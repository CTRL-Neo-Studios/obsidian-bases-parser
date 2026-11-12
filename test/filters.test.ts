import {describe, expect, it} from 'vitest'
import {fromFilterGroup, OPERATORS, parseBase, ruleExpression, stringifyBase, toFilterGroup, type Base, type FilterOperator, type FilterRule, type FilterValue, type PropertyKind} from '../src'
import captured from './fixtures/obsidian/filters.json'

// Obsidian 1.15.1's filter builder over a probe note: how it shows ~85 expressions, the operators each property kind
// offers, and what it writes for each operator.

// The probe note's property types in Obsidian (`dt` is a text property there; `l` a list; formula `f` a number).
const KINDS: Record<string, PropertyKind> = {s: 'text', n: 'number', b: 'checkbox', d: 'date', dt: 'text', l: 'list', tags: 'list', rel: 'text', 'formula.f': 'number'}
const kindOf = (property: string) => KINDS[property] ?? 'text'

// Obsidian's labels, per kind.
const LABELS: Record<PropertyKind, Record<string, FilterOperator>> = {
	text: {'is': 'equals', 'is not': 'notEquals', 'starts with': 'startsWith', 'ends with': 'endsWith', 'is empty': 'isEmpty', 'contains': 'contains', 'contains any of': 'containsAny', 'contains all of': 'containsAll', 'does not start with': 'notStartsWith', 'does not end with': 'notEndsWith', 'is not empty': 'isNotEmpty', 'does not contain': 'notContains', 'does not contain any of': 'notContainsAny', 'does not contain all of': 'notContainsAll'},
	number: {'=': 'equals', '≠': 'notEquals', '<': 'lessThan', '≤': 'lessOrEqual', '>': 'greaterThan', '≥': 'greaterOrEqual', 'is empty': 'isEmpty', 'is not empty': 'isNotEmpty'},
	checkbox: {'is': 'equals', 'is not': 'notEquals'},
	date: {'on': 'equals', 'not on': 'notEquals', 'before': 'lessThan', 'on or before': 'lessOrEqual', 'after': 'greaterThan', 'on or after': 'greaterOrEqual', 'is empty': 'isEmpty', 'is not empty': 'isNotEmpty'},
	list: {'is exactly': 'equals', 'is not exactly': 'notEquals', 'is empty': 'isEmpty', 'contains': 'contains', 'contains any of': 'containsAny', 'contains all of': 'containsAll', 'is not empty': 'isNotEmpty', 'does not contain': 'notContains', 'does not contain any of': 'notContainsAny', 'does not contain all of': 'notContainsAll'},
	file: {'links to': 'linksTo', 'in folder': 'inFolder', 'has tag': 'hasTag', 'has property': 'hasProperty', 'does not link to': 'notLinksTo', 'is not in folder': 'notInFolder', 'does not have tag': 'notHasTag', 'does not have property': 'notHasProperty'},
}
// The menu's property names → ids.
const PROPERTY_LABELS: Record<string, string> = {'file': 'file', 'file name': 'file.name', 'folder': 'file.folder', 'file extension': 'file.ext', 'file path': 'file.path', 'file size': 'file.size', 'created time': 'file.ctime', 'file tags': 'file.tags', 'file links': 'file.links', 'f': 'formula.f'}

