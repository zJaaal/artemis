// TypeScript lint, as in Falcon's packages/protocol: typescript-eslint, prettier, the owner's spacing rules
// and the test rules of CODE_STANDARDS §7.
import vitest from '@vitest/eslint-plugin';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

import spacing from './eslint.spacing.cjs';

// One case per test, no branching, nothing skipped or focused, every test asserts something.
const testRules = {
    files: ['**/*.test.ts', '**/*.test-d.ts'],
    plugins: { vitest },
    rules: {
        ...vitest.configs.recommended.rules,
        'vitest/no-conditional-in-test': 'error',
        'vitest/no-conditional-expect': 'error',
        'vitest/no-disabled-tests': 'error',
        'vitest/no-focused-tests': 'error',
        'vitest/expect-expect': 'error',
        'vitest/valid-title': 'error',
        'vitest/no-identical-title': 'error',
        'vitest/no-standalone-expect': 'error'
    }
};

export default defineConfig([
    // Build output and the plain-.js fixture command trees are not linted.
    globalIgnores(['dist', 'src/test/fixtures']),
    tseslint.configs.recommended,
    eslintPluginPrettierRecommended,
    spacing,
    {
        rules: {
            // CODE_STANDARDS §2: no `any`; no enums (as const objects instead).
            '@typescript-eslint/no-explicit-any': 'error',
            'no-restricted-syntax': [
                'error',
                { selector: 'TSEnumDeclaration', message: 'No enums: use an as const object.' }
            ]
        }
    },
    testRules
]);
