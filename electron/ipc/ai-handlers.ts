import { ipcMain } from "electron"
import { readFileSync } from "fs"
import { log } from "../logger"
import {
  chat, chatStream, abortAgent,
  setApiKey, getApiKey,
  setOpenAIKey, getOpenAIKey,
  setGeminiKey, getGeminiKey,
  setLocalEndpoint, getLocalEndpoint,
  setLocalKey, getLocalKey,
  setLocalModel, getLocalModel,
  fetchLocalModels,
  setProvider, setModel, getProviderAndModel,
  setAdvisorEnabled, getAdvisorEnabled,
  setThinkingEffort, getThinkingEffort,
  setAutoAccept, getAutoAccept,
  fetchManagedUsage,
  MODELS, getTokenUsage, resetTokenUsage
} from "../ai/provider"
import { hasFeature } from "../pro"
import {
  getMemories, addMemory, updateMemory, deleteMemory,
  buildMemoryContext, loadInstructions,
  estimateMessagesTokens, buildCompressionPrompt,
  type MemoryType
} from "../ai/memory"
import {
  agentChat, inlineEdit,
  buildGlobalSummary,
  getLastCheckpoint, revertCheckpoint,
  evaluateCode, evaluateFiles,
  isBridgeConnected, getBridgeTree, getBridgeLogs,
  isStudioConnected,
  recordQuery,
  getActiveSessionSenderId, redactSecrets
} from "../pro/modules"
import {
  type AIContext,
  aiGeneratedFiles, PRO_REQUIRED,
  buildFullSystemPrompt,
  requireMatchesCurrentProject,
  requireInProject,
  getCurrentProject
} from "./shared"

import { STREAM_CHANNEL_RE } from "./stream-channel"
export { STREAM_CHANNEL_RE } from "./stream-channel"

