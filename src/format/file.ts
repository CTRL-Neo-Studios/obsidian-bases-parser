import type {Base, BaseView, FilterNode, PropertyOrder} from '../query/base'
import {readYaml, writeYaml} from './yaml'

/** The file's contents, or why it can't be read (Obsidian's message, without its "Unable to parse your base file:"). */
export type ParsedBase = {base: Base; error: null} | {base: null; error: string}

class Invalid extends Error {}

type Raw = Record<string, unknown>
const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)
/** A YAML list where a map belongs reads as a map of its indexes, as in Obsidian (`[a]` is `{"0": a}`). */
const asRecord = (value: unknown): Raw | null => (Array.isArray(value) ? Object.fromEntries(value.map((v, i) => [String(i), v])) : isObject(value) ? value : null)
/** Views keep property ids without `note.` in `order`, `sort`, `groupBy` and `summaries` (not in `columnSize`). */
export const shortId = (id: string) => (id.startsWith('note.') ? id.slice(5) : id)
const DIRECTIONS = new Set(['ASC', 'DESC'])

// Bases whose `summaries` came from the file. Obsidian keeps those with the unknown keys (first, in place), while a
// `summaries` created by an edit is written after `formulas`.
const summariesFromFile = new WeakSet<Base>()

/** Carries what `stringifyBase` needs to know about `base` over to `next` (an edited copy). */
export function derive(base: Base, next: Base): Base {
	if (summariesFromFile.has(base) && next.summaries !== undefined) summariesFromFile.add(next)
	return next
}

/** Reads a `.base` file as Obsidian 1.15.1 does: the same checks, messages and clean-ups. */
export function parseBase(text: string): ParsedBase {
	let raw: unknown
	try {
		raw = readYaml(text)
	} catch (e) {
		return {base: null, error: (e as Error).message}
	}
	try {
		const top = raw === null || raw === undefined ? {} : asRecord(raw)
		if (!top) throw new Invalid('Query is an invalid format. It should be a YAML object.')
		const base: Base = {}
		for (const [key, value] of Object.entries(top)) {
			if (value === null || value === undefined) {
				if (!['filters', 'formulas', 'summaries', 'properties', 'views'].includes(key)) base[key] = value
				continue
			}
			if (key === 'filters') base.filters = filterNode(value)
			else if (key === 'formulas' || key === 'summaries') base[key] = strings(value, key)
			else if (key === 'properties') {
				const properties = properties_(value)
				if (properties) base.properties = properties
			} else if (key !== 'views') base[key] = value
		}
		base.views = views(top.views)
		if (base.summaries) summariesFromFile.add(base)
		return {base, error: null}
	} catch (e) {
		if (e instanceof Invalid) return {base: null, error: e.message}
		throw e
	}
}

function filterNode(value: unknown): FilterNode {
	if (typeof value === 'string') return value
	if (!isObject(value)) throw new Invalid('"filters" must be a string or an object')
	const keys = Object.keys(value)
	if (keys.length !== 1 || !['and', 'or', 'not'].includes(keys[0]!)) throw new Invalid('"filters" may only have one of an "and", "or", or "not" keys.')
	const conjunction = keys[0] as 'and' | 'or' | 'not'
	const children = value[conjunction]
	if (!Array.isArray(children)) throw new Invalid(`"${conjunction}" filter must be an array`)
	return {[conjunction]: children.map(filterNode)} as FilterNode
}

function strings(value: unknown, what: string): Record<string, string> {
	const record = asRecord(value)
	if (!record) throw new Invalid(`"${what}" must be a object`)
	for (const [key, text] of Object.entries(record)) {
		if (typeof text !== 'string') throw new Invalid(`Formula values must be strings. Value for property ${key} is not.`)
	}
	return record as Record<string, string>
}

function properties_(value: unknown): Base['properties'] | undefined {
	if (!isObject(value)) throw new Invalid('Invalid properties configuration.')
	const out: NonNullable<Base['properties']> = {}
	for (const [id, config] of Object.entries(value)) {
		if (!isObject(config)) throw new Invalid('Invalid properties configuration.')
		const {displayName, ...rest} = config
		// A display name that isn't text drops the property's whole config, as Obsidian does; otherwise it's written last.
		if (displayName !== undefined && typeof displayName !== 'string') continue
		out[id] = displayName === undefined ? rest : {...rest, displayName}
	}
	return Object.keys(out).length ? out : undefined
}

