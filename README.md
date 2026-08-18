# pi-runinfra

[RunInfra.ai](https://runinfra.ai) model provider extension for [pi](https://pi.dev/).

Registers the RunInfra OpenAI-compatible endpoint as the `runinfra` provider
with its current model catalog, including cost metadata, reasoning-level
mapping, and the per-request `X-Client-Request-Id` header RunInfra's API
examples expect.

## Models

Prices per 1M tokens (as shown on the RunInfra dashboard).

| Model (id) | Input | Output | Context | State |
|---|---|---|---|---|
| `deepseek-v4-flash` | $0.13 | $0.27 | 1M | Available (cached input $0.01) |
| `deepseek-ai/DeepSeek-V4-Pro-0813` | $0.60 | $1.90 | 1M | Currently unavailable |
| `nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16` | $0.05 | $0.15 | 256K | Available |
| `Qwen/Qwen3.8-27B` | $0.10 | $0.40 | 256K | Available |
| `Inferact/Qwen3.8-2.4T-A95B-NVFP4` | $2.00 | $6.00 | 256K | Available |

## Install

```bash
pi install npm:pi-runinfra
```

Or try it without installing:

```bash
pi -e npm:pi-runinfra
```

> If you previously used the standalone extension at
> `~/.pi/agent/extensions/runinfra.ts`, remove it to avoid double registration:
> `rm ~/.pi/agent/extensions/runinfra.ts`

## API Key

Register your RunInfra workspace key (from https://runinfra.ai → API keys) one
of these ways — any order:

```bash
# 1) Environment variable (matches RunInfra's own docs)
export RUNINFRA_GATEWAY_KEY=sk-...
pi
```

```bash
# 2) pi's native login (stores the key in ~/.pi/agent/auth.json)
/login runinfra
```

```bash
# 3) This package's command (writes ~/.pi/agent/auth.json directly)
/runinfra-key
```

## Usage

```bash
# pick a model interactively
/model → runinfra/deepseek-v4-flash

# or start pi directly on it
pi --provider runinfra --model deepseek-v4-flash
```

## Behavior Notes

- **Reasoning**: RunInfra always applies reasoning to DeepSeek models.
  Omitting `reasoning_effort` means **maximum** effort (more tokens, slower,
  costlier). The extension maps pi thinking levels to explicit effort values
  (`minimal/low → "low"`, `medium → "medium"`, `high → "high"`, `xhigh/max →
  "max"`). `off` is not available for DeepSeek models. If RunInfra rejects a
  value, edit `thinkingLevelMap` in `extensions/runinfra.ts`.
- **Qwen / Nemotron**: registered without thinking parameters since RunInfra's
  support is undocumented. If RunInfra accepts `enable_thinking`, flip
  `reasoning: true` and add `compat.thinkingFormat: "qwen"`.
- **`X-Client-Request-Id`**: a per-request UUID is added to every request via
  the `before_provider_headers` event (retries reuse the same id).
- **System role**: `supportsDeveloperRole: false` — the system prompt is sent
  as `system`, not `developer`, matching DeepSeek/Qwen-style endpoints.

## Overrides

`models.json` overrides compose above this extension's provider, so you can
tune prices, context windows, or endpoints without editing the package:

```json
{
  "providers": {
    "runinfra": {
      "modelOverrides": {
        "deepseek-v4-flash": {
          "maxTokens": 65536,
          "cost": { "input": 0.1, "output": 0.25 }
        }
      }
    }
  }
}
```

## Development

```bash
npm pack --dry-run   # inspect the publish contents
npm login
npm publish         # manual one-off publish (alternative to the CI flow below)
```

## Release Flow (GitHub Actions)

Two workflows are included:

- **`.github/workflows/release.yml`** — release-please: parses conventional
  commits on `main` and opens a release PR that bumps `package.json` and
  updates `CHANGELOG.md`. Merging that PR creates a GitHub Release + tag
  `vX.Y.Z`.
- **`.github/workflows/publish.yml`** — on release published, runs
  `npm publish --provenance` with the `NPM_TOKEN` secret.

### Commit message conventions

```text
feat: add a new model          → minor bump (0.x: 0.1.0 → 0.2.0)
fix: correct pricing metadata   → patch bump (0.1.0 → 0.1.1)
feat!: change provider id      → major bump
```

### Setup checklist

1. Push this repo to GitHub.
2. Add `NPM_TOKEN` to **repo Settings → Secrets and variables → Actions**
   (npm token, "Automation" type to bypass 2FA).
3. Push a conventional commit to `main` — release-please opens the first
   release PR. Merge it → release is created → npm publish runs.

`npm publish --provenance` uses GitHub OIDC (sigstore); remove the
`--provenance` flag and the `id-token: write` permission if you don't want it.

## License

MIT
