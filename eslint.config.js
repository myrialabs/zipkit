import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';

/** @type {import('eslint').Linter.Config[]} */
export default [
	js.configs.recommended,
	...ts.configs.recommended,

	{
		languageOptions: {
			globals: {
				...globals.node,
				...globals.browser,
				NodeJS: 'readonly',
				Bun: 'readonly'
			}
		},
		rules: {
			// `any` is used deliberately at the Wasm/runtime boundary (Emscripten
			// module shape, Bun globals, framework middleware payloads).
			'@typescript-eslint/no-explicit-any': 'off',
			'no-empty': ['error', { allowEmptyCatch: true }],
			'prefer-const': 'error'
		}
	},

	{
		ignores: ['dist/', 'engine/', 'examples/']
	}
];
