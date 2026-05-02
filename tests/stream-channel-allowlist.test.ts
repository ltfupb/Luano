import { describe, it, expect } from "vitest"
import { STREAM_CHANNEL_RE, isValidStreamChannel } from "../electron/ipc/stream-channel"

// H2 regression guard. The renderer passes streamChannel into ai:chat-stream
// and ai:agent-chat; main forwards it to webContents.send. Without filtering,
// a compromised renderer could request "bridge:update" or "updater:status"
// and hijack legitimate system channels with attacker-controlled payloads.
//
// If a future change widens the regex (e.g. accepts arbitrary suffixes), this
// suite trips so the reviewer is forced to evaluate whether the new format is
// safe to forward.

describe("STREAM_CHANNEL_RE — H2 channel allowlist", () => {
  const VALID = "ai:stream:11111111-1111-1111-1111-111111111111"

  it("accepts canonical ai:stream:<uuid>", () => {
    expect(STREAM_CHANNEL_RE.test(VALID)).toBe(true)
    expect(isValidStreamChannel(VALID)).toBe(true)
  })

  it("accepts canonical ai:agent:<uuid>", () => {
    const ch = "ai:agent:22222222-2222-2222-2222-222222222222"
    expect(STREAM_CHANNEL_RE.test(ch)).toBe(true)
  })

  it("accepts mixed-case hex (case-insensitive flag)", () => {
    const ch = "ai:stream:DEADBEEF-1234-5678-9abc-def012345678"
    expect(STREAM_CHANNEL_RE.test(ch)).toBe(true)
  })

  it.each([
    ["empty",                   ""],
    ["bridge channel",          "bridge:update"],
    ["updater channel",         "updater:status"],
    ["raw IPC name",            "ai:tool-call-result"],
    ["prototype string",        "__proto__"],
    ["wrong prefix",            "x:stream:11111111-1111-1111-1111-111111111111"],
    ["ai but wrong action",     "ai:other:11111111-1111-1111-1111-111111111111"],
    ["missing uuid",            "ai:stream:"],
    ["malformed uuid",          "ai:stream:not-a-uuid"],
    ["uuid with appended cmd",  "ai:stream:11111111-1111-1111-1111-111111111111; rm -rf /"],
    ["trailing newline",        "ai:stream:11111111-1111-1111-1111-111111111111\n"],
    ["leading whitespace",      " ai:stream:11111111-1111-1111-1111-111111111111"],
    ["uuid with non-hex",       "ai:stream:zzzzzzzz-1111-1111-1111-111111111111"]
  ])("rejects %s (%j)", (_, ch) => {
    expect(STREAM_CHANNEL_RE.test(ch)).toBe(false)
    expect(isValidStreamChannel(ch)).toBe(false)
  })

  it.each([null, undefined, 42, {}, []])("rejects non-string %j", (val) => {
    expect(isValidStreamChannel(val)).toBe(false)
  })
})
