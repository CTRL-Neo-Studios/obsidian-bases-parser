import {describe, expect, it} from 'vitest'
import {ExpressionSyntaxError, parseExpression} from '../src'
import captured from './fixtures/obsidian/expressions.json'

// Each expression with the AST (or error) Obsidian 1.15.1 produced for it: precedence, literals, names, access, calls,
// the vault's own formulas and filters, and text that doesn't parse.
describe('parseExpression gives Obsidian\'s AST', () => {
	for (const {expr, ast, error} of captured as {expr: string; ast?: unknown; error?: string}[]) {
		it(JSON.stringify(expr), () => {
			if (ast) return expect(parseExpression(expr)).toEqual(ast)
			// Obsidian's other messages (a JSON or RegExp error) come from its own internals; ours say where parsing stopped.
			expect(() => parseExpression(expr)).toThrow(
				error === 'Invalid function name' ? /^Invalid function name$/ : /^Unable to parse formula\. \(position \d+\)$/,
			)
		})
	}
})

describe('syntax error positions', () => {
	const position = (text: string) => {
		try {
			parseExpression(text)
		} catch (error) {
			if (error instanceof ExpressionSyntaxError) return error.position
			throw error
		}
		throw new Error(`${text} parsed`)
	}

	it.each([
		['a b', 1, 'trailing text: where the expression ended'],
		['(1 + 2) 3', 7, 'trailing text after a group'],
		['1 +', 3, 'a missing operand'],
		['f(1, )', 5, 'a missing argument'],
		['"abc', 0, 'an unterminated string: its start'],
		['"a\nb"', 2, 'a raw newline in a string'],
		['a.true', 2, 'a keyword as a member name'],
		['f()()', 3, 'calling something that isn\'t a name'],
	])('%j → %i (%s)', (text, expected) => {
		expect(position(text)).toBe(expected)
	})
})
