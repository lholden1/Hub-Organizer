'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog, nativeTheme, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const pkg = require('./package.json');

const OS = process.platform === 'darwin' ? 'mac' : 'win';
const OS_NAME = OS === 'mac' ? 'Mac' : 'Windows';

let win = null;
let config = { dataFile: null };
let lastWriteMtime = 0;
let watched = null;

// ---------- config & data ----------
const configPath = () => path.join(app.getPath('userData'), 'config.json');
const dataFile = () => config.dataFile || path.join(app.getPath('userData'), 'hub-data.json');

function loadConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    if (c && typeof c.dataFile === 'string') config.dataFile = c.dataFile;
  } catch { /* first run */ }
}
function saveConfig() {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

const str = (v) => (typeof v === 'string' ? v : '');
const num = (v) => (Number.isFinite(v) ? v : null);

const validIcon = (v) =>
  typeof v === 'string' && v.length < 250000 && /^data:image\/(png|jpeg|gif|webp|svg\+xml|x-icon);base64,/.test(v) ? v : '';

// Shrinks any image to at most 64px and returns it as a data URL (keeps the data file small).
function toIconDataUrl(img) {
  if (!img || img.isEmpty()) return null;
  const { width, height } = img.getSize();
  if (!width || !height) return null;
  const s = Math.min(1, 64 / Math.max(width, height));
  const out = s < 1
    ? img.resize({ width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)), quality: 'best' })
    : img;
  return out.toDataURL();
}

async function fetchBuffer(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 6000);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length && buf.length < 500000 ? buf : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const validColor = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : '');

function normalize(d) {
  const nodes = (Array.isArray(d && d.nodes) ? d.nodes : [])
    .filter((n) => n && typeof n.id === 'string' && typeof n.name === 'string')
    .map((n) => {
      const type = n.type === 'app' ? 'app' : n.type === 'area' ? 'area' : 'web';
      const area = type === 'area';
      return {
        id: n.id,
        name: n.name.slice(0, 80),
        type,
        // Areas open nothing, so they never keep an address or path.
        url: area ? '' : str(n.url),
        paths: area ? { win: '', mac: '' } : { win: str(n.paths && n.paths.win), mac: str(n.paths && n.paths.mac) },
        group: str(n.group).slice(0, 80),
        color: area ? validColor(n.color) : '',
        notes: str(n.notes).slice(0, 2000),
        icon: validIcon(n.icon),
        x: num(n.x),
        y: num(n.y),
      };
    });
  const ids = new Set(nodes.map((n) => n.id));
  const seen = new Set();
  const edges = (Array.isArray(d && d.edges) ? d.edges : [])
    .filter((e) => e && ids.has(e.from) && ids.has(e.to) && e.from !== e.to)
    .map((e) => ({
      id: typeof e.id === 'string' && e.id ? e.id : `${e.from}>${e.to}`,
      from: e.from,
      to: e.to,
      label: str(e.label).slice(0, 40),
    }))
    .filter((e) => (seen.has(e.id) ? false : seen.add(e.id)));
  return { version: 2, nodes, edges };
}

function readData(file) {
  if (!fs.existsSync(file)) return { data: normalize({}) };
  try {
    return { data: normalize(JSON.parse(fs.readFileSync(file, 'utf8'))) };
  } catch {
    const bak = `${file}.broken-${Date.now()}`;
    try { fs.copyFileSync(file, bak); } catch { /* ignore */ }
    return { data: normalize({}), warning: `Your data file could not be read. A copy was kept at ${bak}.` };
  }
}

function writeData(data) {
  const file = dataFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(normalize(data), null, 2));
  fs.renameSync(tmp, file);
  lastWriteMtime = fs.statSync(file).mtimeMs;
  return true;
}

// Detect edits made by another computer (cloud sync replaces the file).
function watch() {
  if (watched) fs.unwatchFile(watched);
  watched = dataFile();
  fs.watchFile(watched, { interval: 2000 }, (cur) => {
    if (cur.mtimeMs && cur.mtimeMs !== lastWriteMtime && win && !win.isDestroyed()) {
      win.webContents.send('data:external-change');
    }
  });
}

