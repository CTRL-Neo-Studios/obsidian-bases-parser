import {parseDate} from './time'
import {NULL, parseWikiLink, type Value} from './value'

const SCHEME = /^[a-z][a-z0-9+.-]*:/i

/** A URL as Obsidian recognises one in a property: a scheme, no spaces, parseable, and not `javascript:`. */
export function isUrl(text: string): boolean {
	return SCHEME.test(text) && !/\s/.test(text) && !/^javascript:/i.test(text) && URL.canParse(text)
}

/**
 * A frontmatter value (YAML as JSON) as formulas see it. Obsidian converts by the value, not by the property's type:
 * date-like text is a Date, `[[…]]` a Link, a URL a URL; quoted numbers stay text. `tags` is always a list of `#tag`s.
 * `from` is the note, for resolving its links.
 */
export function fromFrontmatter(raw: unknown, from: string, key?: string): Value {
	if (key?.toLowerCase() === 'tags') {
		const tags = Array.isArray(raw) ? raw : raw == null ? [] : [raw]
		return {type: 'List', items: tags.filter(t => t != null).map(t => tag(String(t)))}
	}
	if (raw === null || raw === undefined) return NULL
	if (typeof raw === 'boolean') return {type: 'Boolean', value: raw}
	if (typeof raw === 'number') return {type: 'Number', value: raw}
	if (Array.isArray(raw)) return {type: 'List', items: raw.map(item => fromFrontmatter(item, from))}
	if (typeof raw === 'object') {
		return {type: 'Object', entries: new Map(Object.entries(raw).map(([k, v]) => [k, fromFrontmatter(v, from)]))}
	}
	return fromText(String(raw), from)
}

function fromText(text: string, from: string): Value {
	const date = parseDate(text)
	if (date) return {type: 'Date', ...date}
	const link = parseWikiLink(text, from)
	if (link) return link
	if (isUrl(text)) return {type: 'URL', value: text}
	return {type: 'String', value: text}
}

/** A tag as a string with its `#`, flagged so list `contains` matches it without `#` or case. */
export function tag(text: string): Value {
	return {type: 'String', value: text.startsWith('#') ? text : `#${text}`, tag: true}
}
