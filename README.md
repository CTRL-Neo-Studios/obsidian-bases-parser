# @type32/obsidian-bases-parser

[Obsidian Bases](https://obsidian.md/help/bases) (`.base` files) in plain TypeScript: the expression language, every function, queries (filters, search, sort, limit, groups, summaries), the filter builder's model, and reading and writing `.base` files exactly as Obsidian does.

The behaviour is Obsidian 1.15.1's, observed in the app rather than taken from the docs (which differ in places). Thousands of captured Obsidian results are the test suite. No Obsidian code is used.

The library never touches a filesystem or a UI framework: your app passes in its files and its link graph.

```bash
bun add @type32/obsidian-bases-parser
```

## Reading and writing `.base` files

```ts
import {parseBase, stringifyBase, toggleSort, setGroupBy} from '@type32/obsidian-bases-parser'

const parsed = parseBase(text)
if (parsed.error !== null) throw new Error(`Unable to parse your base file: ${parsed.error}`)
let base = parsed.base

base = toggleSort(base, 'Tasks', 'note.priority') // a header click: A → Z, Z → A, off
base = setGroupBy(base, 'Tasks', {property: 'note.status', direction: 'ASC'})
const written = stringifyBase(base) // what Obsidian would write, byte for byte
```

- **`parseBase`** returns Obsidian's error messages and makes Obsidian's clean-ups:
  - `note.` is dropped from `order`, `sort` and `groupBy`;
  - invalid sorts and limits are removed;
  - a base without views gets a table named "View".
- **`stringifyBase`** writes Obsidian's key order, quoting and layout. Files Obsidian saved round-trip unchanged.
- **`readYaml` / `writeYaml`** are the YAML reader and writer underneath (YAML 1.2's core schema, Obsidian's quoting), for other YAML Obsidian writes, such as a note's frontmatter.
- **Edits** are pure functions (base in, base out):
  - `toggleSort`, `setSort`, `setGroupBy`, `setGroupOrder`, `setLimit`, `setOrder`, `setColumnSize`, `setSummary`, `setViewOption`, `setFilters`;
  - `setFormula`, `deleteFormula`, `renameFormula`;
  - `setSummaryFormula`, `renameSummaryFormula`, `deleteSummaryFormula`, `setDisplayName`;
  - `addView`, `duplicateView`, `deleteView`, `renameView`, `setDefaultView`, `moveView`, `uniqueViewName`, `viewNameError`.

  Each writes what Obsidian writes for the same action, for example a header click moving its sort to the front. A few couldn't be observed, and their doc comments say so.

## Running a view

```ts
import {runQuery, toDisplay, type BaseHost} from '@type32/obsidian-bases-parser'

const host: BaseHost = {
	// path, ctime, mtime, size, frontmatter (YAML as JSON), body tags, links and embeds
	file: path => index.get(path) ?? null,
	resolve: (link, from) => resolveLinkpath(link, from), // `M`, `folder/M` → a path, or null
	backlinks: path => backlinksOf(path),
}

const result = runQuery(base, 'Tasks', {host, paths: allPaths, now: Date.now(), thisPath: 'Projects/Tasks.base', search: ''})
for (const group of result.groups) {
	for (const row of group.rows) console.log(row.path, toDisplay(row.property('formula.age')))
}
result.summaries // per property, over the shown rows; each group has its own
result.total     // rows before the limit
```

Here `index`, `resolveLinkpath`, `backlinksOf` and `allPaths` stand for your app's own index.

Properties are ids: `note.status` (or `status`), `file.name`, `formula.age`. Frontmatter is converted by value, as Obsidian does: date-like text is a Date, `[[…]]` a Link, a URL a URL, and `tags` a list of `#tags`.

The query behaves as Obsidian's does:

- **Filters:** the base's, then the view's. A filter that errors on a row leaves the row out; the row is listed in `result.errors`.
- **Search:** the words and punctuation of the search text must each appear in a shown value.
- **Sort:** stable, on top of file-name order. Empty values go last; checkboxes sort by whether they're checked.
- **Limit** applies before grouping.
- **Groups** are keyed by a value's text, with the empty group last. `groupOrder` lists the shown groups.
- **Summaries:** all 14 built-ins (Average divides by every row and rounds to two decimals) plus custom formulas over `values`.

A query of 5 000 notes takes about 10 ms.

## Expressions and values

```ts
import {RowScope, toText} from '@type32/obsidian-bases-parser'

const row = new RowScope({host, now: Date.now(), thisPath: 'Tasks.base', formulas: {age: 'today() - file.ctime'}}, 'Notes/A.md')
toText(row.evaluate('file.tags.filter(value.startsWith("#project")).length')) // "2"
toText(row.formula('age')) // "a year"
```

- **`parseExpression`** parses the language into the same tree Obsidian builds:
  - JavaScript precedence; lists and regexes, but no object literals;
  - names may be any text without spaces or punctuation (`café`, `名前`);
  - `note["my prop"]` for the rest.
- **Values** are tagged with Obsidian's type names: Null, Boolean, Number, String, URL, HTML, Image, Link, Date, Duration, List, Object, File, RegExp, Error. `toText` is Obsidian's `toString()`, and `toDisplay` how a cell shows the value (`11/20/2026 10:30 AM`).
- **Errors are values** (`Cannot find function "upper" on type String`), not exceptions.
- **Durations** keep calendar months, as Obsidian's do: `duration("2M").days` counts from now, and `"18M"` reads "2 years".
- **Functions:** every one Obsidian 1.15.1 has, with its argument checks and messages. That includes the list aggregates (`sum`, `mean`, `median`, `min`, `max`, `stddev`, `earliest`, `latest`), and excludes the documented `upper()` and `markdown()`, which 1.15.1 doesn't have.
- **`FUNCTION_NAMES`** lists the global functions and the methods by name, for an editor's autocomplete.

## The filter builder

```ts
import {toFilterGroup, fromFilterGroup, ruleExpression, OPERATORS} from '@type32/obsidian-bases-parser'

const group = toFilterGroup(view.filters, property => kinds.get(property) ?? 'text')
// {conjunction: 'and', items: [{property: 'status', operator: 'equals', values: ['todo'], text: 'status == "todo"'}, {expression: 'd > today()'}]}
ruleExpression({property: 'tags', operator: 'containsAny', values: ['a', 'b']}) // 'tags.containsAny("a", "b")'
```

- **Kinds:** a property's kind (`text`, `number`, `checkbox`, `date`, `list`, `file`) decides its operators, in the order of Obsidian's menu (`OPERATORS`). File properties have fixed kinds.
- **Expression rows:** an expression the builder can't show as a rule stays an expression row.
- **Unchanged rules** keep their original text when written back.

## Where it differs from Obsidian

Each of these is on purpose:

- **Errors:**
  - YAML syntax errors use js-yaml's wording.
  - `now(1)` reports "too many arguments" where Obsidian shows an internal error.
  - `repeat` and `toFixed` range errors are worded the same on every JavaScript engine.
- **Queries:**
  - Formulas are computed whenever a sort or group uses them. Obsidian only computes formulas shown in the view.
  - A column mixing types sorts consistently; Obsidian's order there contradicts itself.

## Development

```bash
bun install
bun run test         # vitest, against Obsidian's captured results in test/fixtures/obsidian
bun run test:types
bun run lint
bun run build        # tsdown → dist (ESM + CJS)
```

The fixtures were captured by driving Obsidian 1.15.1 on probe notes. Each test file says what its fixture holds.

## License

MIT
