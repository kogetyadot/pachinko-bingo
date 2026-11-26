import {
  BallEntity,
  BallKind,
  BingoCell,
  GameEvent,
  PocketState,
  RelicId,
  RunStats,
  StageModifierDef,
  WORLD,
} from '../types';
import { ALL_BINGO_LINES, POCKET_LABELS } from '../data/catalog';

const MAX_STAGE_MULT = 1_000_000_000;
const CHAIN_RESET_DURATION = 2.8;

export interface BingoStateMutator {
  grid: BingoCell[][];
  pockets: PocketState[];
  completedLineIds: string[];
  reachColumns: boolean[];
  stageModifier: StageModifierDef;
  stageScore: number;
  totalRunScore: number;
  stageMult: number;
  cardLevel: number;
  medals: number;
  feverActive: boolean;
  feverTimer: number;
  feverCardResetTimer: number;
  feverBallGrantsThisStage: number;
  stageMagnetMedals: number;
  stageGoldMedals: number;
  ballQueue: BallKind[];
  ownedRelics: RelicId[];
  hitstopTimer: number;
  stageBingos: number;
  chainCount: number;
  chainTotalScore: number;
  chainTimer: number;
  lastShotChips: number;
  lastShotMult: number;
  lastShotPoints: number;
  stats: RunStats;
  events: GameEvent[];
  onRelicPulse: (relicId: RelicId) => void;
}

export function clampStageMult(m: number): number {
  if (!Number.isFinite(m)) return MAX_STAGE_MULT;
  return Math.min(MAX_STAGE_MULT, Math.max(1, Number(m.toFixed(2))));
}

/**
 * Generates logical center coordinates of a Bingo cell inside the lower board area.
 */
export function getBingoCellCenter(
  row: number,
  col: number
): { x: number; y: number } {
  const cellW = WORLD.COL_WIDTH;
  const cellH = (WORLD.BINGO_BOTTOM - WORLD.BINGO_TOP) / 5;
  return {
    x: WORLD.BOARD_LEFT + col * cellW + cellW / 2,
    y: WORLD.BINGO_TOP + row * cellH + cellH / 2,
  };
}

export function createInitialPockets(): PocketState[] {
  return POCKET_LABELS.map((label, col) => {
    const xLeft = WORLD.BOARD_LEFT + col * WORLD.COL_WIDTH;
    const xRight = xLeft + WORLD.COL_WIDTH;
    return {
      col,
      label,
      xLeft,
      xRight,
      xCenter: (xLeft + xRight) / 2,
      overdrive: false,
      overdriveLevel: 0,
      isReachTarget: false,
      hitAnim: 0,
    };
  });
}

function shuffledNumbersForColumn(col: number): number[] {
  const base = col * 15 + 1;
  const pool: number[] = [];
  for (let i = 0; i < 15; i++) {
    pool.push(base + i);
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool;
}

export function createBingoCard(cardLevel: number): BingoCell[][] {
  const colNums = [0, 1, 2, 3, 4].map((c) => shuffledNumbersForColumn(c));
  const baseChips = 80 * cardLevel;
  const grid: BingoCell[][] = [];

  for (let r = 0; r < 5; r++) {
    const rowCells: BingoCell[] = [];
    for (let c = 0; c < 5; c++) {
      const isFree = r === 2 && c === 2;
      rowCells.push({
        row: r,
        col: c,
        number: isFree ? 0 : colNums[c][r],
        isFree,
        opened: isFree,
        reigniteCount: 0,
        baseChips,
        openAnim: isFree ? 0.6 : 0,
        reigniteAnim: 0,
        inBingoLine: false,
        inReachLine: false,
      });
    }
    grid.push(rowCells);
  }

  return grid;
}

/**
 * Decays Bingo cell animations once per frame.
 */
export function decayBingoAnims(grid: BingoCell[][], dt: number): void {
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const cell = grid[r][c];
      if (cell.openAnim > 0) {
        cell.openAnim = Math.max(0, cell.openAnim - dt * 2.8);
      }
      if (cell.reigniteAnim > 0) {
        cell.reigniteAnim = Math.max(0, cell.reigniteAnim - dt * 2.8);
      }
    }
  }
}