export function registerAIHandlers(): void {
  // ── AI Key Management ────────────────────────────────────────────────────────
  ipcMain.handle("ai:setKey", (_, key: string) => {
    setApiKey(key)
    return { success: true }
  })
  ipcMain.handle("ai:get-key", () => {
    const key = getApiKey()
    return key ? "***set***" : null
  })
  ipcMain.handle("ai:set-openai-key", (_, key: string) => {
    setOpenAIKey(key)
    return { success: true }
  })
  ipcMain.handle("ai:get-openai-key", () => {
    const key = getOpenAIKey()
    return key ? "***set***" : null
  })
  ipcMain.handle("ai:set-gemini-key", (_, key: string) => {
    setGeminiKey(key)
    return { success: true }
  })
  ipcMain.handle("ai:get-gemini-key", () => {
    const key = getGeminiKey()
    return key ? "***set***" : null
  })
  ipcMain.handle("ai:set-local-endpoint", (_, endpoint: string) => {
    // Validate the URL — without this, a renderer can persist any string as
    // the local-provider base URL, including `file://`, `javascript:`, or a
    // remote attacker-controlled host. Only accept http(s) loopback by
    // default; non-loopback HTTPS hosts are allowed (user might run a LAN
    // Ollama) but not random schemes.
    if (typeof endpoint !== "string" || endpoint.length === 0) {
      return { success: false, error: "Invalid endpoint" }
    }
    let parsed: URL
    try {
      parsed = new URL(endpoint)
    } catch {
      return { success: false, error: "Invalid URL" }
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { success: false, error: `Endpoint must use http:// or https:// (got ${parsed.protocol})` }
    }
    // M2: non-loopback hostnames must use HTTPS. A LAN Ollama over HTTP is a
    // MitM risk (attacker on the same network can intercept API responses).
    // Loopback (127.0.0.1, ::1, localhost) is exempt — it never leaves the machine.
    // WHATWG URL keeps IPv6 hostnames bracketed (`[::1]`), so strip those before
    // comparing — otherwise `http://[::1]:11434` would be rejected as non-loopback.
    const rawHost = parsed.hostname
    const host = rawHost.startsWith("[") && rawHost.endsWith("]")
      ? rawHost.slice(1, -1)
      : rawHost
    const isLoopback = host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1"
    if (!isLoopback && parsed.protocol === "http:") {
      return { success: false, error: "Non-loopback endpoints must use https://" }
    }
    // Defensive: strip credentials embedded in the URL — they would land in
    // the persisted store and leak into provider request logs.
    if (parsed.username || parsed.password) {
      return { success: false, error: "Endpoint URL must not embed credentials" }
    }
    setLocalEndpoint(parsed.toString())
    return { success: true }
  })
  ipcMain.handle("ai:get-local-endpoint", () => getLocalEndpoint())
  ipcMain.handle("ai:set-local-key", (_, key: string) => {
    setLocalKey(key)
    return { success: true }
  })
  ipcMain.handle("ai:get-local-key", () => {
    const key = getLocalKey()
    return key ? "***set***" : null
  })
  ipcMain.handle("ai:set-local-model", (_, model: string) => {
    setLocalModel(model)
    return { success: true }
  })
  ipcMain.handle("ai:get-local-model", () => getLocalModel())
  ipcMain.handle("ai:fetch-local-models", () => fetchLocalModels())
  ipcMain.handle("ai:set-provider", (_, provider: string) => {
    // Runtime allowlist — the `as` cast in the original code trusted the
    // renderer's string, so a buggy/compromised renderer could install an
    // unknown provider and push the downstream switch into its default
    // branch (or crash). Mirrors the `Provider` union in ai/provider.ts.
    const VALID_PROVIDERS = new Set(["anthropic", "openai", "gemini", "local", "managed"])
    if (typeof provider !== "string" || !VALID_PROVIDERS.has(provider)) {
      return { success: false, error: `Invalid provider: ${String(provider)}` }
    }
    setProvider(provider as "anthropic" | "openai" | "gemini" | "local" | "managed")
    return { success: true }
  })
  ipcMain.handle("ai:set-model", (_, model: string) => {
    // Mirror the `ai:set-provider` allowlist pattern: without this gate, a
    // buggy/compromised renderer can persist any string as the current
    // model, which then flows into provider SDK calls. `local` accepts any
    // user-configured model id (the user types it themselves), so skip
    // validation there; every other provider must match the known list.
    if (typeof model !== "string" || model.length === 0) {
      return { success: false, error: "Invalid model" }
    }
    const { provider } = getProviderAndModel()
    if (provider !== "local") {
      const valid = MODELS[provider].map((m) => m.id)
      if (!valid.includes(model)) {
        return { success: false, error: `Unknown model for ${provider}: ${model}` }
      }
    }
    setModel(model)
    return { success: true }
  })
  ipcMain.handle("ai:get-provider-model", () => {
    return { ...getProviderAndModel(), models: MODELS }
  })
  ipcMain.handle("ai:set-advisor", (_, enabled: boolean) => {
    setAdvisorEnabled(enabled)
    return { success: true }
  })
  ipcMain.handle("ai:get-advisor", () => getAdvisorEnabled())
  ipcMain.handle("ai:set-thinking-effort", (_, effort: string) => {
    const valid = new Set(["low", "medium", "high", "xhigh", "max"])
    if (!valid.has(effort)) return { success: false }
    setThinkingEffort(effort as "low" | "medium" | "high" | "xhigh" | "max")
    return { success: true }
  })
  ipcMain.handle("ai:get-thinking-effort", () => getThinkingEffort())
  ipcMain.handle("ai:set-auto-accept", (_, enabled: boolean) => {
    setAutoAccept(enabled === true)
    return { success: true }
  })
  ipcMain.handle("ai:get-auto-accept", () => getAutoAccept())

  ipcMain.handle("managed:fetch-usage", () => fetchManagedUsage())

  // Menu rebuild — called by renderer when a project opens/closes so items
  // like "Close Project" / "Quick Open" toggle enabled state correctly.
  ipcMain.handle("menu:set-project-state", async (_, hasProject: boolean) => {
    const { installMenu } = await import("../menu")
    const { BrowserWindow } = await import("electron")
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
    installMenu(win, hasProject === true)
    return { success: true }
  })
  ipcMain.handle("ai:token-usage", () => getTokenUsage())
  ipcMain.handle("ai:reset-token-usage", () => {
    resetTokenUsage()
    return { success: true }
  })

  // ── AI Context ───────────────────────────────────────────────────────────
  ipcMain.handle("ai:build-context", async (_, projectPath: string, filePath?: string) => {
    // `buildGlobalSummary` reads files under `projectPath` to build the
    // project overview prompt. A renderer-forged path would let it walk
    // arbitrary filesystem trees — gate on the currently-open project.
    const safeProject = requireMatchesCurrentProject(projectPath)
    const globalSummary = await buildGlobalSummary(safeProject)
    return { globalSummary, filePath: filePath ?? null }
  })

  // ── AI Chat (Basic) ────────────────────────────────────────────────────────
  // `projectPath` from ctx is force-overridden to the trusted current project
  // (set on project:open). This prevents a compromised renderer from steering
  // `buildFullSystemPrompt` into reading LUANO.md / memory / progress from an
  // attacker-chosen directory and exfiltrating it via the model's response.
  ipcMain.handle("ai:chat", async (_, messages: unknown[], contextData: unknown) => {
    const ctx = { ...(contextData as AIContext), projectPath: getCurrentProject() ?? undefined }
    return chat(messages as never, buildFullSystemPrompt(ctx))
  })

  ipcMain.handle(
    "ai:chat-stream",
    async (event, messages: unknown[], contextData: unknown, streamChannel: string) => {
      if (!STREAM_CHANNEL_RE.test(streamChannel)) {
        throw new Error(`Invalid streamChannel format: "${streamChannel}"`)
      }
      const ctx = { ...(contextData as AIContext), projectPath: getCurrentProject() ?? undefined }
      await chatStream(messages as never, buildFullSystemPrompt(ctx), streamChannel, event.sender.id)
      return { success: true }
    }
  )

  // ── Inline Edit (Cmd+K) [Pro] ──────────────────────────────────────────────
  ipcMain.handle(
    "ai:inline-edit",
    async (
      _,
      filePath: string,
      fileContent: string,
      instruction: string,
      contextData: unknown
    ) => {
      if (!hasFeature("inline-edit")) return PRO_REQUIRED("inline-edit")
      // Gate filePath through the sandbox — inline edit can only target files
      // inside the currently-open project. Reject renderer-forged paths.
      const safeFilePath = requireInProject(filePath)
      const ctx = { ...(contextData as AIContext), projectPath: getCurrentProject() ?? undefined }
      const systemPrompt = buildFullSystemPrompt({
        ...ctx,
        currentFile: safeFilePath,
        mode: "chat"
      })
      return inlineEdit(safeFilePath, fileContent, instruction, systemPrompt)
    }
  )

  // ── Agent Abort ────────────────────────────────────────────────────────────
  // Sender-bound: only the renderer that started the active session can abort
  // it. Without this, any renderer (including a compromised one or a second
  // window) could kill another window's in-flight session, abandoning a
  // half-applied edit. ask-user / approval already pin to the owning sender;
  // abort was the missed sibling.
  ipcMain.on("ai:abort", (event) => {
    const owner = getActiveSessionSenderId()
    // No active session OR session was started without a sender id — fall
    // through to abort. The sender mismatch is the case we're guarding.
    if (owner !== undefined && event.sender.id !== owner) return
    abortAgent()
  })

  // ── Agent Chat (Tool Use) [Pro] ────────────────────────────────────────────
  ipcMain.handle(
    "ai:agent-chat",
    async (event, messages: unknown[], contextData: unknown, streamChannel: string, planMode?: boolean) => {
      if (!STREAM_CHANNEL_RE.test(streamChannel)) {
        throw new Error(`Invalid streamChannel format: "${streamChannel}"`)
      }
      if (!hasFeature("agent")) return PRO_REQUIRED("agent")
      // Force the project root to the trusted currently-open project. A
      // renderer-forged ctx.projectPath could redirect agent tools (Write / Edit /
      // Delete / Patch) at arbitrary paths on disk via the validatePath root.
      const trustedProject = getCurrentProject() ?? undefined
      // Fail closed: without a current project, file-path tools (Read /
      // Write / Edit / Delete / etc.) would fall through with no sandbox
      // and operate on raw renderer-supplied paths anywhere on disk. The
      // agent has no business running in that state — refuse outright.
      if (!trustedProject) {
        return { success: false, error: "Open a project before starting an agent session." }
      }
      const ctx: AIContext = { ...(contextData as AIContext), projectPath: trustedProject }

      const lastUserMsg = ((messages as Array<{role:string;content:string}>).findLast(m => m.role === "user")?.content ?? "")

      // Studio session context — surfaces Bridge (runtime I/O) and MCP
      // (Creator Store InsertModel only, post-consolidation) state to the model.
      // Without this, the model hedges about whether Studio is live.
      //
      // Bridge logs originate from the Studio plugin — a malicious plugin
      // could try to inject prompt instructions. The raw text is passed to
      // agentChat which wraps it in a per-turn sentinel'd tool_output block
      // so the model treats it as data, not instructions. We additionally
      // run each runtime log line through `redactSecrets` so anything the
      // plugin printed (Authorization headers, sk- API keys, Bearer tokens
      // in user code) doesn't get exfiltrated to the LLM provider.
      const bridgeOn = isBridgeConnected()
      const mcpOn = await isStudioConnected().catch((err) => {
        log.warn("[ai] isStudioConnected probe failed:", err)
        return false
      })
      let studioContext: string | undefined
      if (bridgeOn || mcpOn) {
        const lines: string[] = []
        if (bridgeOn && mcpOn) {
          lines.push("Roblox Studio is fully connected — Bridge plugin (runtime I/O) + MCP (Creator Store).")
        } else if (bridgeOn) {
          lines.push("Roblox Studio is connected via the Bridge plugin. InsertModel needs Studio's MCP toggle (Assistant widget → '…' → Enable MCP) — mention this to the user only if they ask for an asset insert.")
        } else {
          lines.push("Studio's MCP server is reachable but the Bridge plugin is not installed. Only InsertModel works — ReadInstanceTree, RuntimeLogs, RunScript, and SetProperty will all error. Tell the user to install the Bridge plugin (Studio panel → Install Plugin) for runtime tools.")
        }
        if (bridgeOn) {
          const tree = getBridgeTree()
          const logs = getBridgeLogs()
          if (tree) {
            const childCount = tree.children?.length ?? 0
            lines.push(`DataModel root: ${tree.name} [${tree.class}] with ${childCount} top-level services.`)
          }
          const recentErrors = (logs as Array<{ kind: string; text: string }>).filter((l) => l.kind === "error").slice(-5)
          if (recentErrors.length > 0) {
            lines.push("Recent Studio errors:")
            recentErrors.forEach((e: { text: string }) => lines.push(`  [ERROR] ${redactSecrets(e.text)}`))
          }
        }
        studioContext = lines.join("\n")
      }

      // Build the system prompt WITHOUT bridgeContext — it's injected per-turn
      // by agentChat (wrapped in a sentinel'd tool_output block for prompt-injection
      // hardening). System prompt stays cacheable this way too.
      const fullPrompt = buildFullSystemPrompt(ctx, { includeProgress: true })
      // Pass sender.id so the agent's ask-user / approval IPC handlers can
      // reject responses coming from a different renderer. Prevents a
      // compromised renderer from auto-approving destructive tool calls in
      // another session.
      const result = await agentChat(
        messages as never,
        fullPrompt,
        streamChannel,
        trustedProject,
        planMode === true,
        { senderId: event.sender.id, studioContext }
      )
      recordQuery({ userQuery: lastUserMsg, apisReferenced: [], ragHit: false })

      for (const fp of result.modifiedFiles) {
        try {
          const content = readFileSync(fp, "utf-8")
          aiGeneratedFiles.set(fp, content)
        } catch (err) {
          log.debug("[ai] failed to snapshot AI-generated file:", fp, err)
        }
      }

      if (result.modifiedFiles.length > 0) {
        // H4: send checkpoint notification only to the originating window.
        const senderWc = !event.sender.isDestroyed() ? event.sender : null
        if (senderWc) {
          senderWc.send("agent:checkpoint-available", {
            fileCount: result.modifiedFiles.length,
            files: result.modifiedFiles
          })
        }
      }

      return result
    }
  )

  // ── Agent Checkpoint Revert ──────────────────────────────────────────────
  // H15: gate by sender id — only the renderer that owns the active session
  // may trigger a revert. A second renderer (XSS, extension popup) calling
  // agent:revert could otherwise revert the checkpoint of another renderer's
  // session into wrong-project paths (especially dangerous when combined with C2).
  ipcMain.handle("agent:revert", async (event) => {
    const owner = getActiveSessionSenderId()
    if (owner !== undefined && event.sender.id !== owner) {
      return { success: false, message: "Not session owner" }
    }
    const checkpoint = getLastCheckpoint()
    if (!checkpoint) return { success: false, message: "No checkpoint available" }
    const reverted = revertCheckpoint(checkpoint)
    return { success: true, reverted }
  })

  // ── AI Evaluator [Pro] ────────────────────────────────────────────────────
  // Gate filePath — without this, a renderer-forged path would let the
  // evaluator read+describe arbitrary files on disk via the model response.
  ipcMain.handle("ai:evaluate", async (_, filePath: string, content: string, instruction?: string) => {
    if (!hasFeature("agent")) return PRO_REQUIRED("agent")
    const safePath = requireInProject(filePath)
    return evaluateCode(safePath, content, instruction)
  })

  ipcMain.handle("ai:evaluate-batch", async (_, files: Array<{ path: string; content: string }>, instruction?: string) => {
    if (!hasFeature("agent")) return PRO_REQUIRED("agent")
    if (!Array.isArray(files)) return { success: false, error: "files must be an array" }
    // Validate every path up-front — any single bad path aborts the batch.
    const safeFiles = files.map((f) => ({ path: requireInProject(f.path), content: f.content }))
    return evaluateFiles(safeFiles, instruction)
  })

  // ── Context Compression ───────────────────────────────────────────────────
  ipcMain.handle("ai:compress-messages", async (_, messages: Array<{ role: string; content: string }>) => {
    const prompt = buildCompressionPrompt(messages)
    return chat([{ role: "user", content: prompt }], "You are a concise summarizer.")
  })

  ipcMain.handle("ai:estimate-tokens", (_, messages: Array<{ role: string; content: string }>) =>
    estimateMessagesTokens(messages)
  )

  // ── Error Explainer ───────────────────────────────────────────────────────
  ipcMain.handle("ai:explain-error", async (_, errorText: string, contextData: unknown) => {
    const ctx = { ...(contextData as AIContext), projectPath: getCurrentProject() ?? undefined }
    return chat(
      [{ role: "user", content: `Explain this Roblox Studio error. Possible causes and fix:\n\n${errorText}` }],
      buildFullSystemPrompt(ctx)
    )
  })

  // ── Memory ─────────────────────────────────────────────────────────────────
  // Every handler reads/writes `{projectPath}/.luano/memory.json`. Without
  // the project-match gate, a compromised renderer could read/write JSON at
  // arbitrary filesystem paths under a `.luano/memory.json` suffix.
  ipcMain.handle("memory:list", (_, projectPath: string) => {
    const safeProject = requireMatchesCurrentProject(projectPath)
    return getMemories(safeProject)
  })
  ipcMain.handle("memory:add", (_, projectPath: string, type: MemoryType, content: string) => {
    const safeProject = requireMatchesCurrentProject(projectPath)
    return addMemory(safeProject, type, content)
  })
  ipcMain.handle("memory:update", (_, projectPath: string, id: string, content: string) => {
    const safeProject = requireMatchesCurrentProject(projectPath)
    return updateMemory(safeProject, id, content)
  })
  ipcMain.handle("memory:delete", (_, projectPath: string, id: string) => {
    const safeProject = requireMatchesCurrentProject(projectPath)
    return deleteMemory(safeProject, id)
  })
  ipcMain.handle("memory:context", (_, projectPath: string) => {
    const safeProject = requireMatchesCurrentProject(projectPath)
    return buildMemoryContext(safeProject)
  })

  // ── Project Instructions ──────────────────────────────────────────────────
  // Reads `{projectPath}/LUANO.md` and nested LUANO.md files — renderer-forged
  // path would leak file contents from anywhere on disk into the system prompt.
  ipcMain.handle("instructions:load", (_, projectPath: string) => {
    const safeProject = requireMatchesCurrentProject(projectPath)
    return loadInstructions(safeProject)
  })

}
