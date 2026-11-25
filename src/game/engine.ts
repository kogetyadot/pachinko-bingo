import {
  BallEntity,
  BallKind,
  BingoCell,
  GameEvent,
  GameMode,
  GamePhase,
  GameStateSnapshot,
  IGameEngine,
  PinEntity,
  PinKind,
  PocketState,
  RelicId,
  RunStats,
  ShopOffer,
  StageClearSummary,
  TrailPoint,
  WORLD,
} from '../types';
import {
  BALL_CATALOG,
  createDefaultPinLayout,
  getStageTargetScore,
  PIN_CATALOG,
  RELIC_CATALOG,
} from '../data/catalog';
import {
  clampLaunchPower,
  computeReleaseProgress,
  getTrajectoryPreview,
  sampleRailPoint,
} from './rail';
import { stepPhysics } from './physics';
import {
  BingoStateMutator,
  createBingoCard,
  createInitialPockets,
  decayBingoAnims,
  refreshGridLineStates,
  resetCardAfterFeverDelay,
  resolveBallInPocket,
  triggerLightningCellOpen,
} from './bingo';

const MAX_STANDARD_STAGE = 8;
const STAGE_END_DELAY = 0.85;
const AUTO_FIRE_INTERVAL = 0.26;
const STARTING_MEDALS = 45;
const INITIAL_REROLL_COST = 15;

const STARTER_DECK: BallKind[] = [
  'STEEL',
  'STEEL',
  'STEEL',
  'BOMB',
  'STEEL',
  'MULTI',
  'STEEL',
  'STEEL',
  'STEEL',
  'STEEL',
];

const SHOP_PIN_POOL: PinKind[] = [
  'SPLITTER',
  'BUMPER',
  'SPINNER',
  'BOMB_PIN',
  'MAGNET',
];

const SHOP_BALL_POOL: BallKind[] = ['BOMB', 'MULTI', 'LASER', 'GOLD'];

function createEmptyStats(): RunStats {
  return {
    totalBingos: 0,
    totalFullCards: 0,
    highestSingleShot: 0,
    maxStageMult: 1,
    totalBallsFired: 0,
    totalPinsHit: 0,
    stagesCleared: 0,
  };
}

function createInitialPins(): PinEntity[] {
  return createDefaultPinLayout().map((bp, idx) => ({
    id: idx + 1,
    x: bp.x,
    y: bp.y,
    radius: PIN_CATALOG[bp.kind].radius,
    kind: bp.kind,
    customizable: bp.customizable,
    hitAnim: 0,
    spinAngle: 0,
    cooldownUntil: 0,
  }));
}

function shuffleCopy<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function pickWeightedRelics(
  available: RelicId[],
  count: number
): RelicId[] {
  const pool = [...available];
  const chosen: RelicId[] = [];
  const rarityWeight: Record<'COMMON' | 'RARE' | 'LEGENDARY', number> = {
    COMMON: 1.0,
    RARE: 0.82,
    LEGENDARY: 0.65,
  };

  while (chosen.length < count && pool.length > 0) {
    let totalWeight = 0;
    for (const id of pool) {
      totalWeight += rarityWeight[RELIC_CATALOG[id].rarity];
    }
    let roll = Math.random() * totalWeight;
    let pickedIndex = 0;
    for (let i = 0; i < pool.length; i++) {
      roll -= rarityWeight[RELIC_CATALOG[pool[i]].rarity];
      if (roll <= 0) {
        pickedIndex = i;
        break;
      }
    }
    chosen.push(pool[pickedIndex]);
    pool.splice(pickedIndex, 1);
  }

  return chosen;
}

function pinSlotPriorityScore(pin: PinEntity, kind: PinKind): number {
  const centerDist = Math.abs(pin.x - 287.5);
  const centerScore = Math.max(0, 260 - centerDist);

  switch (kind) {
    case 'SPLITTER':
    case 'BOMB_PIN':
    case 'SPINNER': {
      // Upper-mid rows maximize downstream cascades & multipliers
      const idealY = 230;
      const yScore = Math.max(0, 220 - Math.abs(pin.y - idealY));
      return yScore * 1.4 + centerScore;
    }
    case 'BUMPER':
    case 'MAGNET': {
      // Mid-lower rows redirect trajectories and boost late bounces
      const idealY = 330;
      const yScore = Math.max(0, 220 - Math.abs(pin.y - idealY));
      return yScore * 1.35 + centerScore * 0.9;
    }
    default:
      return centerScore;
  }
}

