# pi-model-router

Let [pi](https://pi.dev) pick the model for you. Select `router/auto`, and each new message you send is sorted into **low**, **medium** or **high** complexity, then answered by the model you assigned to that tier: a quick, cheap model for small questions, a strong one for hard work.

- **Saves money and time.** Easy requests don't go to your most expensive model.
- **Change models without restarting.** Edit the config file and the next message uses it. No `/reload`, no new session.
- **Keeps working when a classifier doesn't.** List several classifiers and the next one takes over; if all fail, the request goes to the high tier.
- **Stays on one model within a reply.** Tool calls and retries keep the model the turn started with, so caching and reasoning carry over.

## Install

```sh
pi install git:github.com/fyang93/pi-model-router
```

Then copy `config.json.example` to `~/.pi/agent/model-router.json`, put in the models you want, restart pi and choose `router/auto` (`pi --model router/auto`).

## Config

```json
{
  "classifier": ["opencode/jev-1.13-free", "openai-codex/gpt-5.6-luna"],
  "low":    { "model": "openai-codex/gpt-5.6-luna", "thinking": "low" },
  "medium": { "model": "openai-codex/gpt-5.6-luna", "thinking": "medium" },
  "high":   { "model": "openai-codex/gpt-5.6-sol",  "thinking": "high" }
}
```

- `low`, `medium`, `high`: any chat model from `pi --list-models`, with its thinking level.
- `classifier`: the model that sorts each message, or a list tried in order. It can be a chat model or one of [pi's classifier models](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md#use-classifier-models). Optional `classifierTimeoutMs` (default 10000) sets how long each one gets.

Sorting costs one small extra call per message you send. The config lives in your pi directory and is never part of the package.

## Development

`node --test test.ts` runs the offline tests; `pi -e ./index.ts --list-models router/auto` loads the local copy.
