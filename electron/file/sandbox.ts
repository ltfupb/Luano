import { resolve, normalize, sep } from "path"

/**
 * Validate that a file path is within the allowed project boundary.
 * Prevents path traversal attacks (e.g., "../../etc/passwd").
 *
 * @returns normalized absolute path if valid
 * @throws Error if path escapes the project root
 */
export function validatePath(filePath: string, projectRoot: string): string {
  const normalized = normalize(resolve(projectRoot, filePath))
  const normalizedRoot = normalize(resolve(projectRoot))

  if (normalized !== normalizedRoot && !normalized.startsWith(normalizedRoot + sep)) {
    throw new Error(`Path traversal blocked: ${filePath} is outside project root`)
  }

  return normalized
}

/**
 * Check if a path is within the project root without throwing.
 */
export function isPathSafe(filePath: string, projectRoot: string): boolean {
  try {
    validatePath(filePath, projectRoot)
    return true
  } catch {
    return false
  }
}
