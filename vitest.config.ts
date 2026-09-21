import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Gridstack ships extensionless ESM imports. Let Vite resolve them so
        // lifecycle tests exercise the real library, not a mocked grid.
        server: { deps: { inline: ['gridstack'] } },
    },
});
