import {RowScope, type BaseHost, type EvaluationContext} from '../expr/evaluate'
import {durationMs} from '../values/time'
import {collate, isTruthy, list, looseEquals, NULL, num, toText, type Value, type ValueOf} from '../values/value'
import type {Base, FilterNode, PropertyOrder} from './base'

export interface QueryOptions {
	host: BaseHost
	/** Every file the base can see. */
	paths: readonly string[]
	/** The clock, in ms. */
	now: number
	/** `this`: the base file, or the note embedding it. */
	thisPath: string
	/** The toolbar's search text. */
	search?: string
}

export interface QueryGroup {
	/** The group's value (its first row's); null without `groupBy`, or for the group of rows without a value. */
	key: Value | null
	rows: RowScope[]
	/** The view's summaries over this group, by property id. */
	summaries: Map<string, Value>
}

export interface QueryResult {
	/** Shown rows: filtered, searched, sorted, limited, and in shown groups. */
	rows: RowScope[]
	groups: QueryGroup[]
	/** The view's summaries over every shown row, by property id. */
	summaries: Map<string, Value>
	/** Rows before the limit ("Showing 2 of 9"). */
	total: number
	/** Rows a filter errored on (left out, as Obsidian leaves them out without a word). */
	errors: {path: string; message: string}[]
}

/** Runs one view of a base: filters, search, sort, limit, groups and summaries, as Obsidian 1.15.1 does. */
export function runQuery(base: Base, viewName: string, options: QueryOptions): QueryResult {
	const view = base.views?.find(v => v.name === viewName)
	if (!view) throw new Error(`View "${viewName}" not found`)
	const context: EvaluationContext = {host: options.host, now: options.now, thisPath: options.thisPath, formulas: base.formulas ?? {}}
	const errors: QueryResult['errors'] = []

	let rows = options.paths.map(path => new RowScope(context, path)).filter(row => {
		for (const filter of [base.filters, view.filters]) {
			if (filter === undefined) continue
			const passed = passes(filter, row)
			if (typeof passed === 'string') errors.push({path: row.path, message: passed})
			if (passed !== true) return false
		}
		return true
	})
	if (options.search?.trim()) rows = rows.filter(matcher(options.search, view.order?.length ? view.order : ['file.name']))

	// Rows start in file-name order; sorts are stable on top of it.
	const names = new Map(rows.map(row => [row, toText(row.property('file.name'))]))
	rows.sort((a, b) => collate(names.get(a)!, names.get(b)!) || collate(a.path, b.path))
	for (const key of [...(view.sort ?? [])].reverse()) {
		const values = new Map(rows.map(row => [row, row.property(key.property)]))
		rows.sort((a, b) => compareForSort(values.get(a)!, values.get(b)!, key.direction === 'DESC'))
	}
	const total = rows.length
	if (typeof view.limit === 'number' && view.limit > 0) rows = rows.slice(0, view.limit)

	const groups = view.groupBy ? groupRows(rows, view.groupBy, view.groupOrder) : [{key: null, rows}]
	if (view.groupBy) {
		const shown = new Set(groups.flatMap(g => g.rows))
		rows = rows.filter(row => shown.has(row))
	}
	const summarizeAll = (subset: RowScope[]) => new Map(Object.entries(view.summaries ?? {}).map(([property, summary]) => [property, summarize(base, context, subset, property, summary)]))
	return {
		rows,
		groups: groups.map(g => ({...g, summaries: summarizeAll(g.rows)})),
		summaries: summarizeAll(rows),
		total,
		errors,
	}
}

/** True, false, or the error message (the row is left out). */
function passes(filter: FilterNode, row: RowScope): boolean | string {
	if (typeof filter === 'string') {
		const value = row.evaluate(filter)
		return value.type === 'Error' ? value.message : isTruthy(value)
	}
	const [kind, children] = Object.entries(filter)[0] as ['and' | 'or' | 'not', FilterNode[]]
	for (const child of children) {
		const passed = passes(child, row)
		if (typeof passed === 'string') return passed
		if (kind === 'and' && !passed) return false
		if (kind === 'or' && passed) return true
		if (kind === 'not' && passed) return false
	}
	return kind !== 'or'
}

/**
 * The search: words and single punctuation marks (`-1` is `-` and `1`), each found, ignoring case, in one of the
 * shown values' text. So `x, y` finds a list `x, y`, and `-1` finds any row with a `-` and a `1` somewhere.
 */
