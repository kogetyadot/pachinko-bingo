import { SoundEngine } from '../audio/soundEngine';
import {
  BALL_CATALOG,
  PIN_CATALOG,
  RELIC_CATALOG,
  formatMult,
  formatScore,
} from '../data/catalog';
import { CanvasRenderer } from '../render/canvasRenderer';
import {
  BallKind,
  GameEvent,
  GamePhase,
  GameStateSnapshot,
  IGameEngine,
  PinKind,
  RelicId,
  ShopOffer,
} from '../types';
import {
  getBallIconSvg,
  getPinIconSvg,
  getRelicIconSvg,
  getUiIconSvg,
} from './svgIcons';

const HIGH_SCORE_STORAGE_KEY = 'neon_bingo_high_score';

function formatCompactMobileScore(n: number): string {
  if (!Number.isFinite(n)) return 'MAX';
  const rounded = Math.floor(n);
  if (rounded < 1_000_000) {
    return formatScore(rounded);
  }
  if (rounded < 1_000_000_000) {
    return `${(rounded / 1_000_000).toFixed(2)}M`;
  }
  if (rounded < 1_000_000_000_000) {
    return `${(rounded / 1_000_000_000).toFixed(2)}B`;
  }
  return `${(rounded / 1_000_000_000_000).toFixed(2)}T`;
}

export class UIController {
  private engine: IGameEngine;
  private renderer: CanvasRenderer;
  private sound: SoundEngine;

  private highScore: number;
  private runBaselineHighScore: number;
  private lastPhase: GamePhase | null = null;
  private shopTab: 'BUY' | 'BOARD' = 'BUY';
  private boardFocusMode = false;
  private selectedRelicId: RelicId | null = null;
  private holdingLaunch = false;
  private holdAccumulator = 0;

  private lastHudSignature = '';
  private lastControlSignature = '';
  private lastShopSignature = '';
  private lastEndSignature = '';

  // Cached DOM references
  private appEl!: HTMLElement;
  private screenTitle!: HTMLElement;
  private titleVideoEl!: HTMLVideoElement;
  private cabinetShell!: HTMLElement;
  private canvasEl!: HTMLCanvasElement;

  private overlayStageClear!: HTMLElement;
  private overlayShop!: HTMLElement;
  private overlayEnd!: HTMLElement;
  private boardTuneBanner!: HTMLElement;

  constructor(engine: IGameEngine, renderer: CanvasRenderer, sound: SoundEngine) {
    this.engine = engine;
    this.renderer = renderer;
    this.sound = sound;
    this.highScore = this.loadHighScore();
    this.runBaselineHighScore = this.highScore;

    this.bindDom();
    this.injectStaticIcons();
    this.bindEvents();
    this.syncAudioButtons();
    this.updateTitleHighScore();
  }

  private loadHighScore(): number {
    try {
      const raw = window.localStorage.getItem(HIGH_SCORE_STORAGE_KEY);
      const parsed = raw ? Number(raw) : 0;
      return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
    } catch {
      return 0;
    }
  }

  private saveHighScore(score: number): boolean {
    if (score <= this.highScore) return false;
    this.highScore = Math.floor(score);
    try {
      window.localStorage.setItem(HIGH_SCORE_STORAGE_KEY, String(this.highScore));
    } catch {
      // Ignore storage error
    }
    this.updateTitleHighScore();
    return true;
  }

  private q<T extends HTMLElement>(id: string): T {
    const el = document.getElementById(id);
    if (!el) {
      throw new Error(`Missing required UI element #${id}`);
    }
    return el as T;
  }

  private bindDom(): void {
    this.appEl = this.q('app');
    this.screenTitle = this.q('screen-title');
    this.titleVideoEl = this.q<HTMLVideoElement>('title-attract-video');
    this.cabinetShell = this.q('cabinet-shell');
    this.canvasEl = this.q<HTMLCanvasElement>('playfield-canvas');
    this.overlayStageClear = this.q('overlay-stage-clear');
    this.overlayShop = this.q('overlay-shop');
    this.overlayEnd = this.q('overlay-end');
    this.boardTuneBanner = this.q('board-tune-banner');
  }