/**
 * Recomputes inBingoLine, inReachLine, reachColumns, and pocket.isReachTarget flags.
 */
export function refreshGridLineStates(state: BingoStateMutator): void {
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      state.grid[r][c].inBingoLine = false;
      state.grid[r][c].inReachLine = false;
    }
  }

  state.reachColumns = [false, false, false, false, false];

  for (const line of ALL_BINGO_LINES) {
    let openedCount = 0;
    let missingCell: [number, number] | null = null;
    for (const [r, c] of line.cells) {
      if (state.grid[r][c].opened) {
        openedCount++;
      } else {
        missingCell = [r, c];
      }
    }

    if (openedCount === 5) {
      for (const [r, c] of line.cells) {
        state.grid[r][c].inBingoLine = true;
      }
    } else if (openedCount === 4 && missingCell) {
      state.reachColumns[missingCell[1]] = true;
      for (const [r, c] of line.cells) {
        state.grid[r][c].inReachLine = true;
      }
    }
  }

  for (let c = 0; c < 5; c++) {
    state.pockets[c].isReachTarget = state.reachColumns[c];
  }
}

function countLineCompletionsIfOpened(
  grid: BingoCell[][],
  row: number,
  col: number
): { newBingos: number; newReaches: number } {
  let newBingos = 0;
  let newReaches = 0;

  for (const line of ALL_BINGO_LINES) {
    let containsTarget = false;
    let openCount = 0;
    for (const [r, c] of line.cells) {
      if (r === row && c === col) containsTarget = true;
      if (grid[r][c].opened) openCount++;
    }
    if (!containsTarget) continue;
    if (openCount === 4) newBingos++;
    else if (openCount === 3) newReaches++;
  }

  return { newBingos, newReaches };
}

function selectExcitingCellInColumn(
  grid: BingoCell[][],
  col: number
): BingoCell | null {
  const unopened: BingoCell[] = [];
  for (let r = 0; r < 5; r++) {
    if (!grid[r][col].opened) {
      unopened.push(grid[r][col]);
    }
  }
  if (unopened.length === 0) return null;

  let bestBingoCount = 0;
  let bingoCandidates: BingoCell[] = [];
  let bestReachCount = 0;
  let reachCandidates: BingoCell[] = [];

  for (const cell of unopened) {
    const { newBingos, newReaches } = countLineCompletionsIfOpened(
      grid,
      cell.row,
      cell.col
    );
    if (newBingos > 0) {
      if (newBingos > bestBingoCount) {
        bestBingoCount = newBingos;
        bingoCandidates = [cell];
      } else if (newBingos === bestBingoCount) {
        bingoCandidates.push(cell);
      }
    }
    if (newReaches > 0) {
      if (newReaches > bestReachCount) {
        bestReachCount = newReaches;
        reachCandidates = [cell];
      } else if (newReaches === bestReachCount) {
        reachCandidates.push(cell);
      }
    }
  }

  if (bingoCandidates.length > 0) {
    return bingoCandidates[Math.floor(Math.random() * bingoCandidates.length)];
  }
  if (reachCandidates.length > 0) {
    return reachCandidates[Math.floor(Math.random() * reachCandidates.length)];
  }
  return unopened[Math.floor(Math.random() * unopened.length)];
}

