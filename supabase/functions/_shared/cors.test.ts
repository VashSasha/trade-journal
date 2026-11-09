import assert from 'node:assert/strict';
import { appCorsHeaders, isAllowedAppOrigin } from './cors.ts';

const APP = 'https://nvzn-journal.com';

Deno.test('CORS accepts configured production, local development and both owned Pages projects', () => {
    const origins = [APP, 'http://localhost:4200', 'http://127.0.0.1:4200'];
    for (const project of ['nvzn-journal', 'trade-journal-2go']) {
        for (const prefix of ['', 'release-v1-5.', 'ab12cd34.', 'a.']) origins.push(`https://${prefix}${project}.pages.dev`);
    }
    for (const origin of origins) {
        assert.equal(isAllowedAppOrigin(origin, APP), true, origin);
        const headers = appCorsHeaders(new Request('https://api.test', { headers: { Origin: origin } }), APP);
        assert.equal(headers['Access-Control-Allow-Origin'], origin);
        assert.equal(headers['Access-Control-Allow-Methods'], 'POST, OPTIONS');
        assert.equal(headers.Vary, 'Origin');
        assert.equal(headers['Access-Control-Allow-Credentials'], undefined);
    }
});

Deno.test('CORS rejects foreign projects, origin tricks, opaque origins and malformed configuration', () => {
    for (const origin of [null, undefined, '', 'null', 'https://evil.pages.dev',
        'https://nvzn-journal.com.evil.test', 'https://nvzn-journal.pages.dev.evil.test',
        'https://foo.trade-journal-2go.pages.dev.evil.test', 'https://a.b.nvzn-journal.pages.dev',
        'https://-bad.nvzn-journal.pages.dev', 'https://bad-.nvzn-journal.pages.dev',
        `https://${'a'.repeat(64)}.nvzn-journal.pages.dev`, 'http://release.nvzn-journal.pages.dev',
        'https://release.nvzn-journal.pages.dev:444', 'https://nvzn-journal.pages.dev@evil.test',
        'https://evil.test@nvzn-journal.pages.dev', 'https://nvzn-journal.pages.dev/',
        'https://nvzn-journal.pages.dev/path', 'https://nvzn-journal.pages.dev?x=1',
        'https://nvzn-journal.pages.dev#x', 'https://nvzn-journal.pages.dev\\@evil.test',
        ' http://localhost:4200', 'app://localhost', 'https://localhost:4200', 'http://localhost:4201']) {
        assert.equal(isAllowedAppOrigin(origin, APP), false, String(origin));
    }
    for (const invalid of ['', 'null', 'https://evil.test@nvzn-journal.com', `${APP}/path`]) {
        assert.equal(isAllowedAppOrigin(invalid, invalid), false, invalid);
    }
    assert.equal(isAllowedAppOrigin(APP), false, 'Missing configuration must not implicitly grant an origin');
    assert.equal(isAllowedAppOrigin('https://app.example', 'https://app.example'), true);
});

Deno.test('denied and originless requests do not receive CORS approval', () => {
    for (const origin of [null, 'https://evil.pages.dev', 'null']) {
        const req = new Request('https://api.test', { headers: origin ? { Origin: origin } : {} });
        assert.deepEqual(appCorsHeaders(req, APP), { Vary: 'Origin' });
    }
});
