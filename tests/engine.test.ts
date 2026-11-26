import { describe, expect, it } from 'vitest';
import { BallEntity, GameEvent, RelicId, StageModifierDef, WORLD } from '../src/types';
import { createGameEngine, NeonPachinkoEngine } from '../src/game/engine';
import {
  computeReleaseProgress,
  getTrajectoryPreview,
  sampleRailPoint,
} from '../src/game/rail';
import { stepPhysics } from '../src/game/physics';
import {
  BingoStateMutator,
  createBingoCard,
  createInitialPockets,
  resetCardAfterFeverDelay,
  resolveBallInPocket,
} from '../src/game/bingo';
import { BALL_CATALOG, getStageModifier, PIN_CATALOG } from '../src/data/catalog';

function stepUntilIdle(engine: NeonPachinkoEngine, maxSeconds = 12): number {
  const dt = 1 / 60;
  const maxSteps = Math.ceil(maxSeconds / dt);
  let steps = 0;
  while (steps < maxSteps) {
    engine.step(dt);
    steps++;
    const state = engine.getState();
    if (state.balls.length === 0 && state.phase === 'PLAYING') {
      return steps * dt;
    }
    if (state.phase !== 'PLAYING') {
      return steps * dt;
    }
  }
  return maxSeconds;
}

describe('Neon Pachinko Rail & Aiming', () => {
  it('maps power monotonically from left chute exit to right-hit cushion exit', () => {
    const pLow = computeReleaseProgress(0.15, false);
    const pMid = computeReleaseProgress(0.5, false);
    const pRight = computeReleaseProgress(0.92, false);

    expect(pLow).toBeLessThan(pMid);
    expect(pMid).toBeLessThan(pRight);

    const lowPos = sampleRailPoint(pLow);
    const midPos = sampleRailPoint(pMid);
    const rightPos = sampleRailPoint(pRight);

    expect(lowPos.x).toBeLessThan(170);
    expect(midPos.x).toBeGreaterThan(220);
    expect(midPos.x).toBeLessThan(340);
    expect(rightPos.x).toBeGreaterThan(390);
    expect(rightPos.x).toBeLessThanOrEqual(515);
  });

  it('produces deterministic 28-point trajectory previews with zero jitter extending into top pin corridor', () => {
    const previewA = getTrajectoryPreview(0.62);
    const previewB = getTrajectoryPreview(0.62);

    expect(previewA).toEqual(previewB);
    expect(previewA.length).toBe(28);
    expect(previewA[previewA.length - 1].y).toBeGreaterThan(190);
    for (const pt of previewA) {
      expect(Number.isFinite(pt.x)).toBe(true);
      expect(Number.isFinite(pt.y)).toBe(true);
      expect(pt.x).toBeGreaterThanOrEqual(WORLD.RAIL_X_CENTER - 1);
      expect(pt.x).toBeLessThanOrEqual(WORLD.BOARD_RIGHT);
    }
  });
});

describe('480Hz Sub-Stepped Physics Stability', () => {
  it('settles 300 varied-power ball drops into pockets within 12s with zero stuck balls', () => {
    const engine = new NeonPachinkoEngine();
    const totalDrops = 300;
    const columnHits = [0, 0, 0, 0, 0];

    for (let i = 0; i < totalDrops; i++) {
      const cur = engine.getState();
      if (
        i % 10 === 0 ||
        cur.phase !== 'PLAYING' ||
        cur.ballQueue.length === 0 ||
        cur.stageScore >= cur.targetScore
      ) {
        engine.startNewRun('ENDLESS');
      }
      const power = (i % 25) / 24;
      engine.setLaunchPower(power);
      const fired = engine.fireBall();
      expect(fired).toBe(true);

      const elapsed = stepUntilIdle(engine, 12);
      const snap = engine.getState();

      expect(elapsed).toBeLessThan(12);
      expect(snap.balls.length).toBe(0);

      const events = engine.drainEvents();
      for (const ev of events) {
        if (ev.type === 'POCKET_ENTER' && ev.col !== undefined) {
          columnHits[ev.col]++;
        }
      }
    }

    // Verify all 5 columns (B, I, N, G, O) are reachable across powers
    for (const hits of columnHits) {
      expect(hits).toBeGreaterThan(5);
    }
  });

  it('spawns 3 balls from SPLITTER pin and respects WORLD.MAX_ACTIVE_BALLS cap', () => {
    const pins = [
      {
        id: 1,
        x: 280,
        y: 250,
        radius: PIN_CATALOG.SPLITTER.radius,
        kind: 'SPLITTER' as const,
        customizable: true,
        hitAnim: 0,
        spinAngle: 0,
        cooldownUntil: 0,
      },
    ];
    const pockets = createInitialPockets();
    const events: GameEvent[] = [];
    let nextId = 2;

    const balls = [
      {
        id: 1,
        x: 280,
        y: 230,
        vx: 0,
        vy: 220,
        radius: WORLD.BALL_RADIUS,
        kind: 'STEEL' as const,
        megaBomb: false,
        onRail: false,
        railProgress: 0.6,
        railReleaseProgress: 0.6,
        launchPower: 0.5,
        chips: 0,
        mult: 1,
        bounces: 0,
        splitGen: 0,
        stuckTimer: 0,
        lastPinId: -1,
        lastPinTime: -1,
        trail: [],
        hitPinIds: [],
      },
    ];

    // Step until splitter is hit
    for (let f = 0; f < 10; f++) {
      stepPhysics(1 / 60, {
        balls,
        pins,
        pockets,
        reachColumns: [false, false, false, false, false],
        ownedRelics: [],
        simTime: f / 60,
        nextBallId: () => nextId++,
        onPinballWizardCellOpen: () => {},
        onRelicPulse: () => {},
        onPinHitStat: () => {},
        events,
      });
    }

    expect(balls.length).toBe(3);

    // Now test MAX_ACTIVE_BALLS overflow handling
    while (balls.length < WORLD.MAX_ACTIVE_BALLS) {
      balls.push({
        ...balls[0],
        id: nextId++,
        x: 100 + (nextId % 4) * 40,
        y: 150,
        hitPinIds: [],
      });
    }

    const overflowBall = {
      ...balls[0],
      id: nextId++,
      x: 280,
      y: 230,
      vx: 0,
      vy: 220,
      mult: 1,
      chips: 0,
      hitPinIds: [],
    };
    balls[0] = overflowBall;
    pins[0].cooldownUntil = 0;

    for (let f = 0; f < 10; f++) {
      stepPhysics(1 / 60, {
        balls,
        pins,
        pockets,
        reachColumns: [false, false, false, false, false],
        ownedRelics: [],
        simTime: 2 + f / 60,
        nextBallId: () => nextId++,
        onPinballWizardCellOpen: () => {},
        onRelicPulse: () => {},
        onPinHitStat: () => {},
        events,
      });
    }

    expect(balls.length).toBeLessThanOrEqual(WORLD.MAX_ACTIVE_BALLS);
    expect(overflowBall.mult).toBeGreaterThanOrEqual(2);
    expect(events.some((e) => e.text === 'OVERFLOW x2!')).toBe(true);
  });
});