function selectRandomUnopenedCell(
  grid: BingoCell[][],
  preferredOtherColsThan?: number
): BingoCell | null {
  const preferred: BingoCell[] = [];
  const allUnopened: BingoCell[] = [];

  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (!grid[r][c].opened) {
        allUnopened.push(grid[r][c]);
        if (preferredOtherColsThan === undefined || c !== preferredOtherColsThan) {
          preferred.push(grid[r][c]);
        }
      }
    }
  }

  const pool = preferred.length > 0 ? preferred : allUnopened;
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function selectRandomOpenedCell(
  grid: BingoCell[][],
  onlyCol?: number
): BingoCell | null {
  const pool: BingoCell[] = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (onlyCol !== undefined && c !== onlyCol) continue;
      if (grid[r][c].opened) {
        pool.push(grid[r][c]);
      }
    }
  }
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function applyReigniteCell(
  cell: BingoCell,
  state: BingoStateMutator
): number {
  cell.reigniteCount += 1;
  cell.reigniteAnim = 1.0;

  const bonusChips = 50 * state.cardLevel;
  const hasAmp = state.ownedRelics.includes('reignite_amp');
  if (hasAmp) {
    state.stageMult = clampStageMult(state.stageMult * 1.05 + 0.65);
    state.onRelicPulse('reignite_amp');
    const center = getBingoCellCenter(cell.row, cell.col);
    state.events.push({
      type: 'RELIC_PROC',
      x: center.x,
      y: center.y - 16,
      relicId: 'reignite_amp',
      text: '再点火 x1.05 +0.65!',
      color: '#ff2a5f',
    });
  } else {
    state.stageMult = clampStageMult(state.stageMult + 0.25);
  }

  const center = getBingoCellCenter(cell.row, cell.col);
  state.events.push({
    type: 'CELL_REIGNITE',
    x: center.x,
    y: center.y,
    row: cell.row,
    col: cell.col,
    value: bonusChips,
    mult: state.stageMult,
    combo: cell.reigniteCount,
    text: `RE-IGNITE #${cell.reigniteCount}`,
    color: '#ff2a5f',
  });

  return bonusChips;
}

function openCell(
  cell: BingoCell,
  state: BingoStateMutator,
  sourceX?: number,
  sourceY?: number
): number {
  cell.opened = true;
  cell.openAnim = 1.0;
  const center = getBingoCellCenter(cell.row, cell.col);
  state.events.push({
    type: 'CELL_OPEN',
    x: center.x,
    y: center.y,
    targetX: sourceX,
    targetY: sourceY,
    row: cell.row,
    col: cell.col,
    value: cell.baseChips,
    text: cell.isFree ? 'FREE' : `${cell.number}`,
    color: '#00f0ff',
  });
  return cell.baseChips;
}

function hitCellOpenOrReignite(
  cell: BingoCell,
  state: BingoStateMutator,
  sourceX?: number,
  sourceY?: number
): number {
  if (!cell.opened) {
    return openCell(cell, state, sourceX, sourceY);
  }
  return applyReigniteCell(cell, state);
}

function triggerOverdriveSurge(
  col: number,
  state: BingoStateMutator
): number {
  const pocket = state.pockets[col];
  const hasOverdriveArc = state.ownedRelics.includes('overdrive_arc');

  pocket.overdriveLevel += 1;
  let overdriveText: string;
  if (hasOverdriveArc) {
    state.stageMult = clampStageMult(state.stageMult * 1.35 + 2.0);
    overdriveText = '過電流覚醒 x1.35!';
    state.onRelicPulse('overdrive_arc');
    state.events.push({
      type: 'RELIC_PROC',
      x: pocket.xCenter,
      y: WORLD.POCKET_TOP - 22,
      relicId: 'overdrive_arc',
      text: overdriveText,
      color: '#00f0ff',
    });
  } else {
    state.stageMult = clampStageMult(state.stageMult * 1.2 + 1.2);
    overdriveText = '列覚醒 x1.2 +1.2!';
  }

  if (state.stageModifier.id === 'OVERDRIVE_SURGE') {
    state.stageMult = clampStageMult(state.stageMult + 1.5);
  }

  state.events.push({
    type: 'OVERDRIVE_TRIGGER',
    x: pocket.xCenter,
    y: WORLD.POCKET_TOP + 20,
    col,
    mult: state.stageMult,
    text: overdriveText,
    color: '#ffd000',
  });

  // Visual re-ignition pulse across column cells
  let surgeChips = 100 * state.cardLevel;
  for (let r = 0; r < 5; r++) {
    state.grid[r][col].reigniteAnim = 1.0;
  }

  // Chain lightning arcs to other columns
  const arcCount = hasOverdriveArc ? 2 : 1;
  const sourceX = pocket.xCenter;
  const sourceY = WORLD.POCKET_TOP + 22;
  for (let i = 0; i < arcCount; i++) {
    const target = selectRandomUnopenedCell(state.grid, col);
    if (target) {
      const targetCenter = getBingoCellCenter(target.row, target.col);
      state.events.push({
        type: 'OVERDRIVE_TRIGGER',
        x: sourceX,
        y: sourceY,
        targetX: targetCenter.x,
        targetY: targetCenter.y,
        col: target.col,
        row: target.row,
        color: '#00f0ff',
      });
      surgeChips += openCell(target, state, sourceX, sourceY);
    } else {
      const reigniteTarget = selectRandomOpenedCell(state.grid);
      if (reigniteTarget) {
        surgeChips += applyReigniteCell(reigniteTarget, state);
      }
    }
  }

  return surgeChips;
}

