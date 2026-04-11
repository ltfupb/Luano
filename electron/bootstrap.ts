/**
 * electron/bootstrap.ts — first-thing-to-run setup
 *
 * MUST be the very first import in main.ts. Runs before anything else can
 * call `app.getPath("userData")`, because Electron caches the resolved path
 * on first access and later `app.setName()` calls don't retroactively move
 * the data directory.
 *
 * Two jobs:
 *  1. Force the Electron product name to "Luano" so userData resolves to
 *     `<appData>/Luano` (capitalized, matching productName convention used
 *     by VS Code, Slack, Discord, Notion).
 *  2. Migrate data from the legacy lowercase `luano` folder (left over from
 *     a startup-ordering bug in versions ≤ 0.7.10) to the new path.
 */

import { app } from "electron"
import { existsSync, readdirSync, renameSync } from "fs"
import { dirname, join } from "path"

app.setName("Luano")

// Fixed temp name lets us recover from a crash between the two rename steps
// on case-insensitive filesystems. A timestamped name would leave orphaned
// data permanently stranded.
const TEMP_NAME = "__luano_rename_tmp"

function migrate(): void {
  const newPath = app.getPath("userData")
  const parent = dirname(newPath)
  if (!existsSync(parent)) return

  let entries: string[]
  try {
    entries = readdirSync(parent)
  } catch {
    return
  }

  const tempPath = join(parent, TEMP_NAME)
  const hasFinal = entries.includes("Luano")
  const hasTemp = entries.includes(TEMP_NAME)

  // Step 1 — recover from a crash mid-rename. If the temp folder exists,
  // a previous launch got through the first renameSync but not the second.
  // Finish the job. If the final folder ALSO exists (genuinely case-sensitive
  // FS with both somehow present), bail out rather than clobber user data.
  if (hasTemp) {
    if (hasFinal) return
    try {
      renameSync(tempPath, newPath)
    } catch {
      // Locked or permission denied — retry next launch.
    }
    return
  }

  // Step 2 — find the legacy folder. readdirSync returns the on-disk casing,
  // so on NTFS/APFS (case-insensitive) this catches "luano" physically stored
  // with any lowercase variant, and on ext4 (case-sensitive) it catches the
  // genuinely-lowercase directory.
  const legacyEntry = entries.find((e) => e.toLowerCase() === "luano" && e !== "Luano")
  if (!legacyEntry) return

  // Step 3 — refuse to clobber if both legacy and "Luano" exist side-by-side
  // (only possible on case-sensitive filesystems). Leave it for manual merge.
  if (hasFinal) return

  // Step 4 — two-step rename. Works uniformly for:
  //   • case-only rename on case-insensitive FS (Windows NTFS, macOS APFS
  //     default) where a direct `luano` → `Luano` is a no-op at OS level
  //   • genuine move on case-sensitive FS (Linux ext4, APFS with
  //     case-sensitive option) where it's a normal directory move
  try {
    renameSync(join(parent, legacyEntry), tempPath)
    renameSync(tempPath, newPath)
  } catch {
    // Best-effort — retry next launch. Data remains accessible via the
    // legacy path on case-insensitive FS, or untouched on case-sensitive FS.
  }
}

try {
  migrate()
} catch {
  // Never block app startup on migration failure.
}
