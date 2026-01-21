const { app, BrowserWindow } = require('electron');
const path = require('path');
const url = require('url');

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
            webSecurity: true
        },
        title: 'Trade Journal',
        show: false // Don't show until ready
    });

    // Determine if we're in development or production
    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

    if (isDev) {
        // Development: Load from Angular dev server
        mainWindow.loadURL('http://localhost:4200');

        // Open DevTools in development
        mainWindow.webContents.openDevTools();
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

// Log useful info
console.log('Electron version:', process.versions.electron);
console.log('Chrome version:', process.versions.chrome);
console.log('Node version:', process.versions.node);
console.log('App path:', app.getAppPath());