describe('5x5 Bingo, Bomb/Overdrive/Re-Ignite Inflation & Fever', () => {
  function createTestMutator(
    ownedRelics: RelicId[] = [],
    stageModifier: StageModifierDef = getStageModifier(1)
  ): BingoStateMutator {
    return {
      grid: createBingoCard(1),
      pockets: createInitialPockets(),
      completedLineIds: [],
      reachColumns: [false, false, false, false, false],
      stageModifier,
      stageScore: 0,
      totalRunScore: 0,
      stageMult: 1,
      cardLevel: 1,
      medals: 0,
      feverActive: false,
      feverTimer: 0,
      feverCardResetTimer: 0,
      feverBallGrantsThisStage: 0,
      stageMagnetMedals: 0,
      stageGoldMedals: 0,
      ballQueue: [],
      ownedRelics,
      hitstopTimer: 0,
      stageBingos: 0,
      chainCount: 0,
      chainTotalScore: 0,
      chainTimer: 0,
      lastShotChips: 0,
      lastShotMult: 1,
      lastShotPoints: 0,
      stats: {
        totalBingos: 0,
        totalFullCards: 0,
        highestSingleShot: 0,
        maxStageMult: 1,
        totalBallsFired: 0,
        totalPinsHit: 0,
        stagesCleared: 0,
      },
      events: [],
      onRelicPulse: () => {},
    };
  }

  function makeDummyBall(kind: 'STEEL' | 'BOMB' | 'LASER' | 'GOLD'): BallEntity {
    return {
      id: 1,
      x: 280,
      y: 515,
      vx: 0,
      vy: 200,
      radius: WORLD.BALL_RADIUS,
      kind,
      megaBomb: false,
      onRail: false,
      railProgress: 0.6,
      railReleaseProgress: 0.6,
      launchPower: 0.5,
      chips: 100,
      mult: 1.5,
      bounces: 6,
      splitGen: 0,
      stuckTimer: 0,
      lastPinId: -1,
      lastPinTime: -1,
      trail: [],
      hitPinIds: [],
    };
  }

  it('produces exponential multiplier growth via Bomb + Re-Ignite + Overdrive + reignite_amp and emits shot value on POCKET_ENTER', () => {
    const mut = createTestMutator(['reignite_amp', 'blast_furnace', 'overdrive_arc']);
    // Pre-open column 2 so column 2 is OVERDRIVE and surrounding cells re-ignite
    for (let r = 0; r < 5; r++) {
      mut.grid[r][2].opened = true;
    }
    mut.pockets[2].overdrive = true;
    mut.grid[1][1].opened = true;
    mut.grid[3][3].opened = true;

    resolveBallInPocket(makeDummyBall('BOMB'), 2, mut);
    const multAfterFirstBomb = mut.stageMult;
    expect(multAfterFirstBomb).toBeGreaterThan(4);

    resolveBallInPocket(makeDummyBall('LASER'), 2, mut);
    expect(mut.stageMult).toBeGreaterThan(multAfterFirstBomb * 2.0);
    expect(mut.stageMult).toBeLessThan(1000);
    expect(mut.stageScore).toBeGreaterThan(10_000);
    expect(mut.events.some((e) => e.type === 'OVERDRIVE_TRIGGER')).toBe(true);
    expect(mut.events.some((e) => e.type === 'CELL_REIGNITE')).toBe(true);

    const pocketEvents = mut.events.filter((e) => e.type === 'POCKET_ENTER');
    expect(pocketEvents.length).toBe(2);
    expect(pocketEvents[1].value).toBeGreaterThan(0);
    expect(pocketEvents[1].mult).toBeGreaterThan(1);

    const cellOpens = mut.events.filter((e) => e.type === 'CELL_OPEN');
    expect(cellOpens.length).toBeGreaterThan(0);
    for (const ev of cellOpens) {
      expect(ev.targetX).toBeDefined();
      expect(ev.targetY).toBeDefined();
    }
  });

  it('triggers FULL BINGO FEVER on 25/25 opened cells, holds full board for 0.45s delay, then resets card while preserving stageMult', () => {
    const mut = createTestMutator(['fever_engine']);
    mut.stageMult = 12;

    // Open 24 of 25 cells, leaving only (0, 0) unopened
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        mut.grid[r][c].opened = !(r === 0 && c === 0);
      }
    }

    resolveBallInPocket(makeDummyBall('STEEL'), 0, mut);

    expect(mut.cardLevel).toBe(2);
    expect(mut.feverActive).toBe(true);
    expect(mut.feverCardResetTimer).toBeCloseTo(0.45, 5);
    expect(mut.stats.totalFullCards).toBe(1);
    expect(mut.ballQueue.length).toBe(3);
    expect(mut.feverBallGrantsThisStage).toBe(1);
    expect(mut.stageMult).toBeGreaterThanOrEqual(18);
    expect(mut.events.some((e) => e.type === 'FULL_BINGO_FEVER')).toBe(true);

    // During 0.45s celebration window, all 25 cells stay illuminated
    let illuminatedCount = 0;
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        if (mut.grid[r][c].opened) illuminatedCount++;
      }
    }
    expect(illuminatedCount).toBe(25);

    // After delay elapses, fresh card generated with only center FREE opened
    resetCardAfterFeverDelay(mut);
    let openCount = 0;
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        if (mut.grid[r][c].opened) openCount++;
      }
    }
    expect(openCount).toBe(1);
    expect(mut.grid[2][2].isFree).toBe(true);
    expect(mut.grid[2][2].opened).toBe(true);
  });
});

