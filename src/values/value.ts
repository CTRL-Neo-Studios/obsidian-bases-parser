import {dateToDisplay, dateToString, durationMs, humanize, parseDate, parseDuration, type Duration} from './time'

/**
 * A value as formulas see it. `type` is Obsidian's own type name (what `isType` and its error messages use).
 * Strings flagged `tag` came from tags (`#probe`, matched without `#` or case by `contains`); `icon` from `icon()`.
 */
export type Value =
	| {type: 'Null'}
	| {type: 'Boolean'; value: boolean}
	| {type: 'Number'; value: number}
	| {type: 'String'; value: string; tag?: true; icon?: true}
	| {type: 'URL'; value: string}
	| {type: 'HTML'; value: string}
	/** `src` is a path or URL; `value` the Markdown it prints as (`![[a.png]]`, `![](https://…)`). */
	| {type: 'Image'; value: string; src: string}
	/** `path` is the link text (`M`, `M#Head`); `from` the file it's resolved from. */
	| {type: 'Link'; path: string; display: string | null; from: string}
	/** `relative` is the text of `date.relative()`, which stays a Date in Obsidian. */
	| {type: 'Date'; ms: number; time: boolean; relative?: string}
	| ({type: 'Duration'} & Duration)
	| {type: 'List'; items: Value[]}
	| {type: 'Object'; entries: Map<string, Value>}
	| {type: 'File'; path: string}
	/** `this`: the base file (or the note embedding it), with `this.file` and `this.formula`. */
	| {type: 'ThisFile'; path: string}
	| {type: 'Formulas'; names: string[]}
	| {type: 'RegExp'; regexp: RegExp}
	| {type: 'Error'; message: string}

export type TypeName = Value['type']
export type ValueOf<T extends TypeName> = Extract<Value, {type: T}>

export const NULL: Value = {type: 'Null'}
export const bool = (value: boolean): Value => ({type: 'Boolean', value})
export const num = (value: number): Value => ({type: 'Number', value})
export const str = (value: string): Value => ({type: 'String', value})
export const list = (items: Value[]): Value => ({type: 'List', items})
export const error = (message: string): ValueOf<'Error'> => ({type: 'Error', message})
export const date = (ms: number, time: boolean): Value => ({type: 'Date', ms, time})

// What each type also counts as, for `isType` and for which functions apply (a Link takes String's functions).
const PARENTS: Partial<Record<TypeName, TypeName>> = {URL: 'String', HTML: 'String', Image: 'String', Link: 'String', ThisFile: 'File'}

/** The type and its ancestors, most specific first (`Link`, `String`). */
export function typeChain(type: TypeName): TypeName[] {
	const chain: TypeName[] = [type]
	for (let t = PARENTS[type]; t; t = PARENTS[t]) chain.push(t)
	return chain
}

export const isA = (value: Value, type: TypeName) => typeChain(value.type).includes(type)

/** The text a String-like value stands for in string functions: a link's text, a URL, the HTML, the image Markdown. */
export function stringValue(value: Value): string | null {
	switch (value.type) {
		case 'String':
		case 'URL':
		case 'HTML':
		case 'Image':
			return value.value
		case 'Link':
			return value.path
		default:
			return null
	}
}

export function toText(value: Value): string {
	switch (value.type) {
		case 'Null': return 'null'
		case 'Boolean':
		case 'Number': return String(value.value)
		case 'String':
		case 'URL':
		case 'HTML':
		case 'Image': return value.value
		case 'Link': return value.display === null ? `[[${value.path}]]` : `[[${value.path}|${value.display}]]`
		case 'Date': return value.relative ?? dateToString(value.ms, value.time)
		case 'Duration': return humanize(value.anchor, value.anchor + durationMs(value))
		case 'List': return value.items.map(toText).join(', ')
		case 'Object': return JSON.stringify(Object.fromEntries([...value.entries].map(([k, v]) => [k, toText(v)])))
		case 'File':
		case 'ThisFile': return value.path
		case 'Formulas': return `Formulas${JSON.stringify(value.names)}`
		case 'RegExp': return String(value.regexp)
		case 'Error': return `Error: ${value.message}`
	}
}

/** What a cell shows for a scalar: dates as `11/20/2026 10:30 AM`, infinity as `∞`. Other values show their text. */
export function toDisplay(value: Value): string {
	if (value.type === 'Date' && !value.relative) return dateToDisplay(value.ms, value.time)
	if (value.type === 'Number' && Math.abs(value.value) === Infinity) return value.value > 0 ? '∞' : '-∞'
	return toText(value)
}

export function isTruthy(value: Value): boolean {
	switch (value.type) {
		case 'Null':
		case 'Error': return false
		case 'Boolean': return value.value
		case 'Number': return !!value.value
		case 'String':
		case 'URL':
		case 'HTML':
		case 'Image': return value.value !== ''
		case 'List': return value.items.length > 0
		case 'Object': return value.entries.size > 0
		case 'Duration': return durationMs(value) !== 0
		default: return true
	}
}

