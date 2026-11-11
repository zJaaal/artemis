import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        // Fixture command files are plain .js that import the package by name, like a consumer's.
        alias: { '@zjaaal/artemis': fileURLToPath(new URL('./src/index.ts', import.meta.url)) }
    },
    test: {}
});
