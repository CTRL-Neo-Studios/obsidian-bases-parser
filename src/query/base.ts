/** A filter: an expression, or an `and` / `or` / `not` (none of) group of filters. */
export type FilterNode = string | {and: FilterNode[]} | {or: FilterNode[]} | {not: FilterNode[]}

export interface PropertyOrder {
	/** A property id: `note.x` (or `x`), `file.x`, `formula.x`. */
	property: string
	direction: 'ASC' | 'DESC'
}

export interface BaseView {
	type: string
	name: string
	filters?: FilterNode
	/** Shown properties, in order. */
	order?: string[]
	sort?: PropertyOrder[]
	limit?: number
	groupBy?: PropertyOrder
	/** Shown groups, in order (`null` is the group without a value); absent shows every group, sorted. */
	groupOrder?: unknown[] | null
	/** Property id → summary name (built-in, or a key of the base's `summaries`). */
	summaries?: Record<string, string>
	/** Layout options (`cardSize`, `rowHeight`, …) and anything else. */
	[option: string]: unknown
}

/** A `.base` file's contents. */
export interface Base {
	filters?: FilterNode
	formulas?: Record<string, string>
	properties?: Record<string, Record<string, unknown>>
	/** Custom summaries: name → formula over `values`. */
	summaries?: Record<string, string>
	views?: BaseView[]
	[key: string]: unknown
}
