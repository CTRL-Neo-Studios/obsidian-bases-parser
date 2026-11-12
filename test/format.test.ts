import {readdirSync, readFileSync} from 'node:fs'
import {describe, expect, it} from 'vitest'
import * as edit from '../src/format/edit'
import {parseBase, stringifyBase, type Base} from '../src'
import captured from './fixtures/obsidian/format.json'

// What Obsidian 1.15.1 writes, captured from its own serializer: bases it read (normalized), files it refused (its
// messages), and the file after each edit.

const read = (text: string): Base => {
	const parsed = parseBase(text)
	if (parsed.error !== null) throw new Error(parsed.error)
	return parsed.base
}

describe('files Obsidian saved round-trip byte for byte', () => {
	const dir = new URL('./fixtures/vault/', import.meta.url)
	for (const name of readdirSync(dir)) {
		it(name, () => {
			const text = readFileSync(new URL(name, dir), 'utf8')
			expect(stringifyBase(read(text))).toBe(text)
		})
	}
})

describe('a base is written as Obsidian writes it', () => {
	for (const {name, input, output} of captured.normalize) {
		it(name, () => expect(stringifyBase(read(input))).toBe(output))
	}
})

describe('invalid bases fail with Obsidian\'s message; quirks are cleaned up as Obsidian does', () => {
	// js-yaml words syntax errors its own way (Obsidian's come from the `yaml` package), and Obsidian crashes on a
	// non-text `order` item ("o.startsWith is not a function") where this reports its own message for it.
	const OWN_MESSAGE: Record<string, string | RegExp> = {
		'yaml syntax': /./,
		'dup keys': /duplicated mapping key/,
		'order number item': '"order" values must all be of type string in view "T"',
	}
	for (const c of captured.errors as {name: string; input: string; error?: string; output?: string}[]) {
		it(c.name, () => {
			const parsed = parseBase(c.input)
			if (c.error === undefined) return expect(parsed.error === null && stringifyBase(parsed.base)).toBe(c.output)
			const expected = OWN_MESSAGE[c.name] ?? c.error
			expect(parsed.base).toBeNull()
			if (typeof expected === 'string') expect(parsed.error).toBe(expected)
			else expect(parsed.error).toMatch(expected)
		})
	}
})

