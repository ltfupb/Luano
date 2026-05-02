/**
 * electron/toolchain/downloader.ts — On-demand tool download from GitHub Releases
 *
 * Downloads tool binaries to userData/binaries/ so they're writable on all platforms.
 */

import { join, sep } from "path"
import { createReadStream, createWriteStream, mkdirSync, existsSync, chmodSync, readdirSync, copyFileSync, rmSync, statSync, realpathSync } from "fs"
import { createHash } from "crypto"
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
// Hard cap on downloaded archive size. Tool archives in TOOL_REGISTRY are
// all well under 50 MB; 200 MB leaves comfortable headroom for future
// releases while stopping a compromised release URL from exhausting disk /
// RAM before the SHA256 gate can reject the payload.
const MAX_ARCHIVE_SIZE = 200 * 1024 * 1024 // 200 MB
// Hard cap on GitHub API JSON bodies (releases, repo metadata). Real
// payloads are 5-50 KB — anything beyond 256 KB is almost certainly a
// compromised proxy / DNS hijack streaming garbage to OOM us. Keep
// generous enough to absorb any future release with many assets.
const MAX_API_BODY_BYTES = 256 * 1024 // 256 KB
// Per-fetch timeout for GitHub API calls. Without this, a stalled GitHub
// (or a mitm that holds the socket open) hangs the request forever and
// blocks update checks for the lifetime of the process.
const API_FETCH_TIMEOUT_MS = 30_000
// Cap concurrent GitHub fetches so a renderer that submits a huge
// installed-tools list (or a flood of download-all calls) can't fan out
// unbounded promises against the GitHub API.
const MAX_CONCURRENT_FETCHES = 4
// Cap the number of tools a single batch IPC can process. Pairs with the
// per-fetch concurrency cap — concurrency limits in-flight, this limits
// total work submitted in one shot. Real toolchain has < 10 tools so 16
// is generous.
const MAX_BATCH_TOOLS = 16

function getPlatformKey(): "win" | "mac" | "linux" {
  if (process.platform === "win32") return "win"
  if (process.platform === "darwin") return "mac"
  return "linux"
}

/** Resolve a redirect Location header against the current URL and validate
 *  the scheme. We REFUSE to follow `file://`, `data:`, `javascript:`, etc.
 *  — only same-origin-safe https URLs. A malicious or compromised CDN that
 *  redirects to a local-file URL would otherwise let us "download" from
 *  the user's filesystem and feed it through the SHA256 gate. */
function resolveSafeRedirect(currentUrl: string, location: string): string {
  // URL constructor handles both absolute and relative locations.
  // Throws synchronously on a malformed input; caller turns that into a
  // clean rejection rather than letting the throw bubble through the
  // event-emitter callback chain.
  const next = new URL(location, currentUrl)
  if (next.protocol !== "https:") {
    throw new Error(`Refusing to follow non-https redirect: ${next.protocol}//${next.host}`)
  }
  return next.toString()
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
          // Validate redirect target scheme inside try/catch — URL parsing
          // throws synchronously on bad input, and a non-https target also
          // throws. Either way: settle cleanly instead of letting the
          // exception escape the response callback (where it would land
          // in 'uncaughtException').
          let nextUrl: string
          try {
            nextUrl = resolveSafeRedirect(currentUrl, res.headers.location)
          } catch (err) {
            settle(() => reject(err as Error))
            return
          }
          follow(nextUrl, depth + 1)
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

    // Initial URL must also pass the scheme check. Wrap in try so a
    // malformed `url` rejects cleanly rather than throwing into the
    // Promise constructor's callback chain.
    try {
      const initial = new URL(url)
      if (initial.protocol !== "https:") {
        throw new Error(`Refusing to fetch non-https URL: ${initial.protocol}//${initial.host}`)
      }
    } catch (err) {
      settle(() => reject(err as Error))
      return
    }

    follow(url)
  })
}

/** Extract a zip file to a directory.
 *  Uses execFileSync with an argv array so paths containing spaces, non-ASCII
 *  characters (Korean usernames, OneDrive paths), or quote characters can't
 *  break shell interpretation.
 *
 *  Zip-slip protection is two-layer:
 *    1. PRE-extraction: list archive entries and reject any with `..`, a
 *       leading `/` or `\`, or a Windows drive letter. A post-hoc walker
 *       cannot see files written outside destDir (they aren't under the
 *       dir it walks), so by the time we check, the damage is done.
 *    2. POST-extraction: defense in depth — walk the extracted tree and
 *       reject symlinks pointing outside destDir in case the entry-name
 *       check missed a platform-specific quirk. */
