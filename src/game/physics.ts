import {
  BallEntity,
  GameEvent,
  PinEntity,
  PocketState,
  RelicId,
  WORLD,
} from '../types';
import { BALL_CATALOG, PIN_CATALOG } from '../data/catalog';
import { stepBallOnRail } from './rail';

export interface PocketCapture {
  ball: BallEntity;
  col: number;
}

export interface PhysicsStepContext {
  balls: BallEntity[];
  pins: PinEntity[];
  pockets: PocketState[];
  reachColumns: boolean[];
  ownedRelics: RelicId[];
  simTime: number;
  nextBallId: () => number;
  onPinballWizardCellOpen: (ball: BallEntity) => void;
  onRelicPulse: (relicId: RelicId) => void;
  onPinHitStat: () => void;
  events: GameEvent[];
}

const SUBSTEPS = 8;
const MAX_FRAME_DT = 0.05;
const POCKET_ENTRY_Y = WORLD.POCKET_TOP + 22; // 514
const DIVIDER_CAP_RADIUS = 4.5;
const DOME_CEILING_CENTER_X = WORLD.DOME_CENTER_X;
const DOME_CEILING_CENTER_Y = WORLD.DOME_CENTER_Y + 2;
const DOME_CEILING_RX = 272;
const DOME_CEILING_RY = 108;
const MAX_BALL_SPEED = 860;
const TRAIL_MAX_POINTS = 14;

function clampSpeed(ball: BallEntity): void {
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed > MAX_BALL_SPEED) {
    const scale = MAX_BALL_SPEED / speed;
    ball.vx *= scale;
    ball.vy *= scale;
  }
}

function findMagnetTargetX(
  ball: BallEntity,
  pockets: PocketState[],
  reachColumns: boolean[]
): number {
  let bestX = 287.5;
  let bestDist = Infinity;
  let foundPreferred = false;

  for (let c = 0; c < pockets.length; c++) {
    const preferred = reachColumns[c] || pockets[c].overdrive;
    if (!preferred) continue;
    foundPreferred = true;
    const dist = Math.abs(ball.x - pockets[c].xCenter);
    if (dist < bestDist) {
      bestDist = dist;
      bestX = pockets[c].xCenter;
    }
  }

  return foundPreferred ? bestX : 287.5;
}

function spawnCloneBall(
  parent: BallEntity,
  vx: number,
  vy: number,
  newId: number,
  hasPrismCore: boolean
): BallEntity {
  const speed = Math.hypot(vx, vy);
  const minSpeed = 180;
  let finalVx = vx;
  let finalVy = vy;
  if (speed > 0 && speed < minSpeed) {
    const scale = minSpeed / speed;
    finalVx *= scale;
    finalVy *= scale;
  }

  const clone: BallEntity = {
    id: newId,
    x: parent.x + (finalVx >= 0 ? 3 : -3),
    y: parent.y,
    vx: finalVx,
    vy: finalVy,
    radius: parent.radius,
    kind: parent.kind === 'MULTI' ? 'STEEL' : parent.kind,
    megaBomb: parent.megaBomb,
    onRail: false,
    railProgress: parent.railProgress,
    railReleaseProgress: parent.railReleaseProgress,
    launchPower: parent.launchPower,
    chips: Math.round(parent.chips * 0.65) + (hasPrismCore ? 80 : 0),
    mult: Number((parent.mult * (hasPrismCore ? 1.25 : 1)).toFixed(4)),
    bounces: parent.bounces,
    splitGen: parent.splitGen + 1,
    stuckTimer: 0,
    lastPinId: parent.lastPinId,
    lastPinTime: parent.lastPinTime,
    trail: [{ x: parent.x, y: parent.y }],
    hitPinIds: [...parent.hitPinIds],
    firstPinHandled: true,
    nextWizardBounce:
      parent.nextWizardBounce ?? Math.floor(parent.bounces / 8) * 8 + 8,
  };

  clampSpeed(clone);
  return clone;
}

