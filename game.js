'use strict';

// Independent clean-room game logic. All measurements are in canvas pixels.
const WIDTH = 960;
const HEIGHT = 720;
const FIELD = Object.freeze({ left: 92, right: 868, top: 118, bottom: 633 });
const BALL_R = 24;
const MAX_POWER = 1050;
const POCKETS = Object.freeze([
  { side: 'top', center: 264, half: 52, effect: 'ice' },
  { side: 'top', center: 696, half: 52, effect: 'hammer' },
  { side: 'bottom', center: 264, half: 52, effect: 'laser' },
  { side: 'bottom', center: 696, half: 52, effect: 'water' },
  { side: 'left', center: 377, half: 63, effect: 'fire' },
  { side: 'right', center: 377, half: 63, effect: 'spark' }
]);

function newPieces(layout = 0) {
  const disks = [];
  const add = (owner, x, y) => disks.push({ id: `p${owner}-${disks.filter(x => x.owner === owner).length}`, owner, x, y, vx: 0, vy: 0, alive: true, r: BALL_R });
  if (layout % 3 === 0) {
    const ys = [186, 260, 334, 408, 482, 556];
    ys.forEach((y, i) => { add(0, i % 2 ? 328 : 245, y); add(1, i % 2 ? 632 : 715, y); });
  } else if (layout % 3 === 1) {
    for (let i = 0; i < 12; i++) {
      const a = (Math.PI * 2 * i / 12) - Math.PI / 2;
      add(i % 2, 480 + Math.cos(a) * 209, 379 + Math.sin(a) * 177);
    }
  } else {
    const coords = [[247,258],[309,206],[309,316],[247,424],[309,477],[376,370]];
    coords.forEach(([x,y]) => add(0,x,y));
    coords.forEach(([x,y]) => add(1,960-x,751-y));
  }
  return disks;
}

function initGame(layout = 0) {
  return { pieces: newPieces(layout), turn: 0, phase: 'playing', winner: null, shots: 0, frame: 0, quiet: 0, events: [], layout, lastAction: '', lastShotBy: null, lastHitFrame: -200 };
}

function validShot(game, owner, pieceId, vx, vy) {
  if (game.phase !== 'playing') return 'Schuss gerade nicht moeglich.';
  if (owner !== game.turn) return 'Du bist noch nicht am Zug.';
  const p = game.pieces.find(d => d.id === pieceId && d.alive);
  if (!p || p.owner !== owner) return 'Waehle eines deiner Tiere.';
  if (!Number.isFinite(vx) || !Number.isFinite(vy)) return 'Ungueltiger Schuss.';
  const mag = Math.hypot(vx,vy);
  if (mag < 36 || mag > MAX_POWER + 1) return 'Schusskraft ausserhalb des gueltigen Bereichs.';
  return null;
}

function shoot(game, owner, pieceId, vx, vy) {
  const error = validShot(game, owner, pieceId, vx, vy);
  if (error) return error;
  const piece = game.pieces.find(p => p.id === pieceId);
  piece.vx = vx; piece.vy = vy;
  game.phase = 'moving'; game.quiet = 0; game.frame = 0;
  game.shots += 1; game.lastShotBy = owner;
  game.lastAction = `Schuss ${game.shots}`;
  game.events.push({ seq: game.shots * 1000, type: 'shot', owner, x: piece.x, y: piece.y });
  return null;
}

function pocketAt(side, pos) {
  return POCKETS.find(p => p.side === side && Math.abs(p.center - pos) <= p.half - 3) || null;
}

function pocket(game, piece, hazard) {
  if (!piece.alive) return;
  piece.alive = false;
  piece.vx = 0; piece.vy = 0;
  game.events.push({ seq: game.shots * 1000 + game.events.length + 1, type:'pocket', owner: piece.owner, effect: hazard.effect, side: hazard.side, x: piece.x, y: piece.y });
}

