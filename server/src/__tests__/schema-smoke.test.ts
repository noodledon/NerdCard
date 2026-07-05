import { describe, expect, it } from 'vitest';
import { Schema, type } from '@colyseus/schema';

describe('schema-smoke', () => {
  it('decorator + encode/roundtrip works', () => {
    class HP extends Schema {
      @type('number')
      hp!: number;
    }

    const obj = new HP();
    obj.hp = 0;

    const encoded = obj.encode();
    const decoded = new HP();
    decoded.decode(encoded);

    expect(decoded.hp).toBe(0);
  });
});