describe('Shop, Pin Customization, & Stage Progression', () => {
  function playUntilStageEnds(engine: NeonPachinkoEngine, power: number): void {
    engine.setLaunchPower(power);
    engine.setStrokeLocked(true);
    for (let f = 0; f < 60 * 35; f++) {
      engine.step(1 / 60);
      const phase = engine.getState().phase;
      if (phase === 'STAGE_CLEAR' || phase === 'GAME_OVER' || phase === 'VICTORY') {
        break;
      }
    }
  }

  it('clears Stage 1 reliably, guarantees SPLITTER or BOMB_PIN in Stage 1 Shop, guards rapid fireBall, and advances to Stage 2', () => {
    const engine = createGameEngine() as NeonPachinkoEngine;

    engine.startNewRun('STANDARD');
    // Starter deck is 8 STEEL + 1 BOMB + 1 MULTI
    const starter = engine.getState().deckTemplate;
    expect(starter.length).toBe(10);
    expect(starter.filter((k) => k === 'BOMB').length).toBe(1);
    expect(starter.filter((k) => k === 'MULTI').length).toBe(1);

    // Rapid-fire root guard prevents double firing while ball is still at railProgress < 0.06
    expect(engine.fireBall()).toBe(true);
    expect(engine.fireBall()).toBe(false);

    let cleared = false;
    const powers = [0.5, 0.35, 0.72, 0.52, 0.25, 0.62, 0.42];
    for (const p of powers) {
      engine.startNewRun('STANDARD');
      playUntilStageEnds(engine, p);
      if (engine.getState().phase === 'STAGE_CLEAR') {
        cleared = true;
        break;
      }
    }
    expect(cleared).toBe(true);

    const clearSnap = engine.getState();
    expect(clearSnap.clearSummary).not.toBeNull();
    expect(clearSnap.clearSummary!.totalMedalsEarned).toBeGreaterThanOrEqual(45);

    engine.proceedFromStageClear();
    let shopState = engine.getState();
    expect(shopState.phase).toBe('SHOP');
    expect(shopState.shopOffers.length).toBe(6);

    // Stage 1 shop guarantees SPLITTER or BOMB_PIN
    const hasCorePin = shopState.shopOffers.some(
      (o) =>
        o.offerKind === 'PIN' &&
        (o.pinKind === 'SPLITTER' || o.pinKind === 'BOMB_PIN')
    );
    expect(hasCorePin).toBe(true);

    // Reroll check
    const oldIds = shopState.shopOffers.map((o) => o.id);
    expect(engine.rerollShop()).toBe(true);
    const rerolled = engine.getState();
    expect(rerolled.shopOffers.map((o) => o.id)).not.toEqual(oldIds);
    expect(rerolled.rerollCost).toBe(20);

    // Buy a pin and manually place onto customizable slot
    const pinOffer = rerolled.shopOffers.find(
      (o) => o.offerKind === 'PIN' && o.cost <= rerolled.medals
    );
    expect(pinOffer).toBeDefined();
    expect(engine.buyShopOffer(pinOffer!.id)).toBe(true);
    expect(engine.getState().pendingPinInventory.length).toBe(1);

    const customSlot = engine
      .getState()
      .pins.find((p) => p.customizable && p.kind === 'NORMAL')!;
    expect(engine.placePinOnSlot(customSlot.id)).toBe(true);
    expect(engine.getState().pendingPinInventory.length).toBe(0);
    expect(
      engine.getState().pins.find((p) => p.id === customSlot.id)?.kind
    ).toBe(pinOffer!.pinKind);

    // Buy a second pin and use autoOptimizePins()
    const secondPin = engine
      .getState()
      .shopOffers.find(
        (o) =>
          o.offerKind === 'PIN' &&
          !o.sold &&
          o.cost <= engine.getState().medals
      );
    if (secondPin) {
      expect(engine.buyShopOffer(secondPin.id)).toBe(true);
      expect(engine.autoOptimizePins()).toBe(1);
      expect(engine.getState().pendingPinInventory.length).toBe(0);
    }

    // Buy a relic if affordable, then test sellRelic refund
    const relicOffer = engine
      .getState()
      .shopOffers.find(
        (o) =>
          o.offerKind === 'RELIC' &&
          !o.sold &&
          o.cost <= engine.getState().medals
      );
    if (relicOffer && relicOffer.relicId) {
      const medalsBefore = engine.getState().medals;
      expect(engine.buyShopOffer(relicOffer.id)).toBe(true);
      expect(engine.getState().ownedRelics).toContain(relicOffer.relicId);
      expect(engine.sellRelic(relicOffer.relicId)).toBe(true);
      expect(engine.getState().ownedRelics).not.toContain(relicOffer.relicId);
      expect(engine.getState().medals).toBe(
        medalsBefore - relicOffer.cost + Math.floor(relicOffer.cost * 0.5)
      );
    }

    // Advance to Stage 2
    engine.startNextStage();
    const stage2 = engine.getState();
    expect(stage2.phase).toBe('PLAYING');
    expect(stage2.stage).toBe(2);
    expect(stage2.stageScore).toBe(0);
    expect(stage2.stageMult).toBe(1);
    expect(BALL_CATALOG.STEEL.cost).toBeGreaterThan(0);
  });

  it('swaps existing special pin back to inventory when overwritten on a customizable slot and exposes debug helpers', () => {
    const engine = createGameEngine() as NeonPachinkoEngine;

    engine.startNewRun('STANDARD');
    engine.debugForceStageClear();
    expect(engine.getState().phase).toBe('STAGE_CLEAR');

    engine.proceedFromStageClear();
    engine.debugGrantMedals(200);

    // Buy two pins (rerolling if needed)
    let tries = 0;
    while (tries < 6 && engine.getState().pendingPinInventory.length < 2) {
      const offer = engine
        .getState()
        .shopOffers.find(
          (o) =>
            o.offerKind === 'PIN' &&
            !o.sold &&
            o.cost <= engine.getState().medals
        );
      if (offer) {
        engine.buyShopOffer(offer.id);
      } else if (engine.getState().medals >= engine.getState().rerollCost) {
        engine.rerollShop();
      } else {
        break;
      }
      tries++;
    }

    const inv = [...engine.getState().pendingPinInventory];
    expect(inv.length).toBeGreaterThanOrEqual(2);

    const firstKind = inv[0];
    const secondKind = inv[1];
    const slot = engine
      .getState()
      .pins.find((p) => p.customizable && p.kind === 'NORMAL')!;

    engine.selectPinBrush(firstKind);
    expect(engine.placePinOnSlot(slot.id)).toBe(true);
    expect(engine.getState().pins.find((p) => p.id === slot.id)?.kind).toBe(
      firstKind
    );

    if (secondKind !== firstKind) {
      engine.selectPinBrush(secondKind);
      expect(engine.placePinOnSlot(slot.id)).toBe(true);
      expect(engine.getState().pins.find((p) => p.id === slot.id)?.kind).toBe(
        secondKind
      );
      expect(engine.getState().pendingPinInventory).toContain(firstKind);
    }

    // Verify showcase & victory helpers
    engine.startNextStage();
    engine.debugTriggerInflationShowcase();
    const showcase = engine.getState();
    expect(showcase.feverActive).toBe(true);
    expect(showcase.balls.length).toBeGreaterThanOrEqual(3);
    expect(showcase.pockets.some((p) => p.overdrive)).toBe(true);

    engine.debugForceVictory();
    expect(engine.getState().phase).toBe('VICTORY');
    engine.continueIntoEndless();
    expect(engine.getState().mode).toBe('ENDLESS');
    expect(engine.getState().phase).toBe('SHOP');
  });

  it('splits MULTI balls reliably when first hit is SPINNER or BUMPER', () => {
    for (const pinKind of ['SPINNER', 'BUMPER'] as const) {
      const pins = [
        {
          id: 1,
          x: 280,
          y: 250,
          radius: PIN_CATALOG[pinKind].radius,
          kind: pinKind,
          customizable: true,
          hitAnim: 0,
          spinAngle: 0,
          cooldownUntil: 0,
        },
      ];
      const pockets = createInitialPockets();
      const events: GameEvent[] = [];
      let nextId = 2;

      const balls: BallEntity[] = [
        {
          id: 1,
          x: 280,
          y: 230,
          vx: 0,
          vy: 220,
          radius: WORLD.BALL_RADIUS,
          kind: 'MULTI',
          megaBomb: false,
          onRail: false,
          railProgress: 0.6,
          railReleaseProgress: 0.6,
          launchPower: 0.5,
          chips: 0,
          mult: 1,
          bounces: 0,
          splitGen: 0,
          stuckTimer: 0,
          lastPinId: -1,
          lastPinTime: -1,
          trail: [],
          hitPinIds: [],
          firstPinHandled: false,
          nextWizardBounce: 8,
        },
      ];

      for (let f = 0; f < 10; f++) {
        stepPhysics(1 / 60, {
          balls,
          pins,
          pockets,
          reachColumns: [false, false, false, false, false],
          ownedRelics: [],
          simTime: f / 60,
          nextBallId: () => nextId++,
          onPinballWizardCellOpen: () => {},
          onRelicPulse: () => {},
          onPinHitStat: () => {},
          events,
        });
      }

      expect(balls.length).toBe(2);
      expect(events.some((e) => e.text === 'TWIN SPLIT!')).toBe(true);
    }
  });

  it('triggers pinball_wizard even when BUMPER increments bounces from 7 to 9', () => {
    const pins = [
      {
        id: 1,
        x: 280,
        y: 250,
        radius: PIN_CATALOG.BUMPER.radius,
        kind: 'BUMPER' as const,
        customizable: true,
        hitAnim: 0,
        spinAngle: 0,
        cooldownUntil: 0,
      },
    ];
    const pockets = createInitialPockets();
    const events: GameEvent[] = [];
    let wizardCalls = 0;

    const balls: BallEntity[] = [
      {
        id: 1,
        x: 280,
        y: 230,
        vx: 0,
        vy: 220,
        radius: WORLD.BALL_RADIUS,
        kind: 'STEEL',
        megaBomb: false,
        onRail: false,
        railProgress: 0.6,
        railReleaseProgress: 0.6,
        launchPower: 0.5,
        chips: 0,
        mult: 1,
        bounces: 7,
        splitGen: 0,
        stuckTimer: 0,
        lastPinId: -1,
        lastPinTime: -1,
        trail: [],
        hitPinIds: [],
        firstPinHandled: true,
        nextWizardBounce: 8,
      },
    ];

    for (let f = 0; f < 10; f++) {
      stepPhysics(1 / 60, {
        balls,
        pins,
        pockets,
        reachColumns: [false, false, false, false, false],
        ownedRelics: ['pinball_wizard'],
        simTime: f / 60,
        nextBallId: () => 99,
        onPinballWizardCellOpen: () => {
          wizardCalls++;
        },
        onRelicPulse: () => {},
        onPinHitStat: () => {},
        events,
      });
    }

    expect(balls[0].bounces).toBeGreaterThanOrEqual(9);
    expect(wizardCalls).toBe(1);
    expect(balls[0].nextWizardBounce).toBe(16);
    expect(events.some((e) => e.relicId === 'pinball_wizard')).toBe(true);
  });

  it('picks up an installed special pin in SHOP when no brush is selected, relocates it, and decays pin hitAnim during SHOP', () => {
    const engine = createGameEngine() as NeonPachinkoEngine;
    engine.startNewRun('STANDARD');
    engine.debugForceStageClear();
    engine.proceedFromStageClear();
    engine.debugGrantMedals(200);

    // Install a pin onto slotA
    const pinOffer = engine
      .getState()
      .shopOffers.find((o) => o.offerKind === 'PIN')!;
    expect(engine.buyShopOffer(pinOffer.id)).toBe(true);

    const customSlots = engine
      .getState()
      .pins.filter((p) => p.customizable && p.kind === 'NORMAL');
    const slotA = customSlots[0];
    const slotB = customSlots[1];

    expect(engine.placePinOnSlot(slotA.id)).toBe(true);
    expect(engine.getState().pendingPinInventory.length).toBe(0);
    expect(engine.getState().selectedPinBrush).toBeNull();
    expect(engine.getState().pins.find((p) => p.id === slotA.id)?.hitAnim).toBe(1);

    // Decay hitAnim smoothly during SHOP phase
    for (let f = 0; f < 30; f++) {
      engine.step(1 / 60);
    }
    expect(engine.getState().pins.find((p) => p.id === slotA.id)!.hitAnim).toBeLessThan(0.1);

    // Click installed special pin at slotA with empty inventory -> picks it up & selects brush
    expect(engine.placePinOnSlot(slotA.id)).toBe(true);
    expect(engine.getState().pins.find((p) => p.id === slotA.id)?.kind).toBe('NORMAL');
    expect(engine.getState().selectedPinBrush).toBe(pinOffer.pinKind);
    expect(engine.getState().pendingPinInventory).toContain(pinOffer.pinKind);

    // Relocate onto slotB
    expect(engine.placePinOnSlot(slotB.id)).toBe(true);
    expect(engine.getState().pins.find((p) => p.id === slotB.id)?.kind).toBe(
      pinOffer.pinKind
    );
    expect(engine.getState().pendingPinInventory.length).toBe(0);
  });
});

