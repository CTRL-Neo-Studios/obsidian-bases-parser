import type {ArithmeticOperator, ComparisonOperator, Expr, PrimitiveExpr} from './ast'

/** A formula or filter that doesn't parse. `position` is the offset in the text where parsing stopped. */
export class ExpressionSyntaxError extends Error {
	constructor(
		message: string,
		readonly position: number,
	) {
		super(message)
		this.name = 'ExpressionSyntaxError'
	}
}

// ponytail: never evicted; holds one entry per distinct expression text a session parses (a base has a few dozen).
const cache = new Map<string, Expr | ExpressionSyntaxError>()

/**
 * Parses a filter, formula, summary formula or map centre. Cached per text, since a query evaluates the same
 * expressions for every row. Throws {@link ExpressionSyntaxError}.
 */
export function parseExpression(text: string): Expr {
	let result = cache.get(text)
	if (!result) {
		try {
			result = new Parser(text).parse()
		} catch (error) {
			if (!(error instanceof ExpressionSyntaxError)) throw error
			result = error
		}
		cache.set(text, result)
	}
	if (result instanceof ExpressionSyntaxError) throw result
	return result
}

// Loosest first. Longer operators come before their prefixes (`<=` before `<`).
const LEVELS: {type: 'comparison' | 'arithmetic'; ops: string[]}[] = [
	{type: 'comparison', ops: ['||']},
	{type: 'comparison', ops: ['&&']},
	{type: 'comparison', ops: ['==', '!=']},
	{type: 'comparison', ops: ['<=', '>=', '<', '>']},
	{type: 'arithmetic', ops: ['+', '-']},
	{type: 'arithmetic', ops: ['*', '/', '%']},
]