export class NeonPachinkoEngine implements IGameEngine {
  private phase: GamePhase = 'TITLE';
  private mode: GameMode = 'STANDARD';
  private stage = 1;
  private stageScore = 0;
  private totalRunScore = 0;
  private targetScore = getStageTargetScore(1);
  private stageMult = 1;
  private cardLevel = 1;
  private medals = STARTING_MEDALS;
  private feverActive = false;
  private feverTimer = 0;
  private feverCardResetTimer = 0;
  private launchPower = 0.52;
  private strokeLocked = false;
  private autoFireCooldown = 0;
  private ballQueue: BallKind[] = [];
  private deckTemplate: BallKind[] = [...STARTER_DECK];
  private pins: PinEntity[] = createInitialPins();
  private balls: BallEntity[] = [];
  private pockets: PocketState[] = createInitialPockets();
  private grid: BingoCell[][] = createBingoCard(1);
  private completedLineIds: string[] = [];
  private reachColumns: boolean[] = [false, false, false, false, false];
  private ownedRelics: RelicId[] = [];
  private relicPulse: Record<string, number> = {};
  private pendingPinInventory: PinKind[] = [];
  private selectedPinBrush: PinKind | null = null;
  private shopOffers: ShopOffer[] = [];
  private rerollCost = INITIAL_REROLL_COST;
  private clearSummary: StageClearSummary | null = null;
  private stats: RunStats = createEmptyStats();
  private simTime = 0;
  private hitstopTimer = 0;
  private stageEndDelayTimer = 0;
  private stageBingos = 0;
  private nextBallEntityId = 1;
  private offerCounter = 1;
  private eventQueue: GameEvent[] = [];

  constructor() {
    this.syncGridLineStates();
  }

  private createBingoMutator(): BingoStateMutator {
    return {
      grid: this.grid,
      pockets: this.pockets,
      completedLineIds: this.completedLineIds,
      reachColumns: this.reachColumns,
      stageScore: this.stageScore,
      totalRunScore: this.totalRunScore,
      stageMult: this.stageMult,
      cardLevel: this.cardLevel,
      medals: this.medals,
      feverActive: this.feverActive,
      feverTimer: this.feverTimer,
      feverCardResetTimer: this.feverCardResetTimer,
      ballQueue: this.ballQueue,
      ownedRelics: this.ownedRelics,
      hitstopTimer: this.hitstopTimer,
      stageBingos: this.stageBingos,
      stats: this.stats,
      events: this.eventQueue,
      onRelicPulse: (relicId) => {
        this.relicPulse[relicId] = 1.0;
      },
    };
  }

  private applyBingoMutator(mut: BingoStateMutator): void {
    this.grid = mut.grid;
    this.pockets = mut.pockets;
    this.completedLineIds = mut.completedLineIds;
    this.reachColumns = mut.reachColumns;
    this.stageScore = mut.stageScore;
    this.totalRunScore = mut.totalRunScore;
    this.stageMult = mut.stageMult;
    this.cardLevel = mut.cardLevel;
    this.medals = mut.medals;
    this.feverActive = mut.feverActive;
    this.feverTimer = mut.feverTimer;
    this.feverCardResetTimer = mut.feverCardResetTimer;
    this.ballQueue = mut.ballQueue;
    this.hitstopTimer = mut.hitstopTimer;
    this.stageBingos = mut.stageBingos;
  }

  private syncGridLineStates(): void {
    const mut = this.createBingoMutator();
    refreshGridLineStates(mut);
    this.applyBingoMutator(mut);
  }

  private buildStageBallQueue(): void {
    const baseDeck = [...this.deckTemplate];
    if (this.ownedRelics.includes('extra_magazine')) {
      baseDeck.push('STEEL', 'STEEL', 'BOMB');
      this.relicPulse['extra_magazine'] = 1.0;
    }

    const shuffled = shuffleCopy(baseDeck);
    const firstSpecialIdx = shuffled.findIndex((k) => k !== 'STEEL');
    if (firstSpecialIdx >= 4) {
      const swapIdx = Math.floor(Math.random() * 4);
      const tmp = shuffled[swapIdx];
      shuffled[swapIdx] = shuffled[firstSpecialIdx];
      shuffled[firstSpecialIdx] = tmp;
    }
    this.ballQueue = shuffled;
  }

