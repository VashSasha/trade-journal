const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveAppPath, isAllowedNavigation, isSafeExternalUrl, isInside } = require('./security');
test('rejects encoded traversal, foreign hosts and invalid paths', () => {
    for (const url of ['app://localhost/%2e%2e%2fsecret', 'app://localhost/%5c..%5csecret',
        'app://other/index.html', 'app://localhost/%00', 'app://localhost/%ZZ']) {
        assert.throws(() => resolveAppPath('/app/dist', url));
    }
    assert.equal(resolveAppPath('/app/dist', 'app://localhost/dashboard'), '/app/dist/dashboard');
    assert.equal(isInside('/app/dist', '/app/dist-evil/secret'), false);
});
test('limits navigation and never opens local files or scripts externally', () => {
    assert.equal(isAllowedNavigation('app://localhost/auth/callback', false), true);
    assert.equal(isAllowedNavigation('https://accounts.google.com/signin', false), true);
    assert.equal(isAllowedNavigation('https://accounts.google.com.evil.test', false), false);
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:pass@example.com']) {
        assert.equal(isSafeExternalUrl(url), false);
    }
});
