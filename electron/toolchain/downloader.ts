/**
 * electron/toolchain/downloader.ts — On-demand tool download from GitHub Releases
 *
 * Downloads tool binaries to userData/binaries/ so they're writable on all platforms.
 */

import { join } from "path"
import { createWriteStream, mkdirSync, existsSync, chmodSync, readdirSync, copyFileSync, rmSync, statSync } from "fs"
import { get as httpsGet } from "https"
import { pipeline } from "stream/promises"
import { execFileSync } from "child_process"
import { tmpdir } from "os"
import { getUserBinDir, isBinaryAvailable } from "../sidecar"
import { TOOL_REGISTRY } from "./registry"
import { store } from "../store"
import { log } from "../logger"

export type DownloadStatus = "not-installed" | "downloading" | "installed" | "error"

const activeDownloads = new Set<string>()

const DOWNLOAD_TIMEOUT_MS = 30_000
const MAX_RETRIES = 1

function getPlatformKey(): "win" | "mac" | "linux" {
  if (process.platform === "win32") return "win"
  if (process.platform === "darwin") return "mac"
  return "linux"
}

/** Follow redirects and download a file with timeout and retry */
function downloadFile(url: string, destPath: string, attempt = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    let currentReq: ReturnType<typeof httpsGet> | null = null
    let settled = false
    const settle = (fn: () => void) => { if (!settled) { settled = true; fn() } }

    const follow = (currentUrl: string, depth = 0): void => {
      if (depth > 5) { settle(() => reject(new Error("Too many redirects"))); return }

      // Destroy previous request before creating new one (redirect path).
      // Remove its error listener first so a late socket-level error from the
      // destroyed request can't retrigger the retry chain.
      if (currentReq) {
        currentReq.removeAllListeners("error")
        currentReq.destroy()
      }

      currentReq = httpsGet(currentUrl, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume() // drain body to free socket
          follow(res.headers.location, depth + 1)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          settle(() => reject(new Error(`HTTP ${res.statusCode} downloading ${currentUrl}`)))
          return
        }
        clearTimeout(timer)
        const ws = createWriteStream(destPath)
        pipeline(res, ws).then(() => settle(resolve)).catch((e) => settle(() => reject(e)))
      })

      currentReq.on("error", (err) => {
        clearTimeout(timer)
        if (attempt < MAX_RETRIES) {
          log.info(`Download failed (attempt ${attempt + 1}), retrying: ${err.message}`)
          downloadFile(url, destPath, attempt + 1).then(() => settle(resolve)).catch((e) => settle(() => reject(e)))
        } else {
          settle(() => reject(err))
        }
      })
    }

    const timer = setTimeout(() => {
      if (currentReq) currentReq.destroy()  // free the hanging socket
      if (attempt < MAX_RETRIES) {
        log.info(`Download timed out (attempt ${attempt + 1}), retrying...`)
        downloadFile(url, destPath, attempt + 1).then(() => settle(resolve)).catch((e) => settle(() => reject(e)))
      } else {
        settle(() => reject(new Error(`Download timed out after ${DOWNLOAD_TIMEOUT_MS}ms`)))
      }
    }, DOWNLOAD_TIMEOUT_MS)

    follow(url)
  })
}

/** Extract a zip file to a directory.
 *  Uses execFileSync with an argv array so paths containing spaces, non-ASCII
 *  characters (Korean usernames, OneDrive paths), or quote characters can't
 *  break shell interpretation. */
function extractZip(zipPath: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true })
  if (process.platform === "win32") {
    execFileSync("tar", ["-xf", zipPath, "-C", destDir], { stdio: "pipe" })
  } else {
    execFileSync("unzip", ["-o", zipPath, "-d", destDir], { stdio: "pipe" })
  }
}

/** Remove macOS Gatekeeper quarantine attribute from a downloaded binary */
function clearQuarantine(binPath: string): void {
  if (process.platform !== "darwin") return
  try {
    execFileSync("xattr", ["-d", "com.apple.quarantine", binPath], { stdio: "pipe" })
  } catch {
    // Attribute may not exist — not an error
  }
}

/**
 * Core download-and-install logic shared by downloadTool() and updateTool().
 * Downloads a zip from the given URL, extracts it, and copies the binary to userData/binaries.
 */