  private setupStage(stageNum: number): void {
    this.stage = stageNum;
    this.stageScore = 0;
    this.targetScore = getStageTargetScore(stageNum);
    this.stageMult = 1;
    this.cardLevel = 1;
    this.feverActive = false;
    this.feverTimer = 0;
    this.feverCardResetTimer = 0;
    this.autoFireCooldown = 0;
    this.balls = [];
    this.pockets = createInitialPockets();
    this.grid = createBingoCard(1);
    this.completedLineIds = [];
    this.stageBingos = 0;
    this.clearSummary = null;
    this.stageEndDelayTimer = 0;
    this.hitstopTimer = 0;
    for (const pin of this.pins) {
      pin.hitAnim = 0;
      pin.cooldownUntil = 0;
    }
    this.buildStageBallQueue();
    this.syncGridLineStates();
  }

  private generateShopOffers(): void {
    const offers: ShopOffer[] = [];

    // 2 Special Pins (Stage 1 Shop guarantees at least 1 SPLITTER or BOMB_PIN for early power spike)
    let pinChoices = shuffleCopy(SHOP_PIN_POOL).slice(0, 2);
    if (
      this.stage === 1 &&
      !pinChoices.includes('SPLITTER') &&
      !pinChoices.includes('BOMB_PIN')
    ) {
      const guaranteed: PinKind = Math.random() < 0.6 ? 'SPLITTER' : 'BOMB_PIN';
      pinChoices = [guaranteed, pinChoices[0]];
    }
    for (const pinKind of pinChoices) {
      const def = PIN_CATALOG[pinKind];
      offers.push({
        id: `offer_${this.offerCounter++}`,
        offerKind: 'PIN',
        pinKind,
        name: def.name,
        description: def.description,
        cost: def.cost,
        accentColor: def.color,
        rarityLabel: 'PIN',
        sold: false,
      });
    }

    // 2 Special Balls
    const ballChoices = shuffleCopy(SHOP_BALL_POOL).slice(0, 2);
    for (const ballKind of ballChoices) {
      const def = BALL_CATALOG[ballKind];
      offers.push({
        id: `offer_${this.offerCounter++}`,
        offerKind: 'BALL',
        ballKind,
        name: def.name,
        description: def.description,
        cost: def.cost,
        accentColor: def.glowColor,
        rarityLabel: 'BALL',
        sold: false,
      });
    }

    // 2 Relics not yet owned
    const availableRelics = (Object.keys(RELIC_CATALOG) as RelicId[]).filter(
      (id) => !this.ownedRelics.includes(id)
    );
    const chosenRelics = pickWeightedRelics(availableRelics, 2);
    for (const relicId of chosenRelics) {
      const def = RELIC_CATALOG[relicId];
      offers.push({
        id: `offer_${this.offerCounter++}`,
        offerKind: 'RELIC',
        relicId,
        name: def.name,
        description: def.description,
        cost: def.cost,
        accentColor: def.accentColor,
        rarityLabel: def.rarity,
        sold: false,
      });
    }

    // Fallback extra ball/pin offers if player already owns nearly all relics
    while (offers.length < 6) {
      const fallbackBall =
        SHOP_BALL_POOL[offers.length % SHOP_BALL_POOL.length];
      const def = BALL_CATALOG[fallbackBall];
      offers.push({
        id: `offer_${this.offerCounter++}`,
        offerKind: 'BALL',
        ballKind: fallbackBall,
        name: def.name,
        description: def.description,
        cost: def.cost,
        accentColor: def.glowColor,
        rarityLabel: 'BALL',
        sold: false,
      });
    }

    this.shopOffers = offers;
  }

