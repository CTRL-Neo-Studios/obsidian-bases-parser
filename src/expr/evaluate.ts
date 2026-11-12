import {fromFrontmatter, tag} from '../values/convert'
import {callFunction, findGlobal, findMethod, type Call} from '../values/functions'
import {addDuration, durationIn, durationMs, isDurationField, parseDuration} from '../values/time'
import {bool, compare, date, error, isTruthy, list, looseEquals, NULL, num, stringValue, toText, type Value, type ValueOf} from '../values/value'
import type {Expr, FunctionExpr} from './ast'
import {ExpressionSyntaxError, parseExpression} from './parse'

/** A link in a file, as the host's index has it: the link text (`M#Head`) and what it shows (`alias`, or the name). */
export interface FileLink {
	link: string
	display: string
}

/** A file as the host knows it. */
export interface BaseFile {
	path: string
	ctime: number
	mtime: number
	size: number
	/** The YAML frontmatter as JSON; null or absent for files without one. */
	frontmatter?: Record<string, unknown> | null
	/** Tags in the body, with `#`, in order (frontmatter `tags` are added from `frontmatter`). */
	tags?: string[]
	/** Every link, in Obsidian's order: frontmatter links, body links, then embeds. */
	links?: FileLink[]
	embeds?: FileLink[]
}

/** The host's files and link graph. The engine never touches a filesystem. */
export interface BaseHost {
	file(path: string): BaseFile | null
	/** The path a link's text (without `#subpath`) points to from `from`, or null when it doesn't resolve. */
	resolve(link: string, from: string): string | null
	/** Paths of the files linking to `path`. */
	backlinks(path: string): string[]
}

export interface EvaluationContext {
	host: BaseHost
	/** The clock for `now()`, `today()` and durations, in ms. */
	now: number
	/** `this`: the base file, or the note embedding the base. */
	thisPath: string
	/** The base's formulas, by name. */
	formulas: Record<string, string>
}

type Vars = Record<string, Value>

/**
 * Evaluates expressions for one row (file). Formulas are evaluated on first use and kept; a formula that needs itself
 * is "Infinite loop detected in formula".
 */
export class RowScope {
	private readonly formulaValues = new Map<string, Value>()
	private readonly evaluating = new Set<string>()
	private noteValue: Value | undefined
	private readonly call: Call

	constructor(
		readonly context: EvaluationContext,
		readonly path: string,
	) {
		const {host} = context
		this.call = {
			now: context.now,
			path,
			resolve: (link, from) => host.resolve(link, from),
			exists: p => host.file(p) !== null,
			tagsOf: p => this.fileTags(p),
			linksOf: p => this.fileLinks(p),
			hasProperty: (p, name) => Object.hasOwn(host.file(p)?.frontmatter ?? {}, name),
			evaluate: () => NULL,
		}
	}

	/** An expression's value for this row. A blank or unparseable expression is null, as in Obsidian. */
	evaluate(expression: string | Expr): Value {
		let expr: Expr
		try {
			expr = typeof expression === 'string' ? parseExpression(expression) : expression
		} catch (e) {
			if (e instanceof ExpressionSyntaxError) return NULL
			throw e
		}
		return this.eval(expr, {})
	}

	/** `formula.name` for this row. */
	formula(name: string): Value {
		const known = this.formulaValues.get(name)
		if (known) return known
		if (!Object.hasOwn(this.context.formulas, name)) return error(`Cannot find "${name}" on type Formulas`)
		if (this.evaluating.has(name)) return error('Infinite loop detected in formula')
		this.evaluating.add(name)
		const value = this.evaluate(this.context.formulas[name]!)
		this.evaluating.delete(name)
		this.formulaValues.set(name, value)
		return value
	}

	private eval(expr: Expr, vars: Vars): Value {
		switch (expr.type) {
			case 'empty': return NULL
			case 'primitive': {
				const value = expr.value
				if (value === null) return NULL
				if (typeof value === 'string') return {type: 'String', value}
				return typeof value === 'number' ? num(value) : bool(value)
			}
			case 'regexp': return {type: 'RegExp', regexp: new RegExp(expr.pattern, expr.flags)}
			case 'paren_expr': return this.eval(expr.value, vars)
			case 'array': {
				const items: Value[] = []
				for (const element of expr.elements) {
					const item = this.eval(element, vars)
					if (item.type === 'Error') return item
					items.push(item)
				}
				return list(items)
			}
			case 'ident': return this.name(expr.id, vars)
			case 'object_access': return this.member(this.eval(expr.object, vars), expr.index)
			case 'array_access': return this.index(this.eval(expr.array, vars), this.eval(expr.index, vars))
			case 'function': return this.callExpr(expr, vars)
			case 'not': {
				const value = this.eval(expr.expr, vars)
				return value.type === 'Error' || value.type === 'Null' ? value : bool(!isTruthy(value))
			}
			case 'negate': {
				const value = this.eval(expr.expr, vars)
				if (value.type === 'Error' || value.type === 'Null') return value
				return value.type === 'Number' ? num(-value.value) : error(`Unable to negate ${toText(value)}`)
			}
			case 'comparison': return this.comparison(expr.operator, expr.left, expr.right, vars)
			case 'arithmetic': {
				const left = this.eval(expr.left, vars)
				if (left.type === 'Error') return left
				const right = this.eval(expr.right, vars)
				if (right.type === 'Error') return right
				return this.arithmetic(expr.operator, left, right)
			}
		}
	}

