import { sympyUrl } from '../config.js';
import type { EngineResult } from './engine.js';
import { mathjsEngine } from './mathjs-engine.js';

interface SympySuccessBody {
  ok: true;
  supported: true;
  value: string;
  operation: string;
}

interface SympyFailureBody {
  ok: false;
  supported: false;
  reason: string;
  operation: string;
}

type SympyBody = SympySuccessBody | SympyFailureBody;

function isSympyBody(value: unknown): value is SympyBody {
  if (typeof value !== 'object' || value === null) return false;
  if (!('ok' in value) || typeof value.ok !== 'boolean') return false;
  if (!('supported' in value) || typeof value.supported !== 'boolean') return false;
  if (!('operation' in value) || typeof value.operation !== 'string') return false;
  if (value.ok) return 'value' in value && typeof value.value === 'string';
  return 'reason' in value && typeof value.reason === 'string';
}

const TIMEOUT_MS = 5000;

async function callSympy(
  operation: string,
  body: Record<string, unknown>,
): Promise<EngineResult> {
  try {
    const response = await fetch(`${sympyUrl}/${operation}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      return { ok: false, supported: false, reason: 'computation error' };
    }
    const json: unknown = await response.json();
    if (!isSympyBody(json)) {
      return { ok: false, supported: false, reason: 'computation error' };
    }
    if (json.ok) {
      return { ok: true, supported: true, value: json.value };
    }
    return { ok: false, supported: false, reason: json.reason };
  } catch {
    return { ok: false, supported: false, reason: 'computation error' };
  }
}

export const sympyEngine = {
  parse: mathjsEngine.parse,
  toString: mathjsEngine.toString,
  evaluate: mathjsEngine.evaluate,
  derivative: mathjsEngine.derivative,

  integrate(expr: string, variable: string): Promise<EngineResult> {
    return callSympy('integrate', { expr, variable });
  },

  limit(
    expr: string,
    variable: string,
    approach: number | string,
  ): Promise<EngineResult> {
    return callSympy('limit', { expr, variable, point: approach });
  },

  continuityCheck(
    expr: string,
    variable: string,
    point: number,
  ): Promise<EngineResult> {
    return callSympy('continuity', { expr, variable, point });
  },

  simplify: mathjsEngine.simplify,
  rationalize: mathjsEngine.rationalize,
  symbolicEqual: mathjsEngine.symbolicEqual,
  det: mathjsEngine.det,
  inv: mathjsEngine.inv,
  lup: mathjsEngine.lup,
  qr: mathjsEngine.qr,
  svd: mathjsEngine.svd,
  eigs: mathjsEngine.eigs,
  expm: mathjsEngine.expm,
  sqrtm: mathjsEngine.sqrtm,
  lusolve: mathjsEngine.lusolve,

  rref(matrix: string): Promise<EngineResult> {
    return callSympy('rref', { matrix });
  },

  rank(matrix: string): Promise<EngineResult> {
    return callSympy('rank', { matrix });
  },

  gcd: mathjsEngine.gcd,
  lcm: mathjsEngine.lcm,
  mod: mathjsEngine.mod,
  invmod: mathjsEngine.invmod,
  isPrime: mathjsEngine.isPrime,
  polynomialRoot: mathjsEngine.polynomialRoot,
  complex: mathjsEngine.complex,
  complexToString: mathjsEngine.complexToString,
};
