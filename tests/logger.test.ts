/**
 * tests/logger.test.ts — log file rotation behavior.
 *
 * Covers:
 *   - Writing when file is under MAX_LOG_SIZE just appends (no rename)
 *   - Writing when file is over MAX_LOG_SIZE triggers rotateCurrentLog
 *     (renameSync called with .<n>.log suffix), then the new line is written
 *   - After rotation, files beyond MAX_LOG_FILES are unlinked (rotateOldLogs)
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => {
  const mockMkdirSync = vi.fn()
  const mockAppendFileSync = vi.fn()
  const mockExistsSync = vi.fn().mockReturnValue(true)
  const mockStatSync = vi.fn()
  const mockRenameSync = vi.fn()
  const mockReaddirSync = vi.fn().mockReturnValue([])
  const mockUnlinkSync = vi.fn()
  return {
    mockMkdirSync, mockAppendFileSync, mockExistsSync, mockStatSync,
    mockRenameSync, mockReaddirSync, mockUnlinkSync,
  }
})

vi.mock("fs", () => ({
  appendFileSync: h.mockAppendFileSync,
  mkdirSync: h.mockMkdirSync,
  existsSync: h.mockExistsSync,
  readdirSync: h.mockReaddirSync,
  unlinkSync: h.mockUnlinkSync,
  statSync: h.mockStatSync,
  renameSync: h.mockRenameSync,
}))

vi.mock("electron", () => ({
  app: {
    getPath: () => "/tmp/luano-test",
    isPackaged: true, // skip stdout mirror
  },
}))

const MAX_LOG_SIZE = 5 * 1024 * 1024

/** Re-import logger fresh so its module-level state (logDir cache) resets. */
async function freshLogger() {
  vi.resetModules()
  return (await import("../electron/logger")).log
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockExistsSync.mockReturnValue(true)
  h.mockReaddirSync.mockReturnValue([])
  h.mockStatSync.mockReturnValue({ size: 100, mtimeMs: Date.now() })
})

describe("logger file rotation", () => {
  it("appends to the current log when file size is under the cap", async () => {
    h.mockStatSync.mockReturnValue({ size: 100, mtimeMs: 0 })

    const log = await freshLogger()
    log.info("hello")

    expect(h.mockAppendFileSync).toHaveBeenCalledTimes(1)
    const [path, line] = h.mockAppendFileSync.mock.calls[0]
    expect(String(path)).toMatch(/luano-\d{4}-\d{2}-\d{2}\.log$/)
    expect(String(line)).toMatch(/\[INFO\] hello\n$/)
    // No rotation
    expect(h.mockRenameSync).not.toHaveBeenCalled()
  })

  it("rotates current log when size exceeds MAX_LOG_SIZE, then writes new line", async () => {
    // write() does: ensureLogDir() → existsSync(logFile) → statSync(logFile)
    // Then if oversized: rotateCurrentLog → existsSync(logFile) [true],
    // existsSync(.1.log) [false], renameSync, rotateOldLogs.
    // Finally appendFileSync.
    //
    // We model this with call-count-based mocks.
    h.mockStatSync.mockReturnValue({ size: MAX_LOG_SIZE + 1, mtimeMs: 0 })

    let existsCall = 0
    h.mockExistsSync.mockImplementation(() => {
      existsCall++
      // call 1: existsSync(logFile) inside write → true (file exists + oversized)
      // call 2: existsSync(logFile) inside rotateCurrentLog → true
      // call 3+: suffix probe existsSync(`${base}.1.log`) → false
      return existsCall <= 2
    })

    const log = await freshLogger()
    log.warn("too big")

    // rotateCurrentLog renamed the logfile to `${base}.1.log`
    expect(h.mockRenameSync).toHaveBeenCalledTimes(1)
    const [from, to] = h.mockRenameSync.mock.calls[0]
    expect(String(from)).toMatch(/luano-\d{4}-\d{2}-\d{2}\.log$/)
    expect(String(to)).toMatch(/luano-\d{4}-\d{2}-\d{2}\.1\.log$/)

    // New line still lands in the original (fresh) log path
    expect(h.mockAppendFileSync).toHaveBeenCalledTimes(1)
    expect(String(h.mockAppendFileSync.mock.calls[0][1])).toMatch(/\[WARN\] too big/)
  })

  it("cleans up old rotation files beyond MAX_LOG_FILES during ensureLogDir", async () => {
    // rotateOldLogs runs inside ensureLogDir. With 7 log files and
    // MAX_LOG_FILES=5, the 2 oldest get unlinked.
    const files = [
      "luano-2026-04-24.log",
      "luano-2026-04-24.1.log",
      "luano-2026-04-24.2.log",
      "luano-2026-04-24.3.log",
      "luano-2026-04-24.4.log",
      "luano-2026-04-24.5.log",
      "luano-2026-04-24.6.log",
    ]
    h.mockReaddirSync.mockReturnValue(files)
    // Give each file a distinct (descending) mtime so sort is well-defined
    let mtime = 7000
    h.mockStatSync.mockImplementation(() => ({
      size: 100,
      mtimeMs: mtime--,
    }))

    const log = await freshLogger()
    log.info("first write — triggers ensureLogDir → rotateOldLogs")

    expect(h.mockUnlinkSync).toHaveBeenCalledTimes(2)
  })
})
