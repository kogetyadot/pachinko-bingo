import {
  BallDef,
  BallKind,
  BingoLineDef,
  PinDef,
  PinKind,
  RelicDef,
  RelicId,
  WORLD,
} from '../types';

export const PIN_CATALOG: Record<PinKind, PinDef> = {
  NORMAL: {
    kind: 'NORMAL',
    name: 'ネオン釘',
    shortLabel: 'STD',
    description: '標準の反発ピン。接触ごとに基礎チップ +15 とコンボ音階を刻む。',
    cost: 0,
    color: '#00f0ff',
    radius: 6.5,
  },
  SPLITTER: {
    kind: 'SPLITTER',
    name: '三連プリズム釘',
    shortLabel: 'x3分裂',
    description: '接触した玉を3個に分裂させる超重要ピン（同一玉につき1回発動）。',
    cost: 45,
    color: '#00ff88',
    radius: 10.5,
  },
  BUMPER: {
    kind: 'BUMPER',
    name: '高圧バンパー',
    shortLabel: '強反発',
    description: '強烈な電磁反発で玉を弾き飛ばし、基礎チップ +75 ＆ コンボ +2。',
    cost: 30,
    color: '#ffb800',
    radius: 13.5,
  },
  SPINNER: {
    kind: 'SPINNER',
    name: '倍率スピナー',
    shortLabel: '倍率x1.4',
    description: '通過する玉の軌道を妨げず回転し、その玉の獲得倍率を ×1.4 増幅する。',
    cost: 40,
    color: '#ff2a5f',
    radius: 11.0,
  },
  BOMB_PIN: {
    kind: 'BOMB_PIN',
    name: '爆縮イグナイタ',
    shortLabel: '爆弾化',
    description: '接触した玉を「ボム球」に着火！既にボム球なら3×3全域爆破へ強化。',
    cost: 50,
    color: '#ff6b00',
    radius: 10.5,
  },
  MAGNET: {
    kind: 'MAGNET',
    name: 'リーチ誘導コア',
    shortLabel: '誘導',
    description: '現在リーチ中またはOVERDRIVE中の列方向へ玉の軌道を吸い寄せる（+40チップ）。',
    cost: 35,
    color: '#38bdf8',
    radius: 11.0,
  },
};

export const BALL_CATALOG: Record<BallKind, BallDef> = {
  STEEL: {
    kind: 'STEEL',
    name: 'クローム球',
    shortLabel: 'CHROME',
    description: '安定した反発を持つ標準の超硬クローム球。',
    cost: 15,
    color: '#e2e8f0',
    glowColor: '#00f0ff',
  },
  BOMB: {
    kind: 'BOMB',
    name: 'ボム球',
    shortLabel: 'BOMB',
    description: 'ポケット突入時、対象マスと上下左右の計5マスを一挙に爆破開放（既開放マスは再点火）！',
    cost: 38,
    color: '#ff5500',
    glowColor: '#ff2a5f',
  },
  MULTI: {
    kind: 'MULTI',
    name: 'ミラージュ球',
    shortLabel: 'TWIN',
    description: '最初のピンに当たった瞬間に2個の玉へ分裂する手数倍増ボール。',
    cost: 36,
    color: '#00ff88',
    glowColor: '#00ff88',
  },
  LASER: {
    kind: 'LASER',
    name: 'レーザー貫通球',
    shortLabel: 'LASER',
    description: '入った列を縦に貫通し、未開放2マス同時開放＋その列の全開放済みマスを再点火！',
    cost: 44,
    color: '#00f0ff',
    glowColor: '#38bdf8',
  },
  GOLD: {
    kind: 'GOLD',
    name: 'ジャックポット金球',
    shortLabel: 'GOLD',
    description: '基礎チップ3倍・ポケット突入で資金 +¥10。OVERDRIVE列なら効果を2連発動！',
    cost: 48,
    color: '#ffd000',
    glowColor: '#ffb800',
  },
};