function applySplitWithCap(
  parent: BallEntity,
  anglesRad: number[],
  ctx: PhysicsStepContext,
  spawnQueue: BallEntity[],
  label: string
): void {
  const hasPrismCore = ctx.ownedRelics.includes('prism_core');
  const speed = Math.max(240, Math.hypot(parent.vx, parent.vy));
  const baseAngle = Math.atan2(parent.vy, parent.vx);

  if (hasPrismCore) {
    parent.chips += 80;
    parent.mult = Number((parent.mult * 1.25).toFixed(4));
    ctx.onRelicPulse('prism_core');
    ctx.events.push({
      type: 'RELIC_PROC',
      x: parent.x,
      y: parent.y - 12,
      relicId: 'prism_core',
      text: 'プリズム増幅',
      color: '#00ff88',
    });
  }

  const currentTotal = ctx.balls.length + spawnQueue.length;
  let spawned = 0;

  for (const offset of anglesRad) {
    if (currentTotal + spawned < WORLD.MAX_ACTIVE_BALLS) {
      const ang = baseAngle + offset;
      const vx = Math.cos(ang) * speed;
      const vy = Math.sin(ang) * speed;
      const child = spawnCloneBall(
        parent,
        vx,
        vy,
        ctx.nextBallId(),
        hasPrismCore
      );
      spawnQueue.push(child);
      spawned++;
    } else {
      parent.mult = Number((parent.mult * 2.0).toFixed(4));
      parent.chips += 150;
      ctx.events.push({
        type: 'BALL_SPLIT',
        x: parent.x,
        y: parent.y,
        text: 'OVERFLOW x2!',
        color: '#00ff88',
      });
    }
  }

  if (spawned > 0) {
    ctx.events.push({
      type: 'BALL_SPLIT',
      x: parent.x,
      y: parent.y,
      text: label,
      color: '#00ff88',
    });
  }
}