// Names are anything but whitespace and ASCII punctuation, except `$` and `_` (so `café`, `名前`, `a€b` are names).
const NOT_NAME = /[\s!-#%-/:-@[-^`{-~]/
const DIGIT = /[0-9]/
const NUMBER = /\d+(?:\.\d*)?|\.\d+/y
const FLAGS = /[A-Za-z]*/y
const HEX4 = /^[0-9a-fA-F]{4}$/
const ESCAPES: Record<string, string> = {'"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t'}
const KEYWORDS: Record<string, PrimitiveExpr['value']> = {true: true, false: false, null: null}

class Parser {
	private pos = 0
	/** End of the last token taken, so trailing garbage is reported where the expression ended. */
	private end = 0

	constructor(private readonly text: string) {}

	parse(): Expr {
		this.ws()
		if (this.pos === this.text.length) return {type: 'empty'}
		const expr = this.binary(0)
		this.ws()
		if (this.pos < this.text.length) this.fail(this.end)
		return expr
	}

	private binary(level: number): Expr {
		const spec = LEVELS[level]
		if (!spec) return this.unary()
		let left = this.binary(level + 1)
		for (;;) {
			this.ws()
			const op = spec.ops.find(o => this.text.startsWith(o, this.pos))
			if (!op) return left
			this.take(op.length)
			const right = this.binary(level + 1)
			left = spec.type === 'comparison'
				? {type: 'comparison', operator: op as ComparisonOperator, left, right}
				: {type: 'arithmetic', operator: op as ArithmeticOperator, left, right}
		}
	}

	private unary(): Expr {
		this.ws()
		if (this.eat('!')) return {type: 'not', expr: this.unary()}
		if (this.eat('-')) {
			this.ws()
			NUMBER.lastIndex = this.pos
			if (!NUMBER.test(this.text)) return {type: 'negate', expr: this.unary()}
			// `-1` is a negative number, but `-1 .abs()` negates the call, as Obsidian does.
			const number = this.primary() as PrimitiveExpr
			const expr = this.postfix(number)
			return expr === number ? {type: 'primitive', value: -(number.value as number)} : {type: 'negate', expr}
		}
		return this.postfix(this.primary())
	}

	private postfix(expr: Expr): Expr {
		for (;;) {
			this.ws()
			if (this.eat('.')) {
				// A member is a name; `a.true` and `a.1` don't parse.
				const start = this.pos
				const index = this.name()
				if (Object.hasOwn(KEYWORDS, index)) this.fail(start)
				expr = {type: 'object_access', object: expr, index}
			} else if (this.eat('[')) {
				const index = this.binary(0)
				this.expect(']')
				expr = {type: 'array_access', array: expr, index}
			} else if (this.text[this.pos] === '(') {
				const at = this.pos
				this.take(1)
				const args = this.list(')')
				if (expr.type === 'ident') expr = {type: 'function', name: expr.id, subject: null, args}
				else if (expr.type === 'object_access') expr = {type: 'function', name: expr.index, subject: expr.object, args}
				else throw new ExpressionSyntaxError('Invalid function name', at)
			} else {
				return expr
			}
		}
	}

	private primary(): Expr {
		this.ws()
		const c = this.text[this.pos]
		if (c === '(') {
			this.take(1)
			const value = this.binary(0)
			this.expect(')')
			return {type: 'paren_expr', value}
		}
		if (c === '[') {
			this.take(1)
			return {type: 'array', elements: this.list(']')}
		}
		if (c === '"' || c === "'") return {type: 'primitive', value: this.string(c)}
		if (c === '/') return this.regexp()
		NUMBER.lastIndex = this.pos
		const number = NUMBER.exec(this.text)
		if (number) {
			this.take(number[0].length)
			return {type: 'primitive', value: Number(number[0])}
		}
		const id = this.name()
		return Object.hasOwn(KEYWORDS, id) ? {type: 'primitive', value: KEYWORDS[id] as PrimitiveExpr['value']} : {type: 'ident', id}
	}

	/** Comma-separated expressions up to `close` (the opener is already taken). No trailing comma. */
	private list(close: string): Expr[] {
		const items: Expr[] = []
		this.ws()
		if (this.eat(close)) return items
		do items.push(this.binary(0))
		while (this.eat(','))
		this.expect(close)
		return items
	}

	private name(): string {
		this.ws()
		const start = this.pos
		let i = start
		if (i < this.text.length && !DIGIT.test(this.text[i]!)) {
			while (i < this.text.length && !NOT_NAME.test(this.text[i]!)) i++
		}
		if (i === start) this.fail(start)
		this.take(i - start)
		return this.text.slice(start, i)
	}

	/** A JSON-style string; single quotes also allow `\'`. Raw control characters (a newline, a tab) aren't allowed. */
	private string(quote: string): string {
		const start = this.pos
		let i = start + 1
		let value = ''
		for (;;) {
			const c = this.text[i]
			if (c === undefined) this.fail(start)
			if (c === quote) break
			if (c.charCodeAt(0) < 0x20) this.fail(i)
			if (c !== '\\') {
				value += c
				i++
				continue
			}
			const e = this.text[i + 1] ?? ''
			if (e === 'u' && HEX4.test(this.text.slice(i + 2, i + 6))) {
				value += String.fromCharCode(parseInt(this.text.slice(i + 2, i + 6), 16))
				i += 6
			} else if (e in ESCAPES || (e === "'" && quote === "'")) {
				value += ESCAPES[e] ?? e
				i += 2
			} else {
				this.fail(i)
			}
		}
		this.take(i + 1 - start)
		return value
	}

	/** `/pattern/flags`. `/` inside `[…]` or escaped doesn't end the pattern; an empty pattern is `//`, not a regex. */
	private regexp(): Expr {
		const start = this.pos
		let i = start + 1
		let inClass = false
		for (;;) {
			const c = this.text[i]
			if (c === undefined || c === '\n') this.fail(start)
			if (c === '\\') i++
			else if (c === '[') inClass = true
			else if (c === ']') inClass = false
			else if (c === '/' && !inClass) break
			i++
		}
		const pattern = this.text.slice(start + 1, i)
		FLAGS.lastIndex = i + 1
		const flags = FLAGS.exec(this.text)![0]
		if (!pattern) this.fail(start)
		try {
			new RegExp(pattern, flags)
		} catch {
			this.fail(start)
		}
		this.take(i + 1 + flags.length - start)
		return {type: 'regexp', pattern, flags}
	}

	private ws() {
		while (this.pos < this.text.length && /\s/.test(this.text[this.pos]!)) this.pos++
	}

	private take(length: number) {
		this.pos += length
		this.end = this.pos
	}

	private eat(token: string): boolean {
		this.ws()
		if (!this.text.startsWith(token, this.pos)) return false
		this.take(token.length)
		return true
	}

	private expect(token: string) {
		if (!this.eat(token)) this.fail(this.pos)
	}

	private fail(position: number): never {
		throw new ExpressionSyntaxError(`Unable to parse formula. (position ${position})`, position)
	}
}
