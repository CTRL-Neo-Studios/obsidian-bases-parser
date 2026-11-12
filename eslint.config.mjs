import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
	{ignores: ['dist', 'node_modules']},
	js.configs.recommended,
	...tseslint.configs.recommended,
	// `const {[key]: _removed, ...rest} = object` drops a key.
	{rules: {'@typescript-eslint/no-unused-vars': ['error', {ignoreRestSiblings: true}]}},
)
