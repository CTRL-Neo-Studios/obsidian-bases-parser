import {load} from 'js-yaml'
import {readFileSync} from 'node:fs'
import {describe, expect, it} from 'vitest'
import {runQuery, summarize, toText, type Base, type BaseFile, type BaseHost, type QueryResult} from '../src'
import probes from './fixtures/obsidian/query.json'
import kthalatir from './fixtures/obsidian/kthalatir.json'

interface SnapshotFile {ctime: number; mtime: number; size: number; frontmatter: Record<string, unknown> | null; tags: string[]}

/** A host over captured files without links (these bases don't use any). */
function hostOf(files: Record<string, SnapshotFile>): BaseHost {
	const paths = Object.keys(files)
	return {
		file: (path): BaseFile | null => (files[path] ? {path, ...files[path]} : null),
		resolve: link => [link, `${link}.md`].find(p => files[p]) ?? paths.find(p => p.endsWith(`/${link}.md`)) ?? null,
		backlinks: () => [],
	}
}

const names = (paths: string[]) => paths.map(p => p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/, ''))
const short = (paths: string[]) => names(paths).join(' ')
const groupsOf = (result: QueryResult) => result.groups.map(g => ({key: g.key && toText(g.key), rows: names(g.rows.map(r => r.path))}))
/** Obsidian's groups: the group without a value has a Null key. */
const capturedGroups = (groups: {key: {type: string; string: string} | null; rows: string[]}[]) =>
	groups.map(g => ({key: !g.key || g.key.type === 'Null' ? null : g.key.string, rows: names(g.rows)}))

describe('queries match Obsidian on probe notes', () => {
	const files = probes.files as unknown as Record<string, SnapshotFile>
	const options = {host: hostOf(files), paths: Object.keys(files), now: Date.now(), thisPath: probes.base}
	const base = (name: keyof typeof probes.bases) => load(probes.bases[name]) as Base

	// Where Obsidian's own behaviour isn't followed (each a quirk, not a rule).
	const DIVERGES = new Set([
		// A column mixing numbers, text, dates, lists and a checkbox: Obsidian's order follows from comparisons that
		// contradict each other; this engine's order is consistent instead.
		'sort mixed ASC', 'sort mixed DESC',
		// Obsidian only computes formulas shown in `order`, so sorting or grouping by any other formula does nothing.
		'sort formula.len ASC', 'sort formula.err ASC', 'group formula.len DESC',
	])

	for (const view of probes.sortGroup) {
		it.skipIf(DIVERGES.has(view.view))(`sort/group: ${view.view}`, () => {
			const result = runQuery(base('sortGroup'), view.view, options)
			expect(short(result.rows.map(r => r.path))).toBe(short(view.rows))
			if (view.groups.length > 1) expect(groupsOf(result)).toEqual(capturedGroups(view.groups))
		})
	}

	for (const view of probes.filters) {
		it(`filter: ${view.view}`, () => {
			expect(short(runQuery(base('filters'), view.view, options).rows.map(r => r.path))).toBe(short(view.rows))
		})
	}

	for (const {search, rows} of probes.search) {
		it(`search: ${JSON.stringify(search)}`, () => {
			expect(short(runQuery(base('filters'), 'search', {...options, search}).rows.map(r => r.path))).toBe(short(rows))
		})
	}

	it('leaves out and reports the rows a filter errors on; a null value doesn\'t error', () => {
		const result = runQuery(base('filters'), 'error all', options)
		expect(result.rows).toEqual([])
		// E and H have no `n`: `null.nope()` is null, not an error.
		expect(names(result.errors.map(e => e.path)).sort()).toEqual(['0', 'A', 'B', 'C', 'D', 'F', 'G', 'I'])
		expect(new Set(result.errors.map(e => e.message))).toEqual(new Set(['Cannot find function "nope" on type Number']))
	})

	describe('summaries', () => {
		const summaries = base('summaries')
		const result = runQuery(summaries, 'T', options)
		const context = {host: options.host, now: options.now, thisPath: probes.base, formulas: summaries.formulas ?? {}}
		const subsets = {all: result.rows, ABC: result.rows.filter(r => /\/[ABC]\.md$/.test(r.path)), none: []}
		for (const c of probes.summaries) {
			it(`${c.subset} ${c.prop} ${c.summary}`, () => {
				const value = summarize(summaries, context, subsets[c.subset as keyof typeof subsets], c.prop, c.summary)
				expect(value.type).toBe(c.type)
				expect(toText(value)).toBe(c.string)
			})
		}
	})
})

describe('the Kthalatir vault matches Obsidian', () => {
	const files = kthalatir.files as unknown as Record<string, SnapshotFile>
	const base = load(readFileSync(new URL('./fixtures/vault/Kthalatir Entries.base', import.meta.url), 'utf8')) as Base
	const options = {host: hostOf(files), paths: Object.keys(files), now: Date.now(), thisPath: kthalatir.base}
	// Files with the same name tie; Obsidian then keeps its own file order, so compare names, not paths.
	for (const view of kthalatir.views) {
		it(`${view.view}: ${view.rows.length} rows`, () => {
			const result = runQuery(base, view.view, options)
			expect(short(result.rows.map(r => r.path))).toBe(short(view.rows))
			expect(groupsOf(result)).toEqual(capturedGroups(view.groups))
		})
	}
})

it('groups, limits and sums like the probe base Obsidian showed (Sum 5, Sum 2, total 7)', () => {
	const files: Record<string, SnapshotFile> = {
		'p/A.md': {ctime: 0, mtime: 0, size: 1, frontmatter: {status: 'todo', priority: 2}, tags: []},
		'p/B.md': {ctime: 0, mtime: 0, size: 1, frontmatter: {status: 'doing', priority: 5}, tags: []},
		'p/C.md': {ctime: 0, mtime: 0, size: 1, frontmatter: null, tags: []},
	}
	const base = load(`filters:
  and:
    - file.inFolder("p")
views:
  - type: table
    name: T
    groupBy:
      property: status
      direction: ASC
    sort:
      - property: status
        direction: ASC
      - property: priority
        direction: DESC
    limit: 2
    summaries:
      priority: Sum
`) as Base
	const result = runQuery(base, 'T', {host: hostOf(files), paths: Object.keys(files), now: 0, thisPath: 'p/P.base'})
	expect(groupsOf(result)).toEqual([{key: 'doing', rows: ['B']}, {key: 'todo', rows: ['A']}])
	expect(result.groups.map(g => toText(g.summaries.get('priority')!))).toEqual(['5', '2'])
	expect(toText(result.summaries.get('priority')!)).toBe('7')
	expect(result.total).toBe(3)
})
