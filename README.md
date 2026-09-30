# pi-model-router

A Pi 0.99.1 virtual model named `router/auto`. On each new user turn, a chat model or Pi classifier model classifies the request as low, medium, or high complexity. Tool follow-ups and retries stay on their physical model to preserve cache and thinking signatures. Direct requests and classifier failures use the high tier.

## Setup

1. Copy `config.json.example` to `~/.pi/agent/model-router.json` (or `$PI_CODING_AGENT_DIR/model-router.json`) and replace target model IDs with **physical chat** `provider/model` IDs shown by `pi --list-models`. `classifier` accepts either a chat model ID or a Pi classifier model ID (e.g. `typesafe/jev-latest` if authenticated). Pi classifier models do **not** appear in `pi --list-models`; consult [Pi's classifier model list](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md#use-classifier-models). Your config stays outside the package and is not uploaded.
2. Install globally with `pi install git:github.com/fyang93/pi-model-router` and restart Pi. For local development, run `pi -e ./index.ts --list-models router/auto` from this directory. Child Pi sessions must load the package too (including when they use a different `PI_CODING_AGENT_DIR`).
3. Select `pi --model router/auto`, or use it with pi-interactive-subagents, whose Pi child sessions request that model explicitly.

Each new user turn costs one additional classification call before the first response; continuation and retry do not classify again. Pi classifier models use `classify()` with a three-way choice; chat models use `streamSimple()` and answer with one word. The classifier receives at most 12,000 characters of the latest user message. Missing target models cause a clear routing error; classification errors default to the high tier. Change `model-router.json` and restart Pi to apply edits.

Run `node --test test.ts` for an offline check. This package uses Pi's native `registerVirtualModel`, not a custom provider. Jev is optional; other classifier models must first be registered with Pi by a provider extension.
