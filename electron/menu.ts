/**
 * Native OS menu — standard File/Edit/View/Window/Help hierarchy. Menu items
 * either use Electron's built-in `role` (for Edit Cut/Copy/Paste, Window
 * Minimize/Zoom, etc.) or fire a `menu:<action>` IPC event that the renderer
 * maps to the same callback as the Command Palette.
 *
 * On Windows/Linux the menu bar is auto-hidden (toggled with Alt). On macOS
 * it's always visible at the top of the screen.
 */

import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from "electron"

function send(win: BrowserWindow | null, channel: string): () => void {
  return () => { win?.webContents.send(channel) }
}

export function buildMenu(win: BrowserWindow | null, hasProject = false): Menu {
  const isMac = process.platform === "darwin"

  const appMenu: MenuItemConstructorOptions[] = isMac ? [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "Preferences…", accelerator: "Cmd+,", click: send(win, "menu:open-settings") },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    }
  ] : []

  const fileMenu: MenuItemConstructorOptions = {
    label: "File",
    submenu: [
      { label: "New Game…", accelerator: "CmdOrCtrl+Shift+N", click: send(win, "menu:new-project") },
      { label: "Open Folder…", accelerator: "CmdOrCtrl+O", click: send(win, "menu:open-folder") },
      { label: "Close Project", enabled: hasProject, click: send(win, "menu:close-project") },
      { type: "separator" },
      ...(isMac ? [] : [
        { label: "Settings…", accelerator: "Ctrl+,", click: send(win, "menu:open-settings") } as MenuItemConstructorOptions,
        { type: "separator" as const }
      ]),
      { label: "Toolchain…", click: send(win, "menu:open-toolchain") },
      { type: "separator" },
      isMac ? { role: "close" } : { role: "quit" }
    ]
  }

  const editMenu: MenuItemConstructorOptions = {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" }
    ]
  }

  const viewMenu: MenuItemConstructorOptions = {
    label: "View",
    submenu: [
      { label: "Command Palette…", accelerator: "CmdOrCtrl+Shift+P", click: send(win, "menu:command-palette") },
      { label: "Quick Open…", accelerator: "CmdOrCtrl+P", enabled: hasProject, click: send(win, "menu:quick-open") },
      { type: "separator" },
      { label: "Toggle Side Panel", accelerator: "CmdOrCtrl+B", enabled: hasProject, click: send(win, "menu:toggle-sidebar") },
      { label: "Toggle AI Chat", accelerator: "CmdOrCtrl+J", enabled: hasProject, click: send(win, "menu:toggle-chat") },
      { label: "Toggle Terminal", accelerator: "CmdOrCtrl+`", enabled: hasProject, click: send(win, "menu:toggle-terminal") },
      { type: "separator" },
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" }
    ]
  }

  const windowMenu: MenuItemConstructorOptions = {
    label: "Window",
    submenu: isMac ? [
      { role: "minimize" },
      { role: "zoom" },
      { type: "separator" },
      { role: "front" }
    ] : [
      { role: "minimize" },
      { role: "close" }
    ]
  }

  const helpMenu: MenuItemConstructorOptions = {
    role: "help",
    submenu: [
      { label: "Luano Website", click: () => { void shell.openExternal("https://luano.dev") } },
      { label: "GitHub", click: () => { void shell.openExternal("https://github.com/ltfupb/Luano") } },
      { label: "Report Issue", click: () => { void shell.openExternal("https://github.com/ltfupb/Luano/issues") } }
    ]
  }

  return Menu.buildFromTemplate([...appMenu, fileMenu, editMenu, viewMenu, windowMenu, helpMenu])
}

export function installMenu(win: BrowserWindow | null, hasProject = false): void {
  Menu.setApplicationMenu(buildMenu(win, hasProject))
}
