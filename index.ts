import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI, ExtensionContext, ModelRouteRequest } from "@earendil-works/pi-coding-agent";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";

type Tier = "low" | "medium" | "high";
type Target = { model: string; thinking: ModelThinkingLevel };
type Config = { classifier: string | string[]; classifierTimeoutMs?: number } & Record<Tier, Target>;

const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

function modelParts(ref: unknown): [string, string] {
  if (typeof ref !== "string") throw new Error("Expected a physical provider/model");
  const slash = ref.indexOf("/");
  if (slash < 1 || slash === ref.length - 1 || ref === "router/auto") {
    throw new Error(`Expected a physical provider/model, got ${JSON.stringify(ref)}`);
  }
  return [ref.slice(0, slash), ref.slice(slash + 1)];
}

export function loadConfig(path: string): Config {
  const config = JSON.parse(readFileSync(path, "utf8"));
  if (!config || typeof config !== "object") throw new Error("Router config must be an object");
  // One classifier or a fallback list, tried in order (e.g. a quota-limited classifier, then a chat model).
  const classifiers = [config.classifier].flat();
  if (!classifiers.length) throw new Error("classifier needs at least one provider/model");
  classifiers.forEach(modelParts);
  for (const tier of ["low", "medium", "high"] as const) {
    modelParts(config[tier]?.model);
    if (!levels.includes(config[tier].thinking)) {
      throw new Error(`Invalid ${tier}.thinking: ${config[tier].thinking}`);
    }
  }
  return config;
}

/** A hanging classifier must not hold up the turn; past this the next one in the list is tried. */
const DEFAULT_CLASSIFIER_TIMEOUT_MS = 10_000;

const isTier = (value: unknown): value is Tier => value === "low" || value === "medium" || value === "high";

/** One classifier's answer, or undefined when it is unavailable, out of quota or answers out of range. */
async function classify(ref: string, text: string, ctx: ExtensionContext, signal?: AbortSignal): Promise<Tier | undefined> {
  const [provider, id] = modelParts(ref);
  const classifier = ctx.modelRegistry.findOfType("classifier", provider, id);
  if (classifier) {
    const result = await ctx.modelRegistry.classify(classifier, {
      state: { request: text.slice(0, 12_000) },
      questions: { complexity: {
        type: "choice",
        instructions: "How complex is this coding request? When unsure, choose high.",
        criteria: {
          low: "Lookup, summary, or trivial change",
          medium: "Focused implementation or debugging",
          high: "Architecture, broad refactor, risky or ambiguous work",
        },
      } },
    }, { signal });
    const answer = result.answers.complexity;
    return result.stopReason === "stop" && answer?.type === "choice" && isTier(answer.choice) ? answer.choice : undefined;
  }
  const model = ctx.modelRegistry.find(provider, id);
  if (!model || model.api === "pi-virtual") return undefined;
  const stream = ctx.modelRegistry.streamSimple(model, {
    messages: [{ role: "user", content: `Classify the complexity of this coding request. Reply with exactly one word: low, medium, or high.\nlow: lookup, summary, trivial change.\nmedium: focused implementation or debugging.\nhigh: architecture, broad refactor, risky or ambiguous work.\nWhen unsure, choose high.\n\nRequest:\n${text.slice(0, 12_000)}`, timestamp: Date.now() }],
  }, { maxTokens: 64, signal });
  const result = await stream.result();
  const response = result.content.filter((part) => part.type === "text").map((part) => part.text).join("").trim().toLowerCase();
  return result.stopReason === "stop" && isTier(response) ? response : undefined;
}

export async function route(request: ModelRouteRequest, ctx: ExtensionContext, config: Config) {
  const sticky = request.reason === "retry" ? request.failed ?? request.previous : request.previous;
  if (request.reason === "retry" || request.reason === "continuation") {
    if (sticky) return { model: sticky.model, thinkingLevel: sticky.thinkingLevel ?? "medium" as const };
  }

  let tier: Tier = "high"; // On classifier failure, prefer quality over a silent downgrade.
  if (request.reason === "user") {
    const user = request.messages.findLast((message) => message.role === "user");
    const text = typeof user?.content === "string"
      ? user.content
      : user?.content.filter((part) => part.type === "text").map((part) => part.text).join("\n") ?? "";
    if (text.trim()) {
      for (const ref of [config.classifier].flat()) {
        try {
          const timeout = AbortSignal.timeout(config.classifierTimeoutMs ?? DEFAULT_CLASSIFIER_TIMEOUT_MS);
          const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
          const answer = await classify(ref, text, ctx, signal);
          if (answer) {
            tier = answer;
            break;
          }
        } catch (error) {
          if (request.signal?.aborted) throw error;
        }
      }
    }
  }

  const target = config[tier];
  const model = ctx.modelRegistry.find(...modelParts(target.model));
  if (!model || model.api === "pi-virtual") throw new Error(`Routing target ${target.model} is not a physical model in Pi's catalog`);
  return { model, thinkingLevel: target.thinking };
}

export default function (pi: ExtensionAPI) {
  const configPath = join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "model-router.json");
  let config = loadConfig(configPath);
  let configMtime = statSync(configPath).mtimeMs;
  pi.registerVirtualModel({
    provider: "router",
    id: "auto",
    name: "Auto Model",
    route: (request, ctx) => {
      if (request.reason === "user") {
        const mtime = statSync(configPath).mtimeMs;
        if (mtime !== configMtime) {
          config = loadConfig(configPath);
          configMtime = mtime;
        }
      }
      return route(request, ctx, config);
    },
  });
}
