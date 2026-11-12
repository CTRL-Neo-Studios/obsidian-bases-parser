import {defineConfig} from 'vitest/config'

// Dates are local time: the Obsidian captures in test/fixtures were made in New York.
process.env.TZ = 'America/New_York'

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
	},
})
