import { BallEntity, TrailPoint, WORLD } from '../types';

export interface RailSample {
  x: number;
  y: number;
  tx: number;
  ty: number;
}

const RAIL_SEGMENT_A_END = 0.35;
const RAIL_START_Y = 490;
const RAIL_CORNER_Y = 116;
const ARCH_END_ANGLE = Math.PI * 2 - 0.12;
const ARCH_ANGLE_SPAN = ARCH_END_ANGLE - Math.PI;

export function clampLaunchPower(power: number): number {
  if (!Number.isFinite(power)) return 0.5;
  return Math.min(1, Math.max(0, power));
}

/**
 * Maps launchPower (0..1) into railReleaseProgress in [0.42, 0.98]:
 * - 0.00..0.28: Top-left exit (x ~ 73..150) -> Left route (B / I)
 * - 0.29..0.52: Left-crown exit (x ~ 154..265) -> Bukkomi nail cluster (I / N)
 * - 0.53..0.75: Right-crown exit (x ~ 270..395) -> Center-Right route (N / G)
 * - 0.76..1.00: Right-hit exit (x ~ 400..502) -> Right cushion drop (G / O)
 */
export function computeReleaseProgress(power: number, withJitter = false): number {
  const p = clampLaunchPower(power);
  const base = 0.475 + 0.255 * p + 0.238 * p * p;
  const jitter = withJitter ? (Math.random() - 0.5) * 0.016 : 0;
  return Math.min(0.98, Math.max(0.42, base + jitter));
}

/**
 * Evaluates position and unit forward tangent along the pachinko launch spline.
 * Segment A (0.00..0.35): Straight vertical ascent at x = WORLD.RAIL_X_CENTER (31) from y = 490 to 116.
 * Segment B (0.35..1.00): Smooth clockwise dome arch from theta = PI (31, 116) across crown (280, 28) to theta = 2*PI - 0.12 (~508, 105).
 */
export function sampleRailPoint(progress: number): RailSample {
  const p = Math.min(1, Math.max(0, progress));

  if (p <= RAIL_SEGMENT_A_END) {
    const u = p / RAIL_SEGMENT_A_END;
    return {
      x: WORLD.RAIL_X_CENTER,
      y: RAIL_START_Y + (RAIL_CORNER_Y - RAIL_START_Y) * u,
      tx: 0,
      ty: -1,
    };
  }

  const t = (p - RAIL_SEGMENT_A_END) / (1 - RAIL_SEGMENT_A_END);
  const theta = Math.PI + t * ARCH_ANGLE_SPAN;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  // Smooth asymmetric horizontal radius gives x = 31 at theta = PI,
  // crown x = 280 at theta = 1.5*PI, and x ~ 508 at theta = -0.12.
  const rx = 239.5 - 9.5 * cosT;
  const ry = 88;
  const x = WORLD.DOME_CENTER_X + rx * cosT;
  const y = WORLD.DOME_CENTER_Y + ry * sinT;

  const dx = -239.5 * sinT + 19 * cosT * sinT;
  const dy = ry * cosT;
  const len = Math.hypot(dx, dy) || 1;

  return {
    x,
    y,
    tx: dx / len,
    ty: dy / len,
  };
}

/**
 * Computes initial free-flight velocity when the ball peels off the dome arch at releaseProgress.
 * Calibrated so low power settles down the Left Route (B/I), mid power drops through Bukkomi/Center (I/N/G),
 * and Right-Hit (power >= 0.76) drops cleanly off the upper-right cushion into Right Route (G/O).
 */
