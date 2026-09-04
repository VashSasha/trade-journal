/** Call ONLY after getUser(jwt) verifies this exact signed token. A freshly
 * refreshed access token is not proof of a recent interactive authentication. */
export function hasRecentAuthentication(verifiedJwt: string, now = Date.now()): boolean {
    try {
        const encoded = verifiedJwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const claims = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
        const allowed = new Set(['password', 'oauth', 'otp', 'totp', 'sso/saml', 'webauthn']);
        return Array.isArray(claims.amr) && claims.amr.some((entry: { method: string; timestamp: number }) =>
            allowed.has(entry.method) && Number.isFinite(entry.timestamp) &&
            now / 1000 - entry.timestamp >= 0 && now / 1000 - entry.timestamp <= 600);
    } catch { return false; }
}