function checkColumnOverdriveAwakenings(state: BingoStateMutator): void {
  for (let c = 0; c < 5; c++) {
    if (state.pockets[c].overdrive) continue;
    let allOpen = true;
    for (let r = 0; r < 5; r++) {
      if (!state.grid[r][c].opened) {
        allOpen = false;
        break;
      }
    }
    if (allOpen) {
      state.pockets[c].overdrive = true;
      state.pockets[c].overdriveLevel = 1;
      state.stageMult = clampStageMult(state.stageMult + 0.5);
      state.events.push({
        type: 'OVERDRIVE_AWAKEN',
        x: state.pockets[c].xCenter,
        y: WORLD.POCKET_TOP + 16,
        col: c,
        mult: state.stageMult,
        text: `${state.pockets[c].label} OVERDRIVE!`,
        color: '#ffd000',
      });
    }
  }
}

function isFullCardOpened(grid: BingoCell[][]): boolean {
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (!grid[r][c].opened) return false;
    }
  }
  return true;
}

function checkAndResolveNewBingos(
  state: BingoStateMutator,
  reachBonus: number
): void {
  const newLines = ALL_BINGO_LINES.filter((line) => {
    if (state.completedLineIds.includes(line.id)) return false;
    return line.cells.every(([r, c]) => state.grid[r][c].opened);
  });

  if (newLines.length === 0) return;

  const multiLineCombo = 1 + (newLines.length - 1) * 0.6;
  const hasDiagKing = state.ownedRelics.includes('diagonal_king');
  const hasMedalMagnet = state.ownedRelics.includes('medal_magnet');

  for (const line of newLines) {
    state.completedLineIds.push(line.id);
    state.stats.totalBingos += 1;
    state.stageBingos += 1;

    let lineBase = 350 * state.cardLevel;
    let multGain = 1.0;

    if (line.kind === 'DIAG' && state.stageModifier.id === 'DIAGONAL_GOLD') {
      lineBase *= 2.0;
    }

    if (state.stageModifier.id === 'GOLDEN_BOSS') {
      lineBase *= 1.5;
    }

    if (line.kind === 'DIAG' && hasDiagKing) {
      lineBase *= 2.5;
      multGain += 2.5;
      state.onRelicPulse('diagonal_king');
      const center = getBingoCellCenter(2, 2);
      state.events.push({
        type: 'RELIC_PROC',
        x: center.x,
        y: center.y - 24,
        relicId: 'diagonal_king',
        text: 'クロス覇者 x2.5!',
        color: '#ff2a5f',
      });
    }

    state.stageMult = clampStageMult(state.stageMult + multGain);
    const lineScore = Math.round(
      lineBase * state.stageMult * multiLineCombo * reachBonus
    );
    state.stageScore += lineScore;
    state.totalRunScore += lineScore;

    const midCell = line.cells[2];
    const midCenter = getBingoCellCenter(midCell[0], midCell[1]);
    state.events.push({
      type: 'BINGO_LINE',
      x: midCenter.x,
      y: midCenter.y,
      value: lineScore,
      mult: state.stageMult,
      combo: newLines.length,
      lineCells: line.cells,
      text: newLines.length > 1 ? `${newLines.length}x BINGO!` : 'BINGO!',
      color: '#ffd000',
    });
  }

  if (hasMedalMagnet) {
    const medalReward = Math.min(
      10 * newLines.length,
      Math.max(0, 60 - state.stageMagnetMedals)
    );
    if (medalReward > 0) {
      state.medals += medalReward;
      state.stageMagnetMedals += medalReward;
      state.onRelicPulse('medal_magnet');
      state.events.push({
        type: 'RELIC_PROC',
        x: WORLD.BOARD_LEFT + WORLD.BOARD_WIDTH / 2,
        y: WORLD.BINGO_TOP - 10,
        relicId: 'medal_magnet',
        value: medalReward,
        text: `+¥${medalReward}`,
        color: '#ffb800',
      });
    }
  }

  state.hitstopTimer = Math.max(
    state.hitstopTimer,
    Math.min(0.14, 0.05 * newLines.length)
  );
}