function resolvePinInteraction(
  ball: BallEntity,
  pin: PinEntity,
  ctx: PhysicsStepContext,
  spawnQueue: BallEntity[]
): void {
  const dx = ball.x - pin.x;
  const dy = ball.y - pin.y;
  const distSq = dx * dx + dy * dy;
  const minDist = ball.radius + pin.radius;

  if (distSq >= minDist * minDist) {
    return;
  }

  const dist = Math.sqrt(distSq);
  const nx = dist > 1e-5 ? dx / dist : 0;
  const ny = dist > 1e-5 ? dy / dist : -1;

  // SPINNER is a non-colliding pass-through sensor
  if (pin.kind === 'SPINNER') {
    if (!ball.hitPinIds.includes(pin.id)) {
      ball.hitPinIds.push(pin.id);
      ball.lastPinId = pin.id;
      ball.lastPinTime = ctx.simTime;
      ball.bounces += 1;
      ball.chips += 25;
      ball.mult = Number((ball.mult * 1.4).toFixed(4));
      pin.spinAngle += 2.8;
      pin.hitAnim = 1;
      ctx.onPinHitStat();

      ctx.events.push({
        type: 'PIN_HIT',
        x: pin.x,
        y: pin.y,
        value: 25,
        mult: ball.mult,
        combo: ball.bounces,
        text: 'SPIN x1.4',
        color: PIN_CATALOG.SPINNER.color,
      });

      handleFirstPinHook(ball, ball.kind === 'MULTI', ctx, spawnQueue);
      checkPinballWizard(ball, ctx);
    }
    return;
  }

  // Separate ball cleanly outside the solid pin surface
  const overlap = minDist - dist;
  ball.x += nx * (overlap + 0.12);
  ball.y += ny * (overlap + 0.12);

  const vn = ball.vx * nx + ball.vy * ny;
  if (vn >= 0) {
    return;
  }

  let restitution = 0.76;
  if (pin.kind === 'BUMPER') restitution = 1.32;
  else if (pin.kind === 'SPLITTER' || pin.kind === 'BOMB_PIN') restitution = 0.82;
  else if (pin.kind === 'MAGNET') restitution = 0.78;

  // Reflect velocity along surface normal
  ball.vx -= (1 + restitution) * vn * nx;
  ball.vy -= (1 + restitution) * vn * ny;

  // Micro-deflection & anti-vertical-bounce safeguard
  const jitterAngle =
    Math.abs(nx) < 0.04
      ? (ball.id % 2 === 0 ? 1 : -1) * 0.08
      : (((ball.id * 17 + ball.bounces * 31) % 100) / 100 - 0.5) * 0.06;
  const cosJ = Math.cos(jitterAngle);
  const sinJ = Math.sin(jitterAngle);
  const rvx = ball.vx * cosJ - ball.vy * sinJ;
  const rvy = ball.vx * sinJ + ball.vy * cosJ;
  ball.vx = rvx;
  ball.vy = rvy;

  if (pin.kind === 'BUMPER') {
    const speed = Math.hypot(ball.vx, ball.vy);
    const targetSpeed = Math.min(680, Math.max(360, speed));
    if (speed > 1e-4) {
      ball.vx = (ball.vx / speed) * targetSpeed;
      ball.vy = (ball.vy / speed) * targetSpeed;
    } else {
      ball.vx = nx * 360;
      ball.vy = ny * 360;
    }
  }

  clampSpeed(ball);

  // Avoid over-counting micro-contacts against the same pin within 25ms
  const isFreshHit =
    ball.lastPinId !== pin.id || ctx.simTime - ball.lastPinTime > 0.025;
  if (!isFreshHit) {
    return;
  }

  ball.lastPinId = pin.id;
  ball.lastPinTime = ctx.simTime;
  ball.bounces += 1;
  pin.hitAnim = 1;
  ctx.onPinHitStat();

  const wasMulti = ball.kind === 'MULTI';
  let hitChips = 0;
  let hitText: string | undefined;

  switch (pin.kind) {
    case 'NORMAL':
      hitChips = 15 + ball.bounces * 2;
      ball.chips += hitChips;
      break;
    case 'BUMPER':
      hitChips = 75 + ball.bounces * 4;
      ball.chips += hitChips;
      ball.bounces += 1;
      hitText = `+${hitChips}`;
      break;
    case 'MAGNET':
      hitChips = 40;
      ball.chips += hitChips;
      hitText = '+40';
      break;
    case 'BOMB_PIN':
      hitChips = 35;
      ball.chips += hitChips;
      if (!ball.hitPinIds.includes(pin.id)) {
        ball.hitPinIds.push(pin.id);
        if (ball.kind !== 'BOMB') {
          ball.kind = 'BOMB';
          ball.megaBomb = ctx.ownedRelics.includes('blast_furnace');
          ctx.events.push({
            type: 'BOMB_IGNITE',
            x: ball.x,
            y: ball.y,
            text: ball.megaBomb ? 'MEGA BOMB IGNITE!' : 'BOMB IGNITE!',
            color: BALL_CATALOG.BOMB.color,
          });
        } else if (!ball.megaBomb) {
          ball.megaBomb = true;
          ball.mult = Number((ball.mult * 1.25).toFixed(4));
          ctx.events.push({
            type: 'BOMB_IGNITE',
            x: ball.x,
            y: ball.y,
            text: '3x3 MEGA UPGRADE!',
            color: '#ff2a5f',
          });
        } else {
          ball.mult = Number((ball.mult * 1.25).toFixed(4));
          ctx.events.push({
            type: 'BOMB_IGNITE',
            x: ball.x,
            y: ball.y,
            text: 'BOMB MULT x1.25!',
            color: '#ff2a5f',
          });
        }
      }
      break;
    case 'SPLITTER':
      hitChips = 25;
      ball.chips += hitChips;
      if (!ball.hitPinIds.includes(pin.id) && ctx.simTime >= pin.cooldownUntil) {
        ball.hitPinIds.push(pin.id);
        pin.cooldownUntil = ctx.simTime + 0.12;
        const deg28 = (28 * Math.PI) / 180;
        applySplitWithCap(ball, [-deg28, deg28], ctx, spawnQueue, 'x3 SPLIT!');
      }
      break;
  }

  ctx.events.push({
    type: 'PIN_HIT',
    x: pin.x,
    y: pin.y,
    value: hitChips,
    mult: ball.mult,
    combo: ball.bounces,
    text: hitText,
    color: PIN_CATALOG[pin.kind].color,
  });

  handleFirstPinHook(ball, wasMulti, ctx, spawnQueue);
  checkPinballWizard(ball, ctx);
}

function handleFirstPinHook(
  ball: BallEntity,
  wasMulti: boolean,
  ctx: PhysicsStepContext,
  spawnQueue: BallEntity[]
): void {
  if (ball.firstPinHandled) return;
  ball.firstPinHandled = true;

  if (wasMulti) {
    const deg22 = (22 * Math.PI) / 180;
    applySplitWithCap(ball, [deg22], ctx, spawnQueue, 'TWIN SPLIT!');
  } else if (
    ctx.ownedRelics.includes('left_trick') &&
    ball.launchPower <= 0.42 &&
    ball.splitGen === 0 &&
    Math.random() < 0.5
  ) {
    const deg20 = (20 * Math.PI) / 180;
    applySplitWithCap(ball, [-deg20], ctx, spawnQueue, 'LEFT TRICK x2!');
    ctx.onRelicPulse('left_trick');
    ctx.events.push({
      type: 'RELIC_PROC',
      x: ball.x,
      y: ball.y - 10,
      relicId: 'left_trick',
      text: '左打ち分裂',
      color: '#00ff88',
    });
  }
}