export const RELIC_CATALOG: Record<RelicId, RelicDef> = {
  reignite_amp: {
    id: 'reignite_amp',
    name: '再点火コンデンサ',
    description: '既開放マスへの再点火ごとにステージ倍率 +0.65x ＆ ×1.05乗算増幅（ボム・レーザーと超相性◎）！',
    cost: 65,
    rarity: 'LEGENDARY',
    accentColor: '#ff2a5f',
  },
  prism_core: {
    id: 'prism_core',
    name: 'プリズム増幅器',
    description: '玉が分裂するたび、分裂した全ての玉に基礎チップ +80 ＆ 玉倍率 ×1.25 を付与。',
    cost: 55,
    rarity: 'RARE',
    accentColor: '#00ff88',
  },
  blast_furnace: {
    id: 'blast_furnace',
    name: '連鎖爆縮炉',
    description: '全てのボム球の爆発範囲が十字（5マス）から周囲8マスを含む 3×3 全域に拡大！',
    cost: 60,
    rarity: 'LEGENDARY',
    accentColor: '#ff6b00',
  },
  overdrive_arc: {
    id: 'overdrive_arc',
    name: '過電流アーク',
    description: '列覚醒（OVERDRIVE）突入時の倍率上昇を ×1.35（+2.0x）に強化＆電撃飛び火が2マスに増加！',
    cost: 62,
    rarity: 'LEGENDARY',
    accentColor: '#00f0ff',
  },
  pinball_wizard: {
    id: 'pinball_wizard',
    name: 'ハイボルテージ釘師',
    description: '玉が釘に8回当たるごとに、その玉の倍率 ×1.45 ＆ ランダムな未開放マスを1つ電撃開放！',
    cost: 52,
    rarity: 'RARE',
    accentColor: '#ffb800',
  },
  diagonal_king: {
    id: 'diagonal_king',
    name: 'クロスライン覇者',
    description: '斜めラインのBINGO成立時、ラインボーナス ×2.5倍 ＆ ステージ倍率 +2.5x 追加上昇。',
    cost: 45,
    rarity: 'COMMON',
    accentColor: '#ff2a5f',
  },
  right_stroke: {
    id: 'right_stroke',
    name: '右打ちブースト回路',
    description: 'パワー68%以上（右打ち領域）で発射した玉は、初期チップ +120 ＆ 玉倍率 ×1.45。',
    cost: 42,
    rarity: 'COMMON',
    accentColor: '#ffb800',
  },
  left_trick: {
    id: 'left_trick',
    name: '左打ちプリズム機構',
    description: 'パワー42%以下（左打ち領域）で発射した玉は、最初の釘接触時に50%で2分裂する。',
    cost: 44,
    rarity: 'COMMON',
    accentColor: '#00ff88',
  },
  reach_radar: {
    id: 'reach_radar',
    name: 'リーチロックオン',
    description: '盤面にリーチ（残り1マス）が存在する間、全てのスコア獲得量が ×1.6倍 に上昇。',
    cost: 46,
    rarity: 'RARE',
    accentColor: '#00f0ff',
  },
  fever_engine: {
    id: 'fever_engine',
    name: '永久機関フィーバー',
    description: 'FULL BINGO（全25マス開放）達成時、FEVER追加球 +3球（1ステージ2回まで）＆ 倍率 ×1.35！',
    cost: 58,
    rarity: 'RARE',
    accentColor: '#ffd000',
  },
  medal_magnet: {
    id: 'medal_magnet',
    name: '黄金メダル回収機',
    description: 'BINGOが1列成立するたび、ショップ資金 +¥10 を即時獲得（1ステージ最大 +¥60）。',
    cost: 40,
    rarity: 'COMMON',
    accentColor: '#ffb800',
  },
  extra_magazine: {
    id: 'extra_magazine',
    name: '拡張マガジン',
    description: '毎ステージ開始時に補充される持ち玉数が +3球（銀玉2＋ボム1）増加する。',
    cost: 54,
    rarity: 'RARE',
    accentColor: '#38bdf8',
  },
};