	private name(id: string, vars: Vars): Value {
		if (Object.hasOwn(vars, id)) return vars[id]!
		switch (id) {
			case 'file': return {type: 'File', path: this.path}
			case 'note': return this.note()
			case 'formula': return {type: 'Formulas', names: Object.keys(this.context.formulas)}
			case 'this': return {type: 'ThisFile', path: this.context.thisPath}
			// Lambda variables outside a lambda are null, whatever the note has.
			case 'value':
			case 'index':
			case 'acc':
			case 'key': return NULL
		}
		const note = this.note() as ValueOf<'Object'>
		return note.entries.get(id) ?? NULL
	}

	private note(): Value {
		this.noteValue ??= this.properties(this.path)
		return this.noteValue
	}

	private properties(path: string): Value {
		const frontmatter = this.context.host.file(path)?.frontmatter ?? {}
		return {type: 'Object', entries: new Map(Object.entries(frontmatter).map(([k, v]) => [k, fromFrontmatter(v, path, k)]))}
	}

	private fileTags(path: string): Value[] {
		const file = this.context.host.file(path)
		const frontmatter = file?.frontmatter && Object.entries(file.frontmatter).find(([k]) => k.toLowerCase() === 'tags')
		const fromFm = frontmatter ? (fromFrontmatter(frontmatter[1], path, 'tags') as ValueOf<'List'>).items : []
		return [...(file?.tags ?? []).map(tag), ...fromFm]
	}

	private fileLinks(path: string, kind: 'links' | 'embeds' = 'links'): Value[] {
		return (this.context.host.file(path)?.[kind] ?? []).map(l => ({type: 'Link', path: l.link, display: l.display, from: path}))
	}

	private member(subject: Value, key: string): Value {
		switch (subject.type) {
			case 'Error':
			case 'Null': return subject
			case 'Object': return subject.entries.get(key) ?? NULL
			case 'ThisFile':
				if (key === 'file') return {type: 'File', path: subject.path}
				if (key === 'formula') return {type: 'Formulas', names: Object.keys(this.context.formulas)}
				return key === 'this' ? subject : NULL
			case 'Formulas': return this.formula(key)
			case 'File': return this.fileField(subject.path, key) ?? error(`Cannot find "${key}" on type File`)
			case 'Date': {
				const d = new Date(subject.ms)
				const fields: Record<string, number> = {year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds(), millisecond: d.getMilliseconds()}
				if (Object.hasOwn(fields, key)) return num(fields[key]!)
				break
			}
			case 'Duration':
				if (isDurationField(key)) return num(durationIn(subject, key))
				break
			case 'List':
				if (key === 'length') return num(subject.items.length)
				break
			default: {
				const text = stringValue(subject)
				if (text !== null && key === 'length') return num(text.length)
			}
		}
		return error(`Cannot find "${key}" on type ${subject.type}`)
	}

