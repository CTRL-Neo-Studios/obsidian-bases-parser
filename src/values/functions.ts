import type {Expr} from '../expr/ast'
import {isUrl} from './convert'
import {formatDate, parseDate, parseDuration, relative, startOfDay} from './time'
import {bool, collate, error, isA, isTruthy, list, looseEquals, NULL, num, parseWikiLink, str, stringValue, toText, typeChain, type TypeName, type Value, type ValueOf} from './value'

/** What a function sees of the evaluation: the clock, links, files, and lazy arguments with lambda variables. */
export interface Call {
	now: number
	/** The row's path: where `link("M")` and `file("M")` resolve from. */
	path: string
	resolve(link: string, from: string): string | null
	exists(path: string): boolean
	tagsOf(path: string): Value[]
	linksOf(path: string): Value[]
	hasProperty(path: string, name: string): boolean
	/** Evaluates a lazy argument with extra variables (`value`, `index`, `acc`, `key`). */
	evaluate(expr: Expr, vars: Record<string, Value>): Value
}

type ParamType = TypeName | 'Any'
interface Param {
	name: string
	types: ParamType[]
	optional?: true
	variadic?: true
	/** Passed unevaluated (an `Expr`), for `if` branches and `filter`/`map`/`reduce` bodies. */
	lazy?: true
}
export interface Fn {
	params: Param[]
	call(args: (Value | Expr)[], call: Call, subject: Value): Value
}

const p = (name: string, ...types: ParamType[]): Param => ({name, types: types.length ? types : ['Any']})
const opt = (param: Param): Param => ({...param, optional: true})
const rest = (param: Param): Param => ({...param, variadic: true})
const lazy = (name: string): Param => ({name, types: ['Any'], lazy: true})
const fn = (params: Param[], call: Fn['call']): Fn => ({params, call})

const v = (args: (Value | Expr)[], i: number) => args[i] as Value | undefined
const s = (args: (Value | Expr)[], i: number) => stringValue(args[i] as Value) as string
const n = (args: (Value | Expr)[], i: number) => (args[i] as ValueOf<'Number'>).value
const text = (subject: Value) => stringValue(subject) as string

/** Calls `fn` after checking arity and argument types, with Obsidian's messages. A null argument for a typed parameter makes the result null. */
export function callFunction(name: string, f: Fn, args: Expr[], call: Call, subject: Value, evaluate: (e: Expr) => Value): Value {
	const required = f.params.filter(param => !param.optional && !param.variadic).length
	const variadic = f.params.some(param => param.variadic)
	if (args.length < required) return error(`Cannot call function "${name}", not enough arguments.`)
	if (!variadic && args.length > f.params.length) return error(`Cannot call function "${name}", too many arguments.`)
	const values: (Value | Expr)[] = []
	let nullArgument = false
	for (const [i, arg] of args.entries()) {
		const param = f.params[Math.min(i, f.params.length - 1)]!
		if (param.lazy) {
			values.push(arg)
			continue
		}
		const value = evaluate(arg)
		if (value.type === 'Error') return value
		if (!param.types.includes('Any')) {
			if (value.type === 'Null') nullArgument = true
			else if (!param.types.some(t => isA(value, t as TypeName))) {
				return error(`Type error in "${name}", parameter "${param.name}". Expected ${param.types[0]}, given ${value.type}.`)
			}
		}
		values.push(value)
	}
	if (nullArgument) return NULL
	try {
		return f.call(values, call, subject)
	} catch (e) {
		if (e instanceof EvalError) return error(e.message)
		throw e
	}
}

/** Thrown inside a function for an error Obsidian reports in the cell. */
class EvalError extends Error {}

function toNumber(value: Value): Value {
	switch (value.type) {
		case 'Null': return NULL
		case 'Number': return value
		case 'Boolean': return num(value.value ? 1 : 0)
		case 'Date': return num(value.ms)
		default: {
			const t = stringValue(value)
			if (t === null) return error(`Unable to convert "${value.type}" to a number.`)
			const parsed = t.trim() === '' ? NaN : Number(t)
			return Number.isNaN(parsed) ? error(`Unable to parse "${t}" as a number.`) : num(parsed)
		}
	}
}

