# Math Engine Capability Matrix — v1. FROZEN scope: math.js GREEN/YELLOW + SymPy stubs RED. Do not extend without plan revision.

| Method | Implemented By | Status | Notes |
|---|---|---|---|
| parse | math.js | GREEN | `math.parse(str)` → opaque `EngineNode` |
| toString | math.js | GREEN | unwrap + `node.toString()` |
| evaluate | math.js | GREEN | `parse` → `compile` → `evaluate(scope)`; numbers returned directly, Complex/Matrix wrapped |
| derivative | math.js | GREEN | `math.derivative(node, var)` |
| integrate | stub | RED | SymPy Wave 3; returns `supported: false` |
| limit | stub | RED | SymPy Wave 3; returns `supported: false` |
| continuityCheck | stub | RED | SymPy Wave 3; returns `supported: false` |
| simplify | math.js | GREEN | `math.simplify(node)` |
| rationalize | math.js | GREEN | `math.rationalize(node)` |
| symbolicEqual | math.js | GREEN | `math.symbolicEqual(nodeA, nodeB)` |
| det | math.js | GREEN | `math.det(matrix)` |
| inv | math.js | GREEN | `math.inv(matrix)` |
| lup | math.js | GREEN | `math.lup(matrix)` → `{ L, U, p }` (p = permutation vector) |
| qr | math.js | GREEN | `math.qr(matrix)` → `{ Q, R }` |
| svd | math.js | YELLOW | Custom via eigs of A*A^T + A^T*A; returns identity fallback on failure |
| eigs | math.js | YELLOW | Works for diagonalizable matrices; fails on defective (returns `ok: false`) |
| expm | math.js | GREEN | `math.expm(matrix)` via Padé approximant |
| sqrtm | math.js | GREEN | `math.sqrtm(matrix)` |
| lusolve | math.js | GREEN | `math.lusolve(A, b)` |
| rref | stub | RED | SymPy Wave 3 or custom TS later; returns `supported: false` |
| rank | stub | RED | SymPy Wave 3; returns `supported: false` |
| gcd | math.js | GREEN | `math.gcd(a, b)` |
| lcm | math.js | GREEN | `math.lcm(a, b)` |
| mod | math.js | GREEN | `math.mod(a, b)` — positive remainder |
| invmod | math.js | GREEN | Computed via `math.xgcd(a, m)` |
| isPrime | math.js | GREEN | `math.isPrime(n)` |
| polynomialRoot | math.js | GREEN | `math.polynomialRoot(c0, c1, c2?, c3?)`; coeffs reversed (NerdCard: hi→lo, mathjs: lo→hi); complex roots use real part |
| complex | math.js | GREEN | `math.complex(re, im)` → opaque `EngineNode` |
| complexToString | math.js | GREEN | unwrap + `complex.toString()` |
