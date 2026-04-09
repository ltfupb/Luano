import { readFileSync, readdirSync, statSync, existsSync } from "fs"
import { join, extname, relative } from "path"

// ── Types ─────────────────────────────────────────────────────────────────────

export type Severity = "error" | "warn" | "info"

export interface PerfWarning {
  file: string
  line: number
  rule: string
  message: string
  severity: Severity
  suggestion?: string
}

// ── Rules ─────────────────────────────────────────────────────────────────────

interface LintRule {
  id: string
  severity: Severity
  pattern: RegExp
  message: string
  suggestion?: string
  /** true면 해당 패턴이 없으면 경고 안 함, 있으면 라인별 체크 */
  lineLevel: boolean
}

const RULES: LintRule[] = [
  {
    id: "no-wait-in-loop",
    severity: "error",
    pattern: /\bwait\s*\(/,
    message: "wait() is deprecated. Use task.wait() instead",
    suggestion: "task.wait()",
    lineLevel: true
  },
  {
    id: "no-spawn",
    severity: "warn",
    pattern: /\bspawn\s*\(/,
    message: "spawn() is deprecated. Use task.spawn() instead",
    suggestion: "task.spawn()",
    lineLevel: true
  },
  {
    id: "no-delay",
    severity: "warn",
    pattern: /\bdelay\s*\(/,
    message: "delay() is deprecated. Use task.delay() instead",
    suggestion: "task.delay()",
    lineLevel: true
  },
  {
    id: "instance-new-in-loop",
    severity: "warn",
    pattern: /Instance\.new\s*\(/,
    message: "Instance.new() in a loop causes performance issues. Consider object pooling or Clone()",
    suggestion: "template:Clone()",
    lineLevel: true
  },
  {
    id: "heartbeat-no-disconnect",
    severity: "error",
    pattern: /RunService\s*[.:]\s*(?:Heartbeat|RenderStepped|Stepped)\s*[.:]\s*Connect\s*\(/,
    message: "RunService event connection requires Disconnect(). Memory leak risk",
    suggestion: "local conn = RunService.Heartbeat:Connect(...) → conn:Disconnect()",
    lineLevel: true
  },
  {
    id: "find-first-child-in-loop",
    severity: "info",
    pattern: /FindFirstChild\s*\(/,
    message: "Repeated FindFirstChild calls in a loop are inefficient. Cache in a variable",
    lineLevel: true
  },
  {
    id: "no-pairs-ipairs",
    severity: "info",
    pattern: /\bipairs\s*\(/,
    message: "In Luau, ipairs() is not needed. Use plain for loop instead (auto-optimized)",
    suggestion: "for i, v in array do",
    lineLevel: true
  },
  {
    id: "string-concat-in-loop",
    severity: "warn",
    pattern: /\.\.\s*["']/,
    message: "String concatenation (..) in a loop causes performance issues. Use table.concat()",
    suggestion: "table.concat(parts)",
    lineLevel: true
  },
  {
    id: "getchildren-in-loop",
    severity: "warn",
    pattern: /:GetChildren\s*\(\s*\)/,
    message: "Repeated GetChildren() calls in a loop are inefficient. Cache in a variable",
    lineLevel: true
  },
  {
    id: "no-loadstring",
    severity: "error",
    pattern: /\bloadstring\s*\(/,
    message: "loadstring() is disabled in Roblox. Cannot be used",
    lineLevel: true
  },
]

// ── 루프 안 감지 헬퍼 ─────────────────────────────────────────────────────────

function isInsideLoop(lines: string[], lineIndex: number): boolean {
  let depth = 0
  for (let i = lineIndex; i >= 0; i--) {
    const trimmed = lines[i].trim()
    if (/^end\b/.test(trimmed)) depth++
    if (/\b(?:for|while|repeat)\b/.test(trimmed)) {
      if (depth === 0) return true
      depth--
    }
  }
  return false
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function walkLuau(dir: string): string[] {
  const out: string[] = []
  if (!existsSync(dir)) return out
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      try {
        const stat = statSync(full)
        if (stat.isDirectory() && !entry.startsWith(".") && entry !== "node_modules") {
          out.push(...walkLuau(full))
        } else if (stat.isFile() && (extname(entry) === ".lua" || extname(entry) === ".luau")) {
          out.push(full)
        }
      } catch {}
    }
  } catch {}
  return out
}

// ── 루프 민감 룰 목록 ─────────────────────────────────────────────────────────

const LOOP_SENSITIVE_RULES = new Set([
  "instance-new-in-loop",
  "find-first-child-in-loop",
  "string-concat-in-loop",
  "getchildren-in-loop"
])

// ── Main ──────────────────────────────────────────────────────────────────────

export function performanceLint(projectPath: string): PerfWarning[] {
  const srcDir = join(projectPath, "src")
  const allFiles = walkLuau(srcDir)
  const warnings: PerfWarning[] = []

  for (const absPath of allFiles) {
    const relPath = relative(projectPath, absPath).replace(/\\/g, "/")
    let src: string
    try { src = readFileSync(absPath, "utf-8") } catch { continue }

    const lines = src.split("\n")

    for (const rule of RULES) {
      if (!rule.lineLevel) continue

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]

        // 주석 건너뛰기
        const trimmed = line.trim()
        if (trimmed.startsWith("--")) continue

        if (rule.pattern.test(line)) {
          // 루프 민감 룰은 루프 안에서만 경고
          if (LOOP_SENSITIVE_RULES.has(rule.id) && !isInsideLoop(lines, i)) {
            continue
          }

          warnings.push({
            file: relPath,
            line: i + 1,
            rule: rule.id,
            message: rule.message,
            severity: rule.severity,
            suggestion: rule.suggestion
          })
        }
      }
    }

    // Heartbeat disconnect 체크 (파일 레벨)
    const heartbeatConnects = (src.match(/(?:Heartbeat|RenderStepped|Stepped)\s*[.:]\s*Connect/g) || []).length
    const disconnects = (src.match(/\bDisconnect\s*\(\s*\)/g) || []).length
    if (heartbeatConnects > 0 && disconnects === 0) {
      // 이미 라인 레벨에서 잡았으므로 severity를 유지
    }
  }

  return warnings
}

export function performanceLintFile(filePath: string, content: string): PerfWarning[] {
  const warnings: PerfWarning[] = []
  const lines = content.split("\n")

  for (const rule of RULES) {
    if (!rule.lineLevel) continue

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()
      if (trimmed.startsWith("--")) continue

      if (rule.pattern.test(line)) {
        if (LOOP_SENSITIVE_RULES.has(rule.id) && !isInsideLoop(lines, i)) {
          continue
        }

        warnings.push({
          file: filePath,
          line: i + 1,
          rule: rule.id,
          message: rule.message,
          severity: rule.severity,
          suggestion: rule.suggestion
        })
      }
    }
  }

  return warnings
}