describe('Stage Modifiers, Inflation Caps, Live Chain Tracking, & Shop Synergies', () => {
  function makeTestBall(
    kind: 'STEEL' | 'BOMB' | 'LASER' | 'GOLD' = 'STEEL',
    launchPower = 0.5
  ): BallEntity {
    return {
      id: 1,
      x: 280,
      y: 515,
      vx: 0,
      vy: 200,
      radius: WORLD.BALL_RADIUS,
      kind,
      megaBomb: false,
      onRail: false,
      railProgress: 0.6,
      railReleaseProgress: 0.6,
      launchPower,
      chips: 100,
      mult: 1.0,
      bounces: 2,
      splitGen: 0,
      stuckTimer: 0,
      lastPinId: -1,
      lastPinTime: -1,
      trail: [],
      hitPinIds: [],
    };
  }

  function makeMutator(
    stageNum: number,
    ownedRelics: RelicId[] = []
  ): BingoStateMutator {
    return {
      grid: createBingoCard(1),
      pockets: createInitialPockets(),
      completedLineIds: [],
      reachColumns: [false, false, false, false, false],
      stageModifier: getStageModifier(stageNum),
      stageScore: 0,
      totalRunScore: 0,
      stageMult: 1,
      cardLevel: 1,
      medals: 0,
      feverActive: false,
      feverTimer: 0,
      feverCardResetTimer: 0,
      feverBallGrantsThisStage: 0,
      stageMagnetMedals: 0,
      stageGoldMedals: 0,
      ballQueue: [],
      ownedRelics,
      hitstopTimer: 0,
      stageBingos: 0,
      chainCount: 0,
      chainTotalScore: 0,
      chainTimer: 0,
      lastShotChips: 0,
      lastShotMult: 1,
      lastShotPoints: 0,
      stats: {
        totalBingos: 0,
        totalFullCards: 0,
        highestSingleShot: 0,
        maxStageMult: 1,
        totalBallsFired: 0,
        totalPinsHit: 0,
        stagesCleared: 0,
      },
      events: [],
      onRelicPulse: () => {},
    };
  }

  it('exposes stageModifier & nextStageModifier and applies Stage 2 CENTER_BONUS & Stage 5 RIGHT_RUSH', () => {
    const engine = createGameEngine() as NeonPachinkoEngine;
    engine.startNewRun('STANDARD');
    expect(engine.getState().stageModifier.id).toBe('STANDARD');
    expect(engine.getState().nextStageModifier.id).toBe('CENTER_BONUS');

    // Stage 2 CENTER_BONUS: +140 chips when entering Col 2 (N)
    const mutStd = makeMutator(1);
    const mutCenter = makeMutator(2);
    resolveBallInPocket(makeTestBall('STEEL'), 2, mutStd);
    resolveBallInPocket(makeTestBall('STEEL'), 2, mutCenter);
    expect(mutCenter.lastShotChips).toBe(mutStd.lastShotChips + 140);

    // Advance engine to Stage 5 (RIGHT_RUSH)
    for (let s = 1; s < 5; s++) {
      engine.debugForceStageClear();
      engine.proceedFromStageClear();
      engine.startNextStage();
    }
    expect(engine.getState().stage).toBe(5);
    expect(engine.getState().stageModifier.id).toBe('RIGHT_RUSH');
    expect(engine.getState().nextStageModifier.id).toBe('HIGH_VOLTAGE');

    // Power >= 0.68 gets initialMult *= 1.4
    engine.setLaunchPower(0.8);
    expect(engine.fireBall()).toBe(true);
    expect(engine.getState().balls[0].mult).toBeCloseTo(1.4, 4);

    // Step briefly so root guard clears, then fire low power (< 0.68) -> mult stays 1.0
    for (let f = 0; f < 5; f++) engine.step(1 / 60);
    engine.setLaunchPower(0.4);
    expect(engine.fireBall()).toBe(true);
    const secondBall = engine.getState().balls[engine.getState().balls.length - 1];
    expect(secondBall.mult).toBeCloseTo(1.0, 4);
  });

  it('applies Stage 3 LEFT_CHANCE, Stage 4 DIAGONAL_GOLD, Stage 6 HIGH_VOLTAGE, Stage 7 OVERDRIVE_SURGE, and Stage 8 GOLDEN_BOSS', () => {
    // Stage 3 LEFT_CHANCE: launchPower <= 0.42 gets 1.6x pin chips
    const makePin = (kind: 'NORMAL' | 'BUMPER' | 'SPINNER') => ({
      id: 1,
      x: 280,
      y: 250,
      radius: PIN_CATALOG[kind].radius,
      kind,
      customizable: true,
      hitAnim: 0,
      spinAngle: 0,
      cooldownUntil: 0,
    });

    const leftBall: BallEntity = { ...makeTestBall('STEEL', 0.35), y: 230, chips: 0, bounces: 0 };
    const rightBall: BallEntity = { ...makeTestBall('STEEL', 0.75), y: 230, chips: 0, bounces: 0 };
    const leftPin = makePin('NORMAL');
    const rightPin = makePin('NORMAL');
    for (let f = 0; f < 5; f++) {
      stepPhysics(1 / 60, {
        balls: [leftBall],
        pins: [leftPin],
        pockets: createInitialPockets(),
        reachColumns: [false, false, false, false, false],
        ownedRelics: [],
        stageModifier: getStageModifier(3),
        simTime: f / 60,
        nextBallId: () => 99,
        onPinballWizardCellOpen: () => {},
        onRelicPulse: () => {},
        onPinHitStat: () => {},
        events: [],
      });
      stepPhysics(1 / 60, {
        balls: [rightBall],
        pins: [rightPin],
        pockets: createInitialPockets(),
        reachColumns: [false, false, false, false, false],
        ownedRelics: [],
        stageModifier: getStageModifier(3),
        simTime: f / 60,
        nextBallId: () => 99,
        onPinballWizardCellOpen: () => {},
        onRelicPulse: () => {},
        onPinHitStat: () => {},
        events: [],
      });
    }
    // NORMAL base hit on bounce 1 = 15 + 2 = 17; 1.6x = Math.round(27.2) = 27
    expect(rightBall.chips).toBe(17);
    expect(leftBall.chips).toBe(27);

    // Stage 6 HIGH_VOLTAGE: BUMPER 125 + bounces*5, SPINNER x1.6
    const hvBumperBall: BallEntity = { ...makeTestBall('STEEL', 0.5), y: 230, chips: 0, bounces: 0 };
    const hvBumperPin = makePin('BUMPER');
    for (let f = 0; f < 5; f++) {
      stepPhysics(1 / 60, {
        balls: [hvBumperBall],
        pins: [hvBumperPin],
        pockets: createInitialPockets(),
        reachColumns: [false, false, false, false, false],
        ownedRelics: [],
        stageModifier: getStageModifier(6),
        simTime: f / 60,
        nextBallId: () => 99,
        onPinballWizardCellOpen: () => {},
        onRelicPulse: () => {},
        onPinHitStat: () => {},
        events: [],
      });
    }
    expect(hvBumperBall.chips).toBe(130); // 125 + 1*5

    const hvSpinnerBall: BallEntity = { ...makeTestBall('STEEL', 0.5), y: 230, chips: 0, mult: 1.0, bounces: 0 };
    const hvSpinnerPin = makePin('SPINNER');
    for (let f = 0; f < 5; f++) {
      stepPhysics(1 / 60, {
        balls: [hvSpinnerBall],
        pins: [hvSpinnerPin],
        pockets: createInitialPockets(),
        reachColumns: [false, false, false, false, false],
        ownedRelics: [],
        stageModifier: getStageModifier(6),
        simTime: f / 60,
        nextBallId: () => 99,
        onPinballWizardCellOpen: () => {},
        onRelicPulse: () => {},
        onPinHitStat: () => {},
        events: [],
      });
    }
    expect(hvSpinnerBall.mult).toBeCloseTo(1.6, 4);

    // Stage 4 DIAGONAL_GOLD: 2.0x diagonal line score
    const setupDiag = (stageNum: number) => {
      const m = makeMutator(stageNum);
      m.grid[1][1].opened = true;
      m.grid[2][2].opened = true;
      m.grid[3][3].opened = true;
      m.grid[4][4].opened = true;
      resolveBallInPocket(makeTestBall('STEEL'), 0, m);
      return m.events.find((e) => e.type === 'BINGO_LINE')?.value ?? 0;
    };
    const diagStd = setupDiag(1);
    const diagGold = setupDiag(4);
    const diagBoss = setupDiag(8);
    expect(diagGold).toBe(diagStd * 2);
    expect(diagBoss).toBe(Math.round(diagStd * 1.5));

    // Stage 7 OVERDRIVE_SURGE: +1.5 extra stageMult on Overdrive trigger
    const runOverdrive = (stageNum: number) => {
      const m = makeMutator(stageNum);
      for (let r = 0; r < 5; r++) m.grid[r][2].opened = true;
      m.pockets[2].overdrive = true;
      resolveBallInPocket(makeTestBall('STEEL'), 2, m);
      return m.stageMult;
    };
    const odStd = runOverdrive(1);
    const odSurge = runOverdrive(7);
    expect(odSurge).toBeCloseTo(odStd + 1.5, 2);
  });

  it('caps feverBallGrantsThisStage at 2 per stage and caps medal_magnet at +60 medals per stage', () => {
    const mut = makeMutator(1, ['fever_engine', 'medal_magnet']);

    // Trigger Full Bingo Fever 3 times in the same stage
    for (let cycle = 0; cycle < 3; cycle++) {
      mut.feverCardResetTimer = 0;
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          mut.grid[r][c].opened = !(r === 0 && c === 0);
        }
      }
      mut.completedLineIds = [];
      const queueBefore = mut.ballQueue.length;
      const multBefore = mut.stageMult;
      resolveBallInPocket(makeTestBall('STEEL'), 0, mut);

      if (cycle < 2) {
        expect(mut.ballQueue.length).toBe(queueBefore + 3);
      } else {
        // 3rd Full Card grants NO additional balls, stopping infinite stage stalls
        expect(mut.ballQueue.length).toBe(queueBefore);
      }
      // Still grants Full Card jackpot, feverActive, and mult surge
      expect(mut.feverActive).toBe(true);
      expect(mut.stageMult).toBeGreaterThan(multBefore);
      resetCardAfterFeverDelay(mut);
    }

    expect(mut.feverBallGrantsThisStage).toBe(2);
    expect(mut.cardLevel).toBe(4);
    // 3 full-card triggers opened 12 lines * 3 (actually 36 line completions!), capped cleanly at 60 medals
    expect(mut.stageMagnetMedals).toBe(60);
    expect(mut.medals).toBe(60);
  });

  it('tracks live chainCount, chainTotalScore, chainTimer decay/reset, and lastShot formula values', () => {
    const engine = createGameEngine() as NeonPachinkoEngine;
    engine.startNewRun('STANDARD');
    engine.setLaunchPower(0.5);
    expect(engine.fireBall()).toBe(true);

    // Step until ball enters a pocket
    const dt = 1 / 60;
    let pocketed = false;
    for (let f = 0; f < 60 * 10; f++) {
      engine.step(dt);
      const st = engine.getState();
      if (st.balls.length === 0) {
        pocketed = true;
        expect(st.chainCount).toBeGreaterThanOrEqual(1);
        expect(st.chainTotalScore).toBeGreaterThan(0);
        expect(st.chainTimer).toBeGreaterThan(2.5);
        expect(st.lastShotChips).toBeGreaterThan(0);
        expect(st.lastShotMult).toBeGreaterThanOrEqual(1);
        expect(st.lastShotPoints).toBeGreaterThan(0);
        break;
      }
    }
    expect(pocketed).toBe(true);

    // Advance 3.0s with zero active balls -> chainTimer hits 0 and chain resets
    for (let f = 0; f < 185; f++) {
      engine.step(dt);
      if (engine.getState().phase !== 'PLAYING') break;
    }
    const afterDecay = engine.getState();
    if (afterDecay.phase === 'PLAYING') {
      expect(afterDecay.chainTimer).toBe(0);
      expect(afterDecay.chainCount).toBe(0);
      expect(afterDecay.chainTotalScore).toBe(0);
    }
  });

  it('populates Japanese tags on all Shop offers and dynamically activates synergyReason after purchase', () => {
    const engine = createGameEngine() as NeonPachinkoEngine;
    engine.startNewRun('STANDARD');
    engine.debugForceStageClear();
    engine.proceedFromStageClear();
    engine.debugGrantMedals(1000);

    // Verify all 6 shop offers have non-empty Japanese archetype tags
    for (const offer of engine.getState().shopOffers) {
      expect(offer.tags).toBeDefined();
      expect(offer.tags!.length).toBeGreaterThanOrEqual(1);
    }

    // Reroll until we get a shop containing both BOMB_PIN and (blast_furnace or reignite_amp)
    let foundPair = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      const offers = engine.getState().shopOffers;
      const bombPinOffer = offers.find(
        (o) => o.offerKind === 'PIN' && o.pinKind === 'BOMB_PIN' && !o.sold
      );
      const bombRelicOffer = offers.find(
        (o) =>
          o.offerKind === 'RELIC' &&
          (o.relicId === 'blast_furnace' || o.relicId === 'reignite_amp') &&
          !o.sold
      );
      if (bombPinOffer && bombRelicOffer) {
        // Before purchasing BOMB_PIN, starter deck alone does not light up blast_furnace / reignite_amp
        expect(bombRelicOffer.synergyReason).toBeUndefined();

        // Buying BOMB_PIN immediately lights up synergyReason on the relic offer sitting next to it!
        expect(engine.buyShopOffer(bombPinOffer.id)).toBe(true);
        const updatedRelic = engine
          .getState()
          .shopOffers.find((o) => o.id === bombRelicOffer.id)!;
        expect(updatedRelic.synergyReason).toBeDefined();
        expect(updatedRelic.synergyReason).toContain('★');
        foundPair = true;
        break;
      }
      engine.debugGrantMedals(50);
      engine.rerollShop();
    }
    expect(foundPair).toBe(true);
  });
});
