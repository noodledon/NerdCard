import { sympyEnabled } from '../config.js';
import { mathjsEngine } from './mathjs-engine.js';
import { hybridEngine } from './hybrid-engine.js';
import type { MathEngine } from './engine.js';

export const mathEngine: MathEngine = sympyEnabled ? hybridEngine : mathjsEngine;

export type { MathEngine, EngineResult, EngineNode } from './engine.js';
