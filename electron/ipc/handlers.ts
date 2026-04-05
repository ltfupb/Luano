/**
 * electron/ipc/handlers.ts — IPC handler orchestrator
 *
 * Delegates to domain-specific handler modules.
 * Each module exports a register*Handlers() function.
 */

import { registerAIHandlers } from "./ai-handlers"
import { registerProjectHandlers } from "./project-handlers"
import { registerBridgeHandlers } from "./bridge-handlers"
import { registerTerminalHandlers, cleanupPtys } from "./terminal-handlers"

export { cleanupPtys }

export function registerIpcHandlers(): void {
  registerAIHandlers()
  registerProjectHandlers()
  registerBridgeHandlers()
  registerTerminalHandlers()
}
