export type GamePhase =
  | 'TITLE'
  | 'PLAYING'
  | 'STAGE_CLEAR'
  | 'SHOP'
  | 'GAME_OVER'
  | 'VICTORY';

export type GameMode = 'STANDARD' | 'ENDLESS';

export type PinKind =
  | 'NORMAL'
  | 'SPLITTER'
  | 'BUMPER'
  | 'SPINNER'
  | 'BOMB_PIN'
  | 'MAGNET';

export type BallKind = 'STEEL' | 'BOMB' | 'MULTI' | 'LASER' | 'GOLD';

export type RelicId =
  | 'reignite_amp'
  | 'prism_core'
  | 'blast_furnace'
  | 'overdrive_arc'
  | 'pinball_wizard'
  | 'diagonal_king'
  | 'right_stroke'
  | 'left_trick'
  | 'reach_radar'
  | 'fever_engine'
  | 'medal_magnet'
  | 'extra_magazine';

export interface PinDef {
  kind: PinKind;
  name: string;
  shortLabel: string;
  description: string;
  cost: number;
  color: string;
  radius: number;
}

export interface BallDef {
  kind: BallKind;
  name: string;
  shortLabel: string;
  description: string;
  cost: number;
  color: string;
  glowColor: string;
}

export interface RelicDef {
  id: RelicId;
  name: string;
  description: string;
  cost: number;
  rarity: 'COMMON' | 'RARE' | 'LEGENDARY';
  accentColor: string;
}

export interface PinEntity {
  id: number;
  x: number;
  y: number;
  radius: number;
  kind: PinKind;
  customizable: boolean;
  hitAnim: number; // 0..1 decay for flash/ring animation
  spinAngle: number; // radians for SPINNER / prism visuals
  cooldownUntil: number; // simulation time seconds
}

export interface TrailPoint {
  x: number;
  y: number;
}

export interface BallEntity {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  kind: BallKind;
  megaBomb: boolean; // true if BOMB upgraded to 3x3 blast
  onRail: boolean;
  railProgress: number; // 0..1 along launch rail
  railReleaseProgress: number; // target 0..1 exit point based on launch power
  launchPower: number; // 0..1
  chips: number;
  mult: number;
  bounces: number;
  splitGen: number; // 0 = original, 1+ = split child
  stuckTimer: number;
  lastPinId: number;
  lastPinTime: number;
  trail: TrailPoint[];
  hitPinIds: number[]; // pins already triggered for one-shot effects like SPLITTER
  firstPinHandled?: boolean;
  nextWizardBounce?: number;
}

export interface BingoCell {
  row: number; // 0..4
  col: number; // 0..4
  number: number; // 1..75 traditional bingo range or 0 for FREE
  isFree: boolean;
  opened: boolean;
  reigniteCount: number;
  baseChips: number;
  openAnim: number; // 0..1 decay
  reigniteAnim: number; // 0..1 decay
  inBingoLine: boolean;
  inReachLine: boolean;
}

export interface BingoLineDef {
  id: string;
  kind: 'ROW' | 'COL' | 'DIAG';
  index: number;
  cells: Array<[number, number]>; // [row, col]
}

export interface PocketState {
  col: number; // 0..4
  label: 'B' | 'I' | 'N' | 'G' | 'O';
  xCenter: number;
  xLeft: number;
  xRight: number;
  overdrive: boolean;
  overdriveLevel: number; // increments each time overdrive triggers
  isReachTarget: boolean;
  hitAnim: number; // 0..1 decay
}

export type GameEventType =
  | 'LAUNCH'
  | 'PIN_HIT'
  | 'BALL_SPLIT'
  | 'BOMB_IGNITE'
  | 'POCKET_ENTER'
  | 'CELL_OPEN'
  | 'CELL_REIGNITE'
  | 'BOMB_BLAST'
  | 'OVERDRIVE_TRIGGER'
  | 'OVERDRIVE_AWAKEN'
  | 'BINGO_LINE'
  | 'FULL_BINGO_FEVER'
  | 'RELIC_PROC'
  | 'ANTI_STUCK_NUDGE'
  | 'STAGE_CLEAR'
  | 'GAME_OVER'
  | 'SHOP_BUY';