// ---------- launching ----------
async function launch(node) {
  if (!node || typeof node !== 'object') return { ok: false, error: 'Nothing to open.' };
  if (node.type === 'area') return { ok: false, error: 'An area opens nothing. Open one of the items connected to it.' };
  try {
    if (node.type === 'web') {
      const raw = str(node.url).trim();
      if (!raw) return { ok: false, error: 'This item has no web address.' };
      const hasScheme = /^([a-z][a-z0-9+.-]*:\/\/|mailto:)/i.test(raw);
      const u = new URL(hasScheme ? raw : 'https://' + raw);
      if (['file:', 'javascript:', 'data:', 'vbscript:'].includes(u.protocol)) {
        return { ok: false, error: 'That kind of link is blocked.' };
      }
      await shell.openExternal(u.toString());
      return { ok: true };
    }
    const p = str(node.paths && node.paths[OS]).trim();
    if (!p) return { ok: false, error: `No ${OS_NAME} path is set for this app. Edit it to add one.` };
    const err = await shell.openPath(p);
    return err ? { ok: false, error: `Could not open the app: ${err}` } : { ok: true };
  } catch (e) {
    return { ok: false, error: `Could not open this item: ${e.message}` };
  }
}

// ---------- IPC ----------
ipcMain.handle('data:load', () => {
  const file = dataFile();
  const r = readData(file);
  if (fs.existsSync(file)) lastWriteMtime = fs.statSync(file).mtimeMs;
  watch();
  return { data: r.data, file, warning: r.warning };
});

ipcMain.handle('data:save', (_e, d) => writeData(d));
ipcMain.on('data:save-sync', (e, d) => {
  try { e.returnValue = writeData(d); } catch { e.returnValue = false; }
});

ipcMain.handle('data:choose-location', async (_e, current) => {
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    message: 'Where should Hub keep its data?',
    detail: 'Choose a folder that your cloud storage syncs (OneDrive, Dropbox, iCloud Drive) to use the same setup on every computer.',
    buttons: ['Use an existing file', 'Create a new file', 'Cancel'],
    defaultId: 1,
    cancelId: 2,
  });
  if (response === 2) return null;
  let file;
  const filters = [{ name: 'Hub data', extensions: ['json'] }];
  if (response === 0) {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
    if (r.canceled || !r.filePaths[0]) return null;
    file = r.filePaths[0];
  } else {
    const r = await dialog.showSaveDialog(win, {
      defaultPath: path.join(app.getPath('documents'), 'hub-data.json'),
      filters,
    });
    if (r.canceled || !r.filePath) return null;
    file = r.filePath;
  }
  config.dataFile = file;
  saveConfig();
  if (response === 0) {
    const r = readData(file);
    if (fs.existsSync(file)) lastWriteMtime = fs.statSync(file).mtimeMs;
    watch();
    return { data: r.data, file, warning: r.warning };
  }
  writeData(current);
  watch();
  return { data: normalize(current), file };
});

ipcMain.handle('data:export', async (_e, d) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), 'hub-backup.json'),
    filters: [{ name: 'Hub data', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, JSON.stringify(normalize(d), null, 2));
  return r.filePath;
});

ipcMain.handle('data:import', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Hub data', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  try {
    return normalize(JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')));
  } catch {
    dialog.showErrorBox('Import failed', 'That file is not a valid Hub data file.');
    return null;
  }
});