function extractZip(zipPath: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true })
  validateArchiveEntryNames(zipPath)
  if (process.platform === "win32") {
    execFileSync("tar", ["-xf", zipPath, "-C", destDir], { stdio: "pipe" })
  } else {
    execFileSync("unzip", ["-o", zipPath, "-d", destDir], { stdio: "pipe" })
  }
  validateNoZipSlip(destDir)
}

/** Enumerate the archive's entry names and reject any that would escape the
 *  destination directory. `tar -tf` works for zip archives on both Windows
 *  (BSD tar, shipped with Windows 10+) and macOS/Linux, so we use one tool.
 *  Runs BEFORE extraction — the post-hoc walker in validateNoZipSlip can't
 *  see files written outside destDir, which is exactly where a zip-slip
 *  entry lands. */
export function validateArchiveEntryNames(zipPath: string): void {
  let listing: string
  try {
    listing = execFileSync("tar", ["-tf", zipPath], { stdio: ["ignore", "pipe", "pipe"] }).toString()
  } catch (err) {
    throw new Error(`Failed to list archive entries for ${zipPath}: ${(err as Error).message}`)
  }
  const entries = listing.split(/\r?\n/).map((e) => e.trim()).filter(Boolean)
  for (const entry of entries) {
    // Absolute path (POSIX or Windows). tar normalizes \\ to / on extract,
    // but the raw entry name can still contain either separator.
    if (entry.startsWith("/") || entry.startsWith("\\")) {
      throw new Error(`Archive contains absolute-path entry (rejected): ${entry}`)
    }
    // Windows drive letter (e.g. `C:\...` or `C:/...`). A drive-qualified
    // path extracted on Windows lands outside destDir regardless of -C.
    if (/^[A-Za-z]:[\\/]/.test(entry)) {
      throw new Error(`Archive contains drive-qualified entry (rejected): ${entry}`)
    }
    // Parent-dir traversal anywhere in the path. `split` handles both
    // separators since a component equal to ".." in either form is a
    // traversal.
    const components = entry.split(/[\\/]/)
    if (components.some((c) => c === "..")) {
      throw new Error(`Archive contains parent-dir traversal entry (rejected): ${entry}`)
    }
  }
}

/** Walk `destDir` and assert every real path stays within it.
 *  Throws on first escape so the caller's try/catch cleans up tmpDir. */
export function validateNoZipSlip(destDir: string): void {
  const rootReal = realpathSync(destDir)
  const rootPrefix = rootReal.endsWith(sep) ? rootReal : rootReal + sep

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      // Reject symlinks outright — resolving them could still point outside
      // even if the parent directory resolves inside. Toolchain archives
      // from upstream releases never contain symlinks, so this is a safe
      // zero-false-positive rule.
      if (entry.isSymbolicLink()) {
        throw new Error(`Archive contains symlink (rejected): ${abs}`)
      }
      const real = realpathSync(abs)
      if (real !== rootReal && !real.startsWith(rootPrefix)) {
        throw new Error(`Archive entry escapes target directory (zip-slip): ${abs} -> ${real}`)
      }
      if (entry.isDirectory()) walk(abs)
    }
  }
  walk(rootReal)
}

/** Compute the SHA256 hex digest of `filePath` by streaming — keeps memory
 *  bounded regardless of archive size. Pairs with the MAX_ARCHIVE_SIZE
 *  pre-check; even if that cap is later loosened, the hasher never pulls the
 *  file into a single Buffer. */
