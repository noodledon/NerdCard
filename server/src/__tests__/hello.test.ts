import { describe, expect, it } from 'vitest';
import colyseus from 'colyseus';
import { appConfig } from '../app.config.js';
import http from 'http';

const { Server } = colyseus as unknown as { Server: new (opts?: Record<string, unknown>) => { listen: (port: number) => void } };

describe('appConfig', () => {
  it('is a function that returns a Server instance', () => {
    const mockServer = { on: () => undefined, once: () => undefined } as unknown as http.Server;
    // startBridge: false keeps the test from binding :2568, so the suite
    // coexists with a running dev server.
    const result = appConfig(mockServer, { startBridge: false });
    expect(result).toHaveProperty('listen');
    expect(result).toHaveProperty('jsonBridge');
  });
});
