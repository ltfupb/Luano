/**
 * electron/toolchain/downloader.ts — On-demand tool download from GitHub Releases
 *
 * Downloads tool binaries to userData/binaries/ so they're writable on all platforms.
 */

import { join } from "path"
import { createWriteStream, mkdirSync, existsSync, chmodSync, readdirSync, copyFileSync, rmSync, statSync } from "fs"
import { get as httpsGet } from "https"
import { pipeline } from "stream/promises"
import { execSync } from "child_process"
import { tmpdir } from "os"
import { getUserBinDir, isBinaryAvailable } from "../sidecar"
import { TOOL_REGISTRY } from "./registry"
import { log } from "../logger"

export type DownloadStatus = "not-installed" | "downloading" | "installed" | "error"

const activeDownloads = new Set<string>()

function getPlatformKey(): "win" | "mac" | "linux" {
  if (process.platform === "win32") return "win"
  if (process.platform === "darwin") return "mac"
  return "linux"
}

/** Follow redirects and download a file */
function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (currentUrl: string, depth = 0): void => {
      if (depth > 5) { reject(new Error("Too many redirects")); return }

      httpsGet(currentUrl, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          follow(res.headers.location, depth + 1)
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} downloading ${currentUrl}`))
          return
        }
        const ws = createWriteStream(destPath)
        pipeline(res, ws).then(resolve).catch(reject)
      }).on("error", reject)
    }
    follow(url)
  })
}

/** Extract a zip file to a directory */
function extractZip(zipPath: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true })
  if (process.platform === "win32") {
    execSync(`tar -xf "${zipPath}" -C "${destDir}"`, { stdio: "pipe" })
  } else {
    execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: "pipe" })
  }
}

export async function downloadTool(toolId: string): Promise<{ success: boolean; error?: string }> {
  const tool = TOOL_REGISTRY[toolId]
  if (!tool) return { success: false, error: `Unknown tool: ${toolId}` }
  if (tool.bundled && isBinaryAvailable(tool.binaryName)) return { success: true }
  if (activeDownloads.has(toolId)) return { success: false, error: "Download already in progress" }

  activeDownloads.add(toolId)
  const platform = getPlatformKey()
  const url = tool.releaseUrls[platform]
  const ext = process.platform === "win32" ? ".exe" : ""
  const binDir = getUserBinDir()
  mkdirSync(binDir, { recursive: true })

  const tmpDir = join(tmpdir(), `luano-dl-${toolId}-${Date.now()}`)
  const zipPath = join(tmpDir, `${toolId}.zip`)

  try {
    mkdirSync(tmpDir, { recursive: true })

    log.info(`Downloading ${tool.name} from ${url}`)
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
      f === `${tool.binaryName}${ext}` ||
      f.startsWith(tool.binaryName)
    )
    if (!binFile) {
      throw new Error(`Binary not found in archive. Files: ${files.join(", ")}`)
    }

    // Copy to userData/binaries
    const destPath = join(binDir, `${tool.binaryName}${ext}`)
    copyFileSync(join(extractDir, binFile), destPath)
    if (process.platform !== "win32") {
      chmodSync(destPath, 0o755)
    }

    log.info(`Installed ${tool.name} to ${destPath}`)
    return { success: true }
  } catch (err) {
    const msg = (err as Error).message
    log.error(`Failed to download ${tool.name}: ${msg}`)
    return { success: false, error: msg }
  } finally {
    activeDownloads.delete(toolId)
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

export function getDownloadStatus(toolId: string): DownloadStatus {
  if (activeDownloads.has(toolId)) return "downloading"
  const tool = TOOL_REGISTRY[toolId]
  if (!tool) return "not-installed"
  if (tool.bundled || isBinaryAvailable(tool.binaryName)) return "installed"
  return "not-installed"
}

export function removeTool(toolId: string): { success: boolean; error?: string } {
  const tool = TOOL_REGISTRY[toolId]
  if (!tool) return { success: false, error: `Unknown tool: ${toolId}` }
  if (tool.bundled) return { success: false, error: "Cannot remove bundled tools" }

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