  private injectStaticIcons(): void {
    const emblem = document.getElementById('title-brand-emblem');
    if (emblem) emblem.innerHTML = getUiIconSvg('brandEmblem', 64);

    document.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
      const kind = el.dataset.icon;
      switch (kind) {
        case 'medal':
          el.innerHTML = getUiIconSvg('medal', 16);
          break;
        case 'rotaryHandle':
          el.innerHTML = getUiIconSvg('rotaryHandle', 52);
          break;
        case 'reroll':
          el.innerHTML = getUiIconSvg('reroll', 16);
          break;
        case 'play':
          el.innerHTML = getUiIconSvg('play', 18);
          break;
        case 'bolt':
          el.innerHTML = getUiIconSvg('bolt', 18);
          break;
        case 'autoTune':
          el.innerHTML = getUiIconSvg('autoTune', 15);
          break;
        case 'aimTarget':
          el.innerHTML = getUiIconSvg('aimTarget', 18);
          break;
        case 'bingoGrid':
          el.innerHTML = getUiIconSvg('bingoGrid', 18);
          break;
        case 'overdriveCore':
          el.innerHTML = getUiIconSvg('overdriveCore', 18);
          break;
        case 'crown':
          el.innerHTML = getUiIconSvg('crown', 18);
          break;
        case 'chevronRight':
          el.innerHTML = getUiIconSvg('chevronRight', 16);
          break;
        default:
          break;
      }
    });
  }

  private bindEvents(): void {
    const unlockGesture = () => this.sound.unlock();
    window.addEventListener('pointerdown', unlockGesture, { passive: true });
    window.addEventListener('touchend', unlockGesture, { passive: true });
    window.addEventListener('keydown', unlockGesture, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.sound.unlock();
      }
    });

    // Audio toggles (Title, Desktop HUD, Sound Mixer)
    ['btn-toggle-bgm', 'btn-toggle-bgm-title', 'btn-mixer-bgm'].forEach((id) => {
      document.getElementById(id)?.addEventListener('click', () => {
        this.sound.toggleBgm();
        this.syncAudioButtons();
      });
    });

    ['btn-toggle-se', 'btn-toggle-se-title', 'btn-mixer-se'].forEach((id) => {
      document.getElementById(id)?.addEventListener('click', () => {
        this.sound.toggleSe();
        this.syncAudioButtons();
      });
    });

    // Global Sound Volume Mixer Popover
    const mixerOverlay = this.q('sound-mixer-popover');
    const toggleMixer = () => {
      this.sound.unlock();
      this.sound.playUiClick(720);
      this.q('mobile-relic-popover').classList.add('is-hidden');
      this.q('mobile-ball-popover').classList.add('is-hidden');
      mixerOverlay.classList.toggle('is-hidden');
      this.syncAudioButtons();
    };
    ['btn-sound-mixer-title', 'btn-sound-mixer-desktop', 'btn-sound-mixer-mobile'].forEach((id) => {
      document.getElementById(id)?.addEventListener('click', toggleMixer);
    });
    this.q('btn-close-sound-mixer').addEventListener('click', () => {
      this.sound.playUiClick(540);
      mixerOverlay.classList.add('is-hidden');
    });
    mixerOverlay.addEventListener('click', (e) => {
      if (e.target === mixerOverlay) {
        mixerOverlay.classList.add('is-hidden');
      }
    });

    const bgmSlider = this.q<HTMLInputElement>('slider-bgm-vol');
    bgmSlider.addEventListener('input', () => {
      const v = Math.max(0, Math.min(100, Number(bgmSlider.value) || 0)) / 100;
      this.sound.setBgmVolume(v);
      this.syncAudioButtons();
    });

    const seSlider = this.q<HTMLInputElement>('slider-se-vol');
    seSlider.addEventListener('input', () => {
      const v = Math.max(0, Math.min(100, Number(seSlider.value) || 0)) / 100;
      this.sound.setSeVolume(v, true);
      this.syncAudioButtons();
    });

    // Title buttons
    this.q('btn-start-standard').addEventListener('click', () => {
      this.sound.unlock();
      this.sound.playUiClick(740);
      this.renderer.clearVfx();
      this.runBaselineHighScore = this.highScore;
      this.shopTab = 'BUY';
      this.boardFocusMode = false;
      this.engine.startNewRun('STANDARD');
      this.update(0, this.engine.drainEvents());
    });

    this.q('btn-start-endless').addEventListener('click', () => {
      this.sound.unlock();
      this.sound.playUiClick(820);
      this.renderer.clearVfx();
      this.runBaselineHighScore = this.highScore;
      this.shopTab = 'BUY';
      this.boardFocusMode = false;
      this.engine.startNewRun('ENDLESS');
      this.update(0, this.engine.drainEvents());
    });

    const quitToTitle = () => {
      this.sound.playUiClick(500);
      this.holdingLaunch = false;
      this.holdAccumulator = 0;
      this.q('mobile-relic-popover').classList.add('is-hidden');
      this.q('mobile-ball-popover').classList.add('is-hidden');
      this.engine.returnToTitle();
      this.update(0, this.engine.drainEvents());
    };
    this.q('btn-quit-to-title').addEventListener('click', quitToTitle);
    this.q('btn-mobile-title').addEventListener('click', quitToTitle);

    // Power Slider (shared Desktop & Mobile)
    const onPowerInput = (pctValue: string) => {
      const pct = Math.max(5, Math.min(100, Number(pctValue) || 42));
      const power = pct / 100;
      this.engine.setLaunchPower(power);
      this.sound.playChargeTick(power);
    };

    const powerSlider = this.q<HTMLInputElement>('slider-power');
    powerSlider.addEventListener('input', () => onPowerInput(powerSlider.value));

    // Aim preset buttons
    document.querySelectorAll<HTMLElement>('.aim-preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = Number(btn.dataset.power ?? '0.42');
        this.engine.setLaunchPower(p);
        this.sound.playChargeTick(p);
        this.sound.playUiClick(620 + p * 320);
      });
    });

    // Lock Stroke button
    const toggleLock = () => {
      const st = this.engine.getState();
      this.engine.setStrokeLocked(!st.strokeLocked);
      this.sound.playUiClick(st.strokeLocked ? 520 : 780);
    };
    this.q('btn-lock-stroke').addEventListener('click', toggleLock);

    // Launch button (Click for 1 shot, Hold for rapid fire)
    const releaseHold = () => {
      this.holdingLaunch = false;
      this.holdAccumulator = 0;
    };
    window.addEventListener('pointerup', releaseHold);
    window.addEventListener('pointercancel', releaseHold);
    window.addEventListener('blur', releaseHold);

    const launchBtn = this.q('btn-launch');
    let firedOnDown = false;
    launchBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.sound.unlock();
      if ((launchBtn as HTMLButtonElement).disabled) {
        releaseHold();
        return;
      }
      this.holdingLaunch = true;
      this.holdAccumulator = 0;
      firedOnDown = this.engine.fireBall();
    });
    launchBtn.addEventListener('pointerup', releaseHold);
    launchBtn.addEventListener('pointercancel', releaseHold);
    launchBtn.addEventListener('pointerleave', releaseHold);
    launchBtn.addEventListener('click', () => {
      if (!firedOnDown) {
        this.sound.unlock();
        this.engine.fireBall();
      }
      firedOnDown = false;
    });

    // Keyboard controls
    window.addEventListener('keydown', (e) => {
      const st = this.engine.getState();
      if (st.phase !== 'PLAYING') return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.sound.unlock();
        if (!e.repeat) {
          this.engine.fireBall();
        }
        this.holdingLaunch = true;
      } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        this.engine.setLaunchPower(st.launchPower - 0.04);
        this.sound.playChargeTick(this.engine.getState().launchPower);
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        this.engine.setLaunchPower(st.launchPower + 0.04);
        this.sound.playChargeTick(this.engine.getState().launchPower);
      } else if (e.code === 'KeyL') {
        toggleLock();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        releaseHold();
      }
    });

    // Stage Clear -> Shop
    this.q('btn-goto-shop').addEventListener('click', () => {
      this.sound.playUiClick(740);
      this.shopTab = 'BUY';
      this.boardFocusMode = false;
      this.lastShopSignature = '';
      this.engine.proceedFromStageClear();
      this.update(0, this.engine.drainEvents());
    });

    // Shop tabs & actions
    this.q('tab-shop-buy').addEventListener('click', () => {
      this.sound.playUiClick(640);
      this.shopTab = 'BUY';
      this.boardFocusMode = false;
      this.lastShopSignature = '';
      this.update(0, this.engine.drainEvents());
    });

    this.q('tab-board-tune').addEventListener('click', () => {
      this.sound.playUiClick(700);
      this.shopTab = 'BOARD';
      this.boardFocusMode = false;
      this.lastShopSignature = '';
      this.update(0, this.engine.drainEvents());
    });

    this.q('btn-focus-canvas-pins').addEventListener('click', () => {
      this.sound.playUiClick(720);
      this.boardFocusMode = true;
      this.lastShopSignature = '';
      this.update(0, this.engine.drainEvents());
    });

    this.q('btn-board-back-shop').addEventListener('click', () => {
      this.sound.playUiClick(640);
      this.boardFocusMode = false;
      this.lastShopSignature = '';
      this.update(0, this.engine.drainEvents());
    });

    const handleAutoPins = () => {
      const placed = this.engine.autoOptimizePins();
      this.sound.playUiClick(placed > 0 ? 880 : 520);
      this.lastShopSignature = '';
      this.update(0, this.engine.drainEvents());
    };
    this.q('btn-auto-pins').addEventListener('click', handleAutoPins);
    this.q('btn-board-auto-pins').addEventListener('click', handleAutoPins);

    this.q('btn-reroll-shop').addEventListener('click', () => {
      if (this.engine.rerollShop()) {
        this.sound.playUiClick(780);
        this.lastShopSignature = '';
        this.update(0, this.engine.drainEvents());
      }
    });

    this.q('btn-next-stage').addEventListener('click', () => {
      this.sound.playUiClick(840);
      this.boardFocusMode = false;
      this.engine.startNextStage();
      this.update(0, this.engine.drainEvents());
    });

    // Mobile Relic & Ball Inspector Popovers
    const mobileRelicPop = this.q('mobile-relic-popover');
    const mobileBallPop = this.q('mobile-ball-popover');
    this.q('btn-mobile-relics').addEventListener('click', () => {
      this.sound.playUiClick(660);
      mobileBallPop.classList.add('is-hidden');
      mobileRelicPop.classList.toggle('is-hidden');
    });
    this.q('btn-close-mobile-relics').addEventListener('click', () => {
      this.sound.playUiClick(580);
      mobileRelicPop.classList.add('is-hidden');
    });

    this.q('btn-mobile-ball-info').addEventListener('click', () => {
      this.sound.playUiClick(680);
      mobileRelicPop.classList.add('is-hidden');
      mobileBallPop.classList.toggle('is-hidden');
    });
    this.q('btn-close-mobile-ball').addEventListener('click', () => {
      this.sound.playUiClick(580);
      mobileBallPop.classList.add('is-hidden');
    });

    // Canvas hover & click for Pin Customization / Relocation in SHOP
    this.canvasEl.addEventListener('pointermove', (e) => {
      const st = this.engine.getState();
      if (st.phase !== 'SHOP') {
        this.renderer.setHoveredPinId(null);
        return;
      }
      const world = this.renderer.canvasToWorld(e.clientX, e.clientY);
      const pin = this.renderer.findCustomizablePinAt(st.pins, world.x, world.y, 24);
      this.renderer.setHoveredPinId(pin ? pin.id : null);
    });

    this.canvasEl.addEventListener('pointerleave', () => {
      this.renderer.setHoveredPinId(null);
    });

    this.canvasEl.addEventListener('click', (e) => {
      const st = this.engine.getState();
      if (st.phase !== 'SHOP') return;
      const world = this.renderer.canvasToWorld(e.clientX, e.clientY);
      const pin = this.renderer.findCustomizablePinAt(st.pins, world.x, world.y, 26);
      if (!pin) return;

      // Support both placing selected brush AND picking up an already-installed special pin when brush is empty
      const canPlaceOrPickUp =
        st.selectedPinBrush !== null ||
        st.pendingPinInventory.length > 0 ||
        (pin.customizable && pin.kind !== 'NORMAL');

      if (canPlaceOrPickUp && this.engine.placePinOnSlot(pin.id)) {
        this.sound.playUiClick(920);
        this.lastShopSignature = '';
        this.update(0, this.engine.drainEvents());
      }
    });

    // End Screen buttons
    this.q('btn-continue-endless').addEventListener('click', () => {
      this.sound.playUiClick(880);
      this.engine.continueIntoEndless();
      this.update(0, this.engine.drainEvents());
    });

    this.q('btn-retry-run').addEventListener('click', () => {
      const mode = this.engine.getState().mode;
      this.sound.playUiClick(780);
      this.renderer.clearVfx();
      this.runBaselineHighScore = this.highScore;
      this.engine.startNewRun(mode);
      this.update(0, this.engine.drainEvents());
    });

    this.q('btn-back-title').addEventListener('click', () => {
      this.sound.playUiClick(540);
      this.engine.returnToTitle();
      this.update(0, this.engine.drainEvents());
    });
  }

  public invalidateCaches(): void {
    this.lastHudSignature = '';
    this.lastControlSignature = '';
    this.lastShopSignature = '';
    this.lastEndSignature = '';
  }

  public update(dt: number, events: GameEvent[]): void {
    const state = this.engine.getState();

    // Hold-to-fire smooth rapid trigger during PLAYING
    if (
      this.holdingLaunch &&
      state.phase === 'PLAYING' &&
      !state.strokeLocked &&
      state.ballQueue.length > 0
    ) {
      this.holdAccumulator += dt;
      if (this.holdAccumulator >= 0.24) {
        this.holdAccumulator = 0;
        this.engine.fireBall();
      }
    } else {
      if (state.ballQueue.length === 0 || state.phase !== 'PLAYING') {
        this.holdingLaunch = false;
      }
      this.holdAccumulator = 0;
    }

    // Audio & VFX dispatch
    this.sound.setFeverState(state.feverActive);
    for (const ev of events) {
      this.sound.playEvent(ev);
    }

    this.renderer.ingestEvents(events);
    this.renderer.updateVfx(dt);

    // Phase-aware BGM selection
    if (state.phase === 'TITLE') {
      this.sound.setBgmTrack('TITLE');
    } else if (state.feverActive) {
      this.sound.setBgmTrack('FEVER');
    } else if (state.phase === 'GAME_OVER') {
      this.sound.setBgmTrack('NONE');
    } else {
      this.sound.setBgmTrack('STAGE');
    }

    // Sync Phase Visibility
    if (this.lastPhase !== state.phase) {
      this.onPhaseChanged(state);
      this.lastPhase = state.phase;
    }

    // Show aim reticle only in PLAYING or during explicit Board Customization
    const customizingBoard =
      state.phase === 'SHOP' && (this.shopTab === 'BOARD' || this.boardFocusMode);
    this.renderer.setShowAimGuide(state.phase === 'PLAYING' || customizingBoard);
    this.renderer.setBoardTuneHighlight(customizingBoard);

    // Sync Active UI Views
    if (state.phase !== 'TITLE') {
      this.syncGameplayHud(state);
      this.renderer.render(state, this.engine);
    }

    if (state.phase === 'STAGE_CLEAR') {
      this.syncStageClearModal(state);
    } else if (state.phase === 'SHOP') {
      this.syncShopDrawer(state);
    } else if (state.phase === 'VICTORY' || state.phase === 'GAME_OVER') {
      this.syncEndModal(state);
    }
  }

  private onPhaseChanged(state: GameStateSnapshot): void {
    this.holdingLaunch = false;
    this.holdAccumulator = 0;
    this.appEl.dataset.phase = state.phase;

    const isTitle = state.phase === 'TITLE';
    this.screenTitle.classList.toggle('is-hidden', !isTitle);
    this.cabinetShell.classList.toggle('is-hidden', isTitle);

    // Pause hidden title attract video during gameplay to free CPU/GPU decode overhead
    if (this.titleVideoEl) {
      if (isTitle) {
        if (this.titleVideoEl.paused) {
          void this.titleVideoEl.play().catch(() => {});
        }
      } else if (!this.titleVideoEl.paused) {
        this.titleVideoEl.pause();
      }
    }

    this.overlayStageClear.classList.toggle('is-hidden', state.phase !== 'STAGE_CLEAR');
    this.overlayShop.classList.toggle('is-hidden', state.phase !== 'SHOP');
    this.overlayEnd.classList.toggle(
      'is-hidden',
      state.phase !== 'VICTORY' && state.phase !== 'GAME_OVER'
    );

    this.q('mobile-relic-popover').classList.add('is-hidden');
    this.q('mobile-ball-popover').classList.add('is-hidden');

    if (state.phase === 'SHOP') {
      this.shopTab = 'BUY';
      this.boardFocusMode = false;
      this.lastShopSignature = '';
    }
    if (state.phase === 'VICTORY' || state.phase === 'GAME_OVER') {
      this.lastEndSignature = '';
    }
    if (isTitle) {
      this.renderer.clearVfx();
    }
    this.lastHudSignature = '';
    this.lastControlSignature = '';
  }

  private syncAudioButtons(): void {
    const bgmOn = this.sound.isBgmEnabled();
    const seOn = this.sound.isSeEnabled();
    const bgmPct = bgmOn ? Math.round(this.sound.getBgmVolume() * 100) : 0;
    const sePct = seOn ? Math.round(this.sound.getSeVolume() * 100) : 0;

    ['btn-toggle-bgm', 'btn-toggle-bgm-title', 'btn-mixer-bgm'].forEach((id) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.classList.toggle('is-on', bgmOn);
      const slot = btn.querySelector('.icon-slot');
      if (slot) slot.innerHTML = getUiIconSvg(bgmOn ? 'bgmOn' : 'bgmOff', 16);
    });

    ['btn-toggle-se', 'btn-toggle-se-title', 'btn-mixer-se'].forEach((id) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.classList.toggle('is-on', seOn);
      const slot = btn.querySelector('.icon-slot');
      if (slot) slot.innerHTML = getUiIconSvg(seOn ? 'seOn' : 'seOff', 16);
    });

    const anyOn = bgmOn || seOn;
    ['btn-sound-mixer-title', 'btn-sound-mixer-desktop', 'btn-sound-mixer-mobile'].forEach((id) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.classList.toggle('is-on', anyOn);
      const slot = btn.querySelector('.icon-slot');
      if (slot) slot.innerHTML = getUiIconSvg(anyOn ? 'seOn' : 'seOff', 15);
    });

    const bgmSlider = document.getElementById('slider-bgm-vol') as HTMLInputElement | null;
    if (bgmSlider) bgmSlider.value = String(bgmPct);
    const bgmPctEl = document.getElementById('bgm-vol-pct');
    if (bgmPctEl) bgmPctEl.textContent = `${bgmPct}%`;

    const seSlider = document.getElementById('slider-se-vol') as HTMLInputElement | null;
    if (seSlider) seSlider.value = String(sePct);
    const sePctEl = document.getElementById('se-vol-pct');
    if (sePctEl) sePctEl.textContent = `${sePct}%`;
  }

  private updateTitleHighScore(): void {
    const el = document.getElementById('title-high-score');
    if (el) el.textContent = formatScore(this.highScore);
  }

  private getStrokeRouteName(power: number): string {
    if (power < 0.24) return '左打ち';
    if (power <= 0.42) return 'ぶっ込み';
    if (power < 0.68) return '中央';
    if (power < 0.85) return '右狙い';
    return '右打ち全開';
  }

  private syncGameplayHud(state: GameStateSnapshot): void {
    const pct = Math.round(state.launchPower * 100);
    const canFire = state.phase === 'PLAYING' && state.ballQueue.length > 0;
    const ctrlSig = `${pct}|${state.strokeLocked ? 1 : 0}|${canFire ? 1 : 0}`;

    if (ctrlSig !== this.lastControlSignature) {
      this.lastControlSignature = ctrlSig;
      const routeText = `${this.getStrokeRouteName(state.launchPower)} ${pct}%`;

      const powerSlider = this.q<HTMLInputElement>('slider-power');
      if (document.activeElement !== powerSlider && powerSlider.value !== String(pct)) {
        powerSlider.value = String(pct);
      }

      this.q('hud-power-pct').textContent = `${pct}%`;
      this.q('hud-stroke-route').textContent = routeText;
      this.q('mcb-route-lbl').textContent = this.getStrokeRouteName(state.launchPower);

      const rotary = this.q('rotary-handle-visual');
      const deg = (state.launchPower - 0.5) * 230;
      rotary.style.transform = `rotate(${deg.toFixed(1)}deg)`;

      document.querySelectorAll<HTMLElement>('.aim-preset-btn').forEach((btn) => {
        const p = Number(btn.dataset.power ?? '0');
        btn.classList.toggle('is-active', Math.abs(p - state.launchPower) < 0.08);
      });

      const lockBtn = this.q('btn-lock-stroke');
      lockBtn.classList.toggle('is-locked', state.strokeLocked);
      lockBtn.setAttribute('aria-pressed', String(state.strokeLocked));
      const lockIconHtml = getUiIconSvg(state.strokeLocked ? 'lockOn' : 'lockOff', 15);
      lockBtn.querySelectorAll('.lock-icon-slot').forEach((s) => (s.innerHTML = lockIconHtml));

      (this.q('btn-launch') as HTMLButtonElement).disabled = !canFire;
    }

    const pinSig = state.pins.map((p) => p.kind[0]).join('');
    const pulseSig = state.ownedRelics
      .map((id) => ((state.relicPulse[id] ?? 0) > 0.25 ? '1' : '0'))
      .join('');
    const hudSig = [
      state.mode,
      state.stage,
      Math.floor(state.stageScore),
      Math.floor(state.totalRunScore),
      state.targetScore,
      state.stageMult.toFixed(2),
      state.cardLevel,
      state.medals,
      state.feverActive ? 1 : 0,
      state.ballQueue.join(','),
      state.completedLineIds.length,
      state.ownedRelics.join(','),
      pulseSig,
      pinSig,
    ].join('|');

    if (hudSig === this.lastHudSignature) return;
    this.lastHudSignature = hudSig;

    if (state.totalRunScore > this.highScore) {
      this.saveHighScore(state.totalRunScore);
    }

    const stageLabel =
      state.mode === 'ENDLESS'
        ? `ENDLESS STG ${state.stage}`
        : `STAGE ${state.stage} / ${state.maxStandardStage}`;
    this.q('hud-stage-badge').textContent = stageLabel;
    this.q('mm-stage-badge').textContent =
      state.mode === 'ENDLESS' ? `END ${state.stage}` : `STG ${state.stage}/${state.maxStandardStage}`;

    const scoreStr = formatScore(state.stageScore);
    const targetStr = formatScore(state.targetScore);
    const pctFill = Math.min(100, (state.stageScore / Math.max(1, state.targetScore)) * 100);

    this.q('hud-stage-score').textContent = scoreStr;
    this.q('hud-target-score').textContent = targetStr;
    this.q('hud-score-progress').style.width = `${pctFill.toFixed(1)}%`;

    this.q('mm-score-val').textContent = formatCompactMobileScore(state.stageScore);
    this.q('mm-target-val').textContent = formatCompactMobileScore(state.targetScore);
    this.q('mm-progress-fill').style.width = `${pctFill.toFixed(1)}%`;

    const multStr = formatMult(state.stageMult);
    this.q('hud-stage-mult').textContent = multStr;
    this.q('mm-mult-badge').textContent = multStr;

    this.q('hud-card-level').textContent = `LV.${state.cardLevel}`;
    this.q('mm-card-level').textContent = `LV.${state.cardLevel}`;
    this.q('hud-medals').textContent = `¥${formatScore(state.medals)}`;
    this.q('mm-medals-val').textContent = `¥${formatScore(state.medals)}`;
    this.q('hud-run-score').textContent = formatScore(state.totalRunScore);
    this.q('hud-fever-pill').classList.toggle('is-hidden', !state.feverActive);
    this.q('mm-fever-pill').classList.toggle('is-hidden', !state.feverActive);

    // Ball Queue & Next Ball
    const remaining = state.ballQueue.length;
    this.q('hud-balls-remaining').textContent = `${remaining} LEFT`;
    this.q('mcb-balls-left').textContent = `x${remaining}`;

    const nextKind: BallKind = state.ballQueue[0] ?? 'STEEL';
    const nextDef = BALL_CATALOG[nextKind];
    this.q('hud-next-ball-icon').innerHTML = getBallIconSvg(nextKind, 34);
    this.q('mcb-next-icon').innerHTML = getBallIconSvg(nextKind, 22);
    this.q('hud-next-ball-name').textContent = remaining > 0 ? nextDef.name : '玉切れ';
    this.q('hud-next-ball-desc').textContent =
      remaining > 0 ? nextDef.description : '盤面上の玉の結果を待機中...';

    const queueEl = this.q('hud-ball-queue');
    queueEl.innerHTML = state.ballQueue
      .slice(0, 18)
      .map(
        (bk, idx) =>
          `<div class="queue-ball-pip ${idx === 0 ? 'is-next' : ''}" title="${BALL_CATALOG[bk].name}">${getBallIconSvg(bk, 15)}</div>`
      )
      .join('');

    // Mobile Next Ball & Deck Breakdown Popover
    const ballDetailEl = this.q('mobile-ball-detail');
    const ballCounts = new Map<BallKind, number>();
    for (const bk of state.ballQueue) {
      ballCounts.set(bk, (ballCounts.get(bk) ?? 0) + 1);
    }
    const countsHtml = Array.from(ballCounts.entries())
      .map(
        ([bk, count]) =>
          `<div class="pin-chip">${getBallIconSvg(bk, 15)}<span>${BALL_CATALOG[bk].shortLabel} ×${count}</span></div>`
      )
      .join('');

    ballDetailEl.innerHTML = `
      <div class="shop-offer-card">
        <div class="offer-card-top">
          <div class="offer-icon-box">${getBallIconSvg(nextKind, 26)}</div>
          <div class="offer-head-meta">
            <strong class="offer-name">NEXT: ${remaining > 0 ? nextDef.name : '玉切れ'}</strong>
            <span class="offer-desc">${remaining > 0 ? nextDef.description : '結果待機中'}</span>
          </div>
        </div>
      </div>
      <div class="srs-title">残りマガジン内訳（計 ${remaining} 球）</div>
      <div class="pin-summary-chips">${countsHtml || '<span class="offer-desc">残り玉なし</span>'}</div>
    `;

    // Pin build summary
    this.q('hud-bingo-count').textContent = `${state.completedLineIds.length} BINGO`;
    const pinCounts: Partial<Record<PinKind, number>> = {};
    for (const p of state.pins) {
      if (p.kind !== 'NORMAL') {
        pinCounts[p.kind] = (pinCounts[p.kind] ?? 0) + 1;
      }
    }
    const summaryEl = this.q('hud-pin-summary');
    const entries = Object.entries(pinCounts) as Array<[PinKind, number]>;
    if (entries.length === 0) {
      summaryEl.innerHTML = `<div class="pin-chip">${getPinIconSvg('NORMAL', 15)}<span>標準釘のみ</span></div>`;
    } else {
      summaryEl.innerHTML = entries
        .map(
          ([kind, count]) =>
            `<div class="pin-chip">${getPinIconSvg(kind, 15)}<span>${PIN_CATALOG[kind].shortLabel} ×${count}</span></div>`
        )
        .join('');
    }

    this.renderRelicRack(state);
  }

  private renderRelicRack(state: GameStateSnapshot): void {
    this.q('hud-relic-count').textContent = `${state.ownedRelics.length} / 6`;
    this.q('mm-relics-count').textContent = `${state.ownedRelics.length}/6`;

    const grid = this.q('hud-relic-slots');
    grid.innerHTML = '';

    for (let i = 0; i < 6; i++) {
      const id = state.ownedRelics[i];
      const slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'relic-slot';

      if (id) {
        const def = RELIC_CATALOG[id];
        const pulse = (state.relicPulse[id] ?? 0) > 0.25;
        slot.classList.add('is-owned');
        if (pulse) slot.classList.add('is-pulsing');
        slot.style.borderColor = pulse ? '#ffd000' : def.accentColor;
        slot.innerHTML = getRelicIconSvg(id, 28);
        slot.title = `${def.name}: ${def.description}`;
        slot.addEventListener('mouseenter', () => {
          this.selectedRelicId = id;
          this.updateRelicTooltip(id);
        });
        slot.addEventListener('click', () => {
          this.selectedRelicId = id;
          this.updateRelicTooltip(id);
        });
      } else {
        slot.disabled = true;
        slot.innerHTML = '<span class="relic-empty-dot"></span>';
      }
      grid.appendChild(slot);
    }

    if (this.selectedRelicId && state.ownedRelics.includes(this.selectedRelicId)) {
      this.updateRelicTooltip(this.selectedRelicId);
    } else if (state.ownedRelics.length > 0) {
      this.updateRelicTooltip(state.ownedRelics[state.ownedRelics.length - 1]);
    } else {
      this.q('hud-relic-tooltip').textContent =
        'レリックを購入するとここに装着され、発動時に電撃パルスが走ります。';
    }

    const mobList = this.q('mobile-relic-list');
    if (state.ownedRelics.length === 0) {
      mobList.innerHTML =
        '<div class="offer-desc">まだレリックを所持していません。ショップで購入しよう！</div>';
    } else {
      mobList.innerHTML = state.ownedRelics
        .map((id) => {
          const def = RELIC_CATALOG[id];
          return `<div class="shop-offer-card">
            <div class="offer-card-top">
              <div class="offer-icon-box">${getRelicIconSvg(id, 24)}</div>
              <div class="offer-head-meta">
                <strong class="offer-name">${def.name}</strong>
                <span class="offer-desc">${def.description}</span>
              </div>
            </div>
          </div>`;
        })
        .join('');
    }
  }

  private updateRelicTooltip(id: RelicId): void {
    const def = RELIC_CATALOG[id];
    const el = this.q('hud-relic-tooltip');
    el.innerHTML = `<strong style="color:${def.accentColor}">${def.name}</strong><br>${def.description}`;
  }

  private syncStageClearModal(state: GameStateSnapshot): void {
    const sum = state.clearSummary;
    if (!sum) return;
    this.q('clear-heading').textContent = `STAGE ${sum.stage} CLEAR`;
    this.q('clear-stage-score').textContent = formatScore(sum.stageScore);
    this.q('clear-base-reward').textContent = `+¥${sum.baseReward}`;
    this.q('clear-unused-balls').textContent = String(sum.unusedBalls);
    this.q('clear-ball-bonus').textContent = `+¥${sum.ballBonus}`;
    this.q('clear-bingo-bonus').textContent = `+¥${sum.bingoBonus}`;
    this.q('clear-total-medals').textContent = `+¥${sum.totalMedalsEarned}`;
  }

  private syncShopDrawer(state: GameStateSnapshot): void {
    const sig = [
      state.stage,
      state.medals,
      state.rerollCost,
      this.shopTab,
      this.boardFocusMode ? 1 : 0,
      state.selectedPinBrush ?? 'none',
      state.pendingPinInventory.join(','),
      state.ownedRelics.join(','),
      state.shopOffers.map((o) => `${o.id}:${o.sold ? 1 : 0}`).join(','),
    ].join('|');

    if (sig === this.lastShopSignature) return;
    this.lastShopSignature = sig;

    this.q('shop-stage-title').textContent = `STAGE ${state.stage} SHOP`;
    this.q('shop-medals').textContent = `¥${formatScore(state.medals)}`;
    this.q('shop-reroll-cost').textContent = `¥${state.rerollCost}`;
    (this.q('btn-reroll-shop') as HTMLButtonElement).disabled = state.medals < state.rerollCost;

    this.overlayShop.classList.toggle('is-hidden', this.boardFocusMode);
    this.overlayShop.classList.toggle('is-board-focus', this.boardFocusMode);
    this.overlayShop.classList.toggle('is-board-tab', this.shopTab === 'BOARD' && !this.boardFocusMode);
    this.boardTuneBanner.classList.toggle('is-hidden', !this.boardFocusMode);

    const pendingCount = state.pendingPinInventory.length;
    const badge = this.q('shop-pending-badge');
    badge.textContent = String(pendingCount);
    badge.classList.toggle('is-hidden', pendingCount === 0);

    this.q('shop-autoplace-note').classList.toggle('is-hidden', pendingCount === 0);

    const tabBuy = this.q('tab-shop-buy');
    const tabBoard = this.q('tab-board-tune');
    tabBuy.classList.toggle('is-active', this.shopTab === 'BUY');
    tabBoard.classList.toggle('is-active', this.shopTab === 'BOARD');
    tabBuy.setAttribute('aria-selected', String(this.shopTab === 'BUY'));
    tabBoard.setAttribute('aria-selected', String(this.shopTab === 'BOARD'));

    this.q('shop-view-buy').classList.toggle('is-hidden', this.shopTab !== 'BUY');
    this.q('shop-view-board').classList.toggle('is-hidden', this.shopTab !== 'BOARD');

    const offersGrid = this.q('shop-offers-grid');
    offersGrid.innerHTML = '';
    for (const offer of state.shopOffers) {
      offersGrid.appendChild(this.createOfferCard(offer, state.medals, state.ownedRelics.length >= 6));
    }

    const sellList = this.q('shop-owned-relics');
    sellList.innerHTML = '';
    if (state.ownedRelics.length === 0) {
      sellList.innerHTML = '<span class="offer-desc">所持レリックなし（最大6枠）</span>';
    } else {
      for (const id of state.ownedRelics) {
        const def = RELIC_CATALOG[id];
        const refund = Math.floor(def.cost * 0.5);
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'sell-relic-chip';
        chip.innerHTML = `${getRelicIconSvg(id, 15)}<span>${def.name}</span><strong style="color:#ffb800">+¥${refund}</strong>`;
        chip.addEventListener('click', () => {
          if (this.engine.sellRelic(id)) {
            this.sound.playUiClick(620);
            this.lastShopSignature = '';
            this.update(0, this.engine.drainEvents());
          }
        });
        sellList.appendChild(chip);
      }
    }

    const invEl = this.q('shop-pin-inventory');
    invEl.innerHTML = '';
    if (pendingCount === 0) {
      invEl.innerHTML =
        '<div class="offer-desc">未配置の特殊釘はありません。盤面上の装着済み特殊釘をクリックすると回収して別スロットへ付け替えられます！</div>';
      this.q('btb-hint').textContent = '装着済みの特殊釘をタップで回収＆付け替え可能';
    } else {
      const counts = new Map<PinKind, number>();
      for (const pk of state.pendingPinInventory) {
        counts.set(pk, (counts.get(pk) ?? 0) + 1);
      }
      counts.forEach((cnt, kind) => {
        const def = PIN_CATALOG[kind];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `pin-brush-btn ${state.selectedPinBrush === kind ? 'is-selected' : ''}`;
        btn.innerHTML = `
          ${getPinIconSvg(kind, 26)}
          <div class="offer-head-meta" style="flex:1">
            <strong class="offer-name">${def.name} ×${cnt}</strong>
            <span class="offer-desc">${def.description}</span>
          </div>
        `;
        btn.addEventListener('click', () => {
          this.sound.playUiClick(740);
          this.engine.selectPinBrush(kind);
          this.lastShopSignature = '';
          this.update(0, this.engine.drainEvents());
        });
        invEl.appendChild(btn);
      });

      const activeKind = state.selectedPinBrush ?? state.pendingPinInventory[0];
      this.q('btb-hint').textContent = `選択中: ${PIN_CATALOG[activeKind].name} (残り${pendingCount}個) — 盤面の緑枠をタップ`;
    }
  }

  private createOfferCard(offer: ShopOffer, medals: number, relicsFull = false): HTMLElement {
    const card = document.createElement('div');
    card.className = `shop-offer-card ${offer.sold ? 'is-sold' : ''}`;

    let iconSvg = '';
    if (offer.offerKind === 'PIN' && offer.pinKind) {
      iconSvg = getPinIconSvg(offer.pinKind, 24);
    } else if (offer.offerKind === 'BALL' && offer.ballKind) {
      iconSvg = getBallIconSvg(offer.ballKind, 24);
    } else if (offer.offerKind === 'RELIC' && offer.relicId) {
      iconSvg = getRelicIconSvg(offer.relicId, 24);
    }

    const isRelicBlocked = offer.offerKind === 'RELIC' && !offer.sold && relicsFull;
    const canAfford = !offer.sold && !isRelicBlocked && medals >= offer.cost;
    const btnLabel = offer.sold ? 'SOLD' : isRelicBlocked ? '満枠 (6/6)' : `¥${offer.cost}`;

    card.innerHTML = `
      <div class="offer-card-top">
        <div class="offer-icon-box" style="border-color:${offer.accentColor}">${iconSvg}</div>
        <div class="offer-head-meta">
          <div class="offer-title-row">
            <span class="offer-rarity" style="color:${offer.accentColor}">${offer.rarityLabel}</span>
          </div>
          <span class="offer-name">${offer.name}</span>
        </div>
      </div>
      <div class="offer-desc">${offer.description}</div>
      <button class="offer-buy-btn" type="button" data-shop-offer-id="${offer.id}" ${canAfford ? '' : 'disabled'}>${btnLabel}</button>
    `;

    const buyBtn = card.querySelector<HTMLButtonElement>('.offer-buy-btn');
    buyBtn?.addEventListener('click', () => {
      if (this.engine.buyShopOffer(offer.id)) {
        this.sound.playUiClick(860);
        this.lastShopSignature = '';
        this.update(0, this.engine.drainEvents());
      }
    });

    return card;
  }

  private syncEndModal(state: GameStateSnapshot): void {
    const sig = `${state.phase}|${state.totalRunScore}|${state.stats.totalBingos}|${state.ownedRelics.join(',')}`;
    if (sig === this.lastEndSignature) return;
    this.lastEndSignature = sig;

    this.saveHighScore(state.totalRunScore);
    const isNewRecord =
      state.totalRunScore > this.runBaselineHighScore && state.totalRunScore > 0;
    const isVictory = state.phase === 'VICTORY';

    const kicker = this.q('end-kicker');
    kicker.textContent = isVictory
      ? 'MISSION COMPLETE — ALL 8 STAGES CLEARED'
      : 'OUT OF BALLS — TARGET NOT REACHED';
    kicker.className = `modal-kicker ${isVictory ? 'gold' : 'crimson'}`;

    this.q('end-title').textContent = isVictory ? 'CABINET CONQUERED!' : 'GAME OVER';
    this.q('end-new-record').classList.toggle('is-hidden', !isNewRecord);

    this.q('end-run-score').textContent = formatScore(state.totalRunScore);
    this.q('end-high-score').textContent = formatScore(this.highScore);
    this.q('end-max-mult').textContent = formatMult(state.stats.maxStageMult);
    this.q('end-best-shot').textContent = formatScore(state.stats.highestSingleShot);
    this.q('end-bingos').textContent = `${state.stats.totalBingos} / ${state.stats.totalFullCards}`;

    const relicsPreview = this.q('end-relics-list');
    if (state.ownedRelics.length === 0) {
      relicsPreview.innerHTML = '<span class="offer-desc">NONE</span>';
    } else {
      relicsPreview.innerHTML = state.ownedRelics
        .map(
          (id) =>
            `<div class="end-relic-chip" style="border-color:${RELIC_CATALOG[id].accentColor}">${getRelicIconSvg(id, 16)}<span>${RELIC_CATALOG[id].name}</span></div>`
        )
        .join('');
    }

    this.q('btn-continue-endless').classList.toggle('is-hidden', !isVictory);
    const retryBtn = this.q('btn-retry-run');
    retryBtn.className = isVictory
      ? 'cta-secondary-btn cyan-outline full'
      : 'cta-primary-btn full';
  }
}
