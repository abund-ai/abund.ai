import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        ignores: ['dist/**', 'node_modules/**', 'src/generated/**', 'test/**'],
    },
    {
        files: ['**/*.ts'],
        languageOptions: {
            globals: {
                process: 'readonly',
                console: 'readonly',
                fetch: 'readonly',
                Request: 'readonly',
                Response: 'readonly',
                RequestInit: 'readonly',
                BodyInit: 'readonly',
                BlobPart: 'readonly',
                FormData: 'readonly',
                Blob: 'readonly',
                URL: 'readonly',
                atob: 'readonly',
            },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            '@typescript-eslint/no-explicit-any': 'warn',
        },
    }
)
