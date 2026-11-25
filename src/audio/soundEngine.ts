import { GameEvent } from '../types';

export type BgmTrack = 'TITLE' | 'STAGE' | 'FEVER' | 'NONE';

const BGM_URLS: Record<Exclude<BgmTrack, 'NONE'>, string> = {
  TITLE: './assets/audio/bgm_title.mp3',
  STAGE: './assets/audio/bgm_stage.mp3',
  FEVER: './assets/audio/bgm_fever.mp3',
};

const STORAGE_KEY_BGM = 'neon_bingo_bgm_enabled';
const STORAGE_KEY_SE = 'neon_bingo_se_enabled';

// Pentatonic / Lydian hybrid frequencies in Hz (C4 up across ~3 octaves)
const CHIME_SCALE_HZ = [
  261.63, 293.66, 329.63, 369.99, 392.0, 440.0, 493.88, 523.25, 587.33, 659.25,
  739.99, 783.99, 880.0, 987.77, 1046.5, 1174.66, 1318.51, 1479.98, 1567.98, 1760.0,
];

interface AudioHandle {
  el: HTMLAudioElement;
  available: boolean;
  failed: boolean;
  targetVol: number;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private synthBgmGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private bgmEnabled: boolean;
  private seEnabled: boolean;
  private unlocked = false;
  private currentTrack: BgmTrack = 'NONE';
  private feverActive = false;

  private audioHandles: Partial<Record<Exclude<BgmTrack, 'NONE'>, AudioHandle>> = {};
  private fadeTimer: number | null = null;
  private synthBgmTimer: number | null = null;
  private synthStep = 0;

  private lastPinHitTime = 0;
  private lastChargeTickTime = 0;
  private lastOverdriveTriggerTime = 0;
  private lastCellOpenTime = 0;
  private lastCellReigniteTime = 0;
  private lastRelicProcTime = 0;
  private reigniteBurstCount = 0;
  private lastReigniteBurstAt = 0;

  constructor() {
    this.bgmEnabled = this.readStorageBool(STORAGE_KEY_BGM, true);
    this.seEnabled = this.readStorageBool(STORAGE_KEY_SE, true);
    this.initAudioElements();
  }

  private readStorageBool(key: string, fallback: boolean): boolean {
    try {
      const v = window.localStorage.getItem(key);
      if (v === '0' || v === 'false') return false;
      if (v === '1' || v === 'true') return true;
    } catch {
      // Ignore storage access failures in private/sandbox contexts
    }
    return fallback;
  }

  private writeStorageBool(key: string, value: boolean): void {
    try {
      window.localStorage.setItem(key, value ? '1' : '0');
    } catch {
      // Ignore storage write failures
    }
  }

  private initAudioElements(): void {
    if (typeof Audio === 'undefined') return;
    (['TITLE', 'STAGE', 'FEVER'] as const).forEach((track) => {
      try {
        const el = new Audio(BGM_URLS[track]);
        el.loop = true;
        el.preload = 'auto';
        el.volume = 0;
        const handle: AudioHandle = {
          el,
          available: false,
          failed: false,
          targetVol: 0,
        };
        el.addEventListener('canplaythrough', () => {
          handle.available = true;
          handle.failed = false;
        });
        el.addEventListener('loadeddata', () => {
          handle.available = true;
          handle.failed = false;
        });
        el.addEventListener('error', () => {
          handle.failed = true;
          handle.available = false;
          this.syncBgmPlayback();
        });
        this.audioHandles[track] = handle;
      } catch {
        this.audioHandles[track] = undefined;
      }
    });
  }

  public isBgmEnabled(): boolean {
    return this.bgmEnabled;
  }

  public isSeEnabled(): boolean {
    return this.seEnabled;
  }

  public getCurrentTrack(): BgmTrack {
    return this.currentTrack;
  }

