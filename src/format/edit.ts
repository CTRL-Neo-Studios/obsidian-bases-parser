import type {Base, BaseView, FilterNode, PropertyOrder} from '../query/base'
import {derive, shortId} from './file'

// Each edit returns a new base, written by `stringifyBase` as Obsidian 1.15.1 writes the same action. Where an edit
// says [inferred], Obsidian's result couldn't be captured (its form only commits on real input) and the rule is the
// closest observed one.

const fullId = (id: string) => (/^(note|file|formula)\./.test(id) ? id : `note.${id}`)

/** Sets (or, with `undefined`, removes) a key: an existing key keeps its place, a new one goes last. */
function put<T extends object>(object: T, key: string, value: unknown): T {
	if (value !== undefined) return {...object, [key]: value}
	const {[key]: _removed, ...rest} = object as Record<string, unknown>
	return rest as T
}

function withView(base: Base, name: string, change: (view: BaseView) => BaseView): Base {
	const views = base.views ?? []
	const i = views.findIndex(v => v.name === name)
	if (i < 0) throw new Error(`View "${name}" not found`)
	return derive(base, {...base, views: views.with(i, change(views[i]!))})
}

const withViews = (base: Base, change: (view: BaseView) => BaseView): Base => derive(base, {...base, views: (base.views ?? []).map(change)})

/** A column header click: not sorted → A→Z, A→Z → Z→A, Z→A → not sorted. The property moves to the front. */
export function toggleSort(base: Base, view: string, property: string): Base {
	const id = shortId(property)
	return withView(base, view, v => {
		const sort = [...(v.sort ?? [])]
		const i = sort.findIndex(s => s.property === id)
		const current = i < 0 ? undefined : sort.splice(i, 1)[0]!.direction
		const next = current === undefined ? 'ASC' : current === 'ASC' ? 'DESC' : undefined
		if (next) sort.unshift({property: id, direction: next})
		return put(v, 'sort', sort)
	})
}

/** The Sort menu's list. An empty list is written as `sort: []`. */
export function setSort(base: Base, view: string, sort: PropertyOrder[]): Base {
	return withView(base, view, v => put(v, 'sort', sort.map(s => ({property: shortId(s.property), direction: s.direction}))))
}

/** Groups by a property, or (null) stops grouping. Another property empties a manual group order; a direction keeps it. */
export function setGroupBy(base: Base, view: string, groupBy: PropertyOrder | null): Base {
	return withView(base, view, v => {
		if (!groupBy) return put(put(v, 'groupBy', undefined), 'groupOrder', undefined)
		const property = shortId(groupBy.property)
		const reset = v.groupBy?.property !== property && v.groupOrder != null
		return put(reset ? put(v, 'groupOrder', []) : v, 'groupBy', {property, direction: groupBy.direction})
	})
}

/** Shown groups in order (`null` is the group without a value), or null for every group, sorted. */
export function setGroupOrder(base: Base, view: string, order: unknown[] | null): Base {
	return withView(base, view, v => put(v, 'groupOrder', order ?? undefined))
}

/** At most `limit` results; null or 0 shows all. */
export function setLimit(base: Base, view: string, limit: number | null): Base {
	return withView(base, view, v => put(v, 'limit', limit && limit > 0 ? limit : undefined))
}

/** Shown properties, in order (Properties menu, Hide column, dragging headers). */
export function setOrder(base: Base, view: string, order: string[]): Base {
	return withView(base, view, v => put(v, 'order', order.map(shortId)))
}

/** A column's width in pixels, or null to reset it. Keys are full ids (`note.x`). [inferred: the last reset removes `columnSize`] */
export function setColumnSize(base: Base, view: string, property: string, width: number | null): Base {
	return withView(base, view, v => {
		const sizes = put((v.columnSize ?? {}) as Record<string, number>, fullId(property), width ?? undefined)
		return put(v, 'columnSize', Object.keys(sizes).length ? sizes : undefined)
	})
}

/** A property's summary (`Sum`, a custom name), or null to remove it. Removing the last leaves `summaries: {}`. */
export function setSummary(base: Base, view: string, property: string, summary: string | null): Base {
	return withView(base, view, v => put(v, 'summaries', put(v.summaries ?? {}, shortId(property), summary ?? undefined)))
}

/** A layout option (`cardSize`, `rowHeight`, `image`…), or null to remove it. */
export function setViewOption(base: Base, view: string, key: string, value: unknown): Base {
	return withView(base, view, v => put(v, key, value ?? undefined))
}

/** The base's filters (`view` null) or a view's; null removes them. */
export function setFilters(base: Base, view: string | null, filters: FilterNode | null): Base {
	if (view === null) return derive(base, put(base, 'filters', filters ?? undefined))
	return withView(base, view, v => put(v, 'filters', filters ?? undefined))
}

/** Adds or changes a formula. */
export function setFormula(base: Base, name: string, formula: string): Base {
	return derive(base, {...base, formulas: {...base.formulas, [name]: formula}})
}

/** Removes a formula and every use of its column: order, sort, grouping, summaries, display name (not column widths). */
export function deleteFormula(base: Base, name: string): Base {
	return renameFormulaIn(base, name, null)
}

/** Renames a formula and its column everywhere `deleteFormula` would remove it. [inferred: placed last, like a renamed summary] */
export function renameFormula(base: Base, name: string, newName: string): Base {
	return renameFormulaIn(base, name, newName)
}

