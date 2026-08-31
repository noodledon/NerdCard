import { mathjsEngine } from './mathjs-engine.js';
import { sympyEngine } from './sympy-engine.js';

export const hybridEngine = {
  ...mathjsEngine,

  integrate: sympyEngine.integrate,
  limit: sympyEngine.limit,
  continuityCheck: sympyEngine.continuityCheck,
  rref: sympyEngine.rref,
  rank: sympyEngine.rank,
};