function advance(game, dt = 1 / 60) {
  if (game.phase !== 'moving') return;
  dt = Math.min(Math.max(dt, 1 / 120), 1 / 30);
  const active = game.pieces.filter(p => p.alive);
  const damping = Math.pow(0.987, dt * 60);
  for (const p of active) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= damping;
    p.vy *= damping;
  }

  for (let i = 0; i < active.length; i++) {
    const a = active[i];
    for (let j = i + 1; j < active.length; j++) {
      const b = active[j];
      let dx = b.x - a.x, dy = b.y - a.y;
      const dd = dx*dx + dy*dy;
      if (dd >= BALL_R*BALL_R*4) continue;
      let dist = Math.sqrt(dd);
      if (dist < 0.00001) { dx = 1; dy = 0; dist = 1; }
      const nx = dx / dist, ny = dy / dist;
      const overlap = 2 * BALL_R - dist;
      a.x -= nx * overlap * .505; a.y -= ny * overlap * .505;
      b.x += nx * overlap * .505; b.y += ny * overlap * .505;
      const rel = (b.vx-a.vx)*nx + (b.vy-a.vy)*ny;
      if (rel < -110 && game.frame - game.lastHitFrame > 8) {
        game.events.push({ seq: game.shots * 1000 + game.events.length + 1, type: 'hit', x:(a.x+b.x)/2, y:(a.y+b.y)/2 });
        game.lastHitFrame = game.frame;
      }
      if (rel < 0) {
        const impulse = -1.88 * rel / 2;
        a.vx -= impulse * nx; a.vy -= impulse * ny;
        b.vx += impulse * nx; b.vy += impulse * ny;
      }
    }
  }

  for (const p of active) {
    if (p.y < FIELD.top + BALL_R) {
      const hole = pocketAt('top', p.x);
      if (hole) { if (p.y < FIELD.top - BALL_R*.62) { pocket(game,p,hole); continue; } }
      else { p.y = FIELD.top + BALL_R; p.vy = Math.abs(p.vy) * .84; }
    }
    if (p.y > FIELD.bottom - BALL_R) {
      const hole = pocketAt('bottom', p.x);
      if (hole) { if (p.y > FIELD.bottom + BALL_R*.62) { pocket(game,p,hole); continue; } }
      else { p.y = FIELD.bottom - BALL_R; p.vy = -Math.abs(p.vy) * .84; }
    }
    if (p.x < FIELD.left + BALL_R) {
      const hole = pocketAt('left', p.y);
      if (hole) { if (p.x < FIELD.left - BALL_R*.62) { pocket(game,p,hole); continue; } }
      else { p.x = FIELD.left + BALL_R; p.vx = Math.abs(p.vx) * .84; }
    }
    if (p.x > FIELD.right - BALL_R) {
      const hole = pocketAt('right', p.y);
      if (hole) { if (p.x > FIELD.right + BALL_R*.62) { pocket(game,p,hole); continue; } }
      else { p.x = FIELD.right - BALL_R; p.vx = -Math.abs(p.vx) * .84; }
    }
  }

  game.frame += 1;
  const remaining = game.pieces.filter(p => p.alive);
  for (const p of remaining) {
    if (Math.hypot(p.vx,p.vy) < 7) { p.vx = 0; p.vy = 0; }
  }
  const quiet = remaining.every(p => p.vx === 0 && p.vy === 0);
  game.quiet = quiet ? game.quiet + 1 : 0;
  if (game.quiet >= 12 || game.frame > 1050) settle(game);
}

function settle(game) {
  game.pieces.forEach(p => { p.vx = 0; p.vy = 0; });
  const n0 = game.pieces.filter(p => p.alive && p.owner === 0).length;
  const n1 = game.pieces.filter(p => p.alive && p.owner === 1).length;
  if (n0 === 0 || n1 === 0) {
    game.phase = 'finished';
    game.winner = n0 > 0 ? 0 : n1 > 0 ? 1 : -1;
    game.lastAction = game.winner === -1 ? 'Unentschieden!' : `Team ${game.winner + 1} gewinnt!`;
    game.events.push({ seq: game.shots * 1000 + game.events.length + 1, type:'finish', winner: game.winner });
  } else {
    game.phase = 'playing';
    game.turn = 1 - game.turn;
    game.lastAction = `Team ${game.turn+1} ist dran`;
    game.events.push({ seq: game.shots * 1000 + game.events.length + 1, type:'turn', owner: game.turn });
  }
  if (game.events.length > 60) game.events = game.events.slice(-60);
}

function publicGame(game) {
  return {
    pieces: game.pieces.map(({id,owner,x,y,vx,vy,alive}) => ({ id,owner,x:Math.round(x*10)/10,y:Math.round(y*10)/10,vx:Math.round(vx),vy:Math.round(vy),alive })),
    turn: game.turn, phase: game.phase, winner: game.winner, shots: game.shots,
    lastAction: game.lastAction, layout: game.layout, events: game.events.slice(-14),
    remaining: [0,1].map(owner => game.pieces.filter(p => p.owner === owner && p.alive).length)
  };
}

module.exports = { WIDTH,HEIGHT,FIELD,BALL_R,MAX_POWER,POCKETS,initGame,newPieces,validShot,shoot,advance,settle,publicGame,pocketAt };
