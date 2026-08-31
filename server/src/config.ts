export const sympyEnabled: boolean = process.env.USE_SYMPY === 'true';
export const sympyUrl: string = process.env.SYMPY_URL ?? 'http://localhost:2569';