/** Resolves a link's text (no `#subpath`) from a file to a path, or null. */
export type Resolve = (link: string, from: string) => string | null

const linkTarget = (link: ValueOf<'Link'>, resolve: Resolve) => {
	const text = link.path.split('#')[0]!
	return resolve(text, link.from) ?? text
}

/** `[[M|alias]]` or `[[M]]` as a Link; null for any other text. */
export function parseWikiLink(text: string, from: string): ValueOf<'Link'> | null {
	const m = /^\[\[([^\]]*)\]\]$/.exec(text)
	if (!m) return null
	const bar = m[1]!.indexOf('|')
	return bar < 0
		? {type: 'Link', path: m[1]!, display: null, from}
		: {type: 'Link', path: m[1]!.slice(0, bar), display: m[1]!.slice(bar + 1), from}
}

/** Obsidian's `==`: JavaScript's loose equality for plain values, dates by day when either has no time, links by target. */
export function looseEquals(a: Value, b: Value, resolve: Resolve, now: number): boolean {
	if (a.type === 'Null' || b.type === 'Null') return a.type === b.type
	if (a.type === 'List' && b.type === 'List') {
		return a.items.length === b.items.length && a.items.every((item, i) => looseEquals(item, b.items[i]!, resolve, now))
	}
	// A one-item list equals its item.
	if (a.type === 'List') return a.items.length === 1 && looseEquals(a.items[0]!, b, resolve, now)
	if (b.type === 'List') return b.items.length === 1 && looseEquals(a, b.items[0]!, resolve, now)
	if (a.type === 'Date' || b.type === 'Date') {
		const x = asDate(a)
		const y = asDate(b)
		if (!x || !y) return false
		if (x.time && y.time) return x.ms === y.ms
		return new Date(x.ms).toDateString() === new Date(y.ms).toDateString()
	}
	if (a.type === 'Duration' || b.type === 'Duration') {
		const x = asDurationMs(a, now)
		const y = asDurationMs(b, now)
		return x !== null && x === y
	}
	if (a.type === 'Link' || b.type === 'Link') {
		const [link, other] = (a.type === 'Link' ? [a, b] : [b, a]) as [ValueOf<'Link'>, Value]
		if (other.type === 'File' || other.type === 'ThisFile') return a.type === 'Link' && linkTarget(link, resolve) === other.path
		if (other.type === 'Link') return linkTarget(link, resolve) === linkTarget(other, resolve)
		const text = stringValue(other)
		if (text === null) return false
		const asLink = parseWikiLink(text, link.from) ?? {type: 'Link', path: text, display: null, from: link.from}
		return linkTarget(link, resolve) === linkTarget(asLink, resolve)
	}
	if (a.type === 'File' || a.type === 'ThisFile') return (b.type === 'File' || b.type === 'ThisFile' || b.type === 'String') && a.path === (b.type === 'String' ? b.value : b.path)
	if (b.type === 'File' || b.type === 'ThisFile') return b.path === stringValue(a)
	if (a.type === 'Object' && b.type === 'Object') {
		return a.entries.size === b.entries.size && [...a.entries].every(([k, v]) => b.entries.has(k) && looseEquals(v, b.entries.get(k)!, resolve, now))
	}
	if (a.type === 'RegExp' && b.type === 'RegExp') return String(a.regexp) === String(b.regexp)
	const x = primitive(a)
	const y = primitive(b)
	// Obsidian compares plain values loosely: `1 == "1"`, `1 == true`.
	return x !== undefined && y !== undefined && x == y
}

/** `<`, `>`…: numbers, strings and booleans as JavaScript compares them; dates and durations by time. NaN when neither is less. */
export function compare(a: Value, b: Value, now: number): number {
	if (a.type === 'Date' || b.type === 'Date') {
		const x = asDate(a)
		const y = asDate(b)
		return x && y ? x.ms - y.ms : NaN
	}
	if (a.type === 'Duration' || b.type === 'Duration') {
		const x = asDurationMs(a, now)
		const y = asDurationMs(b, now)
		return x !== null && y !== null ? x - y : NaN
	}
	const x = primitive(a) ?? toText(a)
	const y = primitive(b) ?? toText(b)
	// Same results as JavaScript's relational operators, NaN for "neither".
	return x < y ? -1 : x > y ? 1 : x === y || (x <= y && x >= y) ? 0 : NaN
}

function primitive(value: Value): string | number | boolean | undefined {
	if (value.type === 'Boolean' || value.type === 'Number') return value.value
	return stringValue(value) ?? undefined
}

function asDate(value: Value): {ms: number; time: boolean} | null {
	if (value.type === 'Date') return value
	const text = stringValue(value)
	return text === null ? null : parseDate(text)
}

function asDurationMs(value: Value, now: number): number | null {
	if (value.type === 'Duration') return durationMs(value)
	const text = stringValue(value)
	const duration = text === null ? null : parseDuration(text, now)
	return duration && durationMs(duration)
}
