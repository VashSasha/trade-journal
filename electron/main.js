const { app, BrowserWindow, shell, protocol, net, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { resolveAppPath, isInside, isAppPage, isAllowedNavigation, isSafeExternalUrl } = require('./security');

// Desktop packages contain public assets only. Authentication and client secrets
// belong to Supabase, never to an Electron .env or privileged renderer IPC.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: {
    secure: true, standard: true, supportFetchAPI: true, corsEnabled: true
} }]);
const isDev = !app.isPackaged;
const angularDistPath = path.join(__dirname, '../dist/trade-journal/browser');
let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400, height: 900, minWidth: 800, minHeight: 600,
        title: 'NVZN Journal', show: false,
        webPreferences: {
            nodeIntegration: false, contextIsolation: true, sandbox: true,
            webSecurity: true, webviewTag: false, preload: path.join(__dirname, 'preload.js')
        }
    });
    // Same-window Supabase/provider redirects still work; arbitrary content
    // cannot replace the app. No auth codes or tokens cross an IPC boundary.
    for (const eventName of ['will-navigate', 'will-redirect']) {
        mainWindow.webContents.on(eventName, (event, destination) => {
            if (!isAllowedNavigation(destination, isDev)) event.preventDefault();
        });
    }
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (isSafeExternalUrl(url)) void shell.openExternal(url);
        return { action: 'deny' };
    });
    mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
    mainWindow.loadURL(isDev ? 'http://localhost:4200' : 'app://localhost/');
    if (isDev && process.env.DEVTOOLS === 'true') mainWindow.webContents.openDevTools();
    mainWindow.once('ready-to-show', () => mainWindow?.show());
    mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
    protocol.handle('app', async request => {
        if (request.method !== 'GET') return new Response(null, { status: 405 });
        let candidate;
        try { candidate = resolveAppPath(angularDistPath, request.url); }
        catch { return new Response(null, { status: 400 }); }
        try {
            // Also reject symlinks escaping the packaged asset directory.
            const root = await fs.realpath(angularDistPath);
            let real;
            try { real = await fs.realpath(candidate); }
            catch {
                if (path.extname(candidate)) return new Response(null, { status: 404 });
                real = await fs.realpath(path.join(root, 'index.html'));
            }
            if (!isInside(root, real)) return new Response(null, { status: 403 });
            return net.fetch(pathToFileURL(real).toString());
        } catch { return new Response(null, { status: 404 }); }
    });
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);

    // Adapt CORS only for requests originating in OUR local renderer, and only
    // for the APIs the desktop actually uses. Never turn off Chromium security.
    const filter = { urls: [
        'https://live.tradovateapi.com/*', 'https://demo.tradovateapi.com/*',
        'https://tv-live.tradovateapi.com/*', 'https://tv-demo.tradovateapi.com/*',
        'https://rpt.tradovateapi.com/*', 'https://rpt-demo.tradovateapi.com/*',
        'https://elbcjsewyqptrckdydha.supabase.co/functions/*'
    ] };
    const ownRequest = details => !isDev && details.webContentsId === mainWindow?.webContents.id &&
        isAppPage(details.frame?.url ?? '', false);
    session.defaultSession.webRequest.onHeadersReceived(filter, (details, callback) => {
        if (!ownRequest(details)) return callback({});
        const headers = { ...details.responseHeaders };
        for (const key of Object.keys(headers)) {
            if (key.toLowerCase().startsWith('access-control-')) delete headers[key];
        }
        callback({ responseHeaders: { ...headers,
            'Access-Control-Allow-Origin': ['app://localhost'],
            'Access-Control-Allow-Headers': ['Content-Type, Accept, Authorization, apikey, x-client-info'],
            'Access-Control-Allow-Methods': ['GET, POST, PUT, PATCH, DELETE, OPTIONS']
        } });
    });
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