async function streamSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256")
    const stream = createReadStream(filePath)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("end", () => resolve(hash.digest("hex")))
    stream.on("error", reject)
  })
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
export async function downloadAndInstall(
  toolId: string,
  binaryName: string,
  url: string,
  version?: string,
  expectedSha256?: string
): Promise<{ success: boolean; error?: string }> {
  const ext = process.platform === "win32" ? ".exe" : ""
  const binDir = getUserBinDir()
  mkdirSync(binDir, { recursive: true })

  const tmpDir = join(tmpdir(), `luano-dl-${toolId}-${Date.now()}`)
  const zipPath = join(tmpDir, `${toolId}.zip`)

  try {
    // Hash verification gate — runs BEFORE download so a malformed caller
    // can't even trigger a network fetch. A CDN takeover or compromised
    // release tooling could swap a legitimate URL's content for malicious
    // code; we chmod +x and execute this archive's contents, so HTTPS
    // alone isn't enough. expectedSha256 is present only for the pinned
    // version in TOOL_REGISTRY; checkToolUpdates() filters updates that
    // lack a hash before they reach this function.
    //
    // SECURITY CONTRACT: install is refused if no expectedSha256 was passed.
    // Every caller (downloadTool, updateTool) must supply one. The only
    // tool-facing surface that can produce an update without a hash is
    // `checkToolUpdates`, which filters out un-hashed upstream versions
    // before they reach this function.
    if (!expectedSha256) {
      throw new Error(
        `Refusing to install ${toolId} without a verified SHA256. ` +
        `This is a security contract — no install path may bypass hash verification.`
      )
    }

    mkdirSync(tmpDir, { recursive: true })

    log.info(`Downloading ${toolId} from ${url}`)
    await downloadFile(url, zipPath)

    // Verify download
    const stat = statSync(zipPath)
    if (stat.size < 1000) {
      throw new Error(`Downloaded file too small (${stat.size} bytes), likely corrupt`)
    }
    // Enforce a hard archive-size cap BEFORE hashing. A compromised release
    // URL could otherwise serve a multi-GB blob and force us to hash it all
    // just to reject — cap the exposure so an oversized payload fails fast.
    if (stat.size > MAX_ARCHIVE_SIZE) {
      throw new Error(
        `Archive too large (${stat.size} bytes > ${MAX_ARCHIVE_SIZE}) — refusing to hash/install.`
      )
    }
    // Hash verification: stream the file into sha256 instead of readFileSync.
    // A 50+ MB archive would otherwise be held entirely in the main-process
    // heap before the comparison runs; streaming keeps memory bounded.
    const actual = await streamSha256(zipPath)
    if (actual !== expectedSha256) {
      throw new Error(
        `SHA256 mismatch for ${toolId} — expected ${expectedSha256}, got ${actual}. ` +
        `Refusing to install. This usually means the release asset was replaced; ` +
        `please report this at github.com/ltfupb/Luano/issues.`
      )
    }
    log.info(`SHA256 verified for ${toolId}`)

    // Extract
    const extractDir = join(tmpDir, "extracted")
    extractZip(zipPath, extractDir)

    // Find the binary in extracted files. Use an EXACT-match rule so archives
    // containing e.g. `rojo-backup` or `rojo-plugin-settings` don't get
    // mis-selected as the main `rojo` binary. If upstream ever ships the
    // binary under a nested directory, add an explicit lookup there instead
    // of loosening this match.
    const files = readdirSync(extractDir).filter(f => !f.endsWith(".zip"))
    const expectedName = `${binaryName}${ext}`
    const binFile = files.find(f => f === expectedName)
    if (!binFile) {
      throw new Error(`Binary "${expectedName}" not found in archive. Files: ${files.join(", ")}`)
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
    const expectedSha256 = tool.sha256?.[platform]
    return await downloadAndInstall(toolId, tool.binaryName, url, tool.version, expectedSha256)
  } finally {
    activeDownloads.delete(toolId)
  }
}

/** Run async tasks with a hard concurrency cap. Simple worker-pool — no
 *  external dep. Tasks return their own results; this just bounds how many
 *  run at once. Used to keep IPC fan-out from spawning unbounded promises
 *  against the GitHub API or our own download pipeline.
 *
 *  Per-task errors are contained (swallowed internally) so one failing task
 *  does not cancel sibling workers via Promise.all rejection. Callers that
 *  need per-task error details use side-effectful closures (downloadMultiple,
 *  checkToolUpdates) — a throw in one closure would skip its side-effect but
 *  leave the batch running. Slots for failed tasks receive undefined. */
async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<(T | undefined)[]> {
  const results: (T | undefined)[] = new Array(tasks.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= tasks.length) return
      try {
        results[i] = await tasks[i]()
      } catch (err) {
        // Contain the error — log it and leave results[i] as undefined.
        // This ensures sibling workers continue to completion rather than
        // being cancelled by Promise.all rejection.
        log.warn(`[toolchain] runWithConcurrency task ${i} failed:`, err)
        results[i] = undefined
      }
    }
  })
  await Promise.all(workers)
  return results
}

/** Validate, dedupe, and clamp a renderer-supplied tool-id batch.
 *  - Drops non-string entries (a renderer could submit garbage).
 *  - Drops unknown tool ids (TOOL_REGISTRY is the allowlist).
 *  - Dedupes (a renderer could spam the same id 1000x).
 *  - Caps total length at MAX_BATCH_TOOLS so a huge array can't fan out
 *    unbounded promise / memory pressure. */
