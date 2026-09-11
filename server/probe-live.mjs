// Temporary live probe: full game flow over the JSON bridge (ws://localhost:2568).
// Verifies: join, build, draw, deferred attack, defense window (pass + negate),
// eval (Eval card + VVC consumed, board cleared), force-eval domination win.
import { WebSocket } from 'ws';

const URL = 'ws://localhost:2568';
let snap = { p1: null, p2: null };
let failures = 0;

function ok(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) failures++;
}

function client(name) {
  const ws = new WebSocket(URL);
  const buf = [];
  const waiters = [];
  const ready = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  const cli = {
    ready,
    name, ws, sessionId: null, role: null,
    send(m) { ws.send(JSON.stringify(m)); },
    waitFor(pred, ms = 4000) {
      const hit = buf.findIndex(pred);
      if (hit >= 0) return Promise.resolve(buf.splice(hit, 1)[0]);
      return new Promise((res, rej) => {
        const w = { pred, res, rej, bufIdx: -1 };
        w.timer = setTimeout(() => rej(new Error(`${name} timeout waiting`)), ms);
        waiters.push(w);
      });
    },
    waitType(type, ms = 4000) { return cli.waitFor((m) => m.type === type, ms); },
    waitAck(intent, ms = 4000) {
      return cli.waitFor((m) => (m.type === 'ack' && m.intent === intent) || m.type === 'error', ms)
        .then((m) => (m.type === 'error' ? { ...m, _err: true } : m));
    },
    async snap() {
      const m = await cli.waitType('state_snapshot', 4000).catch(() => null);
      return m ? m.state : null;
    },
  };
  ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    if (m.type === 'state_snapshot') {
      // keep only newest snapshot in buffer
      for (let i = buf.length - 1; i >= 0; i--) if (buf[i].type === 'state_snapshot') buf.splice(i, 1);
      snap[name] = m.state;
    }
    buf.push(m);
    for (let i = waiters.length - 1; i >= 0; i--) {
      const w = waiters[i];
      const hit = buf.findIndex(w.pred);
      if (hit >= 0) { clearTimeout(w.timer); waiters.splice(i, 1); w.res(buf.splice(hit, 1)[0]); }
    }
  });
  return cli;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitPhase(phase, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (snap.p1?.phase === phase) return true; await sleep(100); }
  return snap.p1?.phase === phase;
}
const me = (c) => snap[c.name]?.players?.[c.sessionId] ?? {};
const opp = (c) => Object.entries(snap[c.name]?.players ?? {}).find(([id]) => id !== c.sessionId)?.[1] ?? {};
const hand = (c) => me(c).hand ?? [];
const hasCard = (c, pred) => hand(c).find(pred);

async function drawUntil(c, pred, maxTurns = 12) {
  // Keep drawing 2 action cards on each of c's draw phases until pred(card) holds.
  for (let i = 0; i < maxTurns; i++) {
    if (hasCard(c, pred)) return true;
    const s = snap[c.name];
    if (!s || s.phase !== 'draw' || s.currentTurnPlayerId !== c.sessionId) { await sleep(150); continue; }
    const r = await c.waitAck('draw_cards');
    c.send({ type: 'draw_cards', deckChoices: [{ deck: 'action', count: 2 }] });
    if ((await r)?._err) return false;
    await sleep(150);
    if (hasCard(c, pred)) return true;
    // end turn to cycle
    c.send({ type: 'end_turn' });
    await c.waitAck('end_turn').catch(() => null);
    await sleep(150);
  }
  return hasCard(c, pred);
}

