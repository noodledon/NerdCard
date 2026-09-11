import colyseus from 'colyseus';
import http from 'http';
import { NerdiClashRoom } from './rooms/NerdiClashRoom.js';
import { JsonBridgeServer } from './json-bridge.js';
import { bridgePort as defaultBridgePort } from './config.js';

const { Server } = colyseus as unknown as {
  Server: new (opts?: Record<string, unknown>) => {
    define: (name: string, roomClass: typeof NerdiClashRoom) => unknown;
    listen: (port: number) => void;
  };
};

export interface AppConfigOptions {
  /** Port for the JSON bridge WebSocket server. Defaults to BRIDGE_PORT env or 2568. */
  bridgePort?: number;
  /** When false, the bridge is created but does not bind a port (used by tests). */
  startBridge?: boolean;
}

export function appConfig(
  httpServer: http.Server,
  options: AppConfigOptions = {},
): { listen: (port: number) => void; jsonBridge: JsonBridgeServer } {
  const { bridgePort = defaultBridgePort, startBridge = true } = options;

  const server = new Server({});
  server.define('nerdiclash', NerdiClashRoom);

  const jsonBridge = new JsonBridgeServer();
  if (startBridge) {
    jsonBridge.start(bridgePort);
  }

  return { listen: (port: number) => server.listen(port), jsonBridge };
}
