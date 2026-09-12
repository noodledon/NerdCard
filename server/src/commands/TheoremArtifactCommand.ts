import {
  failure, getPlayer, isFailure, moveCardToGraveyard, phaseAllowed,
  requiredCard, success, type CommandResult, GameCommand,
} from './base.js';

export interface TheoremArtifactPayload { playerId: string; cardId: string; }

export class TheoremArtifactCommand extends GameCommand<TheoremArtifactPayload> {
  execute({ playerId, cardId }: TheoremArtifactPayload): CommandResult {
    const state = this.gameState();
    if (!phaseAllowed(state, ['play'])) return failure('artifact theorem only in play');
    const player = getPlayer(state, playerId);
    if (!player) return failure('player not found');
    const card = requiredCard(player, cardId);
    if (isFailure(card)) return card;
    // Euler's Ward: persistent passive — the flag is a real @type field
    // synced to snapshots; the halving itself lives in
    // NerdiClashGame.applyPendingAttack (after shield absorb).
    player.artifactTheoremActive = true;
    moveCardToGraveyard(player, cardId);
    return success();
  }
}
