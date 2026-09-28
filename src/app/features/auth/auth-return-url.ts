/** Only local app destinations may survive the OAuth round trip. */
export function safeAuthReturnUrl(value: unknown): string {
    const fallback = '/dashboard';
    if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/')
        || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) return fallback;
    try {
        const url = new URL(value, 'https://nvzn.invalid');
        const root = url.pathname.split('/')[1];
        const allowed = ['', 'dashboard', 'journal', 'analytics', 'reports', 'account', 'settings', 'welcome', 'demo', 'upgrade', 'beta'];
        if (url.origin !== 'https://nvzn.invalid' || !allowed.includes(root)
            || /%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(url.pathname)) return fallback;
        return url.pathname + url.search + url.hash;
    } catch {
        return fallback;
    }
}
