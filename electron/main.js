const { app, BrowserWindow, ipcMain, shell } = require('electron');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const url = require('url');

// Performance flags
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder');

let mainWindow;

function createWindow() {
    // Create the browser window
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            webSecurity: true,
            preload: path.join(__dirname, 'preload.js')
        },
        title: 'Trade Journal',
        show: false // Don't show until ready
    });

    // Determine if we're in development or production
    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

    if (isDev) {
        // Development: Load from Angular dev server
        mainWindow.loadURL('http://localhost:4200');

        // Open DevTools only when explicitly requested via DEVTOOLS=true
        if (process.env.DEVTOOLS === 'true') {
            mainWindow.webContents.openDevTools();
        }
    } else {
        // Production: Load from built files
        mainWindow.loadURL(
            url.format({
                pathname: path.join(__dirname, '../dist/trade-journal/browser/index.html'),
                protocol: 'file:',
                slashes: true
            })
        );
    }

    // Show window when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // Handle window closed
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// Create window when Electron is ready
app.whenReady().then(() => {
    createWindow();

    // On macOS, re-create window when dock icon is clicked
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// ─── Discord OAuth IPC handler ──────────────────────────────────────────────

// Discord app client secret — safe here (Node.js main process, never bundled to web)
const DISCORD_CLIENT_SECRET = 'OR7lSXffa1bWLauBNdasicvvfkWqjtOJ';

// Track the active callback server so we can close it before starting a new one
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
    console.log('Discord OAuth callback URL:', redirectUri);

    // Close any previously open callback server before starting a new flow
    closeCallbackServer();

    // 1. Generate PKCE pair
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest().toString('base64url');

    // 2. Build Discord OAuth URL
    const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: 'identify guilds.members.read',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
    });
    const authUrl = `https://discord.com/oauth2/authorize?${params}`;

    // 3. Start local HTTP server to capture the callback
    const code = await new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url, `http://localhost:${callbackPort}`);
            const authCode = url.searchParams.get('code');
            const error = url.searchParams.get('error');

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
                <html><body style="font-family:sans-serif;text-align:center;padding:3rem;background:#0f172a;color:#94a3b8">
                    <script>window.close();</script>
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

        server.on('error', (err) => {
            activeCallbackServer = null;
            reject(err);
        });

        server.listen(callbackPort, '127.0.0.1', () => {
            // 4. Open the browser after the server is ready
            shell.openExternal(authUrl);
        });

        // Timeout after 5 minutes
        setTimeout(() => {
            closeCallbackServer();
            reject(new Error('Login timed out'));
        }, 5 * 60 * 1000);
    });

    // 5. Exchange code for access token (Node fetch — no CORS restriction)
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
    const expiresIn = tokenData.expires_in; // seconds

    // 6. Fetch user info and guild member roles in parallel
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

// Log useful info
console.log('Electron version:', process.versions.electron);
console.log('Chrome version:', process.versions.chrome);
console.log('Node version:', process.versions.node);
console.log('App path:', app.getAppPath());