function renameFormulaIn(base: Base, name: string, newName: string | null): Base {
	const id = `formula.${name}`
	const next = newName === null ? null : `formula.${newName}`
	const {[name]: formula, ...formulas} = base.formulas ?? {}
	let out = put(base, 'formulas', next ? {...formulas, [newName!]: formula!} : formulas)
	if (out.properties?.[id]) {
		const {[id]: config, ...properties} = out.properties
		const renamed = next ? {...properties, [next]: config!} : properties
		out = put(out, 'properties', Object.keys(renamed).length ? renamed : undefined)
	}
	out = derive(base, out)
	return withViews(out, v => {
		let view = v
		if (view.order) view = put(view, 'order', next ? view.order.map(p => (p === id ? next : p)) : view.order.filter(p => p !== id))
		if (view.sort) view = put(view, 'sort', next ? view.sort.map(s => (s.property === id ? {...s, property: next} : s)) : view.sort.filter(s => s.property !== id))
		if (view.groupBy?.property === id) view = next ? put(view, 'groupBy', {...view.groupBy, property: next}) : put(put(view, 'groupBy', undefined), 'groupOrder', undefined)
		if (view.summaries && id in view.summaries) {
			const {[id]: summary, ...rest} = view.summaries
			view = put(view, 'summaries', next ? {...rest, [next]: summary!} : rest)
		}
		return view
	})
}

/** Adds or changes a custom summary. A base's first one is written after `formulas`. */
export function setSummaryFormula(base: Base, name: string, formula: string): Base {
	return derive(base, {...base, summaries: {...base.summaries, [name]: formula}})
}

/** Renames a custom summary (it moves last) and the views using it. */
export function renameSummaryFormula(base: Base, name: string, newName: string): Base {
	const {[name]: formula, ...rest} = base.summaries ?? {}
	const out = derive(base, {...base, summaries: {...rest, [newName]: formula!}})
	return withViews(out, v => (v.summaries ? put(v, 'summaries', Object.fromEntries(Object.entries(v.summaries).map(([p, s]) => [p, s === name ? newName : s]))) : v))
}

/** Removes a custom summary and its uses; emptied lists stay as `{}`. */
export function deleteSummaryFormula(base: Base, name: string): Base {
	const {[name]: _removed, ...rest} = base.summaries ?? {}
	const out = derive(base, {...base, summaries: rest})
	return withViews(out, v => (v.summaries ? put(v, 'summaries', Object.fromEntries(Object.entries(v.summaries).filter(([, s]) => s !== name))) : v))
}

/** A property's display name, or null to use its own. Written last in its config. [inferred: an emptied config is removed] */
export function setDisplayName(base: Base, property: string, displayName: string | null): Base {
	const {displayName: _old, ...config} = base.properties?.[property] ?? {}
	const next = displayName === null ? config : {...config, displayName}
	const properties = put(base.properties ?? {}, property, Object.keys(next).length ? next : undefined)
	return derive(base, put(base, 'properties', Object.keys(properties).length ? properties : undefined))
}

/** `name`, or `name 2`, `name 3`… if taken ("View 2", "T 2", as Obsidian names them). */
export function uniqueViewName(base: Base, name: string): string {
	const taken = new Set((base.views ?? []).map(v => v.name))
	if (!taken.has(name)) return name
	let n = 2
	while (taken.has(`${name} ${n}`)) n++
	return `${name} ${n}`
}

/** Why a view can't take this name (Obsidian's messages), or null. `current` is the view being renamed. */
export function viewNameError(base: Base, name: string, current?: string): string | null {
	if (!name.trim()) return 'View name cannot be empty.'
	if (name !== current && (base.views ?? []).some(v => v.name === name)) return 'View name already exists.'
	return null
}

/** A new view of a layout, named "View" (or "View 2"…). [inferred: added last] */
export function addView(base: Base, type: string): Base {
	return derive(base, {...base, views: [...(base.views ?? []), {type, name: uniqueViewName(base, 'View')}]})
}

/** A copy of a view, named "T 2" (or "T 3"…). [inferred: placed right after the original] */
export function duplicateView(base: Base, name: string): Base {
	const views = base.views ?? []
	const i = views.findIndex(v => v.name === name)
	if (i < 0) throw new Error(`View "${name}" not found`)
	const copy = {...structuredClone(views[i]!), name: uniqueViewName(base, name)}
	return derive(base, {...base, views: views.toSpliced(i + 1, 0, copy)})
}

export function deleteView(base: Base, name: string): Base {
	return derive(base, {...base, views: (base.views ?? []).filter(v => v.name !== name)})
}

export function renameView(base: Base, name: string, newName: string): Base {
	return withView(base, name, v => ({...v, name: newName}))
}

/** "Default view": the view moves first, where a base opens. */
export function setDefaultView(base: Base, name: string): Base {
	const views = base.views ?? []
	const view = views.find(v => v.name === name)
	if (!view) throw new Error(`View "${name}" not found`)
	return derive(base, {...base, views: [view, ...views.filter(v => v !== view)]})
}

/** Moves a view to `index` (dragging in the Views menu). */
export function moveView(base: Base, name: string, index: number): Base {
	const views = (base.views ?? []).filter(v => v.name !== name)
	const view = base.views?.find(v => v.name === name)
	if (!view) throw new Error(`View "${name}" not found`)
	return derive(base, {...base, views: views.toSpliced(index, 0, view)})
}
