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
    command: "/compact",
    label: "Compact",
    description: "Summarize the conversation to save context",
    prompt: "Summarize our entire conversation so far into a concise context note. Include: what we've built or changed, key decisions made, and what we were working on. Be very concise — under 200 words."
  },
  {
    command: "/clear",
    label: "Clear",
    description: "Clear all chat messages",
    prompt: "/clear"
  },
  {
    command: "/review",
    label: "Review",
    description: "Code review for the current file — bugs, anti-patterns, readability",
    prompt: `Review this Luau code like a senior Roblox engineer. Check for:

1. **Bugs** — logic errors, off-by-one, nil access, wrong event connections
2. **Roblox anti-patterns** — yielding in wrong context, memory leaks (Connections not disconnected), unanchored BaseParts, using deprecated APIs (wait/spawn/delay instead of task library)
3. **Performance** — FindFirstChild/WaitForChild inside loops, unnecessary table copies, missing Debris for temporary parts
4. **Readability** — unclear variable names, overly nested logic, duplicated code

For each issue: state the severity (bug / warning / suggestion), point to the line, say what's wrong, and show the fix.
If the code is clean, say so in one line.

\`\`\`luau
{selection}
\`\`\``
  },
  {
    command: "/convert",
    label: "Convert to Luau",
    description: "Upgrade Lua 5.1 code to modern Luau",
    prompt: `Convert this Lua code to modern Luau. Apply all of the following where applicable:

- Add \`--!strict\` at the top
- Replace \`wait()\` → \`task.wait()\`, \`spawn()\` → \`task.spawn()\`, \`delay()\` → \`task.delay()\`
- Add type annotations to all function parameters and return values
- Use string interpolation (\`\`Hello \${name}\`\`\`) instead of concatenation where it improves readability
- Replace \`table.insert\` patterns with \`table.create\` where size is known upfront
- Replace \`pairs()\` with \`next\` or direct iteration where types allow
- Fix any patterns that would error under --!strict

Show the full converted code. If a change might alter behavior, add a comment explaining why.

\`\`\`lua
{selection}
\`\`\``
  },
  {
    command: "/perf",
    label: "Performance",
    description: "Roblox-specific performance audit",
    prompt: `Audit this Luau code for Roblox performance issues. Check specifically for:

1. **Expensive calls in loops** — FindFirstChild, WaitForChild, GetChildren, or :IsA() called every frame or in tight loops instead of caching
2. **Connection leaks** — RBXScriptConnections created without being stored and disconnected, especially inside loops or repeated calls
3. **Unanchored parts** — BaseParts that should be anchored but aren't, causing physics overhead
4. **Debris misuse** — temporary parts added to workspace without Debris:AddItem()
5. **Deprecated scheduler** — wait(), spawn(), delay() instead of task library equivalents
6. **Table churn** — creating new tables inside frequently-called functions instead of reusing
7. **String concatenation in loops** — use table.concat instead
8. **Unnecessary polling** — RunService.Heartbeat/RenderStepped used where an event would suffice

For each issue: point to the line, estimate the performance impact (high/medium/low), and show the fix.

\`\`\`luau
{selection}
\`\`\``
  },
  {
    command: "/debug",
    label: "Debug",
    description: "Diagnose errors from the live Studio session (requires Studio bridge)",
    prompt: `Debug the current issue in the live Roblox Studio session.

1. Use get_runtime_logs to fetch recent Studio console output
2. Identify all errors and warnings
3. Use read_instance_tree to understand the current game structure if relevant
4. Locate the source of each error in the project files using read_file
5. Fix the root cause — not just the symptom
6. Use run_studio_script to verify the fix if needed

Work through errors one at a time, most critical first. Do not ask for permission — just diagnose and fix.`
  },
  {
    command: "/inspect",
    label: "Inspect Studio",
    description: "Analyze the live Studio instance tree and suggest improvements (requires Studio bridge)",
    prompt: `Inspect the current Roblox Studio session.

1. Use read_instance_tree to get the full DataModel hierarchy
2. Analyze the structure for:
   - Scripts placed in wrong services (e.g. LocalScripts in ServerScriptService, Scripts in ReplicatedStorage)
   - Duplicate or redundant instances
   - Missing standard structure (ServerScriptService, ReplicatedStorage, StarterPlayerScripts etc.)
   - Parts or Models in Workspace that look like they should be in ServerStorage
   - Obvious naming issues (default names like "Part", "Script", "Model")
3. Report findings clearly and suggest concrete fixes
4. If the structure looks correct, say so briefly.`
  },
  {
    command: "/audit",
    label: "Security Audit",
    description: "Scan entire project for Roblox exploit vulnerabilities",
    prompt: `Perform a full security audit of this Roblox project. Use list_files to find all .lua and .luau files, then read each one and check for the following vulnerabilities:

1. **RemoteEvent/RemoteFunction trust** — OnServerEvent or OnServerInvoke handlers that use client-supplied values (damage, currency, position, stats) without server-side validation
2. **Client-side authority** — damage, kill, or score logic that runs on the client and is reported to the server without verification
3. **Leaderstats manipulation** — any script that lets the client directly modify leaderstats or player data
4. **WalkSpeed / JumpPower exploit** — server accepting speed or jump values from the client without clamping
5. **loadstring() usage** — any use of loadstring which can execute arbitrary code
6. **Missing rate limiting** — RemoteEvents that can be spammed with no cooldown
7. **DataStore without pcall** — DataStore:SetAsync/GetAsync calls not wrapped in pcall, risking data loss on error
8. **Tool hit validation** — hit detection that trusts client-reported positions or targets instead of server raycasting

For each issue found, report:
- **File** and approximate line
- **Severity**: Critical / High / Medium
- **What's wrong** in one sentence
- **Fix**: a concrete code snippet showing the correct pattern

If a file is clean, skip it. End with a summary: X critical, Y high, Z medium issues found.`
  },
  {
    command: "/wag",
    label: "Game Wiki",
    description: "Generate or update the game design wiki (WAG)",
    prompt: `Manage the game design wiki (WAG) for this project.

STEP 1: Check if wag/ exists by running list_files on the project root.

IF wag/ does NOT exist:
  Ask the user to describe their game concept, then generate the wiki:
  - Create entity files in wag/ with appropriate subdirectories
  - YAML frontmatter: type, tags, created (today's date)
  - Link related entities with [[wikilinks]] (path relative to wag/, no .md extension)
  - Bidirectional links WITH meaning — not bare lists:
    GOOD: "Dropped by [[monsters/slime]] (5%)"  BAD: "- [[monsters/slime]]"
  - 20-60 lines per entity. Categories come from the game concept, not assumptions.
  - Run wag_update at the end to build INDEX.md

IF wag/ DOES exist:
  1. Read wag/INDEX.md to understand existing entities
  2. Ask the user what's missing or needs to be added
  3. Create only the new entities they describe
  4. Link new entities to existing ones with meaningful bidirectional links
  5. Run wag_update at the end`
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
