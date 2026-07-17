import colyseus from 'colyseus';
import http from 'http';
import { NerdiClashRoom } from './rooms/NerdiClashRoom.js';
import { JsonBridgeServer } from './json-bridge.js';

const { Server } = colyseus as unknown as {
  Server: new (opts?: Record<string, unknown>) => {
    define: (name: string, roomClass: typeof NerdiClashRoom) => unknown;
    listen: (port: number) => void;
  };
};

export function appConfig(httpServer: http.Server): { listen: (port: number) => void; jsonBridge: JsonBridgeServer } {
  const server = new Server({});
  server.define('nerdiclash', NerdiClashRoom);

  const jsonBridge = new JsonBridgeServer();
  jsonBridge.start(2568);

  return { listen: (port: number) => server.listen(port), jsonBridge };
}
