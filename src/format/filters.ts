import type {Expr} from '../expr/ast'
import {ExpressionSyntaxError, parseExpression} from '../expr/parse'
import type {FilterNode} from '../query/base'

/**
 * The filter builder's model (Obsidian's Filter menu): groups of rules (property, operator, values). What a rule can
 * be depends on its property's kind. Expressions the builder can't show as a rule stay as expression rows.
 */
export type PropertyKind = 'text' | 'number' | 'checkbox' | 'date' | 'list' | 'file'

export type FilterOperator =
	| 'equals' | 'notEquals' | 'lessThan' | 'lessOrEqual' | 'greaterThan' | 'greaterOrEqual'
	| 'startsWith' | 'endsWith' | 'contains' | 'containsAny' | 'containsAll' | 'isEmpty'
	| 'notStartsWith' | 'notEndsWith' | 'notContains' | 'notContainsAny' | 'notContainsAll' | 'isNotEmpty'
	| 'linksTo' | 'inFolder' | 'hasTag' | 'hasProperty' | 'notLinksTo' | 'notInFolder' | 'notHasTag' | 'notHasProperty'

/**
 * Each kind's operators in Obsidian's menu order. Labels differ by kind (`equals` is "is" for text, "=" for numbers,
 * "on" for dates, "is exactly" for lists); the UI names them.
 */
export const OPERATORS: Record<PropertyKind, readonly FilterOperator[]> = {
	text: ['equals', 'notEquals', 'startsWith', 'endsWith', 'isEmpty', 'contains', 'containsAny', 'containsAll', 'notStartsWith', 'notEndsWith', 'isNotEmpty', 'notContains', 'notContainsAny', 'notContainsAll'],
	number: ['equals', 'notEquals', 'lessThan', 'lessOrEqual', 'greaterThan', 'greaterOrEqual', 'isEmpty', 'isNotEmpty'],
	checkbox: ['equals', 'notEquals'],
	date: ['equals', 'notEquals', 'lessThan', 'lessOrEqual', 'greaterThan', 'greaterOrEqual', 'isEmpty', 'isNotEmpty'],
	list: ['equals', 'notEquals', 'isEmpty', 'contains', 'containsAny', 'containsAll', 'isNotEmpty', 'notContains', 'notContainsAny', 'notContainsAll'],
	file: ['linksTo', 'inFolder', 'hasTag', 'hasProperty', 'notLinksTo', 'notInFolder', 'notHasTag', 'notHasProperty'],
}

/** Operators taking no value, and those taking several (the rest take one). */
export const NO_VALUE: ReadonlySet<FilterOperator> = new Set(['isEmpty', 'isNotEmpty'])
export const MANY_VALUES: ReadonlySet<FilterOperator> = new Set(['containsAny', 'containsAll', 'notContainsAny', 'notContainsAll', 'hasTag', 'notHasTag'])

/** A text, number, checkbox or date value, or a link (`link("N")`). */
export type FilterValue = string | number | boolean | {link: string}

export interface FilterRule {
	/** A property id: `x` (a note property), `file.x`, `formula.x`; `file` for the file itself (`file` kind). */
	property: string
	operator: FilterOperator
	values: FilterValue[]
	/** The expression the rule was read from; written back as is until the rule changes (Obsidian keeps it too). */
	text?: string
}
export interface FilterExpression {
	expression: string
}
export interface FilterGroup {
	conjunction: 'and' | 'or' | 'not'
	items: (FilterRule | FilterExpression | FilterGroup)[]
}

/** File properties have fixed kinds; note properties and formulas get theirs from `kindOf`. */
export function propertyKind(property: string, kindOf: (property: string) => PropertyKind): PropertyKind {
	if (property === 'file' || property === 'file.file') return 'file'
	if (!property.startsWith('file.')) return kindOf(property)
	const field = property.slice(5)
	if (field === 'size') return 'number'
	if (field === 'ctime' || field === 'mtime') return 'date'
	if (['tags', 'links', 'embeds', 'backlinks'].includes(field)) return 'list'
	return 'text'
}

