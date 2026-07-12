import colyseus from 'colyseus';
import http from 'http';
import { NerdiClashRoom } from './rooms/NerdiClashRoom.js';

const { Server } = colyseus as unknown as {
  Server: new (opts?: Record<string, unknown>) => {
    define: (name: string, roomClass: typeof NerdiClashRoom) => unknown;
    listen: (port: number) => void;
  };
};

/**
 * App configuration for the Colyseus server.
 *
 * TODO: Register rooms and middleware here (Wave 2).
 */
export function appConfig(httpServer: http.Server): { listen: (port: number) => void } {
  const server = new Server({});
  server.define('nerdiclash', NerdiClashRoom);
  return server;
}
