/**
 * pi-runinfra — RunInfra.ai model provider extension for pi
 *
 * Registers the RunInfra (https://runinfra.ai) OpenAI-compatible endpoint
 * with its model catalog (prices per 1M tokens: input / output, cached input,
 * as listed on https://runinfra.ai/inference-api):
 *
 *   deepseek-ai/DeepSeek-V4.1-Flash                    $0.14 / $0.58   1M ctx    (cached in $0.03)
 *   zai-org/GLM-5.3-Flash                              $0.11 / $0.45   1M ctx    (cached in $0.03, image)
 *   nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16  $0.05 / $0.15   256K ctx  (cached in $0.01)
 *   Qwen/Qwen3.8-27B                                   $0.10 / $0.40   256K ctx  (cached in $0.01, image)
 *   ornith-ai/Ornith-1.5-35B-A3B                       $0.10 / $0.40   256K ctx  (cached in $0.01, image)
 *
 * Model ids are the canonical ones from the RunInfra model pages. RunInfra
 * also accepts the short slugs listed by GET /v1/models (`deepseek-v4-1-flash`,
 * `glm-5-3-flash`, `nemotron-3-5-lightning-30b`, `qwen3-8-27b`,
 * `ornith-1-5-35b`). DeepSeek V4 Flash (`deepseek-v4-flash`) was retired on
 * 2026-09-29; DeepSeek V4 Pro and Qwen3.8 2.4T are no longer served.
 *
 * Usage — register an API key one of these ways (any order):
 *
 *   1. Environment variable (matches RunInfra's own docs):
 *        export RUNINFRA_GATEWAY_KEY=sk-...
 *        pi
 *
 *   2. pi's native login (stores the key in ~/.pi/agent/auth.json):
 *        /login runinfra
 *
 *   3. This extension's command (writes ~/.pi/agent/auth.json directly):
 *        /runinfra-key
 *
 * Then select a model with /model → runinfra/<model>
 * (or: pi --provider runinfra --model deepseek-ai/DeepSeek-V4.1-Flash).
 *
 * Notes:
 *   - Every model reasons by default. Omitting `reasoning_effort` means the
 *     model's default (maximum) effort, so the thinking level map pins an
 *     explicit effort per pi thinking level.
 *   - DeepSeek / Nemotron / Qwen / Ornith accept `reasoning_effort: "none"`,
 *     which pi sends for thinking level `off` to skip reasoning entirely.
 *     Qwen3.8 rejects `"minimal"`, so minimal maps to `"low"` everywhere.
 *   - GLM 5.3 Flash cannot disable thinking (`"none"` is rejected) and treats
 *     every value other than `low` / `high` as maximum effort.
 *   - `X-Client-Request-Id` (a per-request UUID) is added to every request,
 *     as shown in RunInfra's own API examples.
 */

import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER_ID = "runinfra";
const PROVIDER_NAME = "RunInfra";
const BASE_URL = "https://api.runinfra.ai/v1";
const ENV_API_KEY = "$RUNINFRA_GATEWAY_KEY";

// Effort map for models that accept `reasoning_effort: "none"` (thinking off).
const EFFORT_WITH_NONE = {
  off: "none",
  minimal: "low", // Qwen3.8 rejects "minimal"
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "max",
  max: "max",
};

function authFilePath(): string {
  // Respect PI_CODING_AGENT_DIR like pi itself; default ~/.pi/agent
  const dir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  return join(dir, "auth.json");
}

export default function (pi: ExtensionAPI) {
  pi.registerProvider(PROVIDER_ID, {
    name: PROVIDER_NAME,
    baseUrl: BASE_URL,
    apiKey: ENV_API_KEY, // env var or /login registration
    api: "openai-completions",

    models: [
      {
        id: "deepseek-ai/DeepSeek-V4.1-Flash",
        name: "DeepSeek V4.1 Flash (RunInfra)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0.14, output: 0.58, cacheRead: 0.03, cacheWrite: 0 },
        contextWindow: 1048576,
        maxTokens: 16384,
        thinkingLevelMap: EFFORT_WITH_NONE,
        compat: {
          // DeepSeek-style endpoint: send system prompt as `system`, not `developer`
          supportsDeveloperRole: false,
          supportsReasoningEffort: true,
        },
      },
      {
        id: "zai-org/GLM-5.3-Flash",
        name: "GLM 5.3 Flash (RunInfra)",
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 0.11, output: 0.45, cacheRead: 0.03, cacheWrite: 0 },
        contextWindow: 1048576,
        maxTokens: 16384,
        // Flash cannot disable thinking; only low / high differ from max.
        thinkingLevelMap: {
          off: null,
          minimal: null,
          low: "low",
          medium: null,
          high: "high",
          xhigh: null,
          max: "max",
        },
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: true,
        },
      },
      {
        id: "nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16",
        name: "Nemotron 3.5 Lightning 30B (RunInfra)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0.05, output: 0.15, cacheRead: 0.01, cacheWrite: 0 },
        contextWindow: 262144,
        maxTokens: 16384,
        thinkingLevelMap: EFFORT_WITH_NONE,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: true,
        },
      },
      {
        id: "Qwen/Qwen3.8-27B",
        name: "Qwen3.8 27B (RunInfra)",
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0 },
        contextWindow: 262144,
        maxTokens: 16384,
        thinkingLevelMap: EFFORT_WITH_NONE,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: true,
        },
      },
      {
        id: "ornith-ai/Ornith-1.5-35B-A3B",
        name: "Ornith 1.5 35B (RunInfra)",
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0 },
        contextWindow: 262144,
        maxTokens: 16384,
        thinkingLevelMap: EFFORT_WITH_NONE,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: true,
        },
      },
    ],
  });

  // RunInfra's API examples send a per-request X-Client-Request-Id (UUID).
  pi.on("before_provider_headers", (event, ctx) => {
    if (ctx.model?.provider === PROVIDER_ID) {
      event.headers["X-Client-Request-Id"] = randomUUID();
    }
  });

  // Interactive API key registration (fallback to /login runinfra).
  pi.registerCommand("runinfra-key", {
    description: `Register the ${PROVIDER_NAME} API key in auth.json (see also: /login ${PROVIDER_ID})`,
    handler: async (_args, ctx) => {
      const key = await ctx.ui.input(
        `${PROVIDER_NAME} workspace API key (from https://runinfra.ai → API keys):`,
        "",
      );
      if (!key || !key.trim()) {
        ctx.ui.notify("Cancelled — no key entered", "warning");
        return;
      }
      const trimmed = key.trim();

      const file = authFilePath();
      let auth: Record<string, unknown> = {};
      try {
        auth = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
      } catch {
        // No auth.json yet (or invalid JSON) — start fresh
      }

      auth[PROVIDER_ID] = { type: "api_key", key: trimmed };

      await mkdir(join(file, ".."), { recursive: true });
      const tmp = `${file}.tmp`;
      await writeFile(tmp, JSON.stringify(auth, null, 2) + "\n", { mode: 0o600 });
      await chmod(tmp, 0o600);
      await rename(tmp, file);

      ctx.ui.notify(`${PROVIDER_NAME} API key saved to ${file}`, "info");
      ctx.ui.notify(
        "Select a model with /model → runinfra/<model>. Restart pi if models stay unavailable.",
        "info",
      );
    },
  });
}
