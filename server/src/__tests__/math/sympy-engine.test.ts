import { afterEach, describe, expect, it, vi } from 'vitest';
import { sympyUrl } from '../../config.js';
import { sympyEngine } from '../../math/sympy-engine.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sympyEngine HTTP adapter', () => {
  it('maps a successful response to EngineResult', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      supported: true,
      value: 'x**3/3',
      operation: 'integrate',
    }), { status: 200 })));

    await expect(sympyEngine.integrate('x^2', 'x')).resolves.toEqual({
      ok: true,
      supported: true,
      value: 'x**3/3',
    });
    expect(fetch).toHaveBeenCalledWith(
      `${sympyUrl}/integrate`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ expr: 'x^2', variable: 'x' }),
      }),
    );
  });

  it('preserves a service failure reason', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      supported: false,
      reason: 'unsupported expression',
      operation: 'limit',
    }), { status: 200 })));

    await expect(sympyEngine.limit('f(x)', 'x', 0)).resolves.toEqual({
      ok: false,
      supported: false,
      reason: 'unsupported expression',
    });
  });

  it.each([
    new Response('not json', { status: 500 }),
    new Response(JSON.stringify({ ok: true }), { status: 200 }),
  ])('normalizes transport and malformed response failures', async (response) => {
    vi.stubGlobal('fetch', vi.fn(async () => response));

    await expect(sympyEngine.rank('[[1]]')).resolves.toEqual({
      ok: false,
      supported: false,
      reason: 'computation error',
    });
  });
});
