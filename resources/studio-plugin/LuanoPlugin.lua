--[[
  LuanoPlugin.lua
  Luano IDE Live Bridge — Roblox Studio Plugin

  설치: %LOCALAPPDATA%\Roblox\Plugins\LuanoPlugin.lua
  포트: 127.0.0.1:27780

  동작:
    1. Heartbeat 루프에서 2초마다 Luano로 HTTP POST
    2. DataModel 트리 스냅샷 + 로그 버퍼를 전송
    3. 응답으로 받은 커맨드 실행 후 결과 전송
--]]

local HttpService    = game:GetService("HttpService")
local LogService     = game:GetService("LogService")
local RunService     = game:GetService("RunService")

local BASE_URL       = "http://127.0.0.1:27780"
local REPORT_SEC     = 2      -- report interval
local MAX_LOGS       = 150    -- log buffer cap
local MAX_DEPTH      = 4      -- tree depth limit
local MAX_CHILDREN   = 50     -- children per node

-- ── Log buffer ────────────────────────────────────────────────────────────────
local logBuffer = {}

local function pushLog(text, kind)
	if #logBuffer >= MAX_LOGS then
		table.remove(logBuffer, 1)
	end
	table.insert(logBuffer, { text = text, kind = kind })
end

LogService.MessageOut:Connect(function(message, messageType)
	local kind = "output"
	if messageType == Enum.MessageType.MessageWarning then
		kind = "warn"
	elseif messageType == Enum.MessageType.MessageError then
		kind = "error"
	end
	pushLog(message, kind)
end)

-- ── Instance tree serializer ──────────────────────────────────────────────────
local function serializeTree(inst, depth)
	depth = depth or 0
	if depth > MAX_DEPTH then return nil end

	local children = {}
	if depth < MAX_DEPTH then
		local count = 0
		for _, child in ipairs(inst:GetChildren()) do
			if count >= MAX_CHILDREN then break end
			local node = serializeTree(child, depth + 1)
			if node then
				table.insert(children, node)
				count += 1
			end
		end
	end

	return {
		name     = inst.Name,
		class    = inst.ClassName,
		children = children,
	}
end

-- ── Command execution ─────────────────────────────────────────────────────────
local function execCommand(cmd)
	if cmd.type ~= "run_script" or not cmd.code then return end

	local fn, parseErr = loadstring(cmd.code)
	if not fn then
		pcall(HttpService.RequestAsync, HttpService, {
			Url    = BASE_URL .. "/api/result",
			Method = "POST",
			Headers = { ["Content-Type"] = "application/json" },
			Body   = HttpService:JSONEncode({
				id      = cmd.id,
				success = false,
				result  = "Parse error: " .. tostring(parseErr),
			}),
		})
		return
	end

	local ok, result = pcall(fn)
	pcall(HttpService.RequestAsync, HttpService, {
		Url    = BASE_URL .. "/api/result",
		Method = "POST",
		Headers = { ["Content-Type"] = "application/json" },
		Body   = HttpService:JSONEncode({
			id      = cmd.id,
			success = ok,
			result  = tostring(result),
		}),
	})
end

-- ── Main heartbeat loop ───────────────────────────────────────────────────────
local lastReport = 0

RunService.Heartbeat:Connect(function()
	local now = tick()
	if now - lastReport < REPORT_SEC then return end
	lastReport = now

	-- Snapshot & clear log buffer
	local logs = logBuffer
	logBuffer = {}

	-- Build tree snapshot
	local tree = serializeTree(game, 0)

	-- Encode payload
	local encodeOk, payload = pcall(function()
		return HttpService:JSONEncode({
			tree = tree,
			logs = logs,
			time = now,
		})
	end)
	if not encodeOk then return end

	-- POST to Luano bridge
	local httpOk, response = pcall(function()
		return HttpService:RequestAsync({
			Url    = BASE_URL .. "/api/report",
			Method = "POST",
			Headers = { ["Content-Type"] = "application/json" },
			Body   = payload,
		})
	end)

	if not httpOk or not response.Success then return end

	-- Process commands from Luano
	local decodeOk, data = pcall(HttpService.JSONDecode, HttpService, response.Body)
	if not decodeOk or not data or not data.commands then return end

	for _, cmd in ipairs(data.commands) do
		task.spawn(execCommand, cmd)
	end
end)

print("[Luano] Live Bridge active →", BASE_URL)
