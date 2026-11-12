import {defineConfig} from 'vitest/config'

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		// Until B1 lands its first tests.
		passWithNoTests: true,
	},
})