ipcMain.handle('pick-app', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    defaultPath: OS === 'mac' ? '/Applications' : process.env.ProgramFiles,
    filters: OS === 'mac'
      ? []
      : [{ name: 'Programs', extensions: ['exe', 'lnk', 'bat', 'cmd'] }, { name: 'All files', extensions: ['*'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('launch', (_e, node) => launch(node));

// ---------- icons ----------
ipcMain.handle('icon:favicon', async (_e, rawUrl) => {
  try {
    const raw = str(rawUrl).trim();
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'https://' + raw);
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = encodeURIComponent(u.hostname);
    const sources = [
      `https://www.google.com/s2/favicons?domain=${host}&sz=128`,
      `https://icons.duckduckgo.com/ip3/${host}.ico`,
    ];
    for (const src of sources) {
      const buf = await fetchBuffer(src);
      if (!buf) continue;
      const icon = toIconDataUrl(nativeImage.createFromBuffer(buf));
      if (icon) return icon;
    }
  } catch { /* fall through */ }
  return null;
});

ipcMain.handle('icon:app', async (_e, p) => {
  try {
    const file = str(p).trim();
    if (!file) return null;
    return toIconDataUrl(await app.getFileIcon(file, { size: 'large' }));
  } catch {
    return null;
  }
});

ipcMain.handle('icon:pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const file = r.filePaths[0];
  try {
    if (/\.svg$/i.test(file)) {
      const buf = fs.readFileSync(file);
      if (buf.length > 180000) return { error: 'That SVG is too large. Use one under 180 KB.' };
      return { icon: 'data:image/svg+xml;base64,' + buf.toString('base64') };
    }
    const icon = toIconDataUrl(nativeImage.createFromPath(file));
    return icon ? { icon } : { error: 'Could not read that image.' };
  } catch {
    return { error: 'Could not read that image.' };
  }
});

// ---------- updates (GitHub releases) ----------
// Windows installs updates by itself. On a Mac, an app that is not signed with an Apple Developer ID cannot
// replace itself, so by default Hub tells you a new version exists and opens the download page instead.
// Set "hub": { "macAutoInstall": true } in package.json once you sign the Mac build.
const MAC_AUTO_INSTALL = !!(pkg.hub && pkg.hub.macAutoInstall);
const SELF_INSTALL = OS === 'win' || MAC_AUTO_INSTALL;
const UPDATE_EVERY_MS = 4 * 60 * 60 * 1000;
let autoUpdater = null;
let updateTimer = null;
let updateDownloaded = false;

// electron-builder strips "build" from the packaged package.json, so read the app-update.yml it generates.
let publishCache = null;
const publishConfig = () => {
  if (publishCache) return publishCache;
  const cfg = {};
  try {
    const text = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = /^([A-Za-z]+):\s*(.*?)\s*$/.exec(line);
      if (m) cfg[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  } catch {
    const p = pkg.build && pkg.build.publish;
    Object.assign(cfg, (Array.isArray(p) ? p[0] : p) || {});
  }
  publishCache = cfg;
  return cfg;
};
const notConfigured = () => {
  const p = publishConfig();
  if (p.provider && p.provider !== 'github') return false;
  return !p.owner || !p.repo || /^YOUR/i.test(p.owner);
};
const releasesUrl = () => {
  const p = publishConfig();
  return `https://github.com/${encodeURIComponent(p.owner)}/${encodeURIComponent(p.repo)}/releases/latest`;
};
function sendUpdate(payload) {
  if (win && !win.isDestroyed()) win.webContents.send('update:state', payload);
}
const friendly = (e) => {
  const m = String((e && e.message) || e || '').split('\n')[0];
  if (/latest[\w-]*\.yml|Cannot find/i.test(m)) return 'No published release was found yet.';
  if (/404/.test(m)) return 'The update file could not be found on GitHub.';
  if (/ENOTFOUND|ECONN|ETIMEDOUT|network|net::/i.test(m)) return 'No internet connection.';
  return m.slice(0, 140) || 'unknown error';
};

function setupUpdater() {
  if (!app.isPackaged) return;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch {
    autoUpdater = null;
    return;
  }
  autoUpdater.autoDownload = SELF_INSTALL;
  autoUpdater.autoInstallOnAppQuit = SELF_INSTALL;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on('update-available', (i) => {
    sendUpdate(SELF_INSTALL ? { state: 'available', version: i.version } : { state: 'manual', version: i.version });
  });
  autoUpdater.on('update-not-available', () => sendUpdate({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => sendUpdate({ state: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (i) => { updateDownloaded = true; sendUpdate({ state: 'ready', version: i.version }); });
  autoUpdater.on('error', (e) => sendUpdate({ state: 'error', message: friendly(e) }));
}

async function checkForUpdates() {
  if (!app.isPackaged) return { state: 'dev' };
  if (notConfigured()) {
    return { state: 'error', message: 'Updates are not set up yet. Put your GitHub username in package.json (build > publish).' };
  }
  if (!autoUpdater) return { state: 'error', message: 'The update component is missing. Reinstall Hub.' };
  try { await autoUpdater.checkForUpdates(); } catch { /* reported through the "error" event */ }
  return { state: 'checking' };
}

function scheduleUpdateChecks() {
  if (!app.isPackaged || notConfigured()) return;
  setTimeout(checkForUpdates, 5000);
  updateTimer = setInterval(checkForUpdates, UPDATE_EVERY_MS);
}

ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('update:check', () => checkForUpdates());
ipcMain.handle('update:install', async () => {
  if (SELF_INSTALL && autoUpdater && updateDownloaded) {
    // Closing the window lets the page save first; then the installer runs and Hub restarts.
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return true;
  }
  if (!notConfigured()) await shell.openExternal(releasesUrl());
  return true;
});

// ---------- window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 820,
    minWidth: 860,
    minHeight: 560,
    title: 'Hub',
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0F1A1F' : '#E7EEEB',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.on('closed', () => { win = null; });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    loadConfig();
    setupUpdater();
    createWindow();
    scheduleUpdateChecks();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => { if (watched) fs.unwatchFile(watched); if (updateTimer) clearInterval(updateTimer); });
}