function checkAndResolveFullBingoFever(
  state: BingoStateMutator,
  reachBonus: number
): void {
  if (state.feverCardResetTimer > 0) return;
  if (!isFullCardOpened(state.grid)) return;

  state.feverActive = true;
  state.feverTimer = 10.0;

  const hasFeverEngine = state.ownedRelics.includes('fever_engine');
  state.stageMult = clampStageMult(
    state.stageMult * (hasFeverEngine ? 1.35 : 1.15)
  );

  let grantedBalls = false;
  if (state.feverBallGrantsThisStage < 2) {
    state.feverBallGrantsThisStage += 1;
    grantedBalls = true;
    if (hasFeverEngine) {
      state.ballQueue.push('BOMB', 'MULTI', 'LASER');
    } else {
      state.ballQueue.push('BOMB', 'MULTI');
    }
  }

  if (hasFeverEngine) {
    state.onRelicPulse('fever_engine');
    state.events.push({
      type: 'RELIC_PROC',
      x: WORLD.BOARD_LEFT + WORLD.BOARD_WIDTH / 2,
      y: WORLD.BINGO_TOP + 28,
      relicId: 'fever_engine',
      text: grantedBalls ? '永久機関 +3球 & x1.35!' : '永久機関 x1.35!',
      color: '#ffd000',
    });
  }

  const jackpot = Math.round(
    1500 * state.cardLevel * state.stageMult * reachBonus
  );
  state.stageScore += jackpot;
  state.totalRunScore += jackpot;
  state.cardLevel += 1;
  state.stats.totalFullCards += 1;

  // Preserve the illuminated 25-cell celebration board for 0.45s before dealing the next card
  state.feverCardResetTimer = 0.45;
  state.hitstopTimer = Math.max(state.hitstopTimer, 0.18);
  const center = getBingoCellCenter(2, 2);
  state.events.push({
    type: 'FULL_BINGO_FEVER',
    x: center.x,
    y: center.y,
    value: jackpot,
    mult: state.stageMult,
    text: 'FULL BINGO FEVER!',
    subtext: `CARD Lv.${state.cardLevel}`,
    color: '#ffd000',
  });
}

/**
 * Deals a fresh 5x5 Bingo card after the Full Bingo celebration delay expires,
 * resetting column Overdrive flags while preserving stageMult.
 */
export function resetCardAfterFeverDelay(state: BingoStateMutator): void {
  state.grid = createBingoCard(state.cardLevel);
  state.completedLineIds = [];
  for (const pocket of state.pockets) {
    pocket.overdrive = false;
    pocket.overdriveLevel = 0;
  }
  refreshGridLineStates(state);
}

/**
 * Resolves a pocketed ball's impact on the 5x5 Bingo grid, Overdrive states,
 * Re-Ignite multiplier inflation, new Bingo lines, and Full Bingo Fever.
 */
