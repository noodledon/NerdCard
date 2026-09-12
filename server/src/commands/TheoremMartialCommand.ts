import { AttackHpCommand, type AttackHpPayload } from './AttackHpCommand.js';

/**
 * Pythagoras Strike (act-martial-theorem-001). Catalog carries
 * `requires: ['right_triangle_board']` — pinned as documented flavor: no
 * domain produces a "right triangle" board in v1, so there is no
 * precondition. The card resolves as a plain catalog-damage attack.
 */
export class TheoremMartialCommand extends AttackHpCommand {
  execute(payload: AttackHpPayload) {
    return super.execute(payload);
  }
}