/** The builder's view of a base's or a view's filters; a plain expression is a group of one. */
export function toFilterGroup(filters: FilterNode | undefined, kindOf: (property: string) => PropertyKind): FilterGroup {
	if (filters === undefined) return {conjunction: 'and', items: []}
	if (typeof filters === 'string') return {conjunction: 'and', items: [toItem(filters, kindOf)]}
	const [conjunction, children] = Object.entries(filters)[0] as [FilterGroup['conjunction'], FilterNode[]]
	return {conjunction, items: children.map(child => (typeof child === 'string' ? toItem(child, kindOf) : toFilterGroup(child, kindOf)))}
}

/** Writes the builder's groups back. Unchanged rules keep their text. */
export function fromFilterGroup(group: FilterGroup): FilterNode {
	return {
		[group.conjunction]: group.items.map(item =>
			'conjunction' in item ? fromFilterGroup(item) : 'expression' in item ? item.expression : (item.text ?? ruleExpression(item))),
	} as FilterNode
}

const literal = (value: FilterValue): string =>
	typeof value === 'object' ? `link(${JSON.stringify(value.link)})` : typeof value === 'string' ? JSON.stringify(value) : String(value)

const RESERVED = new Set(['file', 'note', 'formula', 'this', 'value', 'index', 'acc', 'key', 'values', 'true', 'false', 'null'])
const NAME = /^[^\s!-#%-/:-@[-^`{-~\d][^\s!-#%-/:-@[-^`{-~]*$/

/** How a property is written: `status`, `note["my prop"]`, `file.name`, `formula.f`, `formula["Time of Existence"]`. */
function propertyText(property: string): string {
	const [space, name] = property.startsWith('formula.') ? ['formula', property.slice(8)] : property.startsWith('file.') || property === 'file' ? ['', property] : ['note', property]
	if (space === '') return property
	if (NAME.test(name) && (space === 'formula' || !RESERVED.has(name))) return space === 'formula' ? `formula.${name}` : name
	return `${space}[${JSON.stringify(name)}]`
}

const COMPARE: Partial<Record<FilterOperator, string>> = {equals: '==', notEquals: '!=', lessThan: '<', lessOrEqual: '<=', greaterThan: '>', greaterOrEqual: '>='}
const METHOD: Partial<Record<FilterOperator, [method: string, negated: boolean]>> = {
	startsWith: ['startsWith', false], endsWith: ['endsWith', false], contains: ['contains', false], containsAny: ['containsAny', false], containsAll: ['containsAll', false], isEmpty: ['isEmpty', false],
	notStartsWith: ['startsWith', true], notEndsWith: ['endsWith', true], notContains: ['contains', true], notContainsAny: ['containsAny', true], notContainsAll: ['containsAll', true], isNotEmpty: ['isEmpty', true],
	linksTo: ['hasLink', false], inFolder: ['inFolder', false], hasTag: ['hasTag', false], hasProperty: ['hasProperty', false],
	notLinksTo: ['hasLink', true], notInFolder: ['inFolder', true], notHasTag: ['hasTag', true], notHasProperty: ['hasProperty', true],
}

/**
 * A rule as Obsidian's builder writes it: `s == "todo"`, `!s.startsWith("to")`, `n >= 3`, `d < "2026-01-01"`,
 * `l.containsAny("x", "y")`, `l == ["x", "y"]` (one value: `l == "x"`), `file.hasTag("a", "b")`, `rel == link("N")`.
 */
export function ruleExpression(rule: FilterRule): string {
	const subject = propertyText(rule.property)
	const compare = COMPARE[rule.operator]
	if (compare) {
		const value = rule.values.length > 1 ? `[${rule.values.map(literal).join(', ')}]` : literal(rule.values[0] ?? '')
		return `${subject} ${compare} ${value}`
	}
	const [method, negated] = METHOD[rule.operator]!
	const args = NO_VALUE.has(rule.operator) ? [] : MANY_VALUES.has(rule.operator) ? rule.values : rule.values.slice(0, 1)
	return `${negated ? '!' : ''}${subject}.${method}(${args.map(literal).join(', ')})`
}

/** A rule if the builder can show this expression as one, as Obsidian's can; else the expression as it is. */
function toItem(text: string, kindOf: (property: string) => PropertyKind): FilterRule | FilterExpression {
	let expr: Expr
	try {
		expr = parseExpression(text)
	} catch (e) {
		if (e instanceof ExpressionSyntaxError) return {expression: text}
		throw e
	}
	const rule = readRule(expr, kindOf)
	return rule ? {...rule, text} : {expression: text}
}

function readRule(expr: Expr, kindOf: (property: string) => PropertyKind): Omit<FilterRule, 'text'> | null {
	const negated = expr.type === 'not'
	const body = negated ? expr.expr : expr
	if (body.type === 'comparison' && !negated) {
		const operator = (Object.entries(COMPARE).find(([, op]) => op === body.operator)?.[0]) as FilterOperator | undefined
		const property = propertyOf(body.left)
		if (!operator || !property || property === 'file') return null
		const kind = propertyKind(property, kindOf)
		const values = body.right.type === 'array' && kind === 'list' && (operator === 'equals' || operator === 'notEquals') ? body.right.elements.map(literalOf) : [literalOf(body.right)]
		return accept(property, operator, values, kind)
	}
	if (body.type !== 'function' || !body.subject) return null
	const property = body.subject.type === 'ident' && body.subject.id === 'file' ? 'file' : propertyOf(body.subject)
	if (!property) return null
	const operator = (Object.entries(METHOD).find(([, [method, neg]]) => method === body.name && neg === negated)?.[0]) as FilterOperator | undefined
	if (!operator) return null
	const values = body.args.map(literalOf)
	if (NO_VALUE.has(operator) ? values.length !== 0 : MANY_VALUES.has(operator) ? values.length === 0 : values.length !== 1) return null
	return accept(property, operator, values, propertyKind(property, kindOf))
}

/** A rule if its kind has the operator and the values fit the kind. */
function accept(property: string, operator: FilterOperator, values: (FilterValue | undefined)[], kind: PropertyKind): Omit<FilterRule, 'text'> | null {
	if (!OPERATORS[kind].includes(operator) || values.some(v => v === undefined)) return null
	const fitted: FilterValue[] = []
	for (const value of values as FilterValue[]) {
		if (kind === 'checkbox') {
			if (typeof value !== 'boolean') return null
			fitted.push(value)
		} else if (kind === 'number') {
			// A number, or text holding one; other text shows (and stays) empty, as in Obsidian.
			const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
			if (typeof value === 'object' || typeof value === 'boolean') return null
			if (Number.isFinite(n) && value !== '') fitted.push(n)
		} else if (kind === 'date') {
			if (typeof value !== 'string') return null
			fitted.push(value)
		} else {
			// Text and lists: a `[[link]]` in text is a link; numbers and booleans read as their text.
			const link = typeof value === 'string' && /^\[\[([^\]|]*)(?:\|[^\]]*)?\]\]$/.exec(value)
			fitted.push(link ? {link: link[1]!} : typeof value === 'object' ? value : String(value))
		}
	}
	return {property, operator, values: fitted}
}

