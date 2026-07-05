import { describe, expect, it } from 'vitest';
import colyseus from 'colyseus';
import { appConfig } from '../app.config.js';
import http from 'http';

const { Server } = colyseus as unknown as { Server: new (opts?: Record<string, unknown>) => { listen: (port: number) => void } };

describe('appConfig', () => {
  it('is a function that returns a Server instance', () => {
    const mockServer = {} as http.Server;
    const result = appConfig(mockServer);
    expect(result).toHaveProperty('listen');
  });
});
