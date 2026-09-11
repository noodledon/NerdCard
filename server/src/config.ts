export const sympyEnabled: boolean = process.env.USE_SYMPY === 'true';
export const sympyUrl: string = process.env.SYMPY_URL ?? 'http://localhost:2569';

const envBridgePort = Number.parseInt(process.env.BRIDGE_PORT ?? '', 10);
export const bridgePort: number = Number.isNaN(envBridgePort) ? 2568 : envBridgePort;