export const STAGE_TARGETS: number[] = [
  2200,    // Stage 1: Crisp 1-2 Bingo clear, teaches aiming & Reach
  6500,    // Stage 2: Center N-col bonus & first Shop upgrade
  18000,   // Stage 3: Left-chance route crafting
  48000,   // Stage 4: Diagonal Bingo synergy test
  130000,  // Stage 5: Right-Hit RUSH build spike
  340000,  // Stage 6: High-Voltage yakumono chaining
  880000,  // Stage 7: Overdrive surge mastery
  2200000, // Stage 8: Final Boss Golden Cabinet
];

export const STAGE_MODIFIERS = [
  {
    id: 'STANDARD' as const,
    name: '標準台',
    shortDesc: '狙いの列に落としてBINGOを揃えよう！',
    accentColor: '#f5b942',
  },
  {
    id: 'CENTER_BONUS' as const,
    name: '中央N列ボーナスタイム',
    shortDesc: '中央「N」入賞口で基礎チップ +140！',
    accentColor: '#fbbf24',
    preferredRoute: 'CENTER' as const,
  },
  {
    id: 'LEFT_CHANCE' as const,
    name: '左打ちチャンス台',
    shortDesc: '左打ち(42%以下)の玉は釘チップ ×1.6！',
    accentColor: '#34d399',
    preferredRoute: 'LEFT' as const,
  },
  {
    id: 'DIAGONAL_GOLD' as const,
    name: '斜めビンゴ高配当台',
    shortDesc: '斜めラインBINGOの獲得スコア ×2.0！',
    accentColor: '#fb7185',
  },
  {
    id: 'RIGHT_RUSH' as const,
    name: '右打ちRUSH台',
    shortDesc: '右打ち(68%以上)の玉は初期倍率 ×1.4！',
    accentColor: '#f97316',
    preferredRoute: 'RIGHT' as const,
  },
  {
    id: 'HIGH_VOLTAGE' as const,
    name: '高電圧役物台',
    shortDesc: 'バンパー＆風車の獲得チップ・倍率が強化！',
    accentColor: '#fde047',
  },
  {
    id: 'OVERDRIVE_SURGE' as const,
    name: '覚醒加速台',
    shortDesc: '列OVERDRIVE突入時の倍率上昇が大幅UP！',
    accentColor: '#10b981',
  },
  {
    id: 'GOLDEN_BOSS' as const,
    name: '大決戦・黄金筐体',
    shortDesc: '全BINGO配当 ×1.5！最強ビルドで撃破せよ！',
    accentColor: '#fde047',
  },
];

export function getStageModifier(stage: number) {
  if (stage <= STAGE_MODIFIERS.length) {
    return STAGE_MODIFIERS[Math.max(0, stage - 1)];
  }
  const cycle = STAGE_MODIFIERS.slice(1);
  return cycle[(stage - 1) % cycle.length];
}

export function getStageTargetScore(stage: number): number {
  if (stage <= STAGE_TARGETS.length) {
    return STAGE_TARGETS[Math.max(0, stage - 1)];
  }
  const extra = stage - STAGE_TARGETS.length;
  return Math.round(STAGE_TARGETS[STAGE_TARGETS.length - 1] * Math.pow(2.45, extra));
}

export const POCKET_LABELS: Array<'B' | 'I' | 'N' | 'G' | 'O'> = ['B', 'I', 'N', 'G', 'O'];

export const ALL_BINGO_LINES: BingoLineDef[] = (() => {
  const lines: BingoLineDef[] = [];
  for (let r = 0; r < 5; r++) {
    lines.push({
      id: `ROW_${r}`,
      kind: 'ROW',
      index: r,
      cells: [
        [r, 0],
        [r, 1],
        [r, 2],
        [r, 3],
        [r, 4],
      ],
    });
  }
  for (let c = 0; c < 5; c++) {
    lines.push({
      id: `COL_${c}`,
      kind: 'COL',
      index: c,
      cells: [
        [0, c],
        [1, c],
        [2, c],
        [3, c],
        [4, c],
      ],
    });
  }
  lines.push({
    id: 'DIAG_0',
    kind: 'DIAG',
    index: 0,
    cells: [
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ],
  });
  lines.push({
    id: 'DIAG_1',
    kind: 'DIAG',
    index: 1,
    cells: [
      [0, 4],
      [1, 3],
      [2, 2],
      [3, 1],
      [4, 0],
    ],
  });
  return lines;
})();

