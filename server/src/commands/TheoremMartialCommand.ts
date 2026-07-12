import { AttackHpCommand, type AttackHpPayload } from './AttackHpCommand.js';

export class TheoremMartialCommand extends AttackHpCommand {
  execute(payload: AttackHpPayload) {
    return super.execute(payload);
  }
}
