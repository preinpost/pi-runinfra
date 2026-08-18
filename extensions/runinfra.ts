/**
 * pi-runinfra — RunInfra.ai model provider extension for pi
 *
 * Registers the RunInfra (https://runinfra.ai) OpenAI-compatible endpoint
 * with its model catalog (prices per 1M tokens, as shown on the dashboard):
 *
 *   deepseek-v4-flash                                  $0.13 / $0.27   1M ctx  (cached in $0.01)
 *   deepseek-ai/DeepSeek-V4-Pro-0813                   $0.60 / $1.90   1M ctx  (currently Unavailable)
 *   nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16  $0.05 / $0.15   256K ctx
 *   Qwen/Qwen3.8-27B                                   $0.10 / $0.40   256K ctx
 *   Inferact/Qwen3.8-2.4T-A95B-NVFP4                   $2.00 / $6.00   256K ctx
 *
 * Model ids are the canonical ones from the RunInfra dashboard; if a request
 * returns "model not found", copy the exact id from the API request generator.
 * (DeepSeek V4 Flash also accepts the short alias `deepseek-v4-flash`.)
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
 * (or: pi --provider runinfra --model deepseek-v4-flash).
 *
 * Notes:
 *   - RunInfra always applies reasoning to DeepSeek models. Omitting
 *     `reasoning_effort` means MAXIMUM effort (more tokens, slower, costlier).
 *     The thinking level map pins explicit effort values per pi thinking
 *     level; adjust if RunInfra rejects a value.
 *   - `X-Client-Request-Id` (a per-request UUID) is added to every request,
 *     as shown in RunInfra's own API examples.
 *   - Qwen/Nemotron models are registered without thinking parameters since
 *     RunInfra's support for them is undocumented; enable via
 *     `compat.thinkingFormat: "qwen"` if RunInfra accepts `enable_thinking`.
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
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash (RunInfra)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0.13, output: 0.27, cacheRead: 0.01, cacheWrite: 0 },
        contextWindow: 1048576,
        maxTokens: 16384,
        // RunInfra always reasons; explicit reasoning_effort is honored.
        thinkingLevelMap: {
          off: null, // cannot disable reasoning on this endpoint
          minimal: "low",
          low: "low",
          medium: "medium",
          high: "high",
          xhigh: "max", // DeepSeek V4 family: xhigh maps to max
          max: "max",
        },
        compat: {
          // DeepSeek-style endpoint: send system prompt as `system`, not `developer`
          supportsDeveloperRole: false,
          supportsReasoningEffort: true,
        },
      },
      {
        id: "deepseek-ai/DeepSeek-V4-Pro-0813",
        name: "DeepSeek V4 Pro (RunInfra)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0.6, output: 1.9, cacheRead: 0, cacheWrite: 0 }, // cached price not listed on dashboard
        contextWindow: 1048576,
        maxTokens: 16384,
        thinkingLevelMap: {
          off: null,
          minimal: "low",
          low: "low",
          medium: "medium",
          high: "high",
          xhigh: "max",
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
        reasoning: false,
        input: ["text"],
        cost: { input: 0.05, output: 0.15, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 262144,
        maxTokens: 16384,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
        },
      },
      {
        id: "Qwen/Qwen3.8-27B",
        name: "Qwen3.8 27B (RunInfra)",
        reasoning: false, // enable via compat.thinkingFormat "qwen" if RunInfra accepts enable_thinking
        input: ["text"],
        cost: { input: 0.1, output: 0.4, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 262144,
        maxTokens: 16384,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
        },
      },
      {
        id: "Inferact/Qwen3.8-2.4T-A95B-NVFP4",
        name: "Qwen3.8 2.4T A95B NVFP4 (RunInfra)",
        reasoning: false, // enable via compat.thinkingFormat "qwen" if RunInfra accepts enable_thinking
        input: ["text"],
        cost: { input: 2.0, output: 6.0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 262144,
        maxTokens: 16384,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
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