/** A path, a link's text or a `[[link]]` as a file path, resolved from `from`. */
function resolveTarget(value: Value, call: Call): string | null {
	if (value.type === 'File' || value.type === 'ThisFile') return value.path
	if (value.type === 'Link') return call.resolve(value.path.split('#')[0]!, value.from)
	const t = stringValue(value)
	if (t === null) return null
	const link = parseWikiLink(t, call.path)
	if (link) return resolveTarget(link, call)
	return call.exists(t) ? t : call.resolve(t, call.path)
}

function makeLink(target: Value, display: Value | undefined, call: Call): Value {
	const label = display && display.type !== 'Null' ? toText(display) : null
	if (target.type === 'File' || target.type === 'ThisFile') return {type: 'Link', path: target.path, display: label, from: call.path}
	if (target.type === 'Link') return label === null ? target : {...target, display: label}
	const t = stringValue(target)!
	if (isUrl(t)) return {type: 'URL', value: t}
	const link = parseWikiLink(t, call.path)
	if (link) return label === null ? link : {...link, display: label}
	return {type: 'Link', path: t, display: label, from: call.path}
}

const numbers = (items: Value[]) => items.filter((x): x is ValueOf<'Number'> => x.type === 'Number').map(x => x.value)
const dates = (items: Value[]) => items.filter((x): x is ValueOf<'Date'> => x.type === 'Date').map(x => x.ms)
const aggregate = (items: Value[], f: (values: number[]) => number) => {
	const values = numbers(items)
	return values.length ? num(f(values)) : NULL
}
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)
const mean = (values: number[]) => sum(values) / values.length


function flatten(items: Value[]): Value[] {
	return items.flatMap(item => (item.type === 'List' ? flatten(item.items) : [item]))
}

