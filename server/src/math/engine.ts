/**
 * Math Engine Abstraction Layer
 *
 * All public API methods operate on strings or opaque EngineNode handles.
 * math.js Node objects NEVER cross the MathEngine interface boundary.
 * This enforces the strings-only invariant required by Colyseus Schema.
 */

/**
 * Opaque handle wrapping a math.js Node (or future SymPy AST node).
 * Callers CANNOT extract the internal node — they can only pass it
 * back to engine methods like `toString()` or `evaluate()`.
 *
 * The `_node` field is `unknown` at the interface level; consumers
 * cannot inspect or destructure it. Only engine implementations
 * know the concrete type.
 */
export type EngineNode = {
  readonly _tag: 'EngineNode';
  readonly _node: unknown;
};

/**
 * Result envelope for operations that may be unsupported, partial, or failed.
 * - ok: true if the operation produced a result (even if partial or stubbed).
 * - supported: true if the current backend can compute this operation.
 * - partial: (eigs) true when results are incomplete (e.g. defective matrices).
 * - reason: human-readable explanation when unsupported or failed.
 * - value: the result payload (shape varies by operation).
 */
export interface EngineResult {
  ok: boolean;
  supported: boolean;
  partial?: boolean;
  reason?: string;
  value?: unknown;
}

/**
 * Core math engine interface.
 *
 * Design rules:
 * 1. All expressions and matrix representations are PLAIN strings.
 * 2. parse() returns an opaque EngineNode that CANNOT be stored in a
 *    Colyseus Schema @type("string") field — TypeScript will reject it.
 * 3. evaluate() uses parse → compile → evaluate(scope) internally,
 *    never raw string eval.
 */
export interface MathEngine {
  // ── Parse / Serialize ──────────────────────────────────────────────
  /** Parse a string expression into an opaque node handle. */
  parse(expr: string): EngineNode;

  /** Serialize an opaque node handle back to a string. */
  toString(node: EngineNode): string;

  // ── Evaluation ─────────────────────────────────────────────────────
  /**
   * Evaluate an expression with a scope.
   * Returns a number for numeric results, or EngineNode for Complex/Matrix.
   * Internally uses parse → compile → evaluate(scope).
   */
  evaluate(
    expr: string,
    scope: Record<string, number | EngineNode>,
  ): number | EngineNode;

  // ── Calculus ───────────────────────────────────────────────────────
  /** Symbolic derivative. Returns a string expression. */
  derivative(expr: string, variable: string): string;

  /** Symbolic integration — STUBBED (SymPy Wave 3). */
  integrate(expr: string, variable: string): EngineResult;

  /** Limit evaluation — STUBBED (SymPy Wave 3). */
  limit(
    expr: string,
    variable: string,
    approach: number | string,
  ): EngineResult;

  /** Continuity check at a point — STUBBED (SymPy Wave 3). */
  continuityCheck(
    expr: string,
    variable: string,
    point: number,
  ): EngineResult;

  // ── Algebra / Simplification ───────────────────────────────────────
  /** Simplify an expression string. */
  simplify(expr: string): string;

  /** Rationalize an expression string. */
  rationalize(expr: string): string;

  /** Check if two string expressions are symbolically equal. */
  symbolicEqual(a: string, b: string): boolean;

  // ── Linear Algebra — Matrix Ops ────────────────────────────────────
  /** Determinant of a square matrix. */
  det(matrix: string): number;

  /** Matrix inverse. Returns string matrix. */
  inv(matrix: string): string;

  /** LU decomposition with partial pivoting. */
  lup(matrix: string): { L: string; U: string; P: string };

  /** QR decomposition. */
  qr(matrix: string): { Q: string; R: string };

  /** Singular Value Decomposition (SVD). */
  svd(matrix: string): { U: string; S: string; V: string };

  /** Eigenvalues (and eigenvectors). Partial on defective matrices. */
  eigs(matrix: string): EngineResult;

  /** Matrix exponential. */
  expm(matrix: string): string;

  /** Matrix square root. */
  sqrtm(matrix: string): string;

  /** Solve linear system Ax = b via LU. */
  lusolve(matrix: string, b: string): string;

  /** Reduced Row Echelon Form — STUBBED (SymPy Wave 3). */
  rref(matrix: string): EngineResult;

  /** Matrix rank — STUBBED (SymPy Wave 3). */
  rank(matrix: string): EngineResult;

  // ── Number Theory ──────────────────────────────────────────────────
  /** Greatest common divisor of two integers. */
  gcd(a: number, b: number): number;

  /** Least common multiple of two integers. */
  lcm(a: number, b: number): number;

  /** Modulo (positive remainder). */
  mod(a: number, b: number): number;

  /** Modular inverse: a^(-1) mod m. */
  invmod(a: number, m: number): number;

  /** Primality test. */
  isPrime(n: number): boolean;

  // ── Polynomials ────────────────────────────────────────────────────
  /**
   * Find numerical roots of a polynomial.
   * Coefficients are given from highest degree to constant term.
   */
  polynomialRoot(...coeffs: number[]): number[];

  // ── Complex Numbers ────────────────────────────────────────────────
  /** Create a complex number as an opaque handle. */
  complex(re: number, im: number): EngineNode;

  /** Serialize a complex node handle to its string form (e.g. "3 + 4i"). */
  complexToString(node: EngineNode): string;
}