export function resolveBallInPocket(
  ball: BallEntity,
  col: number,
  state: BingoStateMutator
): void {
  const scoreBefore = state.stageScore;
  const pocket = state.pockets[col];
  pocket.hitAnim = 1.0;

  const sourceX = pocket.xCenter;
  const sourceY = WORLD.POCKET_TOP + 22;

  // Stage 2 CENTER_BONUS modifier: +140 chips when entering Col 2 (N)
  if (state.stageModifier.id === 'CENTER_BONUS' && col === 2) {
    ball.chips += 140;
  }

  // Check reach status BEFORE opening cells this shot
  const anyReachActive = state.reachColumns.some((r) => r);
  const hasReachRadar = state.ownedRelics.includes('reach_radar');
  const reachBonus = anyReachActive && hasReachRadar ? 1.6 : 1.0;
  if (reachBonus > 1.0) {
    state.onRelicPulse('reach_radar');
  }

  const wasOverdrive = pocket.overdrive;
  let openedCellsChips = 0;
  let ballChips = ball.chips;
  let primaryTargetCenter: { x: number; y: number } | undefined;

  if (ball.kind === 'BOMB') {
    const target = selectExcitingCellInColumn(state.grid, col);
    const targetRow = target ? target.row : 2;
    const isMega =
      ball.megaBomb || state.ownedRelics.includes('blast_furnace');
    if (state.ownedRelics.includes('blast_furnace')) {
      state.onRelicPulse('blast_furnace');
    }

    const blastCenter = getBingoCellCenter(targetRow, col);
    primaryTargetCenter = blastCenter;
    state.events.push({
      type: 'BOMB_BLAST',
      x: blastCenter.x,
      y: blastCenter.y,
      row: targetRow,
      col,
      text: isMega ? '3x3 MEGA BLAST!' : 'CROSS BLAST!',
      color: '#ff5500',
    });

    const offsets: Array<[number, number]> = isMega
      ? [
          [-1, -1],
          [-1, 0],
          [-1, 1],
          [0, -1],
          [0, 0],
          [0, 1],
          [1, -1],
          [1, 0],
          [1, 1],
        ]
      : [
          [0, 0],
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ];

    for (const [dr, dc] of offsets) {
      const nr = targetRow + dr;
      const nc = col + dc;
      if (nr >= 0 && nr < 5 && nc >= 0 && nc < 5) {
        openedCellsChips += hitCellOpenOrReignite(
          state.grid[nr][nc],
          state,
          sourceX,
          sourceY
        );
      }
    }

    if (wasOverdrive) {
      openedCellsChips += triggerOverdriveSurge(col, state);
    }
  } else if (ball.kind === 'LASER') {
    primaryTargetCenter = getBingoCellCenter(2, col);
    // Re-ignite ALL already-opened cells in col first
    for (let r = 0; r < 5; r++) {
      if (state.grid[r][col].opened) {
        openedCellsChips += applyReigniteCell(state.grid[r][col], state);
      }
    }
    // Then open up to 2 unopened cells in col
    for (let k = 0; k < 2; k++) {
      const target = selectExcitingCellInColumn(state.grid, col);
      if (target) {
        primaryTargetCenter = getBingoCellCenter(target.row, target.col);
        openedCellsChips += openCell(target, state, sourceX, sourceY);
      }
    }
    if (wasOverdrive) {
      openedCellsChips += triggerOverdriveSurge(col, state);
    }
  } else {
    // STEEL / MULTI / GOLD
    if (ball.kind === 'GOLD') {
      ballChips *= 3;
      const goldGrant = Math.min(10, Math.max(0, 40 - state.stageGoldMedals));
      if (goldGrant > 0) {
        state.medals += goldGrant;
        state.stageGoldMedals += goldGrant;
      }
    }

    if (!wasOverdrive) {
      const target = selectExcitingCellInColumn(state.grid, col);
      if (target) {
        primaryTargetCenter = getBingoCellCenter(target.row, target.col);
        openedCellsChips += openCell(target, state, sourceX, sourceY);
      }

      // Resonance Echo: Steel balls with >= 6 bounces also re-ignite 1 opened cell in columns with >= 2 opened cells
      let openedInCol = 0;
      for (let r = 0; r < 5; r++) {
        if (state.grid[r][col].opened) openedInCol++;
      }
      if (ball.kind === 'STEEL' && ball.bounces >= 6 && openedInCol >= 2) {
        const echoCell = selectRandomOpenedCell(state.grid, col);
        if (echoCell) {
          openedCellsChips += applyReigniteCell(echoCell, state);
        }
      }
    } else {
      primaryTargetCenter = getBingoCellCenter(2, col);
      const triggers = ball.kind === 'GOLD' ? 2 : 1;
      for (let t = 0; t < triggers; t++) {
        openedCellsChips += triggerOverdriveSurge(col, state);
      }
    }
  }

  checkColumnOverdriveAwakenings(state);

  const totalChips = ballChips + openedCellsChips;
  const effectiveMult = Number(
    (ball.mult * state.stageMult * reachBonus).toFixed(2)
  );
  const shotPoints = Math.round(
    totalChips * ball.mult * state.stageMult * reachBonus
  );
  state.lastShotChips = totalChips;
  state.lastShotMult = effectiveMult;
  state.lastShotPoints = shotPoints;
  state.stageScore += shotPoints;
  state.totalRunScore += shotPoints;
  if (shotPoints > state.stats.highestSingleShot) {
    state.stats.highestSingleShot = shotPoints;
  }

  state.events.push({
    type: 'POCKET_ENTER',
    x: sourceX,
    y: sourceY,
    targetX: primaryTargetCenter?.x,
    targetY: primaryTargetCenter?.y,
    col,
    value: shotPoints,
    mult: state.stageMult,
    color: ball.kind === 'GOLD' ? '#ffd000' : '#00f0ff',
  });

  checkAndResolveNewBingos(state, reachBonus);
  checkAndResolveFullBingoFever(state, reachBonus);

  const totalAdded = state.stageScore - scoreBefore;
  if (totalAdded > 0) {
    state.chainCount += 1;
    state.chainTotalScore += totalAdded;
    state.chainTimer = CHAIN_RESET_DURATION;
  }

  if (state.stageMult > state.stats.maxStageMult) {
    state.stats.maxStageMult = state.stageMult;
  }

  refreshGridLineStates(state);
}

