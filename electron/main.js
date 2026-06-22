const { app, BrowserWindow, ipcMain, shell, protocol, net, session } = require('electron');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Load .env — tries the project root (dev) then next to app.asar (production extraResources)
(function loadEnv() {
    const candidates = [
        path.join(__dirname, '../.env'),          // dev: project root
        path.join(process.resourcesPath, '.env'), // production: Contents/Resources/.env
    ];
    for (const envPath of candidates) {
        try {
            const envContent = fs.readFileSync(envPath, 'utf8');
            for (const line of envContent.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                const eqIdx = trimmed.indexOf('=');
                if (eqIdx < 1) continue;
                const key = trimmed.slice(0, eqIdx).trim();
                const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
                if (key && !(key in process.env)) process.env[key] = val;
            }
            return; // stop after first successful load
        } catch { continue; }
    }
})();

// Performance flags (macOS-safe only — VaapiVideoDecoder is Linux-only and was removed)
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

// 'app://' must be registered as privileged BEFORE app.whenReady()
// This gives the Angular app a real origin so ES module imports work correctly.
// Without this, file:// has a null origin and type="module" chunk loading fails (white screen).
protocol.registerSchemesAsPrivileged([
    {
        scheme: 'app',
        privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true }
    }
]);

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const angularDistPath = path.join(__dirname, '../dist/trade-journal/browser');

let mainWindow;

function createWindow() {
    const iconPath = isDev ? path.join(__dirname, '../public/nvzn_logo.png') : undefined;

    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            // webSecurity must be false in production so Angular's app:// origin can reach
            // external APIs (Tradovate, Discord token exchange). The webRequest interceptors
            // below handle CORS. SSL certificate validation is unaffected by this flag.
            webSecurity: isDev,
            preload: path.join(__dirname, 'preload.js')
        },
        ...(iconPath ? { icon: iconPath } : {}),
        title: 'NVZN Journal',
        show: false
    });

    if (isDev && iconPath && process.platform === 'darwin' && app.dock) {
        app.dock.setIcon(iconPath);
    }

    if (isDev) {
        mainWindow.loadURL('http://localhost:4200');
        if (process.env.DEVTOOLS === 'true') {
            mainWindow.webContents.openDevTools();
        }
    } else {
        // Load via custom app:// scheme — gives Angular a real origin so ES module
        // chunk imports aren't blocked by Chromium's null-origin CORS check.
        mainWindow.loadURL('app://localhost/');
    }

    mainWindow.once('ready-to-show', () => mainWindow.show());
    mainWindow.on('closed', () => { mainWindow = null; });

    // In production, log load failures to help diagnose issues
    if (!isDev) {
        mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
            console.error(`[Electron] Failed to load: ${url} — ${code} ${desc}`);
        });
    }
}

app.whenReady().then(() => {
    if (!isDev) {
        // Serve every request under app:// from the Angular dist folder.
        // Falls back to index.html for any path that isn't a real file,
        // so Angular's client-side router handles all navigation.
        protocol.handle('app', async (request) => {
            const { pathname } = new URL(request.url);
            const decoded = decodeURIComponent(pathname);
            let filePath = path.join(angularDistPath, decoded === '/' ? 'index.html' : decoded);

            try {
                await fs.promises.access(filePath, fs.constants.F_OK);
            } catch {
                // Not a real file — return index.html so Angular's router takes over
                filePath = path.join(angularDistPath, 'index.html');
            }

            return net.fetch(url.pathToFileURL(filePath).toString());
        });
    }

    // ── CORS bypass for external APIs ─────────────────────────────────────────
    // In production the page origin is app://localhost, which external APIs don't
    // whitelist. Fix: strip Origin/Referer on outbound requests (server sees no
    // cross-origin request) and inject CORS headers on inbound responses (Chromium
    // accepts the response). This lets us keep webSecurity: true.
    //
    // Covered APIs: Tradovate, Anthropic (Claude), Discord Cloudflare worker exchange.
    const externalApiFilter = {
        urls: [
            'https://*.tradovateapi.com/*',
            'https://api.openai.com/*',
            'https://api.anthropic.com/*',
            'https://*.workers.dev/*'
        ]
    };

    session.defaultSession.webRequest.onBeforeSendHeaders(externalApiFilter, (details, callback) => {
        // Strip Origin/Referer only in production — in dev the origin is
        // http://localhost:4200 which most APIs accept.
        if (!isDev) {
            const headers = details.requestHeaders;
            for (const key of Object.keys(headers)) {
                const lower = key.toLowerCase();
                if (lower === 'origin' || lower === 'referer') delete headers[key];
            }
            callback({ requestHeaders: headers });
        } else {
            callback({});
        }
    });

    session.defaultSession.webRequest.onHeadersReceived(externalApiFilter, (details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'access-control-allow-origin':  ['*'],
                'access-control-allow-headers': ['Content-Type, Accept, Authorization, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access'],
                'access-control-allow-methods': ['GET, POST, PUT, DELETE, OPTIONS'],
            }
        });
    });

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// ─── Discord OAuth IPC handler ──────────────────────────────────────────────