function matcher(search: string, properties: string[]) {
	const tokens = search.toLowerCase().match(/[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? []
	return (row: RowScope) => {
		const texts = properties.map(p => toText(row.property(p)).toLowerCase())
		return tokens.every(token => texts.some(text => text.includes(token)))
	}
}

/** Numbers, dates and durations by size; anything else by text, numeric-aware and ignoring case and accents. */
function orderValues(a: Value, b: Value): number {
	if (a.type === 'Number' && b.type === 'Number') return a.value - b.value
	if (a.type === 'Date' && b.type === 'Date') return a.ms - b.ms
	if (a.type === 'Duration' && b.type === 'Duration') return durationMs(a) - durationMs(b)
	return collate(toText(a), toText(b))
}

/**
 * A sort key: empty values last in either direction, except that a checkbox sorts by whether it's checked, so an
 * unchecked box and no value tie (Obsidian's order).
 */
function compareForSort(a: Value, b: Value, descending: boolean): number {
	const sign = descending ? -1 : 1
	if (a.type === 'Boolean' || b.type === 'Boolean') return sign * (Number(isTruthy(a)) - Number(isTruthy(b)))
	if (a.type === 'Null' || b.type === 'Null') return a.type === b.type ? 0 : a.type === 'Null' ? 1 : -1
	return sign * orderValues(a, b)
}

/**
 * Groups by the value's text (a list `[x]` and a text `x` share a group), sorted by value with the empty group last.
 * `groupOrder` instead lists the shown groups, in order; a listed group without rows is shown empty.
 */
function groupRows(rows: RowScope[], groupBy: PropertyOrder, groupOrder: unknown[] | null | undefined): Omit<QueryGroup, 'summaries'>[] {
	const groups = new Map<string | null, {key: Value | null; rows: RowScope[]}>()
	for (const row of rows) {
		const value = row.property(groupBy.property)
		const id = value.type === 'Null' ? null : toText(value)
		const group = groups.get(id) ?? {key: value.type === 'Null' ? null : value, rows: []}
		group.rows.push(row)
		groups.set(id, group)
	}
	if (groupOrder) {
		return groupOrder.map(entry => {
			const id = entry === null || entry === undefined ? null : String(entry)
			return groups.get(id) ?? {key: id === null ? null : {type: 'String', value: id}, rows: []}
		})
	}
	const sign = groupBy.direction === 'DESC' ? -1 : 1
	return [...groups.values()].sort((a, b) => {
		if (!a.key || !b.key) return a.key === b.key ? 0 : a.key ? -1 : 1
		return sign * orderValues(a.key, b.key)
	})
}

const round2 = (x: number) => Math.round(x * 100) / 100

/**
 * A summary of a property over rows: a built-in (`Sum`, `Average`, …, `Unique`) or a custom one from the base's
 * `summaries`, a formula over `values`. Unknown names are null.
 */
export function summarize(base: Base, context: EvaluationContext, rows: RowScope[], property: string, summary: string): Value {
	const values = rows.map(row => row.property(property))
	const numbers = values.filter((v): v is ValueOf<'Number'> => v.type === 'Number').map(v => v.value)
	// Date and checkbox summaries need a column of only dates (or only checkboxes); number summaries take the numbers.
	const filled = values.filter(v => v.type !== 'Null')
	const only = <T extends Value['type']>(type: T) => (filled.every(v => v.type === type) ? (filled as ValueOf<T>[]) : [])
	const dates = only('Date').map(v => v.ms)
	const booleans = only('Boolean').map(v => v.value)
	const ifNumbers = (f: () => number) => (numbers.length ? num(f()) : NULL)
	const ifRows = (f: () => number) => (rows.length ? num(f()) : NULL)
	const sum = () => numbers.reduce((a, b) => a + b, 0)
	switch (summary) {
		// Over every row, empty or not (Obsidian's), to two decimals.
		case 'Average': return ifNumbers(() => round2(sum() / values.length))
		case 'Sum': return ifNumbers(sum)
		case 'Min': return ifNumbers(() => Math.min(...numbers))
		case 'Max': return ifNumbers(() => Math.max(...numbers))
		case 'Median': return ifNumbers(() => {
			const sorted = [...numbers].sort((a, b) => a - b)
			const mid = sorted.length >> 1
			return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
		})
		case 'Stddev': return ifNumbers(() => {
			const mean = sum() / numbers.length
			return round2(Math.sqrt(numbers.reduce((a, x) => a + (x - mean) ** 2, 0) / numbers.length))
		})
		case 'Range':
			if (numbers.length) return num(Math.max(...numbers) - Math.min(...numbers))
			return dates.length ? {type: 'Duration', months: 0, days: 0, ms: Math.max(...dates) - Math.min(...dates), anchor: context.now} : NULL
		case 'Earliest': return dates.length ? {type: 'Date', ms: Math.min(...dates), time: true} : NULL
		case 'Latest': return dates.length ? {type: 'Date', ms: Math.max(...dates), time: true} : NULL
		case 'Checked': return booleans.length ? num(booleans.filter(Boolean).length) : NULL
		case 'Unchecked': return booleans.length ? num(booleans.filter(b => !b).length) : NULL
		case 'Empty': return ifRows(() => values.filter(v => v.type === 'Null').length)
		case 'Filled': return ifRows(() => filled.length)
		case 'Unique': return ifRows(() => {
			const distinct: Value[] = []
			for (const v of values) {
				if (!distinct.some(d => d.type === v.type && looseEquals(d, v, (link, from) => context.host.resolve(link, from), context.now))) distinct.push(v)
			}
			return distinct.length
		})
	}
	const formula = base.summaries?.[summary]
	if (formula === undefined) return NULL
	return new RowScope(context, context.thisPath).evaluate(formula, {values: list(values)})
}
