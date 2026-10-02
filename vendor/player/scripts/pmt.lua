-- PC Movie Theater: Esc handling for the player.
--   Esc in fullscreen  -> leave fullscreen (like YouTube)
--   Esc when windowed  -> ask "Return to PC Movie Theater?"  (Yes closes the player and goes back to the app)
local mp = require 'mp'
local assdraw = require 'mp.assdraw'

local overlay = mp.create_osd_overlay('ass-events')
local active, sel, was_paused = false, 1, false   -- sel: 1 = Yes, 2 = No
local hit = { yes = nil, no = nil }

local PANEL, ACCENT, TEXT, MUTED = '1F0914', '187AFF', 'FFFFFF', 'C9B3D6'   -- ASS colours are BGR

local function draw()
  local w, h = mp.get_osd_size()
  if not w or w == 0 then w, h = 1280, 720 end
  overlay.res_x, overlay.res_y = w, h
  local s = h / 720
  local bw, bh = 620 * s, 250 * s
  local x0, y0 = (w - bw) / 2, (h - bh) / 2
  local a = assdraw.ass_new()

  -- dim the video
  a:new_event(); a:pos(0, 0); a:append('{\\1c&H000000&\\1a&H70&\\bord0\\shad0}'); a:draw_start(); a:rect_cw(0, 0, w, h); a:draw_stop()
  -- panel with accent outline
  a:new_event(); a:pos(0, 0); a:append(string.format('{\\1c&H%s&\\1a&H00&\\3c&H%s&\\bord%d\\shad0}', PANEL, ACCENT, math.max(1, math.floor(2 * s))))
  a:draw_start(); a:round_rect_cw(x0, y0, x0 + bw, y0 + bh, 18 * s); a:draw_stop()
  -- text
  a:new_event(); a:append(string.format('{\\an5\\pos(%d,%d)\\fs%d\\b1\\1c&H%s&\\bord0\\shad0}Return to PC Movie Theater?', w / 2, y0 + 62 * s, math.floor(38 * s), ACCENT))
  a:new_event(); a:append(string.format('{\\an5\\pos(%d,%d)\\fs%d\\1c&H%s&\\bord0\\shad0}Your spot is saved so you can resume later.', w / 2, y0 + 112 * s, math.floor(22 * s), MUTED))

  -- buttons
  local btn_w, btn_h, gap = 220 * s, 56 * s, 28 * s
  local bx1 = w / 2 - gap / 2 - btn_w
  local bx2 = w / 2 + gap / 2
  local by = y0 + bh - 44 * s - btn_h
  local function button(x, label, selected)
    a:new_event(); a:pos(0, 0)
    if selected then a:append(string.format('{\\1c&H%s&\\1a&H00&\\bord0\\shad0}', ACCENT)) else a:append('{\\1c&H3A2A4A&\\1a&H00&\\bord0\\shad0}') end
    a:draw_start(); a:round_rect_cw(x, by, x + btn_w, by + btn_h, 12 * s); a:draw_stop()
    a:new_event(); a:append(string.format('{\\an5\\pos(%d,%d)\\fs%d\\b1\\1c&H%s&\\bord0\\shad0}%s', x + btn_w / 2, by + btn_h / 2, math.floor(26 * s),
      selected and '1A0900' or TEXT, label))
  end
  button(bx1, 'Yes, go back', sel == 1)
  button(bx2, 'Keep watching', sel == 2)
  hit.yes = { bx1, by, bx1 + btn_w, by + btn_h }
  hit.no = { bx2, by, bx2 + btn_w, by + btn_h }

  overlay.data = a.text
  overlay:update()
end

local keys = {}
local function bind(key, name, fn, flags) mp.add_forced_key_binding(key, name, fn, flags); keys[#keys + 1] = name end

local function close(resume)
  if not active then return end
  active = false
  for _, n in ipairs(keys) do mp.remove_key_binding(n) end
  keys = {}
  overlay:remove()
  if resume and not was_paused then mp.set_property_bool('pause', false) end
end

local function confirm(choice)
  if choice == 1 then close(false); mp.command('quit') else close(true) end
end

local function inside(r, x, y) return r and x >= r[1] and x <= r[3] and y >= r[2] and y <= r[4] end

local function open()
  if active then return end
  active, sel = true, 1
  was_paused = mp.get_property_bool('pause')
  mp.set_property_bool('pause', true)
  bind('y', 'pmt-y', function() confirm(1) end)
  bind('n', 'pmt-n', function() confirm(2) end)
  bind('ESC', 'pmt-esc2', function() confirm(2) end)
  bind('ENTER', 'pmt-enter', function() confirm(sel) end)
  bind('KP_ENTER', 'pmt-kpenter', function() confirm(sel) end)
  bind('SPACE', 'pmt-space', function() confirm(sel) end)
  bind('LEFT', 'pmt-left', function() sel = 1; draw() end, { repeatable = true })
  bind('RIGHT', 'pmt-right', function() sel = 2; draw() end, { repeatable = true })
  bind('UP', 'pmt-up', function() sel = 1; draw() end)
  bind('DOWN', 'pmt-down', function() sel = 2; draw() end)
  bind('GAMEPAD_DPAD_LEFT', 'pmt-gl', function() sel = 1; draw() end)
  bind('GAMEPAD_DPAD_RIGHT', 'pmt-gr', function() sel = 2; draw() end)
  bind('GAMEPAD_ACTION_DOWN', 'pmt-ga', function() confirm(sel) end)
  bind('GAMEPAD_ACTION_RIGHT', 'pmt-gb', function() confirm(2) end)
  bind('MBTN_LEFT', 'pmt-click', function()
    local pos = mp.get_property_native('mouse-pos')
    if pos then
      if inside(hit.yes, pos.x, pos.y) then confirm(1) elseif inside(hit.no, pos.x, pos.y) then confirm(2) end
    end
  end)
  bind('MBTN_LEFT_DBL', 'pmt-dbl', function() end)
  bind('f', 'pmt-f', function() end)
  draw()
end

mp.observe_property('mouse-pos', 'native', function(_, pos)
  if not active or not pos then return end
  local old = sel
  if inside(hit.yes, pos.x, pos.y) then sel = 1 elseif inside(hit.no, pos.x, pos.y) then sel = 2 end
  if sel ~= old then draw() end
end)
mp.observe_property('osd-dimensions', 'native', function() if active then draw() end end)

mp.add_key_binding(nil, 'esc', function()
  if active then confirm(2); return end
  if mp.get_property_bool('fullscreen') then mp.set_property_bool('fullscreen', false); return end
  open()
end)
