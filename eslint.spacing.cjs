// The owner's spacing rules (2026-11-04: "quiero el código organizado"), shared by every package's ESLint config.
// Prettier keeps blank lines but never adds them; these add them, and `eslint --fix` applies them. They go after
// eslint-config-prettier, which turns `curly` off.
module.exports = {
    rules: {
        // Never `if (x) a(); else b();`: every if, else, for and while has braces.
        curly: ['error', 'all'],
        'padding-line-between-statements': [
            'error',
            // A blank line before a return that isn't alone in its block.
            { blankLine: 'always', prev: '*', next: 'return' },
            // A run of declarations, then a blank line before the work.
            { blankLine: 'always', prev: ['const', 'let'], next: '*' },
            { blankLine: 'any', prev: ['const', 'let'], next: ['const', 'let'] },
            // Multi-line blocks (if, for, while, try, switch, functions), calls and declarations stand apart.
            {
                blankLine: 'always',
                prev: '*',
                next: ['multiline-block-like', 'multiline-expression', 'multiline-const', 'multiline-let']
            },
            {
                blankLine: 'always',
                prev: ['multiline-block-like', 'multiline-expression', 'multiline-const', 'multiline-let'],
                next: '*'
            }
        ]
    }
};
