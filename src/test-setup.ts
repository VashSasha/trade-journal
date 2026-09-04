// Node's native localStorage can shadow jsdom's implementation. Supply a
// per-test-worker browser-like store; no real browser data or disk is touched.
function memoryStorage(): Storage {
    const storage = Object.create(null);
    Object.defineProperties(storage, {
        getItem: { value: (key: string) => Object.hasOwn(storage, key) ? storage[key] : null },
        setItem: { value: (key: string, value: string) => { storage[key] = String(value); } },
        removeItem: { value: (key: string) => { delete storage[key]; } },
        clear: { value: () => { for (const key of Object.keys(storage)) delete storage[key]; } },
        key: { value: (index: number) => Object.keys(storage)[index] ?? null },
        length: { get: () => Object.keys(storage).length }
    });
    return storage;
}
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage() });
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: memoryStorage() });
if (!window.matchMedia) {
    window.matchMedia = query => ({ matches: false, media: query, onchange: null,
        addListener: () => undefined, removeListener: () => undefined,
        addEventListener: () => undefined, removeEventListener: () => undefined,
        dispatchEvent: () => false });
}