function sanitizeToolBatch(toolIds: unknown): string[] {
  if (!Array.isArray(toolIds)) return []
  const seen = new Set<string>()
  for (const id of toolIds) {
    if (typeof id !== "string") continue
    if (!TOOL_REGISTRY[id]) continue
    seen.add(id)
    if (seen.size >= MAX_BATCH_TOOLS) break
  }
  return Array.from(seen)
}

/** Download multiple tools in parallel. Returns per-tool results. */
export async function downloadMultiple(toolIds: string[]): Promise<Record<string, { success: boolean; error?: string }>> {
  const safe = sanitizeToolBatch(toolIds)
  const results: Record<string, { success: boolean; error?: string }> = {}
  // Cap concurrency so a renderer that submits the full batch doesn't
  // saturate the network with parallel downloads (each fetches a 5-50 MB
  // archive). MAX_CONCURRENT_FETCHES is plenty for real toolchain installs.
  const tasks = safe.map((id) => async () => {
    results[id] = await downloadTool(id)
  })
  await runWithConcurrency(tasks, MAX_CONCURRENT_FETCHES)
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

/**
 * Fetch a GitHub API JSON endpoint with a hard body-byte cap and a hard
 * per-request timeout. Used by fetchLatestRelease / fetchRepo.
 *
 * Why both caps:
 *  - Body cap defends against a compromised proxy / DNS hijack that
 *    streams unbounded bytes into our `data += chunk.toString()` until
 *    we OOM. Caps at MAX_API_BODY_BYTES and aborts early.
 *  - Timeout defends against a stalled-socket attack: the proxy holds
 *    the connection open without sending bytes, hanging our promise
 *    forever and blocking update checks. Aborts after API_FETCH_TIMEOUT_MS.
 *
 * Returns null on any failure (network, oversize, timeout, parse) so
 * callers can fall back / skip without wrapping each call in try/catch.
 */
async function fetchGitHubJson<T>(url: string): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false
    const settle = (v: T | null): void => { if (!settled) { settled = true; resolve(v) } }

    const req = httpsGet(url, { headers: { "User-Agent": "Luano", Accept: "application/vnd.github+json" } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); settle(null); return }
      const chunks: Buffer[] = []
      let bytes = 0
      res.on("data", (chunk: Buffer) => {
        if (settled) return
        bytes += chunk.byteLength
        if (bytes > MAX_API_BODY_BYTES) {
          // Oversize body — abort the request to free the socket and
          // refuse to parse what we have. A compromised proxy could
          // otherwise stream gigabytes into `data += chunk.toString()`
          // and OOM the main process.
          log.warn(`[toolchain] GitHub API body exceeded cap (${bytes} > ${MAX_API_BODY_BYTES}) for ${url}`)
          req.destroy()
          settle(null)
          return
        }
        chunks.push(chunk)
      })
      res.on("end", () => {
        if (settled) return
        try {
          const text = Buffer.concat(chunks).toString("utf8")
          settle(JSON.parse(text) as T)
        } catch {
          settle(null)
        }
      })
      res.on("error", () => settle(null))
    })

    req.on("error", () => settle(null))
    // Per-fetch timeout — if GitHub stalls (or a mitm holds the socket)
    // the request would otherwise hang forever. setTimeout on the
    // ClientRequest fires when the SOCKET is idle for the duration; we
    // destroy the request to break the wait and resolve null.
    req.setTimeout(API_FETCH_TIMEOUT_MS, () => {
      if (!settled) {
        log.warn(`[toolchain] GitHub API fetch timed out after ${API_FETCH_TIMEOUT_MS}ms: ${url}`)
        req.destroy()
        settle(null)
      }
    })
  })
}