function checkPinballWizard(ball: BallEntity, ctx: PhysicsStepContext): void {
  const threshold = ball.nextWizardBounce ?? 8;
  if (ball.bounces >= threshold) {
    ball.nextWizardBounce = threshold + 8;
    if (ctx.ownedRelics.includes('pinball_wizard')) {
      ball.mult = Number((ball.mult * 1.45).toFixed(4));
      ctx.onRelicPulse('pinball_wizard');
      ctx.onPinballWizardCellOpen(ball);
      ctx.events.push({
        type: 'RELIC_PROC',
        x: ball.x,
        y: ball.y - 14,
        relicId: 'pinball_wizard',
        text: '釘師電撃 x1.45',
        color: '#ffb800',
      });
    }
  }
}

function resolveWallsAndBoundaries(ball: BallEntity): void {
  const minX = WORLD.BOARD_LEFT + ball.radius;
  const maxX = WORLD.BOARD_RIGHT - ball.radius;

  // One-way left return valve ("返し弁") prevents re-entering launch chute
  if (ball.x < minX) {
    ball.x = minX;
    ball.vx = Math.max(Math.abs(ball.vx) * 0.72, 28);
  } else if (ball.x > maxX) {
    ball.x = maxX;
    ball.vx = -Math.max(Math.abs(ball.vx) * 0.72, 28);
  }

  // Top inner dome ceiling boundary above y = 116
  if (ball.y < 116) {
    const effRx = DOME_CEILING_RX - ball.radius;
    const effRy = DOME_CEILING_RY - ball.radius;
    const dx = ball.x - DOME_CEILING_CENTER_X;
    const dy = ball.y - DOME_CEILING_CENTER_Y;
    const normDist = Math.hypot(dx / effRx, dy / effRy);

    if (normDist > 1) {
      const inv = 1 / normDist;
      const clampedX = DOME_CEILING_CENTER_X + dx * inv;
      const clampedY = DOME_CEILING_CENTER_Y + dy * inv;
      ball.x = clampedX;
      ball.y = Math.max(WORLD.DOME_TOP + ball.radius, clampedY);

      // Inward normal of the ellipse
      let nx = -(dx / (effRx * effRx));
      let ny = -(dy / (effRy * effRy));
      const nLen = Math.hypot(nx, ny) || 1;
      nx /= nLen;
      ny /= nLen;

      const vn = ball.vx * nx + ball.vy * ny;
      if (vn < 0) {
        ball.vx -= 1.65 * vn * nx;
        ball.vy -= 1.65 * vn * ny;
      }
      if (ball.vy < 25) {
        ball.vy = 25;
      }
    }
  }

  // Pocket divider fins (4 dividers separating 5 columns at c = 1..4)
  if (ball.y + ball.radius >= WORLD.POCKET_TOP - DIVIDER_CAP_RADIUS) {
    for (let c = 1; c <= 4; c++) {
      const dividerX = WORLD.BOARD_LEFT + c * WORLD.COL_WIDTH;

      if (ball.y < WORLD.POCKET_TOP) {
        // Rounded top bumper cap at (dividerX, WORLD.POCKET_TOP)
        let dx = ball.x - dividerX;
        const dy = ball.y - WORLD.POCKET_TOP;
        if (Math.abs(dx) < 0.5) {
          dx = ball.id % 2 === 0 ? 0.6 : -0.6;
          ball.x = dividerX + dx;
        }
        const dist = Math.hypot(dx, dy);
        const minDist = ball.radius + DIVIDER_CAP_RADIUS;
        if (dist < minDist && dist > 1e-5) {
          const nx = dx / dist;
          const ny = dy / dist;
          ball.x = dividerX + nx * (minDist + 0.15);
          ball.y = WORLD.POCKET_TOP + ny * (minDist + 0.15);
          const vn = ball.vx * nx + ball.vy * ny;
          if (vn < 0) {
            ball.vx -= 1.68 * vn * nx;
            ball.vy -= 1.68 * vn * ny;
          }
          if (Math.abs(ball.vx) < 22) {
            ball.vx = nx >= 0 ? 28 : -28;
          }
        }
      } else {
        // Vertical fin body inside pocket channel
        const finHalfWidth = 3.5;
        const dx = ball.x - dividerX;
        if (Math.abs(dx) < ball.radius + finHalfWidth) {
          const sign = dx >= 0 ? 1 : -1;
          ball.x = dividerX + sign * (ball.radius + finHalfWidth + 0.1);
          if (ball.vx * sign < 0) {
            ball.vx = -ball.vx * 0.65;
          }
        }
      }
    }
  }
}