  public getState(): GameStateSnapshot {
    return {
      phase: this.phase,
      mode: this.mode,
      stage: this.stage,
      maxStandardStage: MAX_STANDARD_STAGE,
      stageScore: this.stageScore,
      totalRunScore: this.totalRunScore,
      targetScore: this.targetScore,
      stageMult: this.stageMult,
      cardLevel: this.cardLevel,
      medals: this.medals,
      feverActive: this.feverActive,
      feverTimer: this.feverTimer,
      launchPower: this.launchPower,
      strokeLocked: this.strokeLocked,
      autoFireCooldown: this.autoFireCooldown,
      ballQueue: this.ballQueue,
      deckTemplate: this.deckTemplate,
      pins: this.pins,
      balls: this.balls,
      pockets: this.pockets,
      grid: this.grid,
      completedLineIds: this.completedLineIds,
      reachColumns: this.reachColumns,
      ownedRelics: this.ownedRelics,
      relicPulse: this.relicPulse,
      pendingPinInventory: this.pendingPinInventory,
      selectedPinBrush: this.selectedPinBrush,
      shopOffers: this.shopOffers,
      rerollCost: this.rerollCost,
      clearSummary: this.clearSummary,
      stats: this.stats,
      simTime: this.simTime,
      hitstopTimer: this.hitstopTimer,
      stageEndDelayTimer: this.stageEndDelayTimer,
    };
  }

  public drainEvents(): GameEvent[] {
    if (this.eventQueue.length === 0) return [];
    const drained = this.eventQueue;
    this.eventQueue = [];
    return drained;
  }

  public startNewRun(mode: GameMode): void {
    this.mode = mode;
    this.phase = 'PLAYING';
    this.totalRunScore = 0;
    this.medals = STARTING_MEDALS;
    this.deckTemplate = [...STARTER_DECK];
    this.pins = createInitialPins();
    this.ownedRelics = [];
    this.relicPulse = {};
    this.pendingPinInventory = [];
    this.selectedPinBrush = null;
    this.shopOffers = [];
    this.rerollCost = INITIAL_REROLL_COST;
    this.stats = createEmptyStats();
    this.simTime = 0;
    this.strokeLocked = false;
    this.launchPower = 0.52;
    this.eventQueue = [];
    this.setupStage(1);
  }

  public setLaunchPower(power: number): void {
    this.launchPower = clampLaunchPower(power);
  }

  public setStrokeLocked(locked: boolean): void {
    this.strokeLocked = Boolean(locked);
  }

  public fireBall(): boolean {
    if (this.phase !== 'PLAYING') return false;
    if (this.stageScore >= this.targetScore && this.balls.length === 0) return false;
    if (this.ballQueue.length === 0) return false;
    if (this.balls.length >= WORLD.MAX_ACTIVE_BALLS) return false;
    if (this.balls.some((b) => b.onRail && b.railProgress < 0.06)) return false;

    const kind = this.ballQueue.shift()!;
    const power = this.launchPower;
    const releaseProgress = computeReleaseProgress(power, true);
    const startSample = sampleRailPoint(0);

    let initialChips = 0;
    let initialMult = 1.0;

    if (this.ownedRelics.includes('right_stroke') && power >= 0.68) {
      initialChips += 120;
      initialMult = Number((initialMult * 1.45).toFixed(4));
      this.relicPulse['right_stroke'] = 1.0;
      this.eventQueue.push({
        type: 'RELIC_PROC',
        x: startSample.x + 24,
        y: startSample.y - 30,
        relicId: 'right_stroke',
        text: '右打ちブースト x1.45',
        color: '#ffb800',
      });
    }

    const ball: BallEntity = {
      id: this.nextBallEntityId++,
      x: startSample.x,
      y: startSample.y,
      vx: 0,
      vy: 0,
      radius: WORLD.BALL_RADIUS,
      kind,
      megaBomb: kind === 'BOMB' && this.ownedRelics.includes('blast_furnace'),
      onRail: true,
      railProgress: 0,
      railReleaseProgress: releaseProgress,
      launchPower: power,
      chips: initialChips,
      mult: initialMult,
      bounces: 0,
      splitGen: 0,
      stuckTimer: 0,
      lastPinId: -1,
      lastPinTime: -1,
      trail: [{ x: startSample.x, y: startSample.y }],
      hitPinIds: [],
      firstPinHandled: false,
      nextWizardBounce: 8,
    };

    this.balls.push(ball);
    this.stats.totalBallsFired += 1;
    this.autoFireCooldown = AUTO_FIRE_INTERVAL;

    this.eventQueue.push({
      type: 'LAUNCH',
      x: startSample.x,
      y: startSample.y,
      color: BALL_CATALOG[kind].glowColor,
      text: BALL_CATALOG[kind].shortLabel,
    });

    return true;
  }

