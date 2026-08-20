// Bitfocus's shared ESLint config.
//
// Two deviations from a bare re-export, both forced:
//   * their tools package exports a `generateEslintConfig` factory, not a
//     default — `export { default }` fails to load;
//   * their config only marks `*.mjs` as ESM, and this module is
//     `"type": "module"` with `.js` sources, so the parser needs telling
//     or every `import` is a parse error.
import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

const config = await generateEslintConfig({})

export default [
	...config,
	{
		files: ['**/*.js', '**/*.mjs'],
		languageOptions: { sourceType: 'module' },
	},
	{
		ignores: ['pkg/**', 'node_modules/**'],
	},
]
