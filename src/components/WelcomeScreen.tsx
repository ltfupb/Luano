import { useProjectStore } from "../stores/projectStore"
import { useAIStore } from "../stores/aiStore"

export function WelcomeScreen(): JSX.Element {
  const { setProject, setFileTree } = useProjectStore()
  const { setGlobalSummary } = useAIStore()

  const handleOpenFolder = async () => {
    const path = await window.api.openFolder()
    if (!path) return

    const { success, lspPort } = await window.api.openProject(path)
    if (!success) return

    const tree = await window.api.readDir(path)
    const { globalSummary } = await window.api.buildContext(path)

    setProject(path, tree as never, lspPort)
    setGlobalSummary(globalSummary)
  }

  return (
    <div className="flex flex-col h-screen bg-[#1a1a2e] items-center justify-center">
      <div className="drag-region absolute top-0 left-0 right-0 h-8" />

      <div className="flex flex-col items-center gap-8 max-w-md w-full px-8">
        {/* Logo */}
        <div className="text-center">
          <h1 className="text-5xl font-bold text-[#eaeaea] tracking-tight">Luano</h1>
          <p className="mt-2 text-[#a0a0b0] text-sm">Roblox Vibe Coding Editor</p>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-3 w-full">
          <button
            onClick={handleOpenFolder}
            className="w-full py-3 px-6 bg-[#e94560] hover:bg-[#c73652] text-white rounded-lg font-medium transition-colors"
          >
            Open Folder
          </button>
          <button
            className="w-full py-3 px-6 bg-[#16213e] hover:bg-[#1e2d5a] text-[#eaeaea] rounded-lg font-medium border border-[#2a2a4a] transition-colors"
            disabled
          >
            New Project (coming soon)
          </button>
        </div>

        {/* API key setup */}
        <ApiKeySetup />

        {/* Hint */}
        <div className="text-xs text-[#606070]">
          Open a Rojo project folder to get started
        </div>
      </div>
    </div>
  )
}

function ApiKeySetup(): JSX.Element {
  const handleSetKey = async () => {
    const key = prompt("Enter your Claude API key:")
    if (!key) return
    await (window as never as { api: { aiSetKey?: (k: string) => Promise<void> } }).api?.aiSetKey?.(key)
    alert("API key saved.")
  }

  return (
    <button
      onClick={handleSetKey}
      className="text-xs text-[#a0a0b0] hover:text-[#eaeaea] underline transition-colors"
    >
      Set Claude API Key
    </button>
  )
}