  public unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      try {
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.85;
        this.masterGain.connect(this.ctx.destination);

        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = this.seEnabled ? 0.9 : 0;
        this.sfxGain.connect(this.masterGain);

        this.synthBgmGain = this.ctx.createGain();
        this.synthBgmGain.gain.value = this.bgmEnabled ? 0.24 : 0;
        this.synthBgmGain.connect(this.masterGain);

        this.noiseBuffer = this.createNoiseBuffer(this.ctx);
      } catch {
        return;
      }
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }

    if (!this.unlocked) {
      this.unlocked = true;
      this.syncBgmPlayback();
    }
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 0.8);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  public toggleBgm(): boolean {
    this.unlock();
    this.bgmEnabled = !this.bgmEnabled;
    this.writeStorageBool(STORAGE_KEY_BGM, this.bgmEnabled);
    if (this.synthBgmGain && this.ctx) {
      this.synthBgmGain.gain.setTargetAtTime(
        this.bgmEnabled ? 0.24 : 0,
        this.ctx.currentTime,
        0.04
      );
    }
    this.syncBgmPlayback();
    this.playUiClick();
    return this.bgmEnabled;
  }

  public toggleSe(): boolean {
    this.unlock();
    this.seEnabled = !this.seEnabled;
    this.writeStorageBool(STORAGE_KEY_SE, this.seEnabled);
    if (this.sfxGain && this.ctx) {
      this.sfxGain.gain.setTargetAtTime(
        this.seEnabled ? 0.9 : 0,
        this.ctx.currentTime,
        0.03
      );
    }
    if (this.seEnabled) {
      this.playUiClick();
    }
    return this.seEnabled;
  }

  public setFeverState(active: boolean): void {
    this.feverActive = active;
  }

  public setBgmTrack(track: BgmTrack): void {
    if (this.currentTrack === track) return;
    this.currentTrack = track;
    this.syncBgmPlayback();
  }

  private syncBgmPlayback(): void {
    if (typeof window === 'undefined') return;
    const activeTrack =
      this.bgmEnabled && this.unlocked && this.currentTrack !== 'NONE'
        ? this.currentTrack
        : null;

    let usingFileAudio = false;

    (['TITLE', 'STAGE', 'FEVER'] as const).forEach((track) => {
      const handle = this.audioHandles[track];
      if (!handle) return;
      const shouldPlay = activeTrack === track && !handle.failed;
      handle.targetVol = shouldPlay ? (track === 'FEVER' ? 0.42 : 0.34) : 0;
      if (shouldPlay) {
        usingFileAudio = true;
        if (handle.el.paused) {
          void handle.el.play().catch((err: unknown) => {
            const errName =
              err && typeof err === 'object' && 'name' in err
                ? String((err as { name?: string }).name)
                : '';
            if (errName !== 'AbortError' && errName !== 'NotAllowedError') {
              handle.failed = true;
            }
            this.ensureSynthFallback();
          });
        }
      }
    });

    this.startFadeLoop();

    if (!activeTrack) {
      this.stopSynthFallback();
    } else if (!usingFileAudio || this.isTrackFailed(activeTrack)) {
      this.ensureSynthFallback();
    } else {
      const h = this.audioHandles[activeTrack];
      if (h && !h.available && !h.failed) {
        // Play procedural synth softly until MP3 finishes buffering/decoding, or permanently if missing
        this.ensureSynthFallback();
      } else {
        this.stopSynthFallback();
      }
    }
  }

  private isTrackFailed(track: Exclude<BgmTrack, 'NONE'>): boolean {
    const h = this.audioHandles[track];
    return !h || h.failed;
  }

  private startFadeLoop(): void {
    if (this.fadeTimer !== null || typeof window === 'undefined') return;
    this.fadeTimer = window.setInterval(() => {
      let anyChanging = false;
      (['TITLE', 'STAGE', 'FEVER'] as const).forEach((track) => {
        const handle = this.audioHandles[track];
        if (!handle) return;
        const diff = handle.targetVol - handle.el.volume;
        if (Math.abs(diff) > 0.015) {
          handle.el.volume = Math.max(0, Math.min(1, handle.el.volume + diff * 0.22));
          anyChanging = true;
        } else {
          handle.el.volume = handle.targetVol;
          if (handle.targetVol === 0 && !handle.el.paused) {
            handle.el.pause();
          }
        }
        // Stop procedural fallback once real MP3 is actively audible
        if (
          track === this.currentTrack &&
          this.bgmEnabled &&
          handle.available &&
          !handle.failed &&
          !handle.el.paused &&
          handle.el.volume > 0.05
        ) {
          this.stopSynthFallback();
        }
      });

      if (!anyChanging && this.fadeTimer !== null) {
        window.clearInterval(this.fadeTimer);
        this.fadeTimer = null;
      }
    }, 50);
  }

  private ensureSynthFallback(): void {
    if (!this.bgmEnabled || !this.unlocked || this.currentTrack === 'NONE') return;
    if (this.synthBgmTimer !== null || typeof window === 'undefined') return;

    const intervalMs = this.currentTrack === 'FEVER' ? 125 : this.currentTrack === 'STAGE' ? 150 : 185;
    this.synthBgmTimer = window.setInterval(() => {
      this.tickSynthGroove();
    }, intervalMs);
  }

  private stopSynthFallback(): void {
    if (this.synthBgmTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(this.synthBgmTimer);
      this.synthBgmTimer = null;
    }
  }

  private tickSynthGroove(): void {
    if (!this.ctx || !this.synthBgmGain || !this.bgmEnabled || this.currentTrack === 'NONE') return;
    if (this.ctx.state !== 'running') return;

    const handle = this.audioHandles[this.currentTrack];
    if (handle && handle.available && !handle.failed && !handle.el.paused && handle.el.volume > 0.1) {
      this.stopSynthFallback();
      return;
    }

    const now = this.ctx.currentTime;
    const step = this.synthStep % 16;
    this.synthStep++;

    // Cyber-arcade bassline progression (D minor / F / G / A)
    const bassRoots =
      this.currentTrack === 'FEVER'
        ? [146.83, 146.83, 174.61, 196.0, 220.0, 196.0, 174.61, 164.81]
        : [73.42, 73.42, 87.31, 98.0, 110.0, 98.0, 87.31, 82.41];
    const barIdx = Math.floor((this.synthStep - 1) / 16) % bassRoots.length;
    const bassFreq = bassRoots[barIdx] * (step % 4 === 2 ? 2 : 1);

    if (step % 2 === 0) {
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(bassFreq, now);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(this.currentTrack === 'FEVER' ? 920 : 580, now);
      filter.frequency.exponentialRampToValueAtTime(160, now + 0.13);
      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.synthBgmGain);
      osc.start(now);
      osc.stop(now + 0.15);
    }

    // Crisp arpeggio sparkle
    const arpOffsets = [0, 3, 7, 10, 12, 10, 7, 3];
    const arpIdx = arpOffsets[step % arpOffsets.length];
    if (this.currentTrack !== 'TITLE' || step % 2 === 1) {
      const leadFreq = bassRoots[barIdx] * 4 * Math.pow(2, arpIdx / 12);
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = this.currentTrack === 'FEVER' ? 'square' : 'triangle';
      osc.frequency.setValueAtTime(leadFreq, now);
      gain.gain.setValueAtTime(this.currentTrack === 'FEVER' ? 0.14 : 0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
      osc.connect(gain);
      gain.connect(this.synthBgmGain);
      osc.start(now);
      osc.stop(now + 0.12);
    }

    // Punchy synth hi-hat on off-beats
    if (step % 2 === 1 && this.noiseBuffer && this.currentTrack !== 'TITLE') {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 6500;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.07, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
      noise.connect(hp);
      hp.connect(g);
      g.connect(this.synthBgmGain);
      noise.start(now);
      noise.stop(now + 0.05);
    }
  }

  public playUiClick(pitch = 660): void {
    if (!this.seEnabled) return;
    this.unlock();
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(pitch, now);
    osc.frequency.exponentialRampToValueAtTime(pitch * 1.35, now + 0.045);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  public playChargeTick(power: number): void {
    if (!this.seEnabled) return;
    this.unlock();
    if (!this.ctx || !this.sfxGain) return;
    const nowMs = performance.now();
    if (nowMs - this.lastChargeTickTime < 45) return;
    this.lastChargeTickTime = nowMs;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    const freq = 320 + Math.max(0, Math.min(1, power)) * 520;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.035);
  }

  public playEvent(ev: GameEvent): void {
    if (!this.seEnabled) return;
    if (!this.ctx || !this.sfxGain) return;
    if (this.ctx.state !== 'running') return;

    switch (ev.type) {
      case 'LAUNCH':
        this.sfxLaunch();
        break;
      case 'PIN_HIT':
        this.sfxPinHit(ev.combo ?? 1, ev.text, ev.color);
        break;
      case 'BALL_SPLIT':
        this.sfxBallSplit();
        break;
      case 'BOMB_IGNITE':
        this.sfxBombIgnite();
        break;
      case 'BOMB_BLAST':
        this.sfxBombBlast();
        break;
      case 'POCKET_ENTER':
        this.sfxPocketEnter(ev.col ?? 2);
        break;
      case 'CELL_OPEN':
        this.sfxCellOpen();
        break;
      case 'CELL_REIGNITE':
        this.sfxCellReignite(ev.combo, ev.text);
        break;
      case 'OVERDRIVE_AWAKEN':
        this.sfxOverdrive(true);
        break;
      case 'OVERDRIVE_TRIGGER':
        this.sfxOverdrive(false);
        break;
      case 'BINGO_LINE':
        this.sfxBingoLine(ev.combo ?? 1);
        break;
      case 'FULL_BINGO_FEVER':
        this.sfxFullBingoFever();
        break;
      case 'SHOP_BUY':
        this.sfxShopBuy();
        break;
      case 'STAGE_CLEAR':
        this.sfxStageClear();
        break;
      case 'GAME_OVER':
        this.sfxGameOver();
        break;
      case 'RELIC_PROC':
        this.sfxRelicProc();
        break;
      case 'ANTI_STUCK_NUDGE':
        this.playTone(540, 740, 0.06, 'sine', 0.06);
        break;
    }
  }

  private playTone(
    freqStart: number,
    freqEnd: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    delay = 0
  ): void {
    if (!this.ctx || !this.sfxGain) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(30, freqStart), t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t0);
    osc.stop(t0 + duration + 0.01);
  }

  private sfxLaunch(): void {
    // Metallic pachinko spring snap + rising rail whirr
    this.playTone(170, 620, 0.13, 'sawtooth', 0.18);
    this.playTone(880, 1420, 0.07, 'triangle', 0.12);
    this.sfxNoiseBurst(0.06, 2200, 'bandpass', 0.14);
  }

  private sfxPinHit(combo: number, label?: string, color?: string): void {
    const nowMs = performance.now();
    if (nowMs - this.lastPinHitTime < 18) return;
    this.lastPinHitTime = nowMs;

    const idx = Math.min(CHIME_SCALE_HZ.length - 1, Math.max(0, combo - 1));
    const feverShift = this.feverActive ? 1.1892 : 1.0; // +3 semitones during Fever!
    const baseHz = CHIME_SCALE_HZ[idx] * feverShift;

    this.playTone(baseHz, baseHz * 1.015, 0.12, 'sine', 0.14);
    this.playTone(baseHz * 2, baseHz * 2.02, 0.07, 'triangle', 0.07);

    if (label && label.includes('x1.4')) {
      // Spinner harmonic shimmer
      this.playTone(baseHz * 1.5, baseHz * 2.25, 0.14, 'sine', 0.12, 0.02);
    } else if (color === '#ffb800' || (label && label.includes('+75'))) {
      // Heavy bumper sub-punch
      this.playTone(175, 68, 0.12, 'triangle', 0.24);
    }
  }

  private sfxBallSplit(): void {
    // Shimmering 3-note triad chord burst
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      this.playTone(freq, freq * 1.03, 0.22, 'triangle', 0.13, i * 0.025);
    });
  }

  private sfxBombIgnite(): void {
    this.playTone(220, 960, 0.22, 'sawtooth', 0.14);
    this.playTone(440, 1320, 0.18, 'sine', 0.11, 0.04);
  }

  private sfxBombBlast(): void {
    // Punchy sub-bass drop + filtered noise explosion
    this.playTone(135, 34, 0.38, 'sine', 0.38);
    this.playTone(190, 48, 0.28, 'sawtooth', 0.2);
    this.sfxNoiseBurst(0.36, 950, 'lowpass', 0.32);
  }

  private sfxPocketEnter(col: number): void {
    const colFreq = [392.0, 440.0, 493.88, 587.33, 659.25][col % 5] ?? 493.88;
    // Laser beam zap + mechanical cell lock-in
    this.playTone(1180, 340, 0.14, 'sawtooth', 0.16);
    this.playTone(colFreq, colFreq * 1.5, 0.14, 'triangle', 0.16, 0.04);
  }

  private sfxCellOpen(): void {
    const nowMs = performance.now();
    if (nowMs - this.lastCellOpenTime < 20) return;
    this.lastCellOpenTime = nowMs;

    this.playTone(587.33, 880, 0.16, 'triangle', 0.18);
    this.playTone(1174.66, 1174.66, 0.12, 'sine', 0.12, 0.04);
  }

  private sfxCellReignite(combo?: number, text?: string): void {
    const nowMs = performance.now();
    if (nowMs - this.lastCellReigniteTime < 20) return;
    this.lastCellReigniteTime = nowMs;

    if (nowMs - this.lastReigniteBurstAt > 600) {
      this.reigniteBurstCount = 0;
    }
    this.lastReigniteBurstAt = nowMs;
    this.reigniteBurstCount++;

    let stack = combo ?? 0;
    if (text) {
      const m = text.match(/#(\d+)/);
      if (m) {
        stack = Math.max(stack, Number(m[1]) || 1);
      }
    }
    stack = Math.max(1, stack, this.reigniteBurstCount);

    const root = 493.88 * Math.min(2.0, 1 + (stack - 1) * 0.09);
    this.playTone(root, root * 1.5, 0.18, 'sawtooth', 0.12);
    this.playTone(root * 2, root * 2.5, 0.16, 'sine', 0.13, 0.03);
  }

  private sfxOverdrive(awaken: boolean): void {
    if (!awaken) {
      const nowMs = performance.now();
      if (nowMs - this.lastOverdriveTriggerTime < 40) return;
      this.lastOverdriveTriggerTime = nowMs;
    }

    // High-voltage electric arc surge + octave synth hit
    this.playTone(165, 660, 0.26, 'sawtooth', 0.2);
    this.playTone(330, 1320, 0.28, 'square', 0.12, 0.03);
    this.sfxNoiseBurst(0.18, 3400, 'bandpass', 0.18);
    if (awaken) {
      this.playTone(880, 1760, 0.3, 'triangle', 0.18, 0.08);
    }
  }

  private sfxBingoLine(combo: number): void {
    const shift = Math.min(4, Math.max(0, combo - 1)) * 0.06;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
    notes.forEach((n, idx) => {
      const f = n * (1 + shift);
      this.playTone(f, f * 1.01, 0.24, 'triangle', 0.2, idx * 0.055);
      this.playTone(f * 0.5, f * 0.5, 0.24, 'sawtooth', 0.09, idx * 0.055);
    });
  }

  private sfxFullBingoFever(): void {
    const fanfare = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98, 2093.0];
    fanfare.forEach((f, i) => {
      this.playTone(f, f * 1.02, 0.34, 'square', 0.15, i * 0.055);
      this.playTone(f * 0.5, f * 0.5, 0.34, 'triangle', 0.18, i * 0.055);
    });
    this.sfxNoiseBurst(0.28, 4200, 'highpass', 0.16);
  }

  private sfxShopBuy(): void {
    // Crisp arcade medal register ka-ching!
    this.playTone(987.77, 987.77, 0.08, 'triangle', 0.18);
    this.playTone(1318.51, 1318.51, 0.24, 'sine', 0.22, 0.065);
    this.playTone(2637.02, 2637.02, 0.18, 'triangle', 0.11, 0.08);
  }

  private sfxStageClear(): void {
    const chord = [440, 554.37, 659.25, 880, 1108.73];
    chord.forEach((f, i) => {
      this.playTone(f, f, 0.32, 'triangle', 0.18, i * 0.07);
    });
  }

  private sfxGameOver(): void {
    const down = [392, 349.23, 311.13, 261.63];
    down.forEach((f, i) => {
      this.playTone(f, f * 0.94, 0.28, 'sawtooth', 0.14, i * 0.12);
    });
  }

  private sfxRelicProc(): void {
    const nowMs = performance.now();
    if (nowMs - this.lastRelicProcTime < 20) return;
    this.lastRelicProcTime = nowMs;

    this.playTone(740, 1108.73, 0.14, 'sine', 0.12);
  }

  private sfxNoiseBurst(
    duration: number,
    filterFreq: number,
    filterType: BiquadFilterType,
    volume: number
  ): void {
    if (!this.ctx || !this.sfxGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(filterFreq, now);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    src.start(now);
    src.stop(now + duration + 0.02);
  }
}
