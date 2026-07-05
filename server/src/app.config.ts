import colyseus from 'colyseus';
import http from 'http';

const { Server } = colyseus as unknown as { Server: new (opts?: Record<string, unknown>) => { listen: (port: number) => void } };

/**
 * App configuration for the Colyseus server.
 *
 * TODO: Register rooms and middleware here (Wave 2).
 */
export function appConfig(httpServer: http.Server): { listen: (port: number) => void } {
  return new Server({});
}