function views(value: unknown): BaseView[] {
	// A base without views shows (and, on its first save, writes) one table named "View".
	if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) return [{type: 'table', name: 'View'}]
	if (!Array.isArray(value)) throw new Invalid('Views must be an array')
	return value.map((raw, i) => {
		if (!isObject(raw)) throw new Invalid(`"view" items must be a YAML object, however item ${i + 1} is not`)
		const name = raw.name
		if (typeof name !== 'string') throw new Invalid(`Missing or invalid "name" in view ${i + 1}`)
		if (raw.type === undefined || raw.type === null) throw new Invalid(`"type" is required in view "${name}"`)
		if (typeof raw.type !== 'string') throw new Invalid(`"type" must be a string in view "${name}"`)
		const view: BaseView = {type: raw.type, name}
		for (const [key, v] of Object.entries(raw)) {
			if (key === 'type' || key === 'name') continue
			const set = (value: unknown) => {
				if (value !== undefined) view[key] = value
			}
			switch (key) {
				case 'filters':
					try {
						set(v === null ? undefined : filterNode(v))
					} catch (e) {
						throw new Invalid(`Unable to parse filters in view "${name}": ${(e as Error).message}`)
					}
					break
				case 'order':
					if (v === null || v === undefined) break
					if (!Array.isArray(v)) throw new Invalid(`"order" must be a array in view "${name}"`)
					if (!v.every(id => typeof id === 'string')) throw new Invalid(`"order" values must all be of type string in view "${name}"`)
					set(v.map(shortId))
					break
				// Invalid sorts, limits and group orders are dropped without a word.
				case 'sort':
					if (Array.isArray(v)) set(v.filter((s): s is PropertyOrder => isObject(s) && typeof s.property === 'string' && DIRECTIONS.has(s.direction as string)).map(s => ({property: shortId(s.property), direction: s.direction})))
					break
				case 'limit':
					if (typeof v === 'number' && v > 0) set(v)
					break
				case 'groupBy':
					if (v === null) break
					if (!isObject(v) || typeof v.property !== 'string' || typeof v.direction !== 'string') throw new Invalid(`"groupBy" must be a object in view "${name}"`)
					if (DIRECTIONS.has(v.direction)) set({property: shortId(v.property), direction: v.direction})
					break
				case 'groupOrder':
					if (Array.isArray(v)) set(v)
					break
				case 'summaries': {
					if (v === null) break
					const record = asRecord(v)
					if (!record || !Object.values(record).every(s => typeof s === 'string')) throw new Invalid(`"summaries" values must all be of type string in view "${name}"`)
					set(Object.fromEntries(Object.entries(record).map(([id, s]) => [shortId(id), s])))
					break
				}
				default:
					view[key] = v
			}
		}
		return view
	})
}

const VIEW_KEYS = ['type', 'name', 'filters', 'groupBy', 'groupOrder', 'order', 'sort', 'limit', 'summaries']

/**
 * Writes a base as Obsidian 1.15.1 does: unknown top-level keys first (and `summaries`, if the file had it), then
 * `filters`, `formulas`, a new `summaries`, `properties`, `views`; each view's known keys in a fixed order, then its
 * options and other keys as they were.
 */
export function stringifyBase(base: Base): string {
	const known = ['filters', 'formulas', 'summaries', 'properties', 'views']
	const out: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(base)) {
		if (value === undefined) continue
		if (!known.includes(key) || (key === 'summaries' && summariesFromFile.has(base))) out[key] = value
	}
	for (const key of known) {
		if (base[key] !== undefined && !(key in out)) out[key] = key === 'views' ? base.views!.map(writeView) : base[key]
	}
	return writeYaml(out)
}

function writeView(view: BaseView): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const key of VIEW_KEYS) if (view[key] !== undefined) out[key] = view[key]
	for (const [key, value] of Object.entries(view)) if (!VIEW_KEYS.includes(key) && value !== undefined) out[key] = value
	return out
}