export interface InitialPinBlueprint {
  x: number;
  y: number;
  kind: PinKind;
  customizable: boolean;
}

/**
 * Carefully tuned pachinko pin matrix spanning x: 50..525, y: 122..462.
 * Leaves clean outer Left & Right-Hit entry channels at the top so player launch power
 * genuinely steers balls toward desired B-I-N-G-O columns!
 */
export function createDefaultPinLayout(): InitialPinBlueprint[] {
  const pins: InitialPinBlueprint[] = [];
  const left = WORLD.BOARD_LEFT; // 50
  const width = WORLD.BOARD_WIDTH; // 475
  const rows = [
    { y: 126, count: 5, padX: 56, customIndices: [1, 3] },
    { y: 172, count: 6, padX: 38, customIndices: [1, 2, 4] },
    { y: 220, count: 6, padX: 52, customIndices: [0, 2, 3, 5] },
    { y: 270, count: 7, padX: 32, customIndices: [1, 2, 4, 5] },
    { y: 320, count: 6, padX: 48, customIndices: [1, 2, 3, 4] },
    { y: 372, count: 7, padX: 30, customIndices: [0, 2, 4, 6] },
    { y: 422, count: 6, padX: 46, customIndices: [1, 4] },
    { y: 462, count: 5, padX: 48, customIndices: [] }, // Final guard pins centered above pockets
  ];

  rows.forEach((row, rIdx) => {
    const usableW = width - row.padX * 2;
    for (let i = 0; i < row.count; i++) {
      const t = row.count === 1 ? 0.5 : i / (row.count - 1);
      const x = Math.round(left + row.padX + t * usableW);
      const customizable = row.customIndices.includes(i);

      // Stage 1 starts with 1 tactile BUMPER and 1 SPINNER so players feel pin variety immediately,
      // while SPLITTER & BOMB_PIN upgrades in the Shop create dramatic build power spikes!
      let kind: PinKind = 'NORMAL';
      if (rIdx === 3 && i === 2) kind = 'BUMPER';
      if (rIdx === 4 && i === 3) kind = 'SPINNER';

      pins.push({ x, y: row.y, kind, customizable });
    }
  });

  return pins;
}

export function formatScore(n: number): string {
  if (!Number.isFinite(n)) return 'MAX';
  const rounded = Math.floor(Math.max(0, n));
  if (rounded < 100_000) {
    return rounded.toLocaleString('en-US');
  }
  if (rounded < 100_000_000) {
    const man = rounded / 10_000;
    return man >= 1000 ? `${Math.round(man).toLocaleString('en-US')}万` : `${man.toFixed(1)}万`;
  }
  if (rounded < 1_000_000_000_000) {
    const oku = rounded / 100_000_000;
    return oku >= 100 ? `${Math.round(oku).toLocaleString('en-US')}億` : `${oku.toFixed(2)}億`;
  }
  const cho = rounded / 1_000_000_000_000;
  return cho >= 100 ? `${Math.round(cho).toLocaleString('en-US')}兆` : `${cho.toFixed(2)}兆`;
}

export function formatMult(m: number): string {
  if (!Number.isFinite(m)) return 'xMAX';
  if (m >= 10_000) {
    return `x${formatScore(Math.round(m))}`;
  }
  if (m >= 100) {
    return `x${Math.round(m).toLocaleString('en-US')}`;
  }
  if (m >= 10) {
    return `x${Number(m.toFixed(1))}`;
  }
  return `x${Number(m.toFixed(2))}`;
}
