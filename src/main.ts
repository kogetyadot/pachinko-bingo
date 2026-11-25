import { SoundEngine } from './audio/soundEngine';
import { NeonPachinkoEngine } from './game/engine';
import { CanvasRenderer } from './render/canvasRenderer';
import { UIController } from './ui/uiController';

interface DebugCapableEngine {
  debugForceStageClear?: () => void;
  debugGrantMedals?: (amount: number) => void;
  debugTriggerInflationShowcase?: () => void;
  debugForceVictory?: () => void;
}

interface GameDebugBridge {
  setPower: (power: number) => void;
  fireBall: () => boolean;
  forceStageClear: () => void;
  grantMedals: (amount: number) => void;
  triggerInflationShowcase: () => void;
  forceVictory: () => void;
}

function bootstrap(): void {
  const canvas = document.getElementById('playfield-canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    throw new Error('Could not find #playfield-canvas');
  }

  const engine = new NeonPachinkoEngine();
  const renderer = new CanvasRenderer(canvas);
  const sound = new SoundEngine();
  const ui = new UIController(engine, renderer, sound);

  const syncAfterDebug = () => {
    ui.invalidateCaches();
    ui.update(0, engine.drainEvents());
  };

  const dbg = engine as unknown as DebugCapableEngine;
  const debugBridge: GameDebugBridge = {
    setPower: (power: number) => {
      engine.setLaunchPower(power);
      syncAfterDebug();
    },
    fireBall: () => {
      const fired = engine.fireBall();
      syncAfterDebug();
      return fired;
    },
    forceStageClear: () => {
      dbg.debugForceStageClear?.();
      syncAfterDebug();
    },
    grantMedals: (amount: number) => {
      dbg.debugGrantMedals?.(amount);
      syncAfterDebug();
    },
    triggerInflationShowcase: () => {
      dbg.debugTriggerInflationShowcase?.();
      syncAfterDebug();
    },
    forceVictory: () => {
      dbg.debugForceVictory?.();
      syncAfterDebug();
    },
  };

  (window as unknown as Record<string, unknown>).__GAME_DEBUG__ = debugBridge;

  let lastTime = performance.now();

  const frame = (now: number) => {
    const rawDt = (now - lastTime) / 1000;
    lastTime = now;
    const dt = Math.min(0.05, Math.max(0, rawDt));

    engine.step(dt);
    const events = engine.drainEvents();
    ui.update(dt, events);

    requestAnimationFrame(frame);
  };

  // Initial sync before first animation frame
  ui.update(0, []);
  requestAnimationFrame(frame);
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
