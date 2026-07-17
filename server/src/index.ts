import colyseus from 'colyseus';
import http from 'http';
import { appConfig } from './app.config.js';

const { Server } = colyseus as unknown as { Server: new (opts?: Record<string, unknown>) => { listen: (port: number) => void } };

const PORT = 2567;
const server = http.createServer();
const { listen } = appConfig(server);

listen(PORT);

console.log(`NerdiClash server listening on :${PORT}`);
