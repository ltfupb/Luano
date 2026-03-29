// src/editor/LuauSnippets.ts
// 30 Roblox-specific Luau code snippets for Monaco autocomplete

import type * as Monaco from "monaco-editor"

interface Snippet {
  prefix: string
  label: string
  detail: string
  body: string
}

const SNIPPETS: Snippet[] = [
  // ── Script Headers ──────────────────────────────────────────────────────────
  {
    prefix: "strict",
    label: "--!strict header",
    detail: "Strict mode + services",
    body: `--!strict
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

$0`
  },
  {
    prefix: "module",
    label: "ModuleScript",
    detail: "ModuleScript boilerplate",
    body: `--!strict
local \${1:ModuleName} = {}

function \${1:ModuleName}.\${2:init}()
\t$0
end

return \${1:ModuleName}`
  },

  // ── OOP ─────────────────────────────────────────────────────────────────────
  {
    prefix: "class",
    label: "OOP Class",
    detail: "Luau OOP class with constructor",
    body: `--!strict
local \${1:ClassName} = {}
\${1:ClassName}.__index = \${1:ClassName}

export type \${1:ClassName} = typeof(setmetatable({} :: {
\t\${2:health}: number,
}, \${1:ClassName}))

function \${1:ClassName}.new(\${3:args}): \${1:ClassName}
\tlocal self = setmetatable({}, \${1:ClassName})
\tself.\${2:health} = \${4:100}
\treturn self
end

function \${1:ClassName}.\${5:destroy}(self: \${1:ClassName})
\t$0
end

return \${1:ClassName}`
  },

  // ── RemoteEvent ─────────────────────────────────────────────────────────────
  {
    prefix: "rmt-server",
    label: "RemoteEvent (Server)",
    detail: "Server-side RemoteEvent handler",
    body: `local ReplicatedStorage = game:GetService("ReplicatedStorage")

local \${1:remoteEvent} = ReplicatedStorage:WaitForChild("\${2:EventName}")

\${1:remoteEvent}.OnServerEvent:Connect(function(player: Player, \${3:data})
\t-- Validate input
\tif typeof(\${3:data}) ~= "\${4:string}" then return end

\t$0
end)`
  },
  {
    prefix: "rmt-client",
    label: "RemoteEvent (Client)",
    detail: "Client fires RemoteEvent to server",
    body: `local ReplicatedStorage = game:GetService("ReplicatedStorage")

local \${1:remoteEvent} = ReplicatedStorage:WaitForChild("\${2:EventName}")

\${1:remoteEvent}:FireServer(\${3:data})
$0`
  },
  {
    prefix: "rmt-create",
    label: "RemoteEvent (Create)",
    detail: "Create RemoteEvent in ReplicatedStorage",
    body: `local ReplicatedStorage = game:GetService("ReplicatedStorage")

local \${1:remoteEvent} = Instance.new("RemoteEvent")
\${1:remoteEvent}.Name = "\${2:EventName}"
\${1:remoteEvent}.Parent = ReplicatedStorage
$0`
  },

  // ── RemoteFunction ──────────────────────────────────────────────────────────
  {
    prefix: "rmf-server",
    label: "RemoteFunction (Server)",
    detail: "Server-side RemoteFunction callback",
    body: `local ReplicatedStorage = game:GetService("ReplicatedStorage")

local \${1:remoteFunc} = ReplicatedStorage:WaitForChild("\${2:FuncName}")

\${1:remoteFunc}.OnServerInvoke = function(player: Player, \${3:args})
\t-- Validate & return
\t$0
\treturn \${4:result}
end`
  },

  // ── DataStore ───────────────────────────────────────────────────────────────
  {
    prefix: "ds-get",
    label: "DataStore GetAsync",
    detail: "Safe DataStore load with pcall",
    body: `local DataStoreService = game:GetService("DataStoreService")

local \${1:store} = DataStoreService:GetDataStore("\${2:StoreName}")

local function loadData(player: Player): \${3:any}?
\tlocal key = "Player_" .. player.UserId
\tlocal success, data = pcall(function()
\t\treturn \${1:store}:GetAsync(key)
\tend)

\tif success then
\t\treturn data
\telse
\t\twarn("Failed to load data for", player.Name, data)
\t\treturn nil
\tend
end
$0`
  },
  {
    prefix: "ds-update",
    label: "DataStore UpdateAsync",
    detail: "Atomic DataStore update with retry",
    body: `local DataStoreService = game:GetService("DataStoreService")

local \${1:store} = DataStoreService:GetDataStore("\${2:StoreName}")

local function updateData(player: Player, callback: (any) -> any)
\tlocal key = "Player_" .. player.UserId
\tlocal success, err = pcall(function()
\t\t\${1:store}:UpdateAsync(key, function(oldData)
\t\t\tlocal data = oldData or \${3:{\}}
\t\t\treturn callback(data)
\t\t end)
\tend)

\tif not success then
\t\twarn("UpdateAsync failed:", err)
\tend
end
$0`
  },
  {
    prefix: "ds-session",
    label: "DataStore Session Lock",
    detail: "Session-locked DataStore pattern",
    body: `local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")

local \${1:store} = DataStoreService:GetDataStore("\${2:PlayerData}")
local sessionData: { [number]: \${3:any} } = {}

local DEFAULT_DATA = {
\t\${4:coins = 0,
\tlevel = 1,}
}

Players.PlayerAdded:Connect(function(player)
\tlocal key = "Player_" .. player.UserId
\tlocal success, data = pcall(\${1:store}.GetAsync, \${1:store}, key)
\tif success then
\t\tsessionData[player.UserId] = data or table.clone(DEFAULT_DATA)
\telse
\t\tsessionData[player.UserId] = table.clone(DEFAULT_DATA)
\t\twarn("Failed to load:", player.Name)
\tend
end)

Players.PlayerRemoving:Connect(function(player)
\tlocal data = sessionData[player.UserId]
\tif data then
\t\tpcall(\${1:store}.SetAsync, \${1:store}, "Player_" .. player.UserId, data)
\t\tsessionData[player.UserId] = nil
\tend
end)

game:BindToClose(function()
\tfor userId, data in sessionData do
\t\tpcall(\${1:store}.SetAsync, \${1:store}, "Player_" .. userId, data)
\tend
end)
$0`
  },

  // ── Player / Character ──────────────────────────────────────────────────────
  {
    prefix: "player-added",
    label: "PlayerAdded Handler",
    detail: "Players.PlayerAdded + existing players",
    body: `local Players = game:GetService("Players")

local function onPlayerAdded(player: Player)
\t$0
end

Players.PlayerAdded:Connect(onPlayerAdded)
for _, player in Players:GetPlayers() do
\ttask.spawn(onPlayerAdded, player)
end`
  },
  {
    prefix: "char-added",
    label: "CharacterAdded Handler",
    detail: "CharacterAdded with Humanoid access",
    body: `local function onCharacterAdded(character: Model)
\tlocal humanoid = character:WaitForChild("Humanoid") :: Humanoid

\thumanoid.Died:Once(function()
\t\t$0
\tend)
end

\${1:player}.CharacterAdded:Connect(onCharacterAdded)
if \${1:player}.Character then
\tonCharacterAdded(\${1:player}.Character)
end`
  },
  {
    prefix: "leaderstats",
    label: "Leaderstats Setup",
    detail: "Player leaderstats (coins, level, etc.)",
    body: `local Players = game:GetService("Players")

Players.PlayerAdded:Connect(function(player)
\tlocal leaderstats = Instance.new("Folder")
\tleaderstats.Name = "leaderstats"
\tleaderstats.Parent = player

\tlocal \${1:coins} = Instance.new("\${2:IntValue}")
\t\${1:coins}.Name = "\${3:Coins}"
\t\${1:coins}.Value = \${4:0}
\t\${1:coins}.Parent = leaderstats
\t$0
end)`
  },

  // ── Services ────────────────────────────────────────────────────────────────
  {
    prefix: "tween",
    label: "TweenService Tween",
    detail: "Create and play a tween",
    body: `local TweenService = game:GetService("TweenService")

local tweenInfo = TweenInfo.new(
\t\${1:0.5},           -- Duration
\tEnum.EasingStyle.\${2:Quad},
\tEnum.EasingDirection.\${3:Out}
)

local tween = TweenService:Create(\${4:instance}, tweenInfo, {
\t\${5:Position = Vector3.new(0, 10, 0)}
})

tween:Play()
$0`
  },
  {
    prefix: "input",
    label: "UserInputService",
    detail: "Keyboard/mouse input handler",
    body: `local UserInputService = game:GetService("UserInputService")

UserInputService.InputBegan:Connect(function(input: InputObject, gameProcessed: boolean)
\tif gameProcessed then return end

\tif input.KeyCode == Enum.KeyCode.\${1:E} then
\t\t$0
\tend
end)`
  },
  {
    prefix: "raycast",
    label: "Workspace Raycast",
    detail: "Raycast with params and result handling",
    body: `local params = RaycastParams.new()
params.FilterDescendantsInstances = { \${1:character} }
params.FilterType = Enum.RaycastFilterType.\${2:Exclude}

local origin = \${3:camera.CFrame.Position}
local direction = \${4:camera.CFrame.LookVector * 100}

local result = workspace:Raycast(origin, direction, params)
if result then
\tlocal hit = result.Instance
\tlocal position = result.Position
\tlocal normal = result.Normal
\t$0
end`
  },
  {
    prefix: "heartbeat",
    label: "RunService.Heartbeat",
    detail: "Game loop with disconnect",
    body: `local RunService = game:GetService("RunService")

local connection: RBXScriptConnection
connection = RunService.Heartbeat:Connect(function(dt: number)
\t$0
end)

-- To stop: connection:Disconnect()`
  },

  // ── GUI ─────────────────────────────────────────────────────────────────────
  {
    prefix: "gui-button",
    label: "GUI Button Handler",
    detail: "TextButton click with debounce",
    body: `local button = \${1:script.Parent} :: TextButton

local debounce = false

button.Activated:Connect(function()
\tif debounce then return end
\tdebounce = true

\t$0

\ttask.delay(\${2:0.5}, function()
\t\tdebounce = false
\tend)
end)`
  },
  {
    prefix: "gui-screen",
    label: "ScreenGui Setup",
    detail: "Create ScreenGui with frame",
    body: `local Players = game:GetService("Players")
local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")

local screenGui = Instance.new("ScreenGui")
screenGui.Name = "\${1:MyGui}"
screenGui.ResetOnSpawn = false
screenGui.Parent = playerGui

local frame = Instance.new("Frame")
frame.Size = UDim2.fromScale(\${2:0.3}, \${3:0.4})
frame.Position = UDim2.fromScale(0.5, 0.5)
frame.AnchorPoint = Vector2.new(0.5, 0.5)
frame.BackgroundColor3 = Color3.fromRGB(\${4:30, 30, 30})
frame.Parent = screenGui
$0`
  },

  // ── Physics / Parts ─────────────────────────────────────────────────────────
  {
    prefix: "touched",
    label: "Part.Touched",
    detail: "Touched event with humanoid check",
    body: `\${1:part}.Touched:Connect(function(hit: BasePart)
\tlocal character = hit.Parent
\tif not character then return end
\tlocal humanoid = character:FindFirstChildOfClass("Humanoid")
\tif not humanoid then return end
\tlocal player = game:GetService("Players"):GetPlayerFromCharacter(character)
\tif not player then return end

\t$0
end)`
  },

  // ── Patterns ────────────────────────────────────────────────────────────────
  {
    prefix: "cooldown",
    label: "Cooldown / Debounce",
    detail: "Reusable cooldown pattern",
    body: `local cooldowns: { [Player]: boolean } = {}

local function tryAction(player: Player): boolean
\tif cooldowns[player] then return false end
\tcooldowns[player] = true

\ttask.delay(\${1:1}, function()
\t\tcooldowns[player] = nil
\tend)

\treturn true
end
$0`
  },
  {
    prefix: "signal",
    label: "Custom Signal",
    detail: "BindableEvent-based custom signal",
    body: `local \${1:Signal} = {}
\${1:Signal}.__index = \${1:Signal}

function \${1:Signal}.new()
\tlocal self = setmetatable({}, \${1:Signal})
\tself._event = Instance.new("BindableEvent")
\treturn self
end

function \${1:Signal}:Fire(...)
\tself._event:Fire(...)
end

function \${1:Signal}:Connect(fn: (...any) -> ()): RBXScriptConnection
\treturn self._event.Event:Connect(fn)
end

function \${1:Signal}:Destroy()
\tself._event:Destroy()
end
$0`
  },
  {
    prefix: "collection",
    label: "CollectionService Tags",
    detail: "Tag-based instance management",
    body: `local CollectionService = game:GetService("CollectionService")

local TAG = "\${1:MyTag}"

local function onTagAdded(instance: Instance)
\t$0
end

local function onTagRemoved(instance: Instance)
\t-- Cleanup
end

CollectionService:GetInstanceAddedSignal(TAG):Connect(onTagAdded)
CollectionService:GetInstanceRemovedSignal(TAG):Connect(onTagRemoved)

for _, instance in CollectionService:GetTagged(TAG) do
\ttask.spawn(onTagAdded, instance)
end`
  },
  {
    prefix: "attribute",
    label: "Attribute Changed",
    detail: "Listen to attribute changes",
    body: `\${1:instance}:GetAttributeChangedSignal("\${2:AttributeName}"):Connect(function()
\tlocal value = \${1:instance}:GetAttribute("\${2:AttributeName}")
\t$0
end)`
  },
  {
    prefix: "spawn-loop",
    label: "Game Loop (task.spawn)",
    detail: "Repeating game loop with task library",
    body: `task.spawn(function()
\twhile true do
\t\t$0
\t\ttask.wait(\${1:1})
\tend
end)`
  },

  // ── Networking ──────────────────────────────────────────────────────────────
  {
    prefix: "rmt-reliable",
    label: "Reliable Remote Pattern",
    detail: "Server remote with validation + rate limit",
    body: `local ReplicatedStorage = game:GetService("ReplicatedStorage")

local remote = ReplicatedStorage:WaitForChild("\${1:ActionEvent}")
local lastFired: { [Player]: number } = {}
local RATE_LIMIT = \${2:0.2} -- seconds

remote.OnServerEvent:Connect(function(player: Player, \${3:action}: string)
\t-- Rate limit
\tlocal now = os.clock()
\tif lastFired[player] and (now - lastFired[player]) < RATE_LIMIT then
\t\treturn
\tend
\tlastFired[player] = now

\t-- Validate
\tif typeof(\${3:action}) ~= "string" then return end

\t$0
end)`
  },

  // ── Utility ─────────────────────────────────────────────────────────────────
  {
    prefix: "wfc",
    label: "WaitForChild Chain",
    detail: "Safe nested WaitForChild",
    body: `local \${1:object} = \${2:workspace}:WaitForChild("\${3:Folder}"):WaitForChild("\${4:Child}")
$0`
  },
  {
    prefix: "require-module",
    label: "Require ModuleScript",
    detail: "Require with path",
    body: `local \${1:Module} = require(\${2:ReplicatedStorage}:WaitForChild("\${3:Modules}"):WaitForChild("\${1:Module}"))
$0`
  },
]

// ── Register with Monaco ──────────────────────────────────────────────────────

export function registerLuauSnippets(monaco: typeof Monaco): void {
  monaco.languages.registerCompletionItemProvider("lua", {
    triggerCharacters: [],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position)
      const range: Monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
      }

      const suggestions: Monaco.languages.CompletionItem[] = SNIPPETS.map((s) => ({
        label: s.prefix,
        kind: monaco.languages.CompletionItemKind.Snippet,
        detail: s.detail,
        documentation: { value: `**${s.label}**\n\n\`\`\`lua\n${s.body.replace(/\$\{?\d+:?[^}]*\}?/g, "…")}\n\`\`\`` },
        insertText: s.body,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        range,
        sortText: `0_${s.prefix}`
      }))

      return { suggestions }
    }
  })
}