  public step(dtRaw: number): void {
    const dt = Math.min(0.05, Math.max(0, dtRaw));
    if (dt <= 0) return;

    // Decay relic pulses in any phase
    for (const key of Object.keys(this.relicPulse)) {
      if (this.relicPulse[key] > 0) {
        this.relicPulse[key] = Math.max(0, this.relicPulse[key] - dt * 3.0);
      }
    }

    // Decay visual animations smoothly across all phases (SHOP, STAGE_CLEAR, VICTORY, etc.)
    decayBingoAnims(this.grid, dt);

    if (this.phase !== 'PLAYING') {
      this.simTime += dt;
      for (const pin of this.pins) {
        if (pin.hitAnim > 0) {
          pin.hitAnim = Math.max(0, pin.hitAnim - dt * 4.5);
        }
        if (pin.kind === 'SPINNER') {
          pin.spinAngle = (pin.spinAngle + dt * 1.4) % (Math.PI * 2);
        }
      }
      for (const pocket of this.pockets) {
        if (pocket.hitAnim > 0) {
          pocket.hitAnim = Math.max(0, pocket.hitAnim - dt * 3.5);
        }
      }
      return;
    }

    if (this.feverActive) {
      this.feverTimer = Math.max(0, this.feverTimer - dt);
      if (this.feverTimer === 0) {
        this.feverActive = false;
      }
    }

    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
      return;
    }

    if (this.feverCardResetTimer > 0) {
      this.feverCardResetTimer = Math.max(0, this.feverCardResetTimer - dt);
      if (this.feverCardResetTimer === 0) {
        const mut = this.createBingoMutator();
        resetCardAfterFeverDelay(mut);
        this.applyBingoMutator(mut);
      }
    }

    if (this.autoFireCooldown > 0) {
      this.autoFireCooldown = Math.max(0, this.autoFireCooldown - dt);
    }

    // Stroke-lock auto-firing while queue has remaining balls and score not yet cleared
    if (
      this.strokeLocked &&
      this.ballQueue.length > 0 &&
      this.autoFireCooldown <= 0 &&
      this.stageScore < this.targetScore
    ) {
      this.fireBall();
    }

    // Advance sub-stepped 2D physics
    const captured = stepPhysics(dt, {
      balls: this.balls,
      pins: this.pins,
      pockets: this.pockets,
      reachColumns: this.reachColumns,
      ownedRelics: this.ownedRelics,
      simTime: this.simTime,
      nextBallId: () => this.nextBallEntityId++,
      onPinballWizardCellOpen: (ball) => {
        const mut = this.createBingoMutator();
        triggerLightningCellOpen(mut, ball);
        this.applyBingoMutator(mut);
      },
      onRelicPulse: (relicId) => {
        this.relicPulse[relicId] = 1.0;
      },
      onPinHitStat: () => {
        this.stats.totalPinsHit += 1;
      },
      events: this.eventQueue,
    });

    // Advance engine simTime to stay synchronized with physics step
    this.simTime += dt;

    if (captured.length > 0) {
      const mut = this.createBingoMutator();
      for (const entry of captured) {
        resolveBallInPocket(entry.ball, entry.col, mut);
      }
      this.applyBingoMutator(mut);
    }

