# pi-runinfra

[RunInfra.ai](https://runinfra.ai) model provider extension for [pi](https://pi.dev/).

Registers the RunInfra OpenAI-compatible endpoint as the `runinfra` provider
with its current model catalog, including cost metadata, reasoning-level
mapping, and the per-request `X-Client-Request-Id` header RunInfra's API
examples expect.

## Models

Prices per 1M tokens (as listed on https://runinfra.ai/inference-api).

| Model (id) | Input | Cached input | Output | Context | Input types |
|---|---|---|---|---|---|
| `deepseek-ai/DeepSeek-V4.1-Flash-1017` | $0.15 | $0.01 | $0.60 | 1M | Text, image |
| `deepseek-ai/DeepSeek-V4.1-Flash` | $0.14 | $0.03 | $0.58 | 1M | Text |
| `zai-org/GLM-5.3-Flash` | $0.11 | $0.03 | $0.45 | 1M | Text, image |
| `nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16` | $0.05 | $0.01 | $0.15 | 256K | Text |
| `Qwen/Qwen3.8-27B` | $0.10 | $0.01 | $0.40 | 256K | Text, image |
| `ornith-ai/Ornith-1.5-35B-A3B` | $0.10 | $0.01 | $0.40 | 256K | Text, image |

RunInfra also accepts the short slugs from `GET /v1/models`
(`deepseek-v4-1-flash-1017`, `deepseek-v4-1-flash`, `glm-5-3-flash`,
`nemotron-3-5-lightning-30b`, `qwen3-8-27b`, `ornith-1-5-35b`).

> DeepSeek V4 Flash (`deepseek-v4-flash`) was retired on 2026-09-29, and
> DeepSeek V4 Pro / Qwen3.8 2.4T are no longer served, so they were removed.
> Switch to `deepseek-ai/DeepSeek-V4.1-Flash-1017` or
> `deepseek-ai/DeepSeek-V4.1-Flash`.

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
/model → runinfra/deepseek-ai/DeepSeek-V4.1-Flash-1017

# or start pi directly on it
pi --provider runinfra --model deepseek-ai/DeepSeek-V4.1-Flash-1017
```

## Behavior Notes

- **Reasoning**: every model reasons by default, and omitting
  `reasoning_effort` means the model's default (maximum) effort. The extension
  pins an explicit effort per pi thinking level.
- **DeepSeek / Nemotron / Qwen / Ornith**: `off → "none"` (no reasoning),
  `minimal/low → "low"`, `medium → "medium"`, `high → "high"`,
  `xhigh/max → "max"`. Qwen3.8 rejects `"minimal"`, so it is never sent.
- **GLM 5.3 Flash**: thinking cannot be disabled (`"none"` is rejected), and
  every value other than `low` / `high` is treated as maximum effort, so only
  `low` / `high` / `max` are exposed.
- **Images**: DeepSeek V4.1 Flash 1017, GLM 5.3 Flash, Qwen3.8 27B and
  Ornith 1.5 35B accept image input; the original DeepSeek V4.1 Flash and
  Nemotron are text only.
- **Output budget**: models use a 16,384-token output budget. For DeepSeek
  V4.1 Flash 1017 this follows RunInfra's recommended budget, not the full
  server output limit; override `maxTokens` via `models.json` if needed.
- **`X-Client-Request-Id`**: a per-request UUID is added to every request via
  the `before_provider_headers` event (retries reuse the same id).
- **System role**: `supportsDeveloperRole: false` — the system prompt is sent
  as `system`, not `developer`, matching DeepSeek/Qwen-style endpoints.
- If RunInfra rejects a value, edit `thinkingLevelMap` in
  `extensions/runinfra.ts` or override it via `models.json`.

## Overrides

`models.json` overrides compose above this extension's provider, so you can
tune prices, context windows, or endpoints without editing the package:

```json
{
  "providers": {
    "runinfra": {
      "modelOverrides": {
        "deepseek-ai/DeepSeek-V4.1-Flash": {
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
node --test .github/scripts/release.test.mjs  # release/recovery tests (Node 22+)
npm pack --dry-run                          # inspect the publish contents
```

## Release Flow (GitHub Actions)

Pushing to `main` triggers `.github/workflows/release.yml`, without a release PR.
It can also be started manually on `main`:

1. **Test recovery logic**, then detect the bump type from conventional commits
   since the nearest version tag (`feat:` → minor, `fix:`/`perf:` → patch,
   breaking change → major, including `BREAKING CHANGE:` commit bodies).
2. **Prepare or resume**: create a version-only `chore(release): vX.Y.Z` commit
   and push it with its tag **atomically**. A retry from the original source SHA
   reuses the existing release only after verifying its parent, manifest, changed
   files, and membership in `main`. Tags are never deleted or overwritten.
3. **Create the GitHub Release if missing**, with auto-generated notes.
4. **Check out the verified tag's exact commit** into a separate directory, then
   run `npm publish --provenance` using `NPM_TOKEN`. The package never comes from
   a newer `main` checkout. An already published version is a successful no-op.

`docs:`, `chore:` and `ci:` commits do not bump a version. If the current version
already has a tag, they can finish its missing GitHub Release/npm publication.
A source superseded by unrelated changes fails safely instead of overwriting
`main`. Registry/authentication errors are reported rather than silently treated
as an unpublished version, and recovery cannot move npm's `latest` backward.

### Recover a failed publication

After correcting `NPM_TOKEN` or another publication issue:

- Run **Release** manually on `main` to resume the current tagged version, or
- Run **Publish to npm (manual)** on `main`, entering an existing tag such as
  `v1.3.0`. This only publishes that tag; it does not bump the version or create
  a new tag. The tag must be on `main` and match `package.json`'s version.

Both workflows share the same concurrency group. Repeating either operation is
safe once the version exists on npm.

**Important:** GitHub's **Re-run jobs** uses the workflow and source commit from
that original run. Re-running a run created before this recovery fix still uses
its old logic. Use a new manual run on `main` to pick up workflow fixes.

### Commit message conventions

```text
feat: add a new model          → minor bump (0.x: 0.1.0 → 0.2.0)
fix: correct pricing metadata   → patch bump (0.1.0 → 0.1.1)
feat!: change provider id      → major bump
docs:/chore:/ci:               → no version bump; resume current release if needed
```

### Setup checklist

1. Repo is on GitHub and `NPM_TOKEN` is set in
   **repo Settings → Secrets and variables → Actions**
   (a valid npm token with package write permission and the required 2FA bypass).
   Renew it before expiry; the workflows check authentication before upload.
2. Push a conventional commit to `main` — release + npm publish happen
   automatically.

`npm publish --provenance` uses GitHub OIDC (sigstore) and requires the
`repository` field in `package.json` (already set); remove the
`--provenance` flag and the `id-token: write` permission if you don't want it.

## License

MIT