	private fileField(path: string, key: string): Value | null {
		const file = this.context.host.file(path)
		const fullname = path.slice(path.lastIndexOf('/') + 1)
		const basename = basenameOf(path)
		const ext = fullname.slice(basename.length + 1)
		switch (key) {
			case 'file': return {type: 'File', path}
			case 'path': return {type: 'String', value: path}
			// Notes are named without `.md`; other files keep their extension (`img.png`, `P.base`).
			case 'name': return {type: 'String', value: ext === 'md' ? basename : fullname}
			case 'basename': return {type: 'String', value: basename}
			case 'fullname': return {type: 'String', value: fullname}
			case 'ext': return {type: 'String', value: ext}
			case 'folder': return {type: 'String', value: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/'}
			case 'size': return file ? num(file.size) : NULL
			case 'ctime': return file ? date(file.ctime, true) : NULL
			case 'mtime': return file ? date(file.mtime, true) : NULL
			case 'tags': return list(this.fileTags(path))
			case 'links': return list(this.fileLinks(path))
			case 'embeds': return list(this.fileLinks(path, 'embeds'))
			case 'backlinks':
				return list(this.context.host.backlinks(path).map(source => ({
					type: 'Link', path: source, display: basenameOf(source), from: path,
				})))
			case 'properties': return path === this.path ? this.note() : this.properties(path)
		}
		return null
	}

	private index(subject: Value, index: Value): Value {
		if (subject.type === 'Error' || subject.type === 'Null') return subject
		if (index.type === 'Error') return index
		if (subject.type === 'List') {
			if (index.type !== 'Number') return error(`Array index must be an integer. Got ${index.type}`)
			if (!Number.isInteger(index.value)) return NULL
			return subject.items.at(index.value) ?? NULL
		}
		if (subject.type === 'Object') {
			if (index.type !== 'String') return error(`Object access must be an string. Got ${index.type}`)
			return subject.entries.get(index.value) ?? NULL
		}
		if (subject.type === 'Formulas' || subject.type === 'File' || subject.type === 'ThisFile') {
			const key = stringValue(index)
			if (key !== null) return this.member(subject, key)
		}
		const text = stringValue(subject)
		if (text !== null) {
			if (index.type !== 'Number') return error(`String index must be an integer. Got ${index.type}`)
			return {type: 'String', value: text.charAt(index.value)}
		}
		return error(`Cannot access index "${toText(index)}" of non-array value`)
	}

	private callExpr(expr: FunctionExpr, vars: Vars): Value {
		const call: Call = {...this.call, evaluate: (body, extra) => this.eval(body, {...vars, ...extra})}
		const evaluate = (arg: Expr) => this.eval(arg, vars)
		if (expr.subject === null) {
			const f = findGlobal(expr.name)
			if (!f) return error(`Cannot find function "${expr.name}"`)
			return callFunction(expr.name, f, expr.args, call, NULL, evaluate)
		}
		const subject = this.eval(expr.subject, vars)
		if (subject.type === 'Error') return subject
		const f = findMethod(subject, expr.name)
		if (!f) return error(`Cannot find function "${expr.name}" on type ${subject.type}`)
		return callFunction(expr.name, f, expr.args, call, subject, evaluate)
	}

	private comparison(operator: Extract<Expr, {type: 'comparison'}>['operator'], leftExpr: Expr, rightExpr: Expr, vars: Vars): Value {
		const left = this.eval(leftExpr, vars)
		if (left.type === 'Error') return left
		if (operator === '&&' && !isTruthy(left)) return bool(false)
		if (operator === '||' && isTruthy(left)) return bool(true)
		const right = this.eval(rightExpr, vars)
		if (right.type === 'Error') return right
		const {resolve} = this.call
		switch (operator) {
			case '&&':
			case '||': return bool(isTruthy(right))
			case '==': return bool(looseEquals(left, right, resolve, this.context.now))
			case '!=': return bool(!looseEquals(left, right, resolve, this.context.now))
		}
		if (left.type === 'Null' || right.type === 'Null') return NULL
		const order = compare(left, right, this.context.now)
		switch (operator) {
			case '<': return bool(order < 0)
			case '<=': return bool(order <= 0)
			case '>': return bool(order > 0)
			case '>=': return bool(order >= 0)
		}
	}

	private arithmetic(operator: Extract<Expr, {type: 'arithmetic'}>['operator'], a: Value, b: Value): Value {
		const now = this.context.now
		const invalid = () => error(`Invalid operator between ${a.type} and ${b.type}`)
		if (a.type === 'Number' && b.type === 'Number') {
			const [x, y] = [a.value, b.value]
			return num(operator === '+' ? x + y : operator === '-' ? x - y : operator === '*' ? x * y : operator === '/' ? x / y : x % y)
		}
		if (operator === '+' || operator === '-') {
			const sign = operator === '+' ? 1 : -1
			if (a.type === 'Date') {
				if (operator === '-' && b.type === 'Date') return {type: 'Duration', months: 0, days: 0, ms: a.ms - b.ms, anchor: now}
				const text = stringValue(b)
				const duration = b.type === 'Duration' ? b : text === null ? null : parseDuration(text, now)
				if (duration) return date(addDuration(a.ms, duration, sign), a.time || duration.ms !== 0)
			}
			if (a.type === 'Duration' && b.type === 'Duration') {
				return {type: 'Duration', months: a.months + sign * b.months, days: a.days + sign * b.days, ms: a.ms + sign * b.ms, anchor: a.anchor}
			}
			if (operator === '+') {
				if (a.type === 'List' && b.type === 'List') return list([...a.items, ...b.items])
				const textA = stringValue(a)
				const textB = stringValue(b)
				// Text joins anything, null as nothing: `"x" + list` is "x1, 2", `null + "a"` is "a".
				if (textA !== null || textB !== null) {
					return {type: 'String', value: (a.type === 'Null' ? '' : toText(a)) + (b.type === 'Null' ? '' : toText(b))}
				}
			}
		}
		if (a.type === 'Null' || b.type === 'Null') return NULL
		if (a.type === 'Duration' && b.type === 'Number' && (operator === '*' || operator === '/')) {
			const k = operator === '*' ? b.value : 1 / b.value
			// A whole multiple keeps calendar months ("1M" * 2 is 2 months); anything else is real time.
			if (Number.isInteger(k)) return {...a, months: a.months * k, days: a.days * k, ms: a.ms * k}
			return {type: 'Duration', months: 0, days: 0, ms: durationMs(a) * k, anchor: a.anchor}
		}
		return invalid()
	}
}

/** The file name without its extension. */
function basenameOf(path: string): string {
	const fullname = path.slice(path.lastIndexOf('/') + 1)
	const dot = fullname.lastIndexOf('.')
	return dot > 0 ? fullname.slice(0, dot) : fullname
}
