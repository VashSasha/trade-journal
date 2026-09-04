const path = require('node:path');
const AUTH_ORIGINS = new Set([
    'https://elbcjsewyqptrckdydha.supabase.co', 'https://accounts.google.com',
    'https://discord.com', 'https://www.discord.com'
]);
function isInside(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function resolveAppPath(root, input) {
    const parsed = new URL(input);
    if (parsed.protocol !== 'app:' || parsed.host !== 'localhost' || parsed.username || parsed.password) throw new Error('Invalid app origin');
    const decoded = decodeURIComponent(parsed.pathname);
    if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').includes('..')) throw new Error('Invalid path');
    const candidate = path.resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`);
    if (!isInside(root, candidate)) throw new Error('Outside app assets');
    return candidate;
}
function isAppPage(input, dev) {
    try {
        const parsed = new URL(input);
        return !parsed.username && !parsed.password && (dev
            ? parsed.origin === 'http://localhost:4200'
            : parsed.protocol === 'app:' && parsed.host === 'localhost');
    } catch { return false; }
}
function isAllowedNavigation(input, dev) {
    try { return isAppPage(input, dev) || AUTH_ORIGINS.has(new URL(input).origin); }
    catch { return false; }
}
function isSafeExternalUrl(input) {
    try {
        const parsed = new URL(input);
        return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
    } catch { return false; }
}
module.exports = { resolveAppPath, isInside, isAppPage, isAllowedNavigation, isSafeExternalUrl };