/** `s`, `note.s`, `note["s"]` → `s`; `file.name`; `formula.f`, `formula["f g"]` → `formula.f g`. Anything else isn't a property. */
function propertyOf(expr: Expr): string | null {
	if (expr.type === 'ident') return RESERVED.has(expr.id) ? null : expr.id
	const object = expr.type === 'object_access' ? expr.object : expr.type === 'array_access' ? expr.array : null
	if (!object || object.type !== 'ident') return null
	const key = expr.type === 'object_access' ? expr.index : expr.type === 'array_access' && expr.index.type === 'primitive' && typeof expr.index.value === 'string' ? expr.index.value : null
	if (key === null) return null
	if (object.id === 'note') return key
	if (object.id === 'formula') return `formula.${key}`
	if (object.id === 'file' && expr.type === 'object_access') return `file.${key}`
	return null
}

/** A literal value: text, a number, a checkbox, or `link("x")`. Anything else (a call, a name) isn't one. */
function literalOf(expr: Expr): FilterValue | undefined {
	if (expr.type === 'primitive') return expr.value === null ? undefined : expr.value
	if (expr.type === 'function' && expr.subject === null && expr.name === 'link' && expr.args.length === 1) {
		const arg = expr.args[0]!
		if (arg.type === 'primitive' && typeof arg.value === 'string') return {link: arg.value}
	}
	return undefined
}
