/**
 * The expression AST. Node shapes are the ones Obsidian 1.15.1 produces for the same text (captured in
 * `test/fixtures/obsidian/expressions.json`), so the parser is checked against Obsidian directly.
 */
export type Expr =
	| EmptyExpr
	| PrimitiveExpr
	| IdentExpr
	| ObjectAccessExpr
	| ArrayAccessExpr
	| FunctionExpr
	| ArithmeticExpr
	| ComparisonExpr
	| NotExpr
	| NegateExpr
	| ParenExpr
	| ArrayExpr
	| RegExpExpr

/** A blank formula (Obsidian keeps `Untitled: ""` formulas). */
export interface EmptyExpr {
	type: 'empty'
}

export interface PrimitiveExpr {
	type: 'primitive'
	value: string | number | boolean | null
}

/** A bare name: a note property, a namespace (`file`, `note`, `formula`, `this`) or a lambda variable (`value`, …). */
export interface IdentExpr {
	type: 'ident'
	id: string
}

/** `object.index` */
export interface ObjectAccessExpr {
	type: 'object_access'
	object: Expr
	index: string
}

/** `array[index]`, also `note["my prop"]` */
export interface ArrayAccessExpr {
	type: 'array_access'
	array: Expr
	index: Expr
}

/** `name(args)` (a global function, `subject` null) or `subject.name(args)` (a method). */
export interface FunctionExpr {
	type: 'function'
	name: string
	subject: Expr | null
	args: Expr[]
}

export type ArithmeticOperator = '+' | '-' | '*' | '/' | '%'

export interface ArithmeticExpr {
	type: 'arithmetic'
	operator: ArithmeticOperator
	left: Expr
	right: Expr
}

/** Comparisons and the boolean `&&` / `||`. */
export type ComparisonOperator = '==' | '!=' | '<' | '<=' | '>' | '>=' | '&&' | '||'

export interface ComparisonExpr {
	type: 'comparison'
	operator: ComparisonOperator
	left: Expr
	right: Expr
}

export interface NotExpr {
	type: 'not'
	expr: Expr
}

/** Unary minus on anything but a plain number (`-1` is a primitive). */
export interface NegateExpr {
	type: 'negate'
	expr: Expr
}

export interface ParenExpr {
	type: 'paren_expr'
	value: Expr
}

export interface ArrayExpr {
	type: 'array'
	elements: Expr[]
}

/** `/pattern/flags`; the pattern is checked by `RegExp` when parsed. */
export interface RegExpExpr {
	type: 'regexp'
	pattern: string
	flags: string
}
