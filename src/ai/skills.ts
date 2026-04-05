// AI Slash Command Skills
// Usage: type "/" in chat to see available commands
// Custom skills: .luano/skills.json in project root

export interface Skill {
  command: string
  label: string
  description: string
  /** Prompt template. {selection} = selected code, {file} = current file path */
  prompt: string
  custom?: boolean
}

export const BUILT_IN_SKILLS: Skill[] = [
  {
    command: "/explain",
    label: "Explain",
    description: "Explain the selected code or current file",
    prompt: "Explain the following code in detail. What does it do, and why?\n\n```luau\n{selection}\n```"
  },
  {
    command: "/fix",
    label: "Fix",
    description: "Find and fix bugs in the code",
    prompt: "Find any bugs or issues in this code and fix them. Explain what was wrong.\n\n```luau\n{selection}\n```"
  },
  {
    command: "/optimize",
    label: "Optimize",
    description: "Optimize code for performance",
    prompt: "Optimize this Luau code for better performance following Roblox best practices. Explain each optimization.\n\n```luau\n{selection}\n```"
  },
  {
    command: "/refactor",
    label: "Refactor",
    description: "Refactor code for readability",
    prompt: "Refactor this code to be cleaner and more maintainable. Follow Luau best practices.\n\n```luau\n{selection}\n```"
  },
  {
    command: "/test",
    label: "Test",
    description: "Generate test cases for the code",
    prompt: "Write test cases for the following code. Use assertions and cover edge cases.\n\n```luau\n{selection}\n```"
  },
  {
    command: "/type",
    label: "Add Types",
    description: "Add type annotations to code",
    prompt: "Add complete Luau type annotations to all functions and variables in this code. Use --!strict mode conventions.\n\n```luau\n{selection}\n```"
  },
  {
    command: "/doc",
    label: "Document",
    description: "Add documentation comments",
    prompt: "Add clear documentation comments to this code. Include function descriptions, parameter types, and return values.\n\n```luau\n{selection}\n```"
  },
  {
    command: "/security",
    label: "Security Audit",
    description: "Check for security vulnerabilities",
    prompt: "Audit this Roblox code for security vulnerabilities. Check for: unvalidated remote inputs, client trust issues, exploitable RemoteFunctions, exposed secrets, and missing rate limiting.\n\n```luau\n{selection}\n```"
  },
  {
    command: "/convert",
    label: "Convert to Luau",
    description: "Convert Lua 5.1 code to modern Luau",
    prompt: "Convert this Lua code to modern Luau. Use type annotations, string interpolation, table.create, task library, and other Luau improvements.\n\n```lua\n{selection}\n```"
  },
  {
    command: "/review",
    label: "Code Review",
    description: "Review code for bugs, anti-patterns, and improvements",
    prompt: `Review this Luau code like a senior engineer. Check for:
1. Bugs and logic errors
2. Roblox anti-patterns (yielding in wrong context, memory leaks, unanchored parts)
3. Security issues (unvalidated remote inputs, client trust)
4. Performance problems (unnecessary loops, missing Debris, Connect without Disconnect)
5. Code style and readability

For each issue found, state: severity (bug/warning/suggestion), the exact line, what's wrong, and how to fix it.
If the code is clean, say so briefly.

\`\`\`luau
{selection}
\`\`\``
  },
  {
    command: "/scaffold",
    label: "Scaffold",
    description: "Generate boilerplate for a new system",
    prompt: "Create a complete scaffold for a Roblox game system. Include proper server/client separation, types, and error handling. The system I need: "
  }
]

export function mergeSkills(customSkills: Skill[]): Skill[] {
  const customMap = new Map(customSkills.map((s) => [s.command, { ...s, custom: true }]))
  const merged = BUILT_IN_SKILLS.filter((s) => !customMap.has(s.command))
  return [...merged, ...customMap.values()]
}

export function findSkills(query: string, allSkills: Skill[]): Skill[] {
  const q = query.toLowerCase()
  if (!q.startsWith("/")) return []
  const search = q.slice(1)
  if (!search) return allSkills
  return allSkills.filter(
    (s) => s.command.slice(1).startsWith(search) || s.label.toLowerCase().startsWith(search)
  )
}

export function expandSkill(skill: Skill, selection: string, filePath: string): string {
  return skill.prompt
    .replace("{selection}", selection || "(no code selected \u2014 use current file)")
    .replace("{file}", filePath || "(no file open)")
}