async function fetchLatestRelease(repo: string): Promise<GitHubRelease | null> {
  return fetchGitHubJson<GitHubRelease>(`https://api.github.com/repos/${repo}/releases/latest`)
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
 *
 * NOTE: we only advertise updates whose SHA256 we can verify. For now the
 * registry only pins a hash for the shipped version, so "updates" here are
 * limited to re-installs of the pinned version (e.g. recovery after a
 * manual deletion). Arbitrary newer upstream releases are NOT offered
 * because installing them would require bypassing the SHA256 contract in
 * downloadAndInstall(). When we start pinning multiple versions or fetching
 * signed checksum manifests per release, this filter loosens.
 */
export async function checkToolUpdates(installedIds: string[]): Promise<ToolUpdate[]> {
  const platform = getPlatformKey()
  const updates: ToolUpdate[] = []
  // Sanitize the renderer-supplied list — drop garbage, dedupe, clamp.
  // Without this a malicious / buggy renderer could submit thousands of
  // entries and fan out thousands of GitHub API calls in parallel.
  const safe = sanitizeToolBatch(installedIds)

  const tasks = safe.map((toolId) => async () => {
    const tool = TOOL_REGISTRY[toolId]
    if (!tool) return

    const release = await fetchLatestRelease(tool.github)
    if (!release) return

    const latestVersion = stripVersionPrefix(release.tag_name)
    const currentVersion = getInstalledVersion(toolId) ?? tool.version
    if (latestVersion === currentVersion) return

    // Only advertise the update if the discovered version is the one we
    // have a verified SHA256 for in the registry. Without a hash the
    // downloader refuses to install anyway, so surfacing the update would
    // just mislead users into clicking a button that will fail.
    if (latestVersion !== tool.version || !tool.sha256) {
      log.info(`Skipping ${toolId} update to ${latestVersion}: no verified SHA256 pinned for this version`)
      return
    }

    const url = findAsset(release.assets, tool.assetKeywords[platform])
    if (!url) return

    updates.push({ toolId, currentVersion, latestVersion, downloadUrl: url })
  })

  // Cap concurrency to avoid pummeling the GitHub API rate limit (60/h
  // unauthenticated). With MAX_BATCH_TOOLS=16 and MAX_CONCURRENT_FETCHES=4,
  // a full check fires four batches of four — well under any mitm flood.
  await runWithConcurrency(tasks, MAX_CONCURRENT_FETCHES)
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
  return fetchGitHubJson<GitHubRepo>(`https://api.github.com/repos/${repo}`)
}

export async function fetchToolMetadata(): Promise<Record<string, ToolMetadata>> {
  const cached = store.get<CachedMetadata>(METADATA_CACHE_KEY)
  if (cached && Date.now() - cached.fetchedAt < METADATA_CACHE_TTL) {
    return cached.data
  }

  const result: Record<string, ToolMetadata> = {}
  const tools = Object.values(TOOL_REGISTRY)
  const tasks = tools.map((tool) => async () => {
    const [repo, release] = await Promise.all([
      fetchRepo(tool.github),
      fetchLatestRelease(tool.github)
    ])
    result[tool.id] = {
      license: repo?.license?.spdx_id ?? repo?.license?.name ?? null,
      updatedAt: release?.published_at ?? null
    }
  })
  // Cap concurrency — without this an N-tool registry fans out 2N
  // simultaneous GitHub fetches at app startup (each tool needs both
  // /repos/X and /repos/X/releases/latest).
  await runWithConcurrency(tasks, MAX_CONCURRENT_FETCHES)

  store.set(METADATA_CACHE_KEY, { fetchedAt: Date.now(), data: result })
  return result
}

/**
 * Download and install a specific version of a tool.
 *
 * Hash verification: we only have a pinned SHA256 for `tool.version`.
 * `checkToolUpdates` only advertises updates that match the pinned
 * version, so in practice `latestVersion === tool.version` here and the
 * pinned hash applies. If a caller ever passes a different version we
 * refuse — downloadAndInstall will also refuse on missing sha256, but
 * an early check gives a clearer error.
 *
 * Note: the second arg is intentionally ignored for security. Older
 * callers passed a `downloadUrl` discovered at runtime, but any caller-
 * supplied URL could be used to grind bandwidth / disk with repeatedly
 * failing hash checks. The canonical URL is always looked up from
 * TOOL_REGISTRY based on toolId + version. Kept in the signature to
 * avoid churning every call site.
 */
export async function updateTool(toolId: string, _ignoredDownloadUrl?: string, latestVersion?: string): Promise<{ success: boolean; error?: string }> {
  const tool = TOOL_REGISTRY[toolId]
  if (!tool) return { success: false, error: `Unknown tool: ${toolId}` }
  if (activeDownloads.has(toolId)) return { success: false, error: "Download already in progress" }

  const platform = getPlatformKey()
  const effectiveVersion = latestVersion ?? tool.version
  // Only allow installing the pinned registry version. Any other value is
  // either stale (cached update info) or attacker-supplied — reject early
  // with a clear error rather than waste a download cycle.
  if (effectiveVersion !== tool.version || !tool.sha256) {
    return {
      success: false,
      error: `No verified SHA256 pinned for ${toolId}@${effectiveVersion}. Refusing to install.`
    }
  }
  // Canonical URL from registry — caller-supplied URL is discarded.
  const canonicalUrl = tool.releaseUrls[platform]
  const expectedSha256 = tool.sha256[platform]

  activeDownloads.add(toolId)
  try {
    return await downloadAndInstall(toolId, tool.binaryName, canonicalUrl, effectiveVersion, expectedSha256)
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