const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
if (!DISCORD_CLIENT_SECRET) {
    console.warn('[Electron] WARNING: DISCORD_CLIENT_SECRET is not set. Discord login will fail.');
}

let activeCallbackServer = null;

function closeCallbackServer() {
    if (activeCallbackServer) {
        try { activeCallbackServer.closeAllConnections?.(); } catch {}
        try { activeCallbackServer.close(); } catch {}
        activeCallbackServer = null;
    }
}

app.on('before-quit', closeCallbackServer);

ipcMain.handle('discord-login', async (event, { clientId, guildId, roles, port }) => {
    const callbackPort = port || 59432;
    const redirectUri = `http://localhost:${callbackPort}/callback`;
    if (isDev) { console.log('Discord OAuth callback URL:', redirectUri); }

    closeCallbackServer();

    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest().toString('base64url');

    const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: 'identify guilds.members.read',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
    });
    const authUrl = `https://discord.com/oauth2/authorize?${params}`;

    const code = await new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url, `http://localhost:${callbackPort}`);
            const authCode = url.searchParams.get('code');
            const error = url.searchParams.get('error');

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
                <html><body style="font-family:sans-serif;text-align:center;padding:3rem;background:#0f172a;color:#94a3b8">
                    <script>window.close();<\/script>
                    <p>Login complete. You can close this tab.</p>
                </body></html>
            `);
            activeCallbackServer = null;
            server.close();

            if (error) reject(new Error(`Discord OAuth error: ${error}`));
            else if (authCode) resolve(authCode);
            else reject(new Error('No authorization code received'));
        });

        activeCallbackServer = server;
        server.on('error', (err) => { activeCallbackServer = null; reject(err); });
        server.listen(callbackPort, '127.0.0.1', () => { shell.openExternal(authUrl); });

        setTimeout(() => {
            closeCallbackServer();
            reject(new Error('Login timed out'));
        }, 5 * 60 * 1000);
    });

    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: redirectUri,
            code_verifier: codeVerifier
        }).toString()
    });

    if (!tokenRes.ok) {
        const err = await tokenRes.text();
        throw new Error(`Token exchange failed: ${err}`);
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    const expiresIn = tokenData.expires_in;

    const [userRes, memberRes] = await Promise.all([
        fetch('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        }),
        fetch(`https://discord.com/api/v10/users/@me/guilds/${guildId}/member`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        })
    ]);

    if (!userRes.ok) throw new Error('Failed to fetch Discord user info');

    const discordUser = await userRes.json();

    let memberRoles = [];
    if (memberRes.ok) {
        const memberData = await memberRes.json();
        memberRoles = memberData.roles || [];
    } else if (memberRes.status === 404) {
        throw new Error('You must be a member of the Discord server to use this app.');
    }

    return {
        id: discordUser.id,
        username: discordUser.username,
        globalName: discordUser.global_name,
        avatar: discordUser.avatar
            ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
            : null,
        roles: memberRoles,
        roleConfig: roles,
        sessionExpiry: Date.now() + expiresIn * 1000
    };
});

if (isDev) {
    console.log('Electron version:', process.versions.electron);
    console.log('Chrome version:', process.versions.chrome);
    console.log('Node version:', process.versions.node);
    console.log('App path:', app.getAppPath());
}