async function downloadAndInstall(
  toolId: string,
  binaryName: string,
  url: string,
  version?: string
): Promise<{ success: boolean; error?: string }> {
  const ext = process.platform === "win32" ? ".exe" : ""
  const binDir = getUserBinDir()
  mkdirSync(binDir, { recursive: true })

  const tmpDir = join(tmpdir(), `luano-dl-${toolId}-${Date.now()}`)
  const zipPath = join(tmpDir, `${toolId}.zip`)

  try {
    mkdirSync(tmpDir, { recursive: true })

    log.info(`Downloading ${toolId} from ${url}`)
    await downloadFile(url, zipPath)

    // Verify download
    const stat = statSync(zipPath)
    if (stat.size < 1000) {
      throw new Error(`Downloaded file too small (${stat.size} bytes), likely corrupt`)
    }

    // Extract
    const extractDir = join(tmpDir, "extracted")
    extractZip(zipPath, extractDir)

    // Find the binary in extracted files
    const files = readdirSync(extractDir).filter(f => !f.endsWith(".zip"))
    const binFile = files.find(f =>
      f === `${binaryName}${ext}` ||
      f.startsWith(binaryName)
    )
    if (!binFile) {
      throw new Error(`Binary not found in archive. Files: ${files.join(", ")}`)
    }

    // Copy to userData/binaries
    const destPath = join(binDir, `${binaryName}${ext}`)
    copyFileSync(join(extractDir, binFile), destPath)
    if (process.platform !== "win32") {
      chmodSync(destPath, 0o755)
    }
    clearQuarantine(destPath)

    log.info(`Installed ${toolId} to ${destPath}`)
    if (version) setInstalledVersion(toolId, version)
    return { success: true }
  } catch (err) {
    const msg = (err as Error).message
    log.error(`Failed to download ${toolId}: ${msg}`)
    return { success: false, error: msg }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

export async function downloadTool(toolId: string): Promise<{ success: boolean; error?: string }> {
  const tool = TOOL_REGISTRY[toolId]
  if (!tool) return { success: false, error: `Unknown tool: ${toolId}` }
  if (isBinaryAvailable(tool.binaryName)) return { success: true }
  if (activeDownloads.has(toolId)) return { success: false, error: "Download already in progress" }

  activeDownloads.add(toolId)
  try {
    const platform = getPlatformKey()
    const url = tool.releaseUrls[platform]
    return await downloadAndInstall(toolId, tool.binaryName, url, tool.version)
  } finally {
    activeDownloads.delete(toolId)
  }
}

/** Download multiple tools in parallel. Returns per-tool results. */
export async function downloadMultiple(toolIds: string[]): Promise<Record<string, { success: boolean; error?: string }>> {
  const results: Record<string, { success: boolean; error?: string }> = {}
  const promises = toolIds.map(async (id) => {
    results[id] = await downloadTool(id)
  })
  await Promise.all(promises)
  return results
}

export function getDownloadStatus(toolId: string): DownloadStatus {
  if (activeDownloads.has(toolId)) return "downloading"
  const tool = TOOL_REGISTRY[toolId]
  if (!tool) return "not-installed"
  if (isBinaryAvailable(tool.binaryName)) return "installed"
  return "not-installed"
}

// ── Update Checking ──────────────────────────────────────────────────────────

export interface ToolUpdate {
  toolId: string
  currentVersion: string
  latestVersion: string
  downloadUrl: string
}

interface GitHubRelease {
  tag_name: string
  published_at: string | null
  assets: Array<{ name: string; browser_download_url: string }>
}

interface GitHubRepo {
  license: { spdx_id: string | null; name: string | null } | null
}

function stripVersionPrefix(tag: string): string {
  return tag.replace(/^v/, "").replace(/\+.*$/, "")
}

function getInstalledVersion(toolId: string): string | null {
  const versions = store.get<Record<string, string>>("toolchain.installedVersions") ?? {}
  return versions[toolId] ?? null
}

function setInstalledVersion(toolId: string, version: string): void {
  const versions = store.get<Record<string, string>>("toolchain.installedVersions") ?? {}
  versions[toolId] = version
  store.set("toolchain.installedVersions", versions)
}

async function fetchLatestRelease(repo: string): Promise<GitHubRelease | null> {
  const url = `https://api.github.com/repos/${repo}/releases/latest`
  return new Promise((resolve) => {
    httpsGet(url, { headers: { "User-Agent": "Luano", Accept: "application/vnd.github+json" } }, (res) => {
      if (res.statusCode !== 200) { resolve(null); res.resume(); return }
      let data = ""
      res.on("data", (chunk: Buffer) => { data += chunk.toString() })
      res.on("end", () => {
        try { resolve(JSON.parse(data)) } catch { resolve(null) }
      })
    }).on("error", () => resolve(null))
  })
}

function findAsset(assets: GitHubRelease["assets"], keywords: string[]): string | null {
  const match = assets.find(a => {
    const name = a.name.toLowerCase()
    return name.endsWith(".zip") && keywords.every(k => name.includes(k.toLowerCase()))
  })
  return match?.browser_download_url ?? null
}

/**
 * Check all installed tools for available updates.
 * Only checks tools that are actually installed on disk.
 */
export async function checkToolUpdates(installedIds: string[]): Promise<ToolUpdate[]> {
  const platform = getPlatformKey()
  const updates: ToolUpdate[] = []

  const checks = installedIds.map(async (toolId) => {
    const tool = TOOL_REGISTRY[toolId]
    if (!tool) return

    const release = await fetchLatestRelease(tool.github)
    if (!release) return

    const latestVersion = stripVersionPrefix(release.tag_name)
    const currentVersion = getInstalledVersion(toolId) ?? tool.version
    if (latestVersion === currentVersion) return

    const url = findAsset(release.assets, tool.assetKeywords[platform])
    if (!url) return

    updates.push({ toolId, currentVersion, latestVersion, downloadUrl: url })
  })

  await Promise.all(checks)
  return updates
}

// ── Metadata (license, pushed_at) with 24h cache ─────────────────────────────

export interface ToolMetadata {
  license: string | null
  updatedAt: string | null
}

const METADATA_CACHE_KEY = "toolchain.metadataCache.v2"
const METADATA_CACHE_TTL = 24 * 60 * 60 * 1000

interface CachedMetadata {
  fetchedAt: number
  data: Record<string, ToolMetadata>
}

async function fetchRepo(repo: string): Promise<GitHubRepo | null> {
  const url = `https://api.github.com/repos/${repo}`
  return new Promise((resolve) => {
    httpsGet(url, { headers: { "User-Agent": "Luano", Accept: "application/vnd.github+json" } }, (res) => {
      if (res.statusCode !== 200) { resolve(null); res.resume(); return }
      let data = ""
      res.on("data", (chunk: Buffer) => { data += chunk.toString() })
      res.on("end", () => {
        try { resolve(JSON.parse(data)) } catch { resolve(null) }
      })
    }).on("error", () => resolve(null))
  })
}

export async function fetchToolMetadata(): Promise<Record<string, ToolMetadata>> {
  const cached = store.get<CachedMetadata>(METADATA_CACHE_KEY)
  if (cached && Date.now() - cached.fetchedAt < METADATA_CACHE_TTL) {
    return cached.data
  }

  const result: Record<string, ToolMetadata> = {}
  const fetches = Object.values(TOOL_REGISTRY).map(async (tool) => {
    const [repo, release] = await Promise.all([
      fetchRepo(tool.github),
      fetchLatestRelease(tool.github)
    ])
    result[tool.id] = {
      license: repo?.license?.spdx_id ?? repo?.license?.name ?? null,
      updatedAt: release?.published_at ?? null
    }
  })
  await Promise.all(fetches)

  store.set(METADATA_CACHE_KEY, { fetchedAt: Date.now(), data: result })
  return result
}

/**
 * Download and install a specific version of a tool from a direct URL.
 */
export async function updateTool(toolId: string, downloadUrl: string, latestVersion?: string): Promise<{ success: boolean; error?: string }> {
  const tool = TOOL_REGISTRY[toolId]
  if (!tool) return { success: false, error: `Unknown tool: ${toolId}` }
  if (activeDownloads.has(toolId)) return { success: false, error: "Download already in progress" }

  activeDownloads.add(toolId)
  try {
    return await downloadAndInstall(toolId, tool.binaryName, downloadUrl, latestVersion)
  } finally {
    activeDownloads.delete(toolId)
  }
}

export function removeTool(toolId: string): { success: boolean; error?: string } {
  const tool = TOOL_REGISTRY[toolId]
  if (!tool) return { success: false, error: `Unknown tool: ${toolId}` }

  const ext = process.platform === "win32" ? ".exe" : ""
  const binPath = join(getUserBinDir(), `${tool.binaryName}${ext}`)

  if (existsSync(binPath)) {
    try {
      rmSync(binPath)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }
  return { success: true }
}