/**
 * Advances all balls and pins by `dt` using 8 physics substeps per frame.
 * Returns any balls that entered pockets during this step.
 */
export function stepPhysics(
  dtRaw: number,
  ctx: PhysicsStepContext
): PocketCapture[] {
  const dt = Math.min(MAX_FRAME_DT, Math.max(0, dtRaw));
  if (dt <= 0) return [];

  const subDt = dt / SUBSTEPS;
  const captured: PocketCapture[] = [];
  const spawnQueue: BallEntity[] = [];

  // Decay visual animation timers on pins and pockets once per frame
  for (const pin of ctx.pins) {
    if (pin.hitAnim > 0) {
      pin.hitAnim = Math.max(0, pin.hitAnim - dt * 4.5);
    }
    if (pin.kind === 'SPINNER') {
      pin.spinAngle = (pin.spinAngle + dt * 1.4) % (Math.PI * 2);
    }
  }
  for (const pocket of ctx.pockets) {
    if (pocket.hitAnim > 0) {
      pocket.hitAnim = Math.max(0, pocket.hitAnim - dt * 3.5);
    }
  }

  for (let sub = 0; sub < SUBSTEPS; sub++) {
    ctx.simTime += subDt;

    for (let i = ctx.balls.length - 1; i >= 0; i--) {
      const ball = ctx.balls[i];

      if (ball.onRail) {
        stepBallOnRail(ball, subDt);
        continue;
      }

      // Gravity + gentle MAGNET attraction
      ball.vy += WORLD.GRAVITY * subDt;

      let magnetAccelX = 0;
      for (const pin of ctx.pins) {
        if (pin.kind !== 'MAGNET') continue;
        const dist = Math.hypot(ball.x - pin.x, ball.y - pin.y);
        if (dist <= 85) {
          const targetX = findMagnetTargetX(
            ball,
            ctx.pockets,
            ctx.reachColumns
          );
          const dir = Math.sign(targetX - ball.x);
          const falloff = 1 - dist / 85;
          magnetAccelX += dir * (240 + 180 * falloff);
        }
      }
      ball.vx += magnetAccelX * subDt;

      // Subtle air drag keeps extreme bounce energy stable
      ball.vx *= 1 - 0.08 * subDt;
      clampSpeed(ball);

      ball.x += ball.vx * subDt;
      ball.y += ball.vy * subDt;

      resolveWallsAndBoundaries(ball);

      for (const pin of ctx.pins) {
        resolvePinInteraction(ball, pin, ctx, spawnQueue);
      }

      // Anti-stuck safeguard
      const speed = Math.hypot(ball.vx, ball.vy);
      if (speed < 26) {
        ball.stuckTimer += subDt;
        if (ball.stuckTimer > 0.42) {
          ball.vx = (Math.random() < 0.5 ? -1 : 1) * 145;
          ball.vy = -190;
          ball.chips += 30;
          ball.stuckTimer = 0;
          ctx.events.push({
            type: 'ANTI_STUCK_NUDGE',
            x: ball.x,
            y: ball.y,
            value: 30,
            text: 'NUDGE +30',
            color: '#00f0ff',
          });
        }
      } else {
        ball.stuckTimer = Math.max(0, ball.stuckTimer - subDt * 2);
      }

      // Pocket entry check
      if (ball.y >= POCKET_ENTRY_Y) {
        const rawCol = Math.floor(
          (ball.x - WORLD.BOARD_LEFT) / WORLD.COL_WIDTH
        );
        const col = Math.min(4, Math.max(0, rawCol));
        ctx.balls.splice(i, 1);
        captured.push({ ball, col });
      }
    }

    if (spawnQueue.length > 0) {
      for (const child of spawnQueue) {
        if (ctx.balls.length < WORLD.MAX_ACTIVE_BALLS) {
          ctx.balls.push(child);
        }
      }
      spawnQueue.length = 0;
    }
  }

  // Record motion trail once per visual frame
  for (const ball of ctx.balls) {
    ball.trail.push({ x: ball.x, y: ball.y });
    if (ball.trail.length > TRAIL_MAX_POINTS) {
      ball.trail.shift();
    }
  }

  return captured;
}
