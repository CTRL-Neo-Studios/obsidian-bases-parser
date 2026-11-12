import {
	CORE_SCHEMA,
	DEFAULT_SCALAR_STYLE_RULES as RULES,
	SCALAR_STYLE,
	Schema,
	defineScalarTag,
	dump,
	floatCoreTag,
	intCoreTag,
	load,
	nullCoreTag,
	type ScalarLayout,
} from 'js-yaml'

// YAML 1.2's core schema, as Obsidian reads and writes: `yes`, `n` and dates are text. Null is written empty
// (`nul:`), and numbers as JavaScript prints them (`1e+21`, not `1.e+21`).
const number = (n: number) => (Number.isNaN(n) ? '.nan' : n === Infinity ? '.inf' : n === -Infinity ? '-.inf' : String(n))
const SCHEMA = new Schema(CORE_SCHEMA.tags.map(tag => {
	if (tag === nullCoreTag) return defineScalarTag(tag.tagName, {...nullCoreTag, represent: () => ''})
	if (tag === intCoreTag) return defineScalarTag(tag.tagName, {...intCoreTag, represent: (n: unknown) => number(n as number)})
	if (tag === floatCoreTag) return defineScalarTag(tag.tagName, {...floatCoreTag, represent: (n: unknown) => number(n as number)})
	return tag
}))

const allows = (layout: ScalarLayout, style: number) => (layout.allowedStylesMask & (1 << style)) !== 0

/** Quoted text is double-quoted, unless single quotes save escaping a `"` (`'"a: b"'`). */
function singleForDoubleQuotes(layout: ScalarLayout) {
	const text = layout.node.value
	if (layout.style === SCALAR_STYLE.DOUBLE_QUOTED && text.includes('"') && !text.includes("'") && allows(layout, SCALAR_STYLE.SINGLE_QUOTED)) {
		layout.style = SCALAR_STYLE.SINGLE_QUOTED
	}
}

/** Invisible characters force quotes, but a tab stays plain (`a	b`), as Obsidian writes it. */
function quoteInvisiblesButTab(layout: ScalarLayout) {
	if (layout.style === SCALAR_STYLE.PLAIN && /[\x7F-\xA0\u2028\u2029\uFEFF\uFFFE\uFFFF]/.test(layout.node.value)) {
		layout.style = SCALAR_STYLE.DOUBLE_QUOTED
	}
}

const STYLE_RULES = [
	RULES.applyQuoteFlowKeysOption,
	quoteInvisiblesButTab,
	RULES.doubleQuoteWhitespaceOnly,
	RULES.applyForceQuotesOption,
	RULES.tryLongOrMultilineAsBlock,
	RULES.quoteInvalidPlain,
	RULES.fallbackToDoubleQuoted,
	singleForDoubleQuotes,
]

/** Reads YAML as Obsidian does (core schema); a file with no content is null. Throws js-yaml's `YAMLException`. */
export function readYaml(text: string): unknown {
	// js-yaml 5 refuses a document-less file; Obsidian reads an empty `.base` as an empty base.
	if (!text.replace(/^\s*#.*$/gm, '').trim()) return null
	return load(text, {schema: SCHEMA})
}

/** Writes YAML as Obsidian 1.15.1 does: block style, two-space indent, no line folding. */
export function writeYaml(value: unknown): string {
	const text = dump(value, {schema: SCHEMA, lineWidth: -1, quoteStyle: 'double', scalarStyleRules: STYLE_RULES})
	// A null list item is `- ` (with its space) in Obsidian's files; js-yaml ends the line at the dash.
	return text.replace(/^( *)-$/gm, '$1- ')
}