    // Stage End Evaluation once all active balls have settled into pockets
    if (this.balls.length === 0) {
      if (this.stageScore >= this.targetScore) {
        this.stageEndDelayTimer += dt;
        if (this.stageEndDelayTimer >= STAGE_END_DELAY) {
          this.completeStageClear();
        }
      } else if (this.ballQueue.length === 0) {
        this.stageEndDelayTimer += dt;
        if (this.stageEndDelayTimer >= STAGE_END_DELAY) {
          this.phase = 'GAME_OVER';
          this.eventQueue.push({
            type: 'GAME_OVER',
            x: WORLD.WIDTH / 2,
            y: WORLD.HEIGHT / 2,
            value: this.stageScore,
            text: 'STAGE FAILED',
            color: '#ff2a5f',
          });
        }
      } else {
        this.stageEndDelayTimer = 0;
      }
    } else {
      this.stageEndDelayTimer = 0;
    }
  }

  private completeStageClear(): void {
    const unusedBalls = this.ballQueue.length;
    const baseReward = 35 + this.stage * 10;
    const ballBonus = unusedBalls * 8;
    const bingoBonus = this.stageBingos * 6;
    const totalMedalsEarned = baseReward + ballBonus + bingoBonus;

    this.medals += totalMedalsEarned;
    this.stats.stagesCleared += 1;
    this.clearSummary = {
      stage: this.stage,
      stageScore: this.stageScore,
      targetScore: this.targetScore,
      unusedBalls,
      baseReward,
      ballBonus,
      bingoBonus,
      totalMedalsEarned,
    };

    if (this.mode === 'STANDARD' && this.stage >= MAX_STANDARD_STAGE) {
      this.phase = 'VICTORY';
    } else {
      this.phase = 'STAGE_CLEAR';
    }

    this.eventQueue.push({
      type: 'STAGE_CLEAR',
      x: WORLD.WIDTH / 2,
      y: WORLD.HEIGHT / 2,
      value: totalMedalsEarned,
      text: `STAGE ${this.stage} CLEAR!`,
      color: '#ffd000',
    });
  }

  public proceedFromStageClear(): void {
    if (this.phase !== 'STAGE_CLEAR' && this.phase !== 'VICTORY') return;
    this.phase = 'SHOP';
    this.rerollCost = INITIAL_REROLL_COST;
    this.generateShopOffers();
  }

  public buyShopOffer(offerId: string): boolean {
    if (this.phase !== 'SHOP') return false;
    const offer = this.shopOffers.find((o) => o.id === offerId);
    if (!offer || offer.sold) return false;
    if (this.medals < offer.cost) return false;

    if (offer.offerKind === 'RELIC' && offer.relicId) {
      if (this.ownedRelics.length >= 6) return false;
      if (this.ownedRelics.includes(offer.relicId)) return false;
      this.ownedRelics.push(offer.relicId);
      this.relicPulse[offer.relicId] = 1.0;
    } else if (offer.offerKind === 'BALL' && offer.ballKind) {
      this.deckTemplate.push(offer.ballKind);
    } else if (offer.offerKind === 'PIN' && offer.pinKind) {
      this.pendingPinInventory.push(offer.pinKind);
      this.selectedPinBrush = offer.pinKind;
    } else {
      return false;
    }

    this.medals -= offer.cost;
    offer.sold = true;

    this.eventQueue.push({
      type: 'SHOP_BUY',
      x: WORLD.WIDTH / 2,
      y: WORLD.HEIGHT / 2,
      value: offer.cost,
      text: offer.name,
      color: offer.accentColor,
    });

    return true;
  }

  public rerollShop(): boolean {
    if (this.phase !== 'SHOP') return false;
    if (this.medals < this.rerollCost) return false;

    this.medals -= this.rerollCost;
    this.rerollCost += 5;
    this.generateShopOffers();
    return true;
  }

  public selectPinBrush(kind: PinKind | null): void {
    if (kind === null) {
      this.selectedPinBrush = null;
      return;
    }
    if (this.pendingPinInventory.includes(kind)) {
      this.selectedPinBrush = kind;
    }
  }

  public placePinOnSlot(pinId: number): boolean {
    if (this.phase !== 'SHOP') return false;

    const pin = this.pins.find((p) => p.id === pinId);
    if (!pin || !pin.customizable) return false;

    // If no brush is active, allow picking up an already-installed special pin to relocate it
    if (!this.selectedPinBrush || this.pendingPinInventory.length === 0) {
      if (pin.kind === 'NORMAL') return false;
      const pickedKind = pin.kind;
      pin.kind = 'NORMAL';
      pin.radius = PIN_CATALOG.NORMAL.radius;
      pin.hitAnim = 1.0;
      this.pendingPinInventory.push(pickedKind);
      this.selectedPinBrush = pickedKind;
      return true;
    }

    const brushIdx = this.pendingPinInventory.indexOf(this.selectedPinBrush);
    if (brushIdx === -1) return false;

    const newKind = this.selectedPinBrush;
    if (pin.kind === newKind) return false;

    // Consume brush from inventory
    this.pendingPinInventory.splice(brushIdx, 1);

    // If replacing an existing special pin, swap it back into inventory so nothing is lost
    const previousKind = pin.kind;
    if (previousKind !== 'NORMAL') {
      this.pendingPinInventory.push(previousKind);
    }

    pin.kind = newKind;
    pin.radius = PIN_CATALOG[newKind].radius;
    pin.hitAnim = 1.0;

    if (!this.pendingPinInventory.includes(this.selectedPinBrush)) {
      this.selectedPinBrush =
        this.pendingPinInventory.length > 0
          ? this.pendingPinInventory[0]
          : null;
    }

    return true;
  }

  public autoOptimizePins(): number {
    if (this.pendingPinInventory.length === 0) return 0;

    let placedCount = 0;
    const remaining: PinKind[] = [...this.pendingPinInventory];
    const nextInventory: PinKind[] = [];

    for (const kind of remaining) {
      const openSlots = this.pins.filter(
        (p) => p.customizable && p.kind === 'NORMAL'
      );
      if (openSlots.length === 0) {
        nextInventory.push(kind);
        continue;
      }

      openSlots.sort(
        (a, b) => pinSlotPriorityScore(b, kind) - pinSlotPriorityScore(a, kind)
      );
      const chosen = openSlots[0];
      chosen.kind = kind;
      chosen.radius = PIN_CATALOG[kind].radius;
      chosen.hitAnim = 1.0;
      placedCount++;
    }

    this.pendingPinInventory = nextInventory;
    this.selectedPinBrush =
      this.pendingPinInventory.length > 0
        ? this.pendingPinInventory[0]
        : null;

    return placedCount;
  }

  public sellRelic(relicId: RelicId): boolean {
    if (this.phase !== 'SHOP') return false;
    const idx = this.ownedRelics.indexOf(relicId);
    if (idx === -1) return false;

    this.ownedRelics.splice(idx, 1);
    delete this.relicPulse[relicId];
    const refund = Math.floor(RELIC_CATALOG[relicId].cost * 0.5);
    this.medals += refund;
    return true;
  }

  public startNextStage(): void {
    if (this.phase !== 'SHOP') return;
    if (this.pendingPinInventory.length > 0) {
      this.autoOptimizePins();
    }
    this.phase = 'PLAYING';
    this.setupStage(this.stage + 1);
  }

  public continueIntoEndless(): void {
    if (this.phase !== 'VICTORY') return;
    this.mode = 'ENDLESS';
    this.phase = 'SHOP';
    this.rerollCost = INITIAL_REROLL_COST;
    this.generateShopOffers();
  }

  public returnToTitle(): void {
    this.phase = 'TITLE';
    this.balls = [];
    this.strokeLocked = false;
    this.feverActive = false;
    this.feverTimer = 0;
    this.feverCardResetTimer = 0;
    this.clearSummary = null;
    this.eventQueue = [];
  }

  public getTrajectoryPreview(power?: number): TrailPoint[] {
    const p = power !== undefined ? clampLaunchPower(power) : this.launchPower;
    return getTrajectoryPreview(p);
  }

  /** E2E verification helper: forces Stage Clear from PLAYING */
  public debugForceStageClear(): void {
    if (this.phase !== 'PLAYING') return;
    if (this.stageScore < this.targetScore) {
      const diff = this.targetScore - this.stageScore + 250;
      this.stageScore += diff;
      this.totalRunScore += diff;
    }
    this.balls = [];
    this.completeStageClear();
  }

  /** E2E verification helper: grants shop medals */
  public debugGrantMedals(amount: number): void {
    if (!Number.isFinite(amount)) return;
    this.medals = Math.max(0, Math.round(this.medals + amount));
  }

  /** E2E verification helper: showcases mid/late-game Overdrive + Fever + Splitter/Bomb explosion */
  public debugTriggerInflationShowcase(): void {
    if (this.phase !== 'PLAYING') {
      this.startNewRun('STANDARD');
    }

    this.stage = Math.max(this.stage, 6);
    this.targetScore = getStageTargetScore(this.stage);
    this.feverActive = true;
    this.feverTimer = 10.0;
    this.feverCardResetTimer = 0;
    this.stageMult = 48.5;
    this.stats.maxStageMult = Math.max(this.stats.maxStageMult, 48.5);
    this.stageScore = Math.max(this.stageScore, 420_000);
    this.totalRunScore = Math.max(this.totalRunScore, 680_000);

    if (!this.ownedRelics.includes('reignite_amp')) this.ownedRelics.push('reignite_amp');
    if (!this.ownedRelics.includes('blast_furnace')) this.ownedRelics.push('blast_furnace');
    if (!this.ownedRelics.includes('overdrive_arc')) this.ownedRelics.push('overdrive_arc');

    // Open multiple cells and awaken Overdrive on columns 1 and 3
    for (let r = 0; r < 5; r++) {
      this.grid[r][1].opened = true;
      this.grid[r][3].opened = true;
      this.grid[r][1].reigniteCount = Math.max(1, this.grid[r][1].reigniteCount);
    }
    this.grid[0][2].opened = true;
    this.grid[1][2].opened = true;
    this.grid[3][2].opened = true;
    this.pockets[1].overdrive = true;
    this.pockets[1].overdriveLevel = 2;
    this.pockets[3].overdrive = true;
    this.pockets[3].overdriveLevel = 1;

    // Install SPLITTER and BOMB_PIN onto customizable slots
    const customSlots = this.pins.filter((p) => p.customizable);
    if (customSlots[0]) {
      customSlots[0].kind = 'SPLITTER';
      customSlots[0].radius = PIN_CATALOG.SPLITTER.radius;
    }
    if (customSlots[1]) {
      customSlots[1].kind = 'BOMB_PIN';
      customSlots[1].radius = PIN_CATALOG.BOMB_PIN.radius;
    }
    if (customSlots[2]) {
      customSlots[2].kind = 'SPLITTER';
      customSlots[2].radius = PIN_CATALOG.SPLITTER.radius;
    }

    this.syncGridLineStates();

    // Launch 3 live special balls (BOMB, GOLD, BOMB) directly into the upper field
    const showcaseBalls: Array<{ kind: BallKind; x: number; y: number; vx: number; vy: number }> = [
      { kind: 'BOMB', x: 185, y: 120, vx: 38, vy: 165 },
      { kind: 'GOLD', x: 285, y: 112, vx: -15, vy: 180 },
      { kind: 'BOMB', x: 392, y: 122, vx: -42, vy: 170 },
    ];
    for (const spec of showcaseBalls) {
      if (this.balls.length >= WORLD.MAX_ACTIVE_BALLS) break;
      this.balls.push({
        id: this.nextBallEntityId++,
        x: spec.x,
        y: spec.y,
        vx: spec.vx,
        vy: spec.vy,
        radius: WORLD.BALL_RADIUS,
        kind: spec.kind,
        megaBomb: spec.kind === 'BOMB',
        onRail: false,
        railProgress: 0.7,
        railReleaseProgress: 0.7,
        launchPower: 0.6,
        chips: 320,
        mult: 2.5,
        bounces: 4,
        splitGen: 0,
        stuckTimer: 0,
        lastPinId: -1,
        lastPinTime: -1,
        trail: [{ x: spec.x, y: spec.y }],
        hitPinIds: [],
        firstPinHandled: false,
        nextWizardBounce: 8,
      });
    }
  }

  /** E2E verification helper: transitions directly to Stage 8 VICTORY screen */
  public debugForceVictory(): void {
    this.mode = 'STANDARD';
    this.stage = MAX_STANDARD_STAGE;
    this.targetScore = getStageTargetScore(MAX_STANDARD_STAGE);
    this.stageScore = 8_640_500;
    this.totalRunScore = Math.max(this.totalRunScore, 14_920_800);
    this.stageMult = 128.4;
    this.cardLevel = 4;
    this.medals += 240;
    this.balls = [];
    this.stats = {
      totalBingos: 34,
      totalFullCards: 3,
      highestSingleShot: 4_850_200,
      maxStageMult: 128.4,
      totalBallsFired: 96,
      totalPinsHit: 812,
      stagesCleared: 8,
    };
    this.clearSummary = {
      stage: MAX_STANDARD_STAGE,
      stageScore: this.stageScore,
      targetScore: this.targetScore,
      unusedBalls: 4,
      baseReward: 115,
      ballBonus: 32,
      bingoBonus: 48,
      totalMedalsEarned: 195,
    };
    this.phase = 'VICTORY';
  }
}

export function createGameEngine(): IGameEngine {
  return new NeonPachinkoEngine();
}