export function computeReleaseVelocity(
  releaseProgress: number,
  power: number
): { vx: number; vy: number } {
  const p = clampLaunchPower(power);
  const sample = sampleRailPoint(releaseProgress);
  const speed = (340 + p * 260) * 0.62;

  const rightCushion = Math.max(0, (sample.x - 420) / 80);
  const leftDrop = Math.max(0, (175 - sample.x) / 115);

  let vxScale = 0.08 + 0.16 * Math.sin(Math.min(1, p / 0.85) * Math.PI);
  vxScale *= 1 - 0.5 * leftDrop;
  if (p >= 0.76) {
    vxScale *= 1 - 0.85 * rightCushion;
  }

  const rawVx = sample.tx * vxScale - rightCushion * 0.14;
  const rawVy = Math.max(0.75, sample.ty * 0.45 + 0.88);
  const norm = Math.hypot(rawVx, rawVy) || 1;

  return {
    vx: (rawVx / norm) * speed,
    vy: (rawVy / norm) * speed,
  };
}

/**
 * Advances a ball while attached to the launch rail.
 * Returns true on the exact step when the ball exits the rail into free-flight physics.
 */
export function stepBallOnRail(ball: BallEntity, dt: number): boolean {
  const p = clampLaunchPower(ball.launchPower);
  const railSpeed = 1.55 + p * 1.15;
  ball.railProgress += railSpeed * dt;

  if (ball.railProgress >= ball.railReleaseProgress) {
    ball.railProgress = ball.railReleaseProgress;
    ball.onRail = false;

    const exit = sampleRailPoint(ball.railReleaseProgress);
    const vel = computeReleaseVelocity(ball.railReleaseProgress, p);
    ball.x = exit.x;
    ball.y = exit.y;
    ball.vx = vel.vx;
    ball.vy = vel.vy;
    return true;
  }

  const pos = sampleRailPoint(ball.railProgress);
  ball.x = pos.x;
  ball.y = pos.y;
  const railVel = 340 + p * 260;
  ball.vx = pos.tx * railVel;
  ball.vy = pos.ty * railVel;
  return false;
}

/**
 * Simulates ~0.62s of deterministic upper-rail path plus post-release gravity parabola
 * matching physics.ts integration (drag + wall bounces) without random jitter, returning 28 points
 * extending cleanly down into the top pin corridor for accurate B/I/N/G/O column aiming.
 */
export function getTrajectoryPreview(power: number): TrailPoint[] {
  const p = clampLaunchPower(power);
  const releaseProgress = computeReleaseProgress(p, false);
  const points: TrailPoint[] = [];

  // 12 points along the upper dome arch from near the chute exit up to releaseProgress
  const railStart = Math.min(0.32, releaseProgress * 0.75);
  const railSteps = 12;
  for (let i = 0; i < railSteps; i++) {
    const frac = i / (railSteps - 1);
    const prog = railStart + (releaseProgress - railStart) * frac;
    const sample = sampleRailPoint(prog);
    points.push({ x: sample.x, y: sample.y });
  }

  // 16 points along post-release free-flight parabola (~0.44s free-flight, ~0.62s total)
  // matching physics substeps (8 substeps per step)
  const exit = sampleRailPoint(releaseProgress);
  let x = exit.x;
  let y = exit.y;
  let { vx, vy } = computeReleaseVelocity(releaseProgress, p);

  const freeSteps = 16;
  const stepDt = 0.0275;
  const subDt = stepDt / 8;
  const minX = WORLD.BOARD_LEFT + WORLD.BALL_RADIUS;
  const maxX = WORLD.BOARD_RIGHT - WORLD.BALL_RADIUS;

  for (let i = 0; i < freeSteps; i++) {
    for (let s = 0; s < 8; s++) {
      vy += WORLD.GRAVITY * subDt;
      vx *= 1 - 0.08 * subDt;
      x += vx * subDt;
      y += vy * subDt;

      if (x < minX) {
        x = minX;
        vx = Math.max(Math.abs(vx) * 0.72, 28);
      } else if (x > maxX) {
        x = maxX;
        vx = -Math.max(Math.abs(vx) * 0.72, 28);
      }

      if (y > WORLD.PIN_AREA_BOTTOM) {
        y = WORLD.PIN_AREA_BOTTOM;
      }
    }

    points.push({ x, y });
  }

  return points;
}
