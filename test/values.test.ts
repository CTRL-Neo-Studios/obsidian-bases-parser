import {describe, expect, it} from 'vitest'
import {RowScope, toDisplay, toText, isTruthy, type BaseFile, type BaseHost, type Value} from '../src'
import captured from './fixtures/obsidian/values.json'

// Obsidian 1.15.1 evaluating ~1150 formulas over probe notes: each value's type, text and truthiness (and how dates and
// numbers display), with the files' metadata as Obsidian's index had it. The host below rebuilds that index.

interface CapturedLink {link: string; displayText: string; resolved: string | null}
interface CapturedFile {
	ctime: number
	mtime: number
	size: number
	frontmatter: Record<string, unknown> | null
	links: CapturedLink[]
	embeds: CapturedLink[]
	frontmatterLinks: CapturedLink[]
	tags: string[]
	backlinks: string[]
}
interface Case {
	row: string
	expr: string
	name: string
	now: number
	formulas?: Record<string, string>
	missing?: true
	type?: string
	string?: string
	truthy?: boolean
	render?: string
	items?: (string | null)[]
}

const files = captured.files as unknown as Record<string, CapturedFile>
const paths = Object.keys(files)

const host: BaseHost = {
	file(path): BaseFile | null {
		const f = files[path]
		if (!f) return null
		const link = (l: CapturedLink) => ({link: l.link, display: l.displayText})
		return {
			path, ctime: f.ctime, mtime: f.mtime, size: f.size, frontmatter: f.frontmatter, tags: f.tags,
			links: [...f.frontmatterLinks, ...f.links, ...f.embeds].map(link), embeds: f.embeds.map(link),
		}
	},
	// Obsidian's lookup, enough for these files: an exact path, the path without `.md`, or a file name anywhere.
	resolve(link) {
		return [link, `${link}.md`].find(p => files[p])
			?? paths.find(p => p.endsWith(`/${link}.md`) || p.endsWith(`/${link}`))
			?? null
	},
	backlinks: path => files[path]?.backlinks ?? [],
}

// Where this engine knowingly differs.
const DIVERGES: Record<string, string> = {
	// Obsidian throws an internal TypeError ("Cannot read properties of undefined (reading 'variadic')").
	'now(1)': 'too many arguments',
	'today(1)': 'too many arguments',
	'random(1)': 'too many arguments',
}

const cases = captured.cases as Case[]

describe('formula values match Obsidian', () => {
	for (const c of cases) {
		it(`${c.row.slice(6)}: ${c.expr}`, () => {
			const scope = new RowScope({host, now: c.now, thisPath: captured.base, formulas: c.formulas ?? {[c.name]: c.expr}}, c.row)
			const value: Value = scope.formula(c.name)
			if (DIVERGES[c.expr]) return expect(toText(value)).toContain(DIVERGES[c.expr])
			// `min()` gives undefined in Obsidian, shown as an empty (null) cell.
			if (c.missing) return expect(value.type).toBe('Null')
			expect(value.type).toBe(c.type)
			// The base's formula names differ between the capture's batches and this test.
			if (value.type !== 'Formulas') expect(toText(value)).toBe(c.string)
			expect(isTruthy(value)).toBe(c.truthy)
			if (c.render !== undefined && (value.type === 'Date' || value.type === 'Number')) expect(toDisplay(value)).toBe(c.render)
			if (c.items && value.type === 'List') expect(value.items.map(i => i.type)).toEqual(c.items.map(t => t ?? 'Link'))
		})
	}
})
