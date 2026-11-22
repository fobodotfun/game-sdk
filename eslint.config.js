import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
    { ignores: ['**/dist/**', '**/node_modules/**', 'examples/**', 'e2e/fixtures/**'] },
    js.configs.recommended,
    ...tseslint.configs.strict,
    {
        rules: {
            '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            'no-console': ['error', { allow: ['error'] }],
            eqeqeq: 'error',
        },
    },
    {
        // a command-line report: printing is its job
        files: ['scripts/**'],
        rules: { 'no-console': 'off' },
    },
    {
        // tests reach into internals and stub freely
        files: ['**/test/**', 'e2e/**'],
        rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
    }
)
