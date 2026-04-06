import { ipcMain, BrowserWindow } from "electron"
import { readFileSync } from "fs"
import {
  chat, chatStream, planChat, abortAgent,
  setApiKey, getApiKey,
  setOpenAIKey, getOpenAIKey,
  setGeminiKey, getGeminiKey,
  setLocalEndpoint, getLocalEndpoint,
  setLocalKey, getLocalKey,
  setLocalModel, getLocalModel,
  fetchLocalModels,
  setProvider, setModel, getProviderAndModel,
  MODELS, getTokenUsage, resetTokenUsage
} from "../ai/provider"
import { hasFeature } from "../pro"
import {
  getMemories, addMemory, updateMemory, deleteMemory,
  buildMemoryContext, loadInstructions,
  buildMemoryDetectPrompt, parseMemoryDetectResponse,
  estimateMessagesTokens, buildCompressionPrompt,
  type MemoryType
} from "../ai/memory"
import {
  agentChat, inlineEdit,
  buildGlobalSummary, buildSystemPrompt,
  getLastCheckpoint, revertCheckpoint,
  evaluateCode, evaluateFiles,
  isBridgeConnected, getBridgeTree, getBridgeLogs,
  recordQuery
} from "../pro/modules"
import {
  type AIContext,
  aiGeneratedFiles, PRO_REQUIRED,
  buildFullSystemPrompt, buildRAGContext
} from "./shared"

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
    setLocalEndpoint(endpoint)
    return { success: true }
  })
  ipcMain.handle("ai:get-local-endpoint", () => getLocalEndpoint())
  ipcMain.handle("ai:set-local-key", (_, key: string) => {
    setLocalKey(key)
    return { success: true }
  })
  ipcMain.handle("ai:get-local-key", () => {
    const key = getLocalKey()
    return key || null
  })
  ipcMain.handle("ai:set-local-model", (_, model: string) => {
    setLocalModel(model)
    return { success: true }
  })
  ipcMain.handle("ai:get-local-model", () => getLocalModel())
  ipcMain.handle("ai:fetch-local-models", () => fetchLocalModels())
  ipcMain.handle("ai:set-provider", (_, provider: string) => {
    setProvider(provider as "anthropic" | "openai" | "gemini" | "local")
    return { success: true }
  })
  ipcMain.handle("ai:set-model", (_, model: string) => {
    setModel(model)
    return { success: true }
  })
  ipcMain.handle("ai:get-provider-model", () => {
    return { ...getProviderAndModel(), models: MODELS }
  })
  ipcMain.handle("ai:token-usage", () => getTokenUsage())
  ipcMain.handle("ai:reset-token-usage", () => {
    resetTokenUsage()
    return { success: true }
  })

  // ── AI Context ───────────────────────────────────────────────────────────
  ipcMain.handle("ai:build-context", async (_, projectPath: string, filePath?: string) => {
    const globalSummary = await buildGlobalSummary(projectPath)
    return { globalSummary, filePath: filePath ?? null }
  })

  // ── AI Chat (Basic) ────────────────────────────────────────────────────────
  ipcMain.handle("ai:chat", async (_, messages: unknown[], contextData: unknown) => {
    const ctx = contextData as AIContext
    return chat(messages as never, buildFullSystemPrompt(ctx))
  })

  ipcMain.handle(
    "ai:chat-stream",
    async (_, messages: unknown[], contextData: unknown, streamChannel: string) => {
      const ctx = contextData as AIContext
      const { lastUserMsg, docsContext } = await buildRAGContext(messages)
      await chatStream(messages as never, buildFullSystemPrompt(ctx, { docsContext }), streamChannel)
      recordQuery({ userQuery: lastUserMsg, apisReferenced: [], ragHit: !!docsContext })
      return { success: true }
    }
  )

  // ── Plan Chat ─────────────────────────────────────────────────────────────
  ipcMain.handle("ai:plan-chat", async (_, messages: unknown[], contextData: unknown) => {
    const ctx = contextData as AIContext
    const { docsContext } = await buildRAGContext(messages)
    return planChat(messages as never, buildFullSystemPrompt(ctx, { docsContext }))
  })

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
      const ctx = contextData as { globalSummary: string; currentFile?: string }
      const systemPrompt = buildSystemPrompt({
        globalSummary: ctx.globalSummary ?? "",
        currentFile: filePath
      })
      return inlineEdit(filePath, fileContent, instruction, systemPrompt)
    }
  )

  // ── Agent Abort ────────────────────────────────────────────────────────────
  ipcMain.on("ai:abort", () => { abortAgent() })

  // ── Agent Chat (Tool Use) [Pro] ────────────────────────────────────────────
  ipcMain.handle(
    "ai:agent-chat",
    async (_, messages: unknown[], contextData: unknown, streamChannel: string) => {
      if (!hasFeature("agent")) return PRO_REQUIRED("agent")
      const ctx = contextData as AIContext

      const { lastUserMsg, docsContext } = await buildRAGContext(messages)

      let bridgeContext: string | undefined
      if (isBridgeConnected()) {
        const tree = getBridgeTree()
        const logs = getBridgeLogs()
        const lines: string[] = ["Roblox Studio plugin is connected and live."]
        if (tree) {
          const childCount = tree.children?.length ?? 0
          lines.push(`DataModel root: ${tree.name} [${tree.class}] with ${childCount} top-level services.`)
        }
        const recentErrors = (logs as Array<{ kind: string; text: string }>).filter((l) => l.kind === "error").slice(-5)
        if (recentErrors.length > 0) {
          lines.push("Recent Studio errors:")
          recentErrors.forEach((e: { text: string }) => lines.push(`  [ERROR] ${e.text}`))
        }
        lines.push(
          "You can use read_instance_tree, get_runtime_logs, run_studio_script, and set_property tools to interact with the live Studio session."
        )
        bridgeContext = lines.join("\n")
      }

      const fullPrompt = buildFullSystemPrompt(ctx, { docsContext, bridgeContext, includeProgress: true })
      const result = await agentChat(messages as never, fullPrompt, streamChannel, ctx.projectPath)
      recordQuery({ userQuery: lastUserMsg, apisReferenced: [], ragHit: !!docsContext })

      for (const fp of result.modifiedFiles) {
        try {
          const content = readFileSync(fp, "utf-8")
          aiGeneratedFiles.set(fp, content)
        } catch { /* skip unreadable */ }
      }

      if (result.modifiedFiles.length > 0) {
        BrowserWindow.getAllWindows().forEach((win) => {
          win.webContents.send("agent:checkpoint-available", {
            fileCount: result.modifiedFiles.length,
            files: result.modifiedFiles
          })
        })
      }

      return result
    }
  )

  // ── Agent Checkpoint Revert ──────────────────────────────────────────────
  ipcMain.handle("agent:revert", async () => {
    const checkpoint = getLastCheckpoint()
    if (!checkpoint) return { success: false, message: "No checkpoint available" }
    const reverted = revertCheckpoint(checkpoint)
    return { success: true, reverted }
  })

  // ── AI Evaluator [Pro] ────────────────────────────────────────────────────
  ipcMain.handle("ai:evaluate", async (_, filePath: string, content: string, instruction?: string) => {
    if (!hasFeature("agent")) return PRO_REQUIRED("agent")
    return evaluateCode(filePath, content, instruction)
  })

  ipcMain.handle("ai:evaluate-batch", async (_, files: Array<{ path: string; content: string }>, instruction?: string) => {
    if (!hasFeature("agent")) return PRO_REQUIRED("agent")
    return evaluateFiles(files, instruction)
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
    const ctx = contextData as AIContext
    return chat(
      [{ role: "user", content: `Explain this Roblox Studio error. Possible causes and fix:\n\n${errorText}` }],
      buildFullSystemPrompt(ctx)
    )
  })

  // ── Memory ─────────────────────────────────────────────────────────────────
  ipcMain.handle("memory:list", (_, projectPath: string) => getMemories(projectPath))
  ipcMain.handle("memory:add", (_, projectPath: string, type: MemoryType, content: string) =>
    addMemory(projectPath, type, content)
  )
  ipcMain.handle("memory:update", (_, projectPath: string, id: string, content: string) =>
    updateMemory(projectPath, id, content)
  )
  ipcMain.handle("memory:delete", (_, projectPath: string, id: string) =>
    deleteMemory(projectPath, id)
  )
  ipcMain.handle("memory:context", (_, projectPath: string) =>
    buildMemoryContext(projectPath)
  )

  // ── Project Instructions ──────────────────────────────────────────────────
  ipcMain.handle("instructions:load", (_, projectPath: string) =>
    loadInstructions(projectPath)
  )

  // ── Auto Memory Detection ─────────────────────────────────────────────────
  ipcMain.handle("memory:auto-detect", async (_, projectPath: string, userMsg: string, assistantMsg: string) => {
    const detectPrompt = buildMemoryDetectPrompt(userMsg, assistantMsg)
    try {
      const response = await chat([{ role: "user", content: detectPrompt }], "You extract memories from conversations. Be very selective.")
      return parseMemoryDetectResponse(response, projectPath)
    } catch {
      return []
    }
  })
}
