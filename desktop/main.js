// PIXELTAPE desktop app (Electron)
// Full player window  ⇄  a see-through window holding only the cassette, floating over every app.
const { app, BrowserWindow, ipcMain, screen, shell } = require("electron");
const path = require("node:path");
const pkg = require("../package.json");

const FULL = { width: 1100, height: 820, minWidth: 380, minHeight: 520 };
const MINI = { width: 310, height: 200 }; // the cassette (300×190) plus room for its shadow

let win = null;       // full player — also where the music actually plays
let miniWin = null;   // floating cassette
let miniPos = null;   // remember where the cassette was dragged to

const safeWebPreferences = {
  preload: path.join(__dirname, "preload.js"),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true
};

function keepLinksOutside(w) {
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  w.webContents.on("will-navigate", event => event.preventDefault());
}

function createWindow() {
  win = new BrowserWindow({
    width: FULL.width,
    height: FULL.height,
    minWidth: FULL.minWidth,
    minHeight: FULL.minHeight,
    frame: false,                 // we draw our own pink title bar
    backgroundColor: "#fff1f8",
    title: "PIXELTAPE",
    show: false,
    // keep timers running while hidden, so the floating cassette stays in sync
    webPreferences: { ...safeWebPreferences, backgroundThrottling: false }
  });
  win.loadFile(path.join(__dirname, "..", "index.html"));
  win.once("ready-to-show", () => {
    win.show();
    setTimeout(checkForUpdates, 5000);                       // shortly after opening…
    setInterval(checkForUpdates, 6 * 60 * 60 * 1000);        // …and every 6 hours
  });
  keepLinksOutside(win);
  win.on("closed", () => {
    win = null;
    if (miniWin) miniWin.destroy();
  });
}

function createMiniWindow() {
  miniWin = new BrowserWindow({
    width: MINI.width,
    height: MINI.height,
    frame: false,
    transparent: true,            // only the cassette is visible — no window, no bar
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    show: false,
    title: "PIXELTAPE",
    webPreferences: safeWebPreferences
  });
  miniWin.setAlwaysOnTop(true, "floating");
  miniWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  miniWin.loadFile(path.join(__dirname, "mini.html"));
  keepLinksOutside(miniWin);
  miniWin.on("moved", () => { miniPos = miniWin.getPosition(); });
  miniWin.on("closed", () => { miniWin = null; });
}

function setMini(on) {
  if (!win) return;
  if (on) {
    if (!miniWin) createMiniWindow();
    if (!miniPos) {
      const { workArea } = screen.getDisplayMatching(win.getBounds());
      miniPos = [workArea.x + workArea.width - MINI.width - 24, workArea.y + workArea.height - MINI.height - 24];
    }
    miniWin.setPosition(miniPos[0], miniPos[1]);
    miniWin.show();
    win.hide();                   // the music keeps playing in the hidden window
  } else {
    if (miniWin) miniWin.hide();
    win.show();
    win.focus();
  }
}

/* ---------- "a new version is out" ----------
   Looks at the latest GitHub release of the repo named in package.json ("repository").
   If it is newer than this app, the app shows a GET IT button that opens the download page. */
function githubRepo() {
  const field = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url || "";
  const match = field.match(/github(?:\.com[/:]|:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  return match && !match[1].startsWith("YOUR-") ? match[1] : null;
}
function isNewer(latest, current) {
  const a = latest.split(".").map(n => parseInt(n, 10) || 0);
  const b = current.split(".").map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return false;
}
async function checkForUpdates() {
  const repo = githubRepo();
  if (!repo || !win) return;
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "PIXELTAPE" }
    });
    if (!response.ok) return;
    const release = await response.json();
    const latest = String(release.tag_name || "").replace(/^v/, "");
    if (latest && isNewer(latest, app.getVersion())) {
      win.webContents.send("pixeltape:update", { version: latest, url: release.html_url });
    }
  } catch { /* offline — try again later */ }
}
ipcMain.on("pixeltape:open-url", (_event, url) => {
  if (/^https:\/\/github\.com\//.test(url)) shell.openExternal(url); // only ever our download page
});

ipcMain.on("pixeltape:set-mini", (_event, on) => setMini(Boolean(on)));
ipcMain.on("pixeltape:minimize", () => win?.minimize());
ipcMain.on("pixeltape:close", () => win?.close());
// full player → cassette: what to show
ipcMain.on("pixeltape:state", (_event, state) => miniWin?.webContents.send("pixeltape:state", state));
// cassette → full player: button presses
ipcMain.on("pixeltape:command", (_event, name) => win?.webContents.send("pixeltape:command", name));

// only one PIXELTAPE at a time
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (miniWin?.isVisible()) { miniWin.focus(); return; }
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(() => {
    createWindow();
    // clicking the Dock icon always brings the full player back, even from mini mode
    app.on("activate", () => {
      if (!win) { createWindow(); return; }
      if (!win.isVisible()) win.webContents.send("pixeltape:command", "restore");
      else win.focus();
    });
  });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