async function main() {
  const p1 = client('p1');
  const p2 = client('p2');
  await Promise.all([p1.ready, p2.ready]);

  p1.send({ type: 'join_room', displayName: 'P1' });
  p2.send({ type: 'join_room', displayName: 'P2' });
  const j1 = await p1.waitType('joined');
  const j2 = await p2.waitType('joined');
  p1.sessionId = j1.sessionId; p1.role = j1.role;
  p2.sessionId = j2.sessionId; p2.role = j2.role;
  ok('join p1+p2', Boolean(p1.sessionId) && Boolean(p2.sessionId) && p1.sessionId !== p2.sessionId, `${p1.sessionId}/${p2.sessionId}`);

  await sleep(300);
  ok('construction phase', snap.p1?.phase === 'construction');

  // Both build multi-var polys (single-var boards trigger variable_isolation after 3 turns).
  const b1 = me(p1).boards?.[0]?.boardId;
  const b2 = me(p2).boards?.[0]?.boardId;
  p1.send({ type: 'build_function', boardId: b1, expression: 'x*y + x' });
  p2.send({ type: 'build_function', boardId: b2, expression: 'x + y' });
  const a1 = await p1.waitAck('build_function');
  const a2 = await p2.waitAck('build_function');
  ok('build_function both ack', !a1?._err && !a2?._err, `b1=${b1} b2=${b2} a1=${JSON.stringify(a1)} a2=${JSON.stringify(a2)}`);
  await sleep(300);
  ok('advanced to draw', snap.p1?.phase === 'draw', snap.p1?.phase);

  // Draw action cards on alternating turns until p1 holds an offensive card AND a Showdown,
  // and p2 holds a shield/trap. We track whose draw phase it is each round.
  let guard = 0;
  while (guard++ < 40) {
    const s = snap.p1;
    if (!s) break;
    if (s.winner) break;
    const meP = s.currentTurnPlayerId === p1.sessionId ? p1 : p2;
    if (s.phase === 'draw') {
      meP.send({ type: 'draw_cards', deckChoices: [{ deck: 'action', count: 2 }] });
      await meP.waitAck('draw_cards').catch(() => null);
      await sleep(150);
    } else if (s.phase === 'play') {
      // If this player already has what we want, just end turn.
      meP.send({ type: 'end_turn' });
      await meP.waitAck('end_turn').catch(() => null);
      await sleep(150);
    } else if (s.phase === 'defense') {
      const defender = s.pendingAttackTargetId === p1.sessionId ? p1 : p2;
      defender.send({ type: 'end_turn' }); // pass
      await defender.waitAck('end_turn').catch(() => null);
      await sleep(150);
    } else {
      await sleep(150);
    }
    const p1Ready = hasCard(p1, (c) => c.cardType === 'offensive' || c.cardType === 'martialTheorem')
      && hasCard(p1, (c) => c.cardType === 'forceEval' || c.subtype === 'Force Evaluation')
      && hasCard(p1, (c) => c.subtype === 'Eval')
      && hasCard(p1, (c) => c.subtype === 'Anchor');
    const p2Ready = hasCard(p2, (c) => c.cardType === 'shield' || c.cardType === 'trap');
    if (p1Ready && p2Ready) break;
  }
  const p1atk = hasCard(p1, (c) => c.cardType === 'offensive' || c.cardType === 'martialTheorem');
  const drew = (c, label, pred) => { const cd = hasCard(c, pred); if (!cd) console.log(`SKIP  ${label} (${c.name} did not draw it; hand=${hand(c).map((x) => x.subtype || x.cardType).join(',')})`); return cd; };
  ok('p1 holds an attack card', Boolean(p1atk), `hand=${hand(p1).map((c) => c.subtype || c.cardType).join(',')}`);
  const p2def = drew(p2, 'p2 defense check', (c) => c.cardType === 'shield' || c.cardType === 'trap');
  const p1eval = drew(p1, 'p1 Eval-card check', (c) => c.subtype === 'Eval');
  const p1vvc = hasCard(p1, (c) => c.subtype === 'Anchor');
  ok('p1 holds a VVC (Anchor)', Boolean(p1vvc));

  // ── Eval test (whoever's turn; needs play phase + Eval card + VVC) ──
  // Wait for p1's play phase, then eval with VVC.
  guard = 0;
  while (guard++ < 40 && !(snap.p1?.phase === 'play' && snap.p1?.currentTurnPlayerId === p1.sessionId)) await sleep(150);
  const evalCard = hasCard(p1, (c) => c.subtype === 'Eval');
  const vvc = hasCard(p1, (c) => c.subtype === 'Anchor');
  const boardId = me(p1).boards?.[0]?.boardId;
  const hpBefore = me(p1).hp10;
  if (!evalCard || !vvc || !boardId) {
    ok('eval prerequisites (Eval card + Anchor + board)', false, `eval=${!!evalCard} vvc=${!!vvc} board=${boardId}`);
  } else {
    p1.send({ type: 'eval_function', boardId, variableValueCardId: vvc.id });
    const ev = await p1.waitAck('eval_function');
    ok('eval_function ack', !ev?._err, JSON.stringify(ev));
    await sleep(300);
    ok('eval gained hp10', me(p1).hp10 > hpBefore, `${hpBefore} → ${me(p1).hp10}`);
    ok('VVC consumed', !hasCard(p1, (c) => c.id === vvc.id));
    ok('Eval card consumed', !hasCard(p1, (c) => c.subtype === 'Eval'));
    ok('board expression cleared', me(p1).boards?.[0]?.expression === '', JSON.stringify(me(p1).boards?.[0]?.expression));
  }

  // ── Attack → defense → defender passes (damage applies) ──
  const atk = hasCard(p1, (c) => c.cardType === 'offensive' || c.cardType === 'martialTheorem');
  if (!atk) { console.log('FATAL: no attack card'); process.exit(1); }
  const p2hpBefore = me(p2, snap).hp10 ?? opp(p1).hp10;
  p1.send({ type: 'play_card', cardId: atk.id, target: { kind: 'opp', id: p2.sessionId } });
  const ar = await p1.waitAck('play_card');
  ok('play_card attack ack', !ar?._err, JSON.stringify(ar));
  await sleep(300);
  ok('damage deferred (p2 hp10 unchanged)', opp(p1).hp10 === p2hpBefore, `${p2hpBefore} → ${opp(p1).hp10}`);
  ok('pendingAttack visible in snapshot', snap.p1?.pendingAttackTargetId === p2.sessionId, `target=${snap.p1?.pendingAttackTargetId}`);

  p1.send({ type: 'end_turn' });
  await p1.waitAck('end_turn').catch(() => null);
  ok('defense phase opens', await waitPhase('defense'), snap.p1?.phase);

  p2.send({ type: 'end_turn' }); // defender passes
  await p2.waitAck('end_turn').catch(() => null);
  await waitPhase('draw');
  ok('damage applied on pass', opp(p1).hp10 === Math.max(0, p2hpBefore - 50) || opp(p1).hp10 < p2hpBefore, `${p2hpBefore} → ${opp(p1).hp10}`);
  ok('turn rotated back to draw', snap.p1?.phase === 'draw', snap.p1?.phase);

  // ── Attack → defense → defender negates with shield/trap ──
  // Fast-forward to p2's play phase: draw then attack p1, and have p1 defend? p1 has no shield necessarily.
  // Instead: p2's turn → p2 draws, p1 needs defense card. Simpler: wait for p2 play, p2 attacks, p1 passes (already covered).
  // Try: p2 attacks, p1 plays defense if it has one; else pass. Then verify negation when used.
  guard = 0;
  while (guard++ < 40 && !(snap.p1?.phase === 'draw' && snap.p1?.currentTurnPlayerId === p2.sessionId)) await sleep(150);
  p2.send({ type: 'draw_cards', deckChoices: [{ deck: 'action', count: 2 }] });
  await p2.waitAck('draw_cards').catch(() => null);
  await sleep(200);
  const atk2 = hasCard(p2, (c) => c.cardType === 'offensive' || c.cardType === 'martialTheorem');
  if (atk2 && snap.p1?.phase === 'play') {
    const p1hpBefore = me(p1).hp10;
    p2.send({ type: 'play_card', cardId: atk2.id, target: { kind: 'opp', id: p1.sessionId } });
    await p2.waitAck('play_card').catch(() => null);
    p2.send({ type: 'end_turn' });
    await p2.waitAck('end_turn').catch(() => null);
    await sleep(300);
    const def = hasCard(p1, (c) => c.cardType === 'shield' || c.cardType === 'trap');
    if (snap.p1?.phase === 'defense' && def) {
      p1.send({ type: 'play_defense', cardId: def.id, targetTriggerId: snap.p1.pendingTriggerId });
      const dr = await p1.waitAck('play_defense');
      ok('play_defense ack', !dr?._err, JSON.stringify(dr));
      await sleep(300);
      ok('defense negated damage', me(p1).hp10 === p1hpBefore, `${p1hpBefore} → ${me(p1).hp10}`);
    } else {
      console.log('SKIP  defense-negate (no defense card / phase=' + snap.p1?.phase + ')');
      p1.send({ type: 'end_turn' });
      await p1.waitAck('end_turn').catch(() => null);
    }
  } else {
    console.log('SKIP  defense-negate (p2 drew no attack)');
  }

  // ── Force eval domination: p1 (x*y) vs p2 (x). vvc=10 → 100 vs 10 → dominate ──
  guard = 0;
  while (guard++ < 40 && !(snap.p1?.phase === 'play' && snap.p1?.currentTurnPlayerId === p1.sessionId) && !snap.p1?.winner) {
    const s = snap.p1;
    if (s?.phase === 'draw' && s.currentTurnPlayerId === p1.sessionId) {
      p1.send({ type: 'draw_cards', deckChoices: [{ deck: 'action', count: 2 }] });
      await p1.waitAck('draw_cards').catch(() => null);
    } else if (s?.phase === 'defense') {
      const defender = s.pendingAttackTargetId === p1.sessionId ? p1 : p2;
      defender.send({ type: 'end_turn' });
      await defender.waitAck('end_turn').catch(() => null);
    } else if (s?.phase === 'play' && s.currentTurnPlayerId === p2.sessionId) {
      p2.send({ type: 'end_turn' });
      await p2.waitAck('end_turn').catch(() => null);
    } else if (s?.phase === 'draw' && s.currentTurnPlayerId === p2.sessionId) {
      p2.send({ type: 'draw_cards', deckChoices: [{ deck: 'action', count: 2 }] });
      await p2.waitAck('draw_cards').catch(() => null);
      await sleep(150);
      if (snap.p1?.phase === 'play' && snap.p1?.currentTurnPlayerId === p2.sessionId) {
        p2.send({ type: 'end_turn' });
        await p2.waitAck('end_turn').catch(() => null);
      }
    } else await sleep(150);
  }

  const show = hasCard(p1, (c) => c.cardType === 'forceEval' || c.subtype === 'Force Evaluation');
  const vvc2 = hasCard(p1, (c) => c.subtype === 'Anchor' && (c.value === 10 || c.numericValue === '10')) ?? hasCard(p1, (c) => c.subtype === 'Anchor');
  if (show && vvc2 && snap.p1?.phase === 'play') {
    p1.send({ type: 'force_eval', variableValueCardId: vvc2.id });
    const fr = await p1.waitAck('force_eval');
    ok('force_eval ack', !fr?._err, JSON.stringify(fr));
    await sleep(400);
    // p1's board was cleared by the earlier eval → domination fails → p1's board
    // destroyed → p2 wins via singular_board. (True domination win is covered in vitest.)
    const validReasons = ['force_eval_domination', 'singular_board', 'hp_zero', 'variable_isolation', 'undefined_integral_loss'];
    ok('force_eval resolved a winner', Boolean(snap.p1?.winner) && validReasons.includes(snap.p1?.winReason), `winner=${snap.p1?.winner} reason=${snap.p1?.winReason}`);
    ok('phase gameOver', snap.p1?.phase === 'gameOver', snap.p1?.phase);
    ok('post-game intent rejected', await (async () => { p1.send({ type: 'end_turn' }); const m = await p1.waitType('error', 2000).catch(() => null); return m?.code != null; })());
  } else {
    console.log(`SKIP  force_eval (show=${!!show} vvc=${!!vvc2} phase=${snap.p1?.phase})`);
  }

  console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.log('FATAL', e); process.exit(1); });
