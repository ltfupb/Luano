/**
 * Allowlist pattern for renderer-supplied stream channel names (H2).
 *
 * Channel names are passed by the renderer into ai:chat-stream / ai:agent-chat
 * and end up at `webContents.send(streamChannel, ...)` in the main process.
 * Without this filter a compromised renderer could pass `bridge:update`,
 * `updater:status`, etc. and have main broadcast attacker-controlled payloads
 * on legitimate system channels — the preload's ALLOWED_CHANNELS only governs
 * what the renderer can listen on, not what main is told to emit.
 *
 * Format: `ai:stream:<uuid-v4>` or `ai:agent:<uuid-v4>`. Case-insensitive on
 * the hex digits because crypto.randomUUID() uses lowercase but consumers may
 * uppercase for display.
 *
 * Lives in its own module so the regex contract is testable without pulling
 * in every electron handler dependency.
 */
export const STREAM_CHANNEL_RE = /^ai:(stream|agent):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidStreamChannel(channel: unknown): channel is string {
  return typeof channel === "string" && STREAM_CHANNEL_RE.test(channel)
}