/** List `contains`: loose equality, and tags match without `#` and case. */
function listHas(items: Value[], value: Value, call: Call): boolean {
	return items.some(item => {
		if (item.type === 'String' && item.tag) {
			const t = stringValue(value)
			if (t !== null) return item.value.slice(1).toLowerCase() === t.replace(/^#/, '').toLowerCase()
		}
		return looseEquals(item, value, call.resolve, call.now)
	})
}

const stringHas = (subject: string, query: string) => query !== '' && subject.toLowerCase().includes(query.toLowerCase())

const GLOBALS: Record<string, Fn> = {
	if: fn([p('condition'), lazy('trueResult'), {...lazy('falseResult'), optional: true}], (args, call) => {
		const branch = isTruthy(args[0] as Value) ? args[1] : args[2]
		return branch ? call.evaluate(branch as Expr, {}) : NULL
	}),
	now: fn([], (_, call) => ({type: 'Date', ms: call.now, time: true})),
	today: fn([], (_, call) => ({type: 'Date', ms: startOfDay(call.now), time: false})),
	date: fn([p('input', 'String', 'Date')], (args) => {
		const input = args[0] as Value
		if (input.type === 'Date') return input
		const parsed = parseDate(s(args, 0))
		return parsed ? {type: 'Date', ...parsed} : NULL
	}),
	duration: fn([p('input', 'String', 'Duration')], (args, call) => {
		const input = args[0] as Value
		if (input.type === 'Duration') return input
		const parsed = parseDuration(s(args, 0), call.now)
		return parsed ? {type: 'Duration', ...parsed} : NULL
	}),
	number: fn([p('input')], args => toNumber(args[0] as Value)),
	min: fn([rest(p('inputs', 'Number'))], args => (args.length ? num(Math.min(...args.map((_, i) => n(args, i)))) : NULL)),
	max: fn([rest(p('inputs', 'Number'))], args => (args.length ? num(Math.max(...args.map((_, i) => n(args, i)))) : NULL)),
	random: fn([], () => num(Math.random())),
	list: fn([p('element')], args => {
		const element = args[0] as Value
		return element.type === 'List' || element.type === 'Null' ? element : list([element])
	}),
	link: fn([p('self', 'String', 'File'), opt(p('display'))], (args, call) => makeLink(args[0] as Value, v(args, 1), call)),
	file: fn([p('input', 'String', 'File')], (args, call) => {
		const path = resolveTarget(args[0] as Value, call)
		return path ? {type: 'File', path} : NULL
	}),
	image: fn([p('input', 'String', 'File')], (args, call) => {
		const input = args[0] as Value
		const t = stringValue(input)
		if (input.type !== 'Link' && t !== null && isUrl(t)) return {type: 'Image', value: `![](${t})`, src: t}
		const src = input.type === 'String' || input.type === 'URL' ? t! : resolveTarget(input, call) ?? (input.type === 'Link' ? input.path : '')
		return {type: 'Image', value: `![[${src}]]`, src}
	}),
	icon: fn([p('input', 'String')], args => ({type: 'String', value: s(args, 0), icon: true})),
	html: fn([p('input', 'String')], args => ({type: 'HTML', value: s(args, 0)})),
	escapeHTML: fn([p('input', 'String')], args => str(s(args, 0).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'))),
}

const ANY: Record<string, Fn> = {
	toString: fn([], (_, __, self) => str(toText(self))),
	isTruthy: fn([], (_, __, self) => bool(isTruthy(self))),
	isType: fn([p('type', 'String')], (args, _, self) => {
		const want = s(args, 0).toLowerCase()
		return bool(want === 'any' || typeChain(self.type).some(t => t.toLowerCase() === want))
	}),
}

const STRING: Record<string, Fn> = {
	contains: fn([p('value', 'String')], (args, _, self) => bool(stringHas(text(self), s(args, 0)))),
	containsAll: fn([rest(p('values', 'String'))], (args, _, self) => bool(args.every((__, i) => stringHas(text(self), s(args, i))))),
	containsAny: fn([rest(p('values', 'String'))], (args, _, self) => bool(args.some((__, i) => stringHas(text(self), s(args, i))))),
	startsWith: fn([p('query', 'String')], (args, _, self) => bool(text(self).startsWith(s(args, 0)))),
	endsWith: fn([p('query', 'String')], (args, _, self) => bool(text(self).endsWith(s(args, 0)))),
	isEmpty: fn([], (_, __, self) => bool(text(self) === '')),
	lower: fn([], (_, __, self) => str(text(self).toLowerCase())),
	title: fn([], (_, __, self) => str(text(self).toLowerCase().replace(/(^|\s)(\S)/gu, (_m, space: string, c: string) => space + c.toUpperCase()))),
	trim: fn([], (_, __, self) => str(text(self).trim())),
	replace: fn([p('pattern', 'String', 'RegExp'), p('replacement', 'String')], (args, _, self) => {
		const pattern = args[0] as Value
		return str(pattern.type === 'RegExp' ? text(self).replace(pattern.regexp, s(args, 1)) : text(self).replaceAll(s(args, 0), s(args, 1)))
	}),
	repeat: fn([p('count', 'Number')], (args, _, self) => {
		const count = n(args, 0)
		if (count < 0 || count === Infinity) throw new EvalError(`Invalid count value: ${count}`)
		return str(text(self).repeat(count))
	}),
	reverse: fn([], (_, __, self) => str([...text(self)].reverse().join(''))),
	slice: fn([p('start', 'Number'), opt(p('end', 'Number'))], (args, _, self) => str(text(self).slice(n(args, 0), v(args, 1) ? n(args, 1) : undefined))),
	split: fn([p('separator', 'String', 'RegExp'), opt(p('n', 'Number'))], (args, _, self) => {
		const separator = args[0] as Value
		const parts = text(self).split(separator.type === 'RegExp' ? separator.regexp : s(args, 0), v(args, 1) ? n(args, 1) : undefined)
		return list(parts.map(str))
	}),
}

const NUMBER: Record<string, Fn> = {
	abs: fn([], (_, __, self) => num(Math.abs((self as ValueOf<'Number'>).value))),
	ceil: fn([], (_, __, self) => num(Math.ceil((self as ValueOf<'Number'>).value))),
	floor: fn([], (_, __, self) => num(Math.floor((self as ValueOf<'Number'>).value))),
	round: fn([opt(p('digits', 'Number'))], (args, _, self) => {
		const x = (self as ValueOf<'Number'>).value
		const digits = v(args, 0) ? n(args, 0) : 0
		// Digits of 0 or below round to an integer (`1234.5.round(-2)` is 1235), as in Obsidian.
		if (digits <= 0) return num(Math.round(x))
		const scale = 10 ** digits
		return num(Math.round(x * scale) / scale)
	}),
	toFixed: fn([p('precision', 'Number')], (args, _, self) => {
		const digits = n(args, 0)
		if (!(digits >= 0 && digits <= 100)) throw new EvalError('toFixed() digits argument must be between 0 and 100')
		return str((self as ValueOf<'Number'>).value.toFixed(digits))
	}),
	isEmpty: fn([], () => bool(false)),
}

const items = (self: Value) => (self as ValueOf<'List'>).items

const LIST: Record<string, Fn> = {
	contains: fn([p('value')], (args, call, self) => bool(listHas(items(self), args[0] as Value, call))),
	containsAll: fn([rest(p('values'))], (args, call, self) => bool(args.every(a => listHas(items(self), a as Value, call)))),
	containsAny: fn([rest(p('values'))], (args, call, self) => bool(args.some(a => listHas(items(self), a as Value, call)))),
	filter: fn([lazy('value')], (args, call, self) => {
		const out: Value[] = []
		for (const [index, value] of items(self).entries()) {
			const keep = call.evaluate(args[0] as Expr, {value, index: num(index)})
			if (keep.type === 'Error') return keep
			if (isTruthy(keep)) out.push(value)
		}
		return list(out)
	}),
	map: fn([lazy('value')], (args, call, self) => {
		const out: Value[] = []
		for (const [index, value] of items(self).entries()) {
			const mapped = call.evaluate(args[0] as Expr, {value, index: num(index)})
			if (mapped.type === 'Error') return mapped
			out.push(mapped)
		}
		return list(out)
	}),
	reduce: fn([lazy('value'), p('initial')], (args, call, self) => {
		let acc = args[1] as Value
		for (const [index, value] of items(self).entries()) {
			acc = call.evaluate(args[0] as Expr, {value, index: num(index), acc})
			if (acc.type === 'Error') return acc
		}
		return acc
	}),
	flat: fn([], (_, __, self) => list(flatten(items(self)))),
	join: fn([p('separator', 'String')], (args, _, self) => str(items(self).map(toText).join(s(args, 0)))),
	reverse: fn([], (_, __, self) => list([...items(self)].reverse())),
	slice: fn([p('start', 'Number'), opt(p('end', 'Number'))], (args, _, self) => list(items(self).slice(n(args, 0), v(args, 1) ? n(args, 1) : undefined))),
	sort: fn([], (_, __, self) => list([...items(self)].sort((a, b) => collate(toText(a), toText(b))))),
	// Grouped by text, first occurrence first, so values that print alike end up together: `[1, 1, 2, "1"]` is `1, "1", 2`.
	unique: fn([], (_, call, self) => {
		const groups = new Map<string, Value[]>()
		for (const item of items(self)) {
			const group = groups.get(toText(item)) ?? []
			if (!group.some(o => o.type === item.type && looseEquals(o, item, call.resolve, call.now))) group.push(item)
			groups.set(toText(item), group)
		}
		return list([...groups.values()].flat())
	}),
	isEmpty: fn([], (_, __, self) => bool(items(self).length === 0)),
	sum: fn([], (_, __, self) => aggregate(items(self), sum)),
	// Over every item, numbers or not: `[5, "five", null].mean()` is 5 / 3, as in Obsidian (and its Average summary).
	mean: fn([], (_, __, self) => aggregate(items(self), values => sum(values) / items(self).length)),
	median: fn([], (_, __, self) => aggregate(items(self), values => {
		const sorted = [...values].sort((a, b) => a - b)
		const mid = sorted.length >> 1
		return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
	})),
	min: fn([], (_, __, self) => aggregate(items(self), values => Math.min(...values))),
	max: fn([], (_, __, self) => aggregate(items(self), values => Math.max(...values))),
	stddev: fn([], (_, __, self) => aggregate(items(self), values => {
		const m = mean(values)
		return Math.sqrt(mean(values.map(x => (x - m) ** 2)))
	})),
	earliest: fn([], (_, __, self) => {
		const values = dates(items(self))
		return values.length ? {type: 'Date', ms: Math.min(...values), time: true} : NULL
	}),
	latest: fn([], (_, __, self) => {
		const values = dates(items(self))
		return values.length ? {type: 'Date', ms: Math.max(...values), time: true} : NULL
	}),
}

const entries = (self: Value) => (self as ValueOf<'Object'>).entries

const OBJECT: Record<string, Fn> = {
	isEmpty: fn([], (_, __, self) => bool(entries(self).size === 0)),
	keys: fn([], (_, __, self) => list([...entries(self).keys()].map(str))),
	values: fn([], (_, __, self) => list([...entries(self).values()])),
	map: fn([lazy('value')], (args, call, self) => {
		const out: Value[] = []
		for (const [key, value] of entries(self)) {
			const mapped = call.evaluate(args[0] as Expr, {key: str(key), value})
			if (mapped.type === 'Error') return mapped
			out.push(mapped)
		}
		return list(out)
	}),
	filter: fn([lazy('value')], (args, call, self) => {
		const out = new Map<string, Value>()
		for (const [key, value] of entries(self)) {
			const keep = call.evaluate(args[0] as Expr, {key: str(key), value})
			if (keep.type === 'Error') return keep
			if (isTruthy(keep)) out.set(key, value)
		}
		return {type: 'Object', entries: out}
	}),
}

const dateOf = (self: Value) => self as ValueOf<'Date'>

const DATE: Record<string, Fn> = {
	format: fn([p('format', 'String')], (args, _, self) => str(formatDate(dateOf(self).ms, s(args, 0)))),
	date: fn([], (_, __, self) => ({type: 'Date', ms: startOfDay(dateOf(self).ms), time: false})),
	time: fn([], (_, __, self) => str(formatDate(dateOf(self).ms, 'HH:mm:ss'))),
	relative: fn([], (_, call, self) => ({...dateOf(self), relative: relative(dateOf(self).ms, call.now)})),
	isEmpty: fn([], () => bool(false)),
}

const pathOf = (self: Value) => (self as ValueOf<'File'>).path

const FILE: Record<string, Fn> = {
	asLink: fn([opt(p('display'))], (args, call, self) => makeLink(self, v(args, 0), call)),
	hasLink: fn([p('dest', 'File', 'String')], (args, call, self) => {
		const dest = args[0] as Value
		const target = resolveTarget(dest, call)
		const t = stringValue(dest)
		return bool(call.linksOf(pathOf(self)).some(link => {
			const l = link as ValueOf<'Link'>
			return (target !== null && call.resolve(l.path.split('#')[0]!, l.from) === target) || (t !== null && l.path.split('#')[0] === t)
		}))
	}),
	inFolder: fn([p('folder', 'String')], (args, _, self) => {
		const folder = s(args, 0).replace(/\/+$/, '')
		return bool(folder === '' || pathOf(self).startsWith(`${folder}/`))
	}),
	hasProperty: fn([p('property', 'String')], (args, call, self) => bool(call.hasProperty(pathOf(self), s(args, 0)))),
	hasTag: fn([rest(p('values', 'String'))], (args, call, self) => {
		const tags = call.tagsOf(pathOf(self)).map(t => (t as ValueOf<'String'>).value.slice(1).toLowerCase())
		return bool(args.some((_, i) => {
			const want = s(args, i).replace(/^#/, '').toLowerCase()
			return tags.some(t => t === want || t.startsWith(`${want}/`))
		}))
	}),
}

const LINK: Record<string, Fn> = {
	asFile: fn([], (_, call, self) => {
		const path = resolveTarget(self, call)
		return path ? {type: 'File', path} : NULL
	}),
	linksTo: fn([p('file', 'File')], (args, call, self) => bool(resolveTarget(self, call) === pathOf(args[0] as Value))),
}

const REGEXP: Record<string, Fn> = {
	matches: fn([p('value', 'String')], (args, _, self) => {
		const re = (self as ValueOf<'RegExp'>).regexp
		re.lastIndex = 0
		return bool(re.test(s(args, 0)))
	}),
}

const NULL_METHODS: Record<string, Fn> = {
	isEmpty: fn([], () => bool(true)),
}

const METHODS: Partial<Record<TypeName, Record<string, Fn>>> = {
	Null: NULL_METHODS, String: STRING, Number: NUMBER, List: LIST, Object: OBJECT, Date: DATE, File: FILE, Link: LINK, RegExp: REGEXP,
}

/** The method `name` for a value: its type's, then its ancestors' (a Link takes String's), then any value's. */
export function findMethod(value: Value, name: string): Fn | undefined {
	for (const type of typeChain(value.type)) {
		const methods = METHODS[type]
		if (methods && Object.hasOwn(methods, name)) return methods[name]
	}
	return Object.hasOwn(ANY, name) ? ANY[name] : undefined
}

/** A global function (`if`, `date`, …); not `Object.prototype`'s names. */
export const findGlobal = (name: string): Fn | undefined => (Object.hasOwn(GLOBALS, name) ? GLOBALS[name] : undefined)