export interface GameEvent {
  type: GameEventType;
  x: number;
  y: number;
  targetX?: number;
  targetY?: number;
  value?: number;
  mult?: number;
  combo?: number;
  col?: number;
  row?: number;
  text?: string;
  subtext?: string;
  color?: string;
  relicId?: RelicId;
  lineCells?: Array<[number, number]>;
}

export type ShopOfferKind = 'PIN' | 'BALL' | 'RELIC';

export interface ShopOffer {
  id: string;
  offerKind: ShopOfferKind;
  pinKind?: PinKind;
  ballKind?: BallKind;
  relicId?: RelicId;
  name: string;
  description: string;
  cost: number;
  accentColor: string;
  rarityLabel: string;
  sold: boolean;
}

export interface RunStats {
  totalBingos: number;
  totalFullCards: number;
  highestSingleShot: number;
  maxStageMult: number;
  totalBallsFired: number;
  totalPinsHit: number;
  stagesCleared: number;
}

export interface StageClearSummary {
  stage: number;
  stageScore: number;
  targetScore: number;
  unusedBalls: number;
  baseReward: number;
  ballBonus: number;
  bingoBonus: number;
  totalMedalsEarned: number;
}

export interface GameStateSnapshot {
  phase: GamePhase;
  mode: GameMode;
  stage: number;
  maxStandardStage: number;
  stageScore: number;
  totalRunScore: number;
  targetScore: number;
  stageMult: number;
  cardLevel: number;
  medals: number;
  feverActive: boolean;
  feverTimer: number;
  launchPower: number; // 0..1 current handle setting
  strokeLocked: boolean;
  autoFireCooldown: number;
  ballQueue: BallKind[]; // remaining balls for current stage (index 0 is next to fire)
  deckTemplate: BallKind[]; // full persistent ball deck across stages
  pins: PinEntity[];
  balls: BallEntity[];
  pockets: PocketState[];
  grid: BingoCell[][]; // [row 0..4][col 0..4]
  completedLineIds: string[];
  reachColumns: boolean[]; // length 5
  ownedRelics: RelicId[];
  relicPulse: Record<string, number>; // relicId -> 0..1 spring animation
  pendingPinInventory: PinKind[]; // purchased pins waiting to be placed (or auto-placed)
  selectedPinBrush: PinKind | null;
  shopOffers: ShopOffer[];
  rerollCost: number;
  clearSummary: StageClearSummary | null;
  stats: RunStats;
  simTime: number;
  hitstopTimer: number;
  stageEndDelayTimer: number;
}

/** Logical coordinate constants shared by Physics, Bingo, Renderer, and Input */
export const WORLD = {
  WIDTH: 540,
  HEIGHT: 920,
  RAIL_X_MIN: 14,
  RAIL_X_CENTER: 31,
  RAIL_X_MAX: 48,
  BOARD_LEFT: 50,
  BOARD_RIGHT: 525,
  BOARD_WIDTH: 475, // 5 columns * 95px
  DOME_TOP: 18,
  DOME_CENTER_X: 280,
  DOME_CENTER_Y: 116,
  PIN_AREA_TOP: 96,
  PIN_AREA_BOTTOM: 488,
  POCKET_TOP: 492,
  POCKET_BOTTOM: 552,
  BINGO_TOP: 568,
  BINGO_BOTTOM: 904,
  COL_WIDTH: 95,
  BALL_RADIUS: 8.5,
  MAX_ACTIVE_BALLS: 48,
  GRAVITY: 690,
} as const;

export interface IGameEngine {
  getState(): GameStateSnapshot;
  drainEvents(): GameEvent[];
  startNewRun(mode: GameMode): void;
  step(dt: number): void;
  setLaunchPower(power: number): void;
  setStrokeLocked(locked: boolean): void;
  fireBall(): boolean;
  proceedFromStageClear(): void;
  buyShopOffer(offerId: string): boolean;
  rerollShop(): boolean;
  selectPinBrush(kind: PinKind | null): void;
  placePinOnSlot(pinId: number): boolean;
  autoOptimizePins(): number;
  sellRelic(relicId: RelicId): boolean;
  startNextStage(): void;
  continueIntoEndless(): void;
  returnToTitle(): void;
  /** Preview trajectory points in logical WORLD coordinates for current launchPower */
  getTrajectoryPreview(power?: number): Array<{ x: number; y: number }>;
}