/**
 * Triggers a random unopened cell strike (used by pinball_wizard relic).
 */
export function triggerLightningCellOpen(
  state: BingoStateMutator,
  ball?: BallEntity
): void {
  const scoreBefore = state.stageScore;
  const sourceX = ball?.x ?? WORLD.BOARD_LEFT + WORLD.BOARD_WIDTH / 2;
  const sourceY = ball?.y ?? WORLD.PIN_AREA_BOTTOM;
  const anyReach = state.reachColumns.some((r) => r);
  const reachBonus =
    anyReach && state.ownedRelics.includes('reach_radar') ? 1.6 : 1.0;
  if (reachBonus > 1.0) {
    state.onRelicPulse('reach_radar');
  }

  const target = selectRandomUnopenedCell(state.grid);
  if (target) {
    const center = getBingoCellCenter(target.row, target.col);
    const chips = openCell(target, state, sourceX, sourceY);
    const bonus = Math.round(chips * state.stageMult * reachBonus);
    state.stageScore += bonus;
    state.totalRunScore += bonus;
    state.events.push({
      type: 'RELIC_PROC',
      x: sourceX,
      y: sourceY,
      targetX: center.x,
      targetY: center.y,
      relicId: 'pinball_wizard',
      color: '#ffb800',
    });
    checkColumnOverdriveAwakenings(state);
    checkAndResolveNewBingos(state, reachBonus);
    checkAndResolveFullBingoFever(state, reachBonus);
    refreshGridLineStates(state);
  } else {
    const opened = selectRandomOpenedCell(state.grid);
    if (opened) {
      const reigniteChips = applyReigniteCell(opened, state);
      const bonus = Math.round(reigniteChips * state.stageMult * reachBonus);
      state.stageScore += bonus;
      state.totalRunScore += bonus;
    }
  }

  const totalAdded = state.stageScore - scoreBefore;
  if (totalAdded > 0) {
    state.chainCount += 1;
    state.chainTotalScore += totalAdded;
    state.chainTimer = CHAIN_RESET_DURATION;
  }

  if (state.stageMult > state.stats.maxStageMult) {
    state.stats.maxStageMult = state.stageMult;
  }
}