describe('edits write what Obsidian writes for the same action', () => {
	const EDITS: Record<string, (b: Base) => Base> = {
		'toggle sort n': b => edit.toggleSort(b, 'T', 'note.n'),
		'toggle sort n twice': b => edit.toggleSort(edit.toggleSort(b, 'T', 'note.n'), 'T', 'note.n'),
		'toggle sort n thrice': b => [1, 2, 3].reduce(x => edit.toggleSort(x, 'T', 'note.n'), b),
		'toggle sort file.name': b => edit.toggleSort(b, 'T', 'file.name'),
		'sort ASC formula on C': b => edit.setSort(b, 'C', [{property: 'formula.f', direction: 'ASC'}]),
		'sort DESC existing': b => edit.setSort(b, 'T', [{property: 'file.name', direction: 'DESC'}]),
		'sort NONE existing': b => edit.setSort(b, 'T', []),
		'group by status': b => edit.setGroupBy(b, 'T', {property: 'note.status', direction: 'ASC'}),
		'group by then change': b => edit.setGroupBy(edit.setGroupOrder(edit.setGroupBy(b, 'T', {property: 'note.status', direction: 'ASC'}), 'T', ['todo', null]), 'T', {property: 'note.n', direction: 'DESC'}),
		'group by then direction': b => edit.setGroupBy(edit.setGroupOrder(edit.setGroupBy(b, 'T', {property: 'note.status', direction: 'ASC'}), 'T', ['todo', null]), 'T', {property: 'note.status', direction: 'DESC'}),
		'group by then clear': b => edit.setGroupBy(edit.setGroupOrder(edit.setGroupBy(b, 'T', {property: 'note.status', direction: 'ASC'}), 'T', ['todo']), 'T', null),
		'group order': b => edit.setGroupOrder(edit.setGroupBy(b, 'T', {property: 'note.status', direction: 'ASC'}), 'T', ['todo', null, false, 3]),
		'group order clear': b => edit.setGroupOrder(edit.setGroupOrder(edit.setGroupBy(b, 'T', {property: 'note.status', direction: 'ASC'}), 'T', ['todo']), 'T', null),
		'group order empty': b => edit.setGroupOrder(edit.setGroupBy(b, 'T', {property: 'note.status', direction: 'ASC'}), 'T', []),
		'limit': b => edit.setLimit(b, 'T', 10),
		'limit then clear null': b => edit.setLimit(edit.setLimit(b, 'T', 10), 'T', null),
		'limit then 0': b => edit.setLimit(edit.setLimit(b, 'T', 10), 'T', 0),
		'order': b => edit.setOrder(b, 'T', ['formula.f', 'note.status', 'file.name', 'note.n']),
		'order empty': b => edit.setOrder(b, 'T', []),
		'columnSize add': b => edit.setColumnSize(b, 'T', 'file.name', 300),
		'columnSize remove': b => edit.setColumnSize(b, 'T', 'note.n', null),
		'summary set': b => edit.setSummary(b, 'T', 'formula.f', 'Average'),
		'summary replace': b => edit.setSummary(b, 'T', 'note.n', 'Max'),
		'summary remove last': b => edit.setSummary(b, 'T', 'note.n', null),
		'summary on C': b => edit.setSummary(b, 'C', 'note.n', 'Sum'),
		'rowHeight': b => edit.setViewOption(b, 'T', 'rowHeight', 'tall'),
		'cardSize change': b => edit.setViewOption(b, 'C', 'cardSize', 300),
		'cardSize remove': b => edit.setViewOption(b, 'C', 'cardSize', null),
		'image option': b => edit.setViewOption(edit.setViewOption(b, 'C', 'imageAspectRatio', 0.75), 'C', 'image', 'note.cover'),
		'formula add text': b => edit.setFormula(b, 'h', 'n + 1'),
		'formula change text': b => edit.setFormula(b, 'f', 'n * 3'),
		'formula remove': b => edit.deleteFormula(b, 'f'),
		'formula remove used': b => edit.deleteFormula(b, 'f'),
		'summary formula add': b => edit.setSummaryFormula(b, 'Twice', 'values.length * 2'),
		'summary formula add existing': b => edit.setSummaryFormula(b, 'Twice', 'values.length * 2'),
		'summary formula rename': b => edit.renameSummaryFormula(b, 'S', 'Count'),
		'summary formula delete': b => edit.deleteSummaryFormula(b, 'S'),
		'summary rename first of two': b => edit.renameSummaryFormula(b, 'S', 'Count'),
		'summary delete first of two': b => edit.deleteSummaryFormula(b, 'S'),
		'summary change existing': b => edit.setSummaryFormula(b, 'S', 'values.length + 1'),
		'no-op save': b => b,
		'no-op save two sums': b => b,
		'no-op save used': b => b,
		'delete view': b => edit.deleteView(b, 'T'),
		'default view': b => edit.setDefaultView(b, 'C'),
	}
	// Captures made with Obsidian's API objects rather than text (`setFormulas({h: {text}})`), not a user action.
	const NOT_ACTIONS = new Set(['formula add', 'formula change'])
	for (const {name, before, after} of captured.edits) {
		if (NOT_ACTIONS.has(name)) continue
		it(name, () => {
			const apply = EDITS[name]
			expect(apply, `no edit mapped for "${name}"`).toBeDefined()
			expect(stringifyBase(apply!(read(before)))).toBe(after)
		})
	}
})

describe('edits Obsidian couldn\'t be captured doing', () => {
	const base = read('views:\n  - type: table\n    name: View\n  - type: list\n    name: T\n')
	it('names new and duplicated views as Obsidian prefills them', () => {
		expect(edit.addView(base, 'cards').views!.map(v => v.name)).toEqual(['View', 'T', 'View 2'])
		expect(edit.duplicateView(base, 'T').views!.map(v => v.name)).toEqual(['View', 'T', 'T 2'])
	})
	it('refuses empty and taken view names with Obsidian\'s messages', () => {
		expect(edit.viewNameError(base, ' ')).toBe('View name cannot be empty.')
		expect(edit.viewNameError(base, 'T', 'View')).toBe('View name already exists.')
		expect(edit.viewNameError(base, 'T', 'T')).toBeNull()
	})
})