// The captures' starting rule for each kind of property, and the value the builder kept when switching operators.
const STARTS: Record<string, {property: string; kind: PropertyKind; value: FilterValue}> = {
	'text': {property: 's', kind: 'text', value: 'todo'}, 'number': {property: 'n', kind: 'number', value: 3}, 'checkbox': {property: 'b', kind: 'checkbox', value: true},
	'date': {property: 'd', kind: 'date', value: '2026-01-01'}, 'list': {property: 'l', kind: 'list', value: 'x'}, 'tags': {property: 'tags', kind: 'list', value: 'one'},
	'file': {property: 'file', kind: 'file', value: 'one'}, 'file name': {property: 'file.name', kind: 'text', value: 'N'}, 'folder': {property: 'file.folder', kind: 'text', value: 'zz-b5'},
	'file extension': {property: 'file.ext', kind: 'text', value: 'md'}, 'file path': {property: 'file.path', kind: 'text', value: 'zz-b5/N.md'}, 'file size': {property: 'file.size', kind: 'number', value: 10},
	'created time': {property: 'file.ctime', kind: 'date', value: '2026-01-01'}, 'file tags': {property: 'file.tags', kind: 'list', value: '#one'}, 'file links': {property: 'file.links', kind: 'list', value: {link: 'N'}},
	'link': {property: 'rel', kind: 'text', value: {link: 'N'}}, 'formula number': {property: 'formula.f', kind: 'number', value: 1},
}

describe('each kind offers Obsidian\'s operators, in its order', () => {
	for (const [name, labels] of Object.entries(captured.operators)) {
		it(name, () => {
			const kind = STARTS[name]!.kind
			expect(OPERATORS[kind]).toEqual(labels.map(label => LABELS[kind][label]))
		})
	}
})

describe('expressions read as the builder shows them', () => {
	const shown = (value: FilterValue) => (typeof value === 'object' ? value.link : String(value))
	for (const c of captured.reads as {expression: string; advanced?: true; property?: string; operator?: string; value?: string | string[] | null}[]) {
		it(JSON.stringify(c.expression), () => {
			const [item] = toFilterGroup(c.expression, kindOf).items
			if (c.advanced) return expect(item).toEqual({expression: c.expression})
			const rule = item as FilterRule
			const property = PROPERTY_LABELS[c.property!] ?? c.property!
			expect(rule.property).toBe(property)
			const kind = property === 'file' ? 'file' : STARTS[Object.keys(STARTS).find(k => STARTS[k]!.property === property) ?? '']?.kind ?? kindOf(property)
			expect(rule.operator).toBe(LABELS[kind][c.operator!])
			const values = rule.values.map(shown)
			if (Array.isArray(c.value)) expect(values).toEqual(c.value)
			else expect(values[0] ?? '').toBe(c.value ?? '')
			expect(rule.text).toBe(c.expression)
		})
	}
})

describe('each operator writes what Obsidian writes', () => {
	for (const c of captured.writes) {
		it(`${c.kind}: ${c.operator}`, () => {
			const start = STARTS[c.kind]!
			const rule: FilterRule = {property: start.property, operator: LABELS[start.kind][c.operator]!, values: [start.value]}
			expect(ruleExpression(rule)).toBe(c.expression)
		})
	}
	it('writes several values as a list where one value is written bare', () => {
		expect(ruleExpression({property: 'l', operator: 'equals', values: ['x', 'y']})).toBe('l == ["x", "y"]')
		expect(ruleExpression({property: 's', operator: 'containsAny', values: ['a', 'b']})).toBe('s.containsAny("a", "b")')
		expect(ruleExpression({property: 'file', operator: 'hasTag', values: ['a', 'b']})).toBe('file.hasTag("a", "b")')
		expect(ruleExpression({property: 'my prop', operator: 'equals', values: ['x']})).toBe('note["my prop"] == "x"')
		expect(ruleExpression({property: 'formula.Time of Existence', operator: 'isEmpty', values: []})).toBe('formula["Time of Existence"].isEmpty()')
	})
})

it('removing a rule rewrites the group but keeps the other rules\' text, as Obsidian does', () => {
	const before = parseBase(captured.untouched.before).base as Base
	const view = before.views![0]!
	const group = toFilterGroup(view.filters, kindOf)
	const after: Base = {...before, views: [{...view, filters: fromFilterGroup({...group, items: group.items.slice(1)})}]}
	expect(stringifyBase(after)).toBe(captured.untouched.after)
})
