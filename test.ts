import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, route } from "./index.ts";

const config = {
  classifier: "provider/small",
  low: { model: "provider/small", thinking: "low" },
  medium: { model: "provider/mid", thinking: "medium" },
  high: { model: "provider/big", thinking: "high" },
} as const;
const models = Object.fromEntries(["small", "mid", "big"].map((id) => [id, { provider: "provider", id, api: "test" }]));
const request = (reason: string, previous?: object) => ({
  reason, previous, messages: [{ role: "user", content: [{ type: "text", text: "Please refactor this module" }] }],
});
const ctx = (reply: string) => ({ modelRegistry: {
  find: (_provider: string, id: string) => models[id],
  findOfType: () => undefined,
  streamSimple: () => ({ result: async () => ({ stopReason: "stop", content: [{ type: "text", text: reply }] }) }),
} });

test("routes each new user turn by classifier answer and keeps continuations/retries sticky", async () => {
  assert.equal((await route(request("user") as any, ctx("low") as any, config)).model.id, "small");
  assert.equal((await route(request("user") as any, ctx("medium") as any, config)).thinkingLevel, "medium");
  assert.equal((await route(request("user") as any, ctx("high") as any, config)).model.id, "big");
  const sticky = { model: models.mid, thinkingLevel: "low" };
  const noClassify = { modelRegistry: { find: () => { throw Error("classified"); } } };
  assert.equal((await route(request("continuation", sticky) as any, noClassify as any, config)).model.id, "mid");
  assert.equal((await route({ ...request("retry"), failed: sticky } as any, noClassify as any, config)).thinkingLevel, "low");
  assert.equal((await route(request("direct") as any, ctx("low") as any, config)).model.id, "big");
});

test("uses Pi's classifier API when the configured model is a classifier", async () => {
  for (const tier of ["low", "medium", "high"] as const) {
    const classifierCtx = { modelRegistry: {
      findOfType: (type: string, provider: string, id: string) => {
        assert.deepEqual([type, provider, id], ["classifier", "provider", "decision"]);
        return { type: "classifier", id };
      },
      classify: async (_model: unknown, input: any) => {
        assert.equal(input.questions.complexity.type, "choice");
        assert.match(input.state.request, /refactor/);
        return { stopReason: "stop", answers: { complexity: { type: "choice", choice: tier } } };
      },
      find: (_provider: string, id: string) => models[id],
      streamSimple: () => { throw Error("should not use chat API"); },
    } };
    assert.equal((await route(request("user") as any, classifierCtx as any, { ...config, classifier: "provider/decision" })).thinkingLevel, config[tier].thinking);
  }
});

test("classifier errors and malformed output fail closed to high", async () => {
  assert.equal((await route(request("user") as any, ctx("other") as any, config)).model.id, "big");
  const broken = { modelRegistry: { ...ctx("low").modelRegistry, streamSimple: () => { throw Error("offline"); } } };
  assert.equal((await route(request("user") as any, broken as any, config)).model.id, "big");
});

test("rejects invalid config and self-routing", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-model-router-"));
  const path = join(dir, "config.json");
  try {
    writeFileSync(path, JSON.stringify(config));
    assert.deepEqual(loadConfig(path), config);
    writeFileSync(path, JSON.stringify({ ...config, low: { model: "router/auto", thinking: "low" } }));
    assert.throws(() => loadConfig(path), /physical provider\/model/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
