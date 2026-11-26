import { GameEvent } from '../types';

export type BgmTrack = 'TITLE' | 'STAGE' | 'FEVER' | 'NONE';

const BGM_URLS: Record<Exclude<BgmTrack, 'NONE'>, string> = {
  TITLE: './assets/audio/bgm_title.mp3',
  STAGE: './assets/audio/bgm_stage.mp3',
  FEVER: './assets/audio/bgm_fever.mp3',
};

const STORAGE_KEY_BGM = 'neon_bingo_bgm_enabled';
const STORAGE_KEY_SE = 'neon_bingo_se_enabled';
const STORAGE_KEY_BGM_VOL = 'neon_bingo_bgm_volume_v2';
const STORAGE_KEY_SE_VOL = 'neon_bingo_se_volume_v2';

// Gentle, comfortable defaults (especially on mobile speakers)
const DEFAULT_BGM_VOLUME = 0.28;
const DEFAULT_SE_VOLUME = 0.35;

// Calibrated internal gain ceilings so 100% is full studio level without harsh clipping
const MAX_BGM_GAIN = 0.52;
const MAX_SE_GAIN = 0.56;
const MAX_SYNTH_BGM_GAIN = 0.22;

// Pentatonic / Lydian hybrid frequencies in Hz (C4 up across ~3 octaves)
const CHIME_SCALE_HZ = [
  261.63, 293.66, 329.63, 369.99, 392.0, 440.0, 493.88, 523.25, 587.33, 659.25,
  739.99, 783.99, 880.0, 987.77, 1046.5, 1174.66, 1318.51, 1479.98, 1567.98, 1760.0,
];

interface DecodedTrackState {
  buffer: AudioBuffer | null;
  loading: boolean;
  failed: boolean;
  source: AudioBufferSourceNode | null;
  gainNode: GainNode | null;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private masterGain: GainNode | null = null;
  private bgmBusGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private synthBgmGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private bgmEnabled: boolean;
  private seEnabled: boolean;
  private bgmVolume: number; // 0..1
  private seVolume: number; // 0..1
  private unlocked = false;
  private currentTrack: BgmTrack = 'NONE';
  private feverActive = false;

  private tracks: Record<Exclude<BgmTrack, 'NONE'>, DecodedTrackState> = {
    TITLE: { buffer: null, loading: false, failed: false, source: null, gainNode: null },
    STAGE: { buffer: null, loading: false, failed: false, source: null, gainNode: null },
    FEVER: { buffer: null, loading: false, failed: false, source: null, gainNode: null },
  };

  private synthBgmTimer: number | null = null;
  private synthStep = 0;

  private lastPinHitTime = 0;
  private lastChargeTickTime = 0;
  private lastOverdriveTriggerTime = 0;
  private lastCellOpenTime = 0;
  private lastCellReigniteTime = 0;
  private lastRelicProcTime = 0;
  private lastPreviewSeTime = 0;
  private reigniteBurstCount = 0;
  private lastReigniteBurstAt = 0;
  private pocketChainStreak = 0;
  private lastPocketHitAt = 0;
  private lastKyuinAt = 0;

  constructor() {
    this.bgmEnabled = this.readStorageBool(STORAGE_KEY_BGM, true);
    this.seEnabled = this.readStorageBool(STORAGE_KEY_SE, true);
    this.bgmVolume = this.readStorageNumber(STORAGE_KEY_BGM_VOL, DEFAULT_BGM_VOLUME);
    this.seVolume = this.readStorageNumber(STORAGE_KEY_SE_VOL, DEFAULT_SE_VOLUME);
  }

  private readStorageBool(key: string, fallback: boolean): boolean {
    try {
      const v = window.localStorage.getItem(key);
      if (v === '0' || v === 'false') return false;
      if (v === '1' || v === 'true') return true;
    } catch {
      // Ignore storage access failures
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

  private readStorageNumber(key: string, fallback: number): number {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) {
          return Math.max(0, Math.min(1, parsed));
        }
      }
    } catch {
      // Ignore storage access failures
    }
    return fallback;
  }

  private writeStorageNumber(key: string, value: number): void {
    try {
      window.localStorage.setItem(key, String(Math.round(value * 100) / 100));
    } catch {
      // Ignore storage write failures
    }
  }

  public isBgmEnabled(): boolean {
    return this.bgmEnabled && this.bgmVolume > 0.001;
  }

  public isSeEnabled(): boolean {
    return this.seEnabled && this.seVolume > 0.001;
  }

  public getBgmVolume(): number {
    return this.bgmVolume;
  }

  public getSeVolume(): number {
    return this.seVolume;
  }

  public getCurrentTrack(): BgmTrack {
    return this.currentTrack;
  }

  /**
   * Computes perceptual (quadratic-tapered) gain for natural slider feel.
   */
  private computeBgmGainValue(): number {
    if (!this.bgmEnabled || this.bgmVolume <= 0.001) return 0;
    const curved = Math.pow(this.bgmVolume, 1.35);
    return curved * MAX_BGM_GAIN;
  }

  private computeSynthBgmGainValue(): number {
    if (!this.bgmEnabled || this.bgmVolume <= 0.001) return 0;
    const curved = Math.pow(this.bgmVolume, 1.35);
    return curved * MAX_SYNTH_BGM_GAIN;
  }

  private computeSeGainValue(): number {
    if (!this.seEnabled || this.seVolume <= 0.001) return 0;
    const curved = Math.pow(this.seVolume, 1.25);
    return curved * MAX_SE_GAIN;
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

        // Dynamics compressor keeps multi-ball chains + explosions punchy yet ear-friendly
        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -14;
        this.compressor.knee.value = 18;
        this.compressor.ratio.value = 6;
        this.compressor.attack.value = 0.004;
        this.compressor.release.value = 0.14;

        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.92;

        this.compressor.connect(this.masterGain);
        this.masterGain.connect(this.ctx.destination);

        // Web Audio BGM bus -> works reliably on iOS Safari where <audio>.volume is ignored!
        this.bgmBusGain = this.ctx.createGain();
        this.bgmBusGain.gain.value = this.computeBgmGainValue();
        this.bgmBusGain.connect(this.compressor);

        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = this.computeSeGainValue();
        this.sfxGain.connect(this.compressor);

        this.synthBgmGain = this.ctx.createGain();
        this.synthBgmGain.gain.value = this.computeSynthBgmGainValue();
        this.synthBgmGain.connect(this.compressor);

        this.noiseBuffer = this.createNoiseBuffer(this.ctx);
      } catch {
        return;
      }
    }

    if (this.ctx.state !== 'running') {
      void this.ctx
        .resume()
        .then(() => {
          this.applyBusGains();
          this.syncBgmPlayback();
        })
        .catch(() => {});
    }

    if (!this.unlocked) {
      this.unlocked = true;
      this.preloadTrack('TITLE');
      this.preloadTrack('STAGE');
      this.preloadTrack('FEVER');
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

  private preloadTrack(track: Exclude<BgmTrack, 'NONE'>): void {
    const st = this.tracks[track];
    if (!this.ctx || st.buffer || st.loading || st.failed) return;
    st.loading = true;

    void fetch(BGM_URLS[track])
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((arr) => {
        if (!this.ctx) throw new Error('AudioContext closed');
        return this.ctx.decodeAudioData(arr);
      })
      .then((decoded) => {
        st.buffer = decoded;
        st.loading = false;
        st.failed = false;
        if (this.currentTrack === track && this.bgmEnabled && this.bgmVolume > 0.001) {
          this.syncBgmPlayback();
        }
      })
      .catch(() => {
        st.loading = false;
        st.failed = true;
        if (this.currentTrack === track) {
          this.syncBgmPlayback();
        }
      });
  }

  public setBgmVolume(vol: number): void {
    this.unlock();
    const clamped = Math.max(0, Math.min(1, vol));
    this.bgmVolume = clamped;
    this.bgmEnabled = clamped > 0.001;
    this.writeStorageNumber(STORAGE_KEY_BGM_VOL, clamped);
    this.writeStorageBool(STORAGE_KEY_BGM, this.bgmEnabled);
    this.applyBusGains();
    this.syncBgmPlayback();
  }

  public setSeVolume(vol: number, playPreview = false): void {
    this.unlock();
    const clamped = Math.max(0, Math.min(1, vol));
    this.seVolume = clamped;
    this.seEnabled = clamped > 0.001;
    this.writeStorageNumber(STORAGE_KEY_SE_VOL, clamped);
    this.writeStorageBool(STORAGE_KEY_SE, this.seEnabled);
    this.applyBusGains();

    if (playPreview && this.isSeEnabled()) {
      const now = performance.now();
      if (now - this.lastPreviewSeTime > 120) {
        this.lastPreviewSeTime = now;
        this.playUiClick(740);
      }
    }
  }

  public toggleBgm(): boolean {
    this.unlock();
    if (this.isBgmEnabled()) {
      this.bgmEnabled = false;
    } else {
      this.bgmEnabled = true;
      if (this.bgmVolume <= 0.02) {
        this.bgmVolume = DEFAULT_BGM_VOLUME;
        this.writeStorageNumber(STORAGE_KEY_BGM_VOL, this.bgmVolume);
      }
    }
    this.writeStorageBool(STORAGE_KEY_BGM, this.bgmEnabled);
    this.applyBusGains();
    this.syncBgmPlayback();
    this.playUiClick();
    return this.isBgmEnabled();
  }

  public toggleSe(): boolean {
    this.unlock();
    if (this.isSeEnabled()) {
      this.seEnabled = false;
    } else {
      this.seEnabled = true;
      if (this.seVolume <= 0.02) {
        this.seVolume = DEFAULT_SE_VOLUME;
        this.writeStorageNumber(STORAGE_KEY_SE_VOL, this.seVolume);
      }
    }
    this.writeStorageBool(STORAGE_KEY_SE, this.seEnabled);
    this.applyBusGains();
    if (this.isSeEnabled()) {
      this.playUiClick();
    }
    return this.isSeEnabled();
  }

  private applyBusGains(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.bgmBusGain) {
      this.bgmBusGain.gain.setTargetAtTime(this.computeBgmGainValue(), now, 0.03);
    }
    if (this.synthBgmGain) {
      this.synthBgmGain.gain.setTargetAtTime(this.computeSynthBgmGainValue(), now, 0.03);
    }
    if (this.sfxGain) {
      this.sfxGain.gain.setTargetAtTime(this.computeSeGainValue(), now, 0.02);
    }
  }

  public setFeverState(active: boolean): void {
    this.feverActive = active;
  }

  public setBgmTrack(track: BgmTrack): void {
    if (this.currentTrack === track) return;
    this.currentTrack = track;
    if (track !== 'NONE' && this.unlocked) {
      this.preloadTrack(track);
    }
    this.syncBgmPlayback();
  }

  private syncBgmPlayback(): void {
    if (typeof window === 'undefined' || !this.ctx || !this.bgmBusGain) return;

    const activeTrack =
      this.isBgmEnabled() && this.unlocked && this.currentTrack !== 'NONE'
        ? this.currentTrack
        : null;

    const now = this.ctx.currentTime;

    (['TITLE', 'STAGE', 'FEVER'] as const).forEach((track) => {
      const st = this.tracks[track];
      const shouldPlay = activeTrack === track && st.buffer !== null;

      if (shouldPlay && st.buffer) {
        if (!st.source) {
          const src = this.ctx!.createBufferSource();
          src.buffer = st.buffer;
          src.loop = true;
          const g = this.ctx!.createGain();
          g.gain.setValueAtTime(0.0001, now);
          g.gain.linearRampToValueAtTime(track === 'FEVER' ? 1.08 : 0.92, now + 0.35);
          src.connect(g);
          g.connect(this.bgmBusGain!);
          src.start(now);
          st.source = src;
          st.gainNode = g;
        } else if (st.gainNode) {
          st.gainNode.gain.setTargetAtTime(track === 'FEVER' ? 1.08 : 0.92, now, 0.12);
        }
      } else if (st.source && st.gainNode) {
        const oldSrc = st.source;
        const oldGain = st.gainNode;
        st.source = null;
        st.gainNode = null;
        try {
          oldGain.gain.cancelScheduledValues(now);
          oldGain.gain.setValueAtTime(Math.max(0.0001, oldGain.gain.value), now);
          oldGain.gain.linearRampToValueAtTime(0.0001, now + 0.25);
          oldSrc.stop(now + 0.28);
        } catch {
          // Already stopped
        }
      }
    });

    if (!activeTrack) {
      this.stopSynthFallback();
    } else {
      const activeState = this.tracks[activeTrack];
      if (activeState.buffer) {
        this.stopSynthFallback();
      } else {
        this.preloadTrack(activeTrack);
        this.ensureSynthFallback();
      }
    }
  }

  private ensureSynthFallback(): void {
    if (!this.isBgmEnabled() || !this.unlocked || this.currentTrack === 'NONE') return;
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
    if (!this.ctx || !this.synthBgmGain || !this.isBgmEnabled() || this.currentTrack === 'NONE') return;
    if (this.ctx.state !== 'running') return;

    if (this.tracks[this.currentTrack].buffer) {
      this.stopSynthFallback();
      return;
    }

    const now = this.ctx.currentTime;
    const step = this.synthStep % 16;
    this.synthStep++;

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
      filter.frequency.setValueAtTime(this.currentTrack === 'FEVER' ? 820 : 520, now);
      filter.frequency.exponentialRampToValueAtTime(150, now + 0.13);
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.synthBgmGain);
      osc.start(now);
      osc.stop(now + 0.15);
    }

    const arpOffsets = [0, 3, 7, 10, 12, 10, 7, 3];
    const arpIdx = arpOffsets[step % arpOffsets.length];
    if (this.currentTrack !== 'TITLE' || step % 2 === 1) {
      const leadFreq = bassRoots[barIdx] * 4 * Math.pow(2, arpIdx / 12);
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(leadFreq, now);
      gain.gain.setValueAtTime(this.currentTrack === 'FEVER' ? 0.11 : 0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
      osc.connect(gain);
      gain.connect(this.synthBgmGain);
      osc.start(now);
      osc.stop(now + 0.12);
    }
  }

  public playUiClick(pitch = 660): void {
    if (!this.isSeEnabled()) return;
    this.unlock();
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(pitch, now);
    osc.frequency.exponentialRampToValueAtTime(pitch * 1.28, now + 0.04);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.055);
  }

  public playChargeTick(power: number): void {
    if (!this.isSeEnabled()) return;
    this.unlock();
    if (!this.ctx || !this.sfxGain) return;
    const nowMs = performance.now();
    if (nowMs - this.lastChargeTickTime < 50) return;
    this.lastChargeTickTime = nowMs;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    const freq = 300 + Math.max(0, Math.min(1, power)) * 460;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.028);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.032);
  }

  public playEvent(ev: GameEvent): void {
    if (!this.isSeEnabled()) return;
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
        this.sfxPocketEnter(ev.col ?? 2, ev.combo);
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
        this.sfxBingoLine(ev.combo ?? 1, ev.value);
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
        this.playTone(540, 740, 0.05, 'sine', 0.04);
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
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t0);
    osc.stop(t0 + duration + 0.01);
  }

  private sfxLaunch(): void {
    // Authentic pachinko solenoid strike + steel ball rail launch click
    this.playTone(145, 380, 0.08, 'triangle', 0.16);
    this.playTone(1480, 2150, 0.045, 'sine', 0.09, 0.01);
    this.sfxNoiseBurst(0.045, 2800, 'bandpass', 0.12);
  }

  private sfxPinHit(combo: number, label?: string, color?: string): void {
    const nowMs = performance.now();
    if (nowMs - this.lastPinHitTime < 22) return;
    this.lastPinHitTime = nowMs;

    const idx = Math.min(CHIME_SCALE_HZ.length - 1, Math.max(0, combo - 1));
    const feverShift = this.feverActive ? 1.1892 : 1.0;
    const baseHz = CHIME_SCALE_HZ[idx] * feverShift;

    // Realistic steel-ball-on-brass-nail metallic "chink" + pleasant harmonic climb
    const metallicFreq = 2600 + (combo % 5) * 260;
    this.playTone(metallicFreq, metallicFreq * 0.94, 0.032, 'sine', 0.065);
    this.playTone(baseHz, baseHz * 1.01, 0.1, 'sine', 0.095);
    this.playTone(baseHz * 2, baseHz * 2.01, 0.055, 'triangle', 0.045);

    if (label && label.includes('x1.4')) {
      // Pinwheel spinner flutter
      this.playTone(baseHz * 1.5, baseHz * 2.2, 0.12, 'sine', 0.09, 0.015);
    } else if (color === '#ffb800' || (label && label.includes('+75'))) {
      // Heavy mechanical bumper thump
      this.playTone(185, 68, 0.11, 'triangle', 0.19);
    }
  }

  private sfxBallSplit(): void {
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      this.playTone(freq, freq * 1.02, 0.18, 'triangle', 0.095, i * 0.025);
    });
  }

  private sfxBombIgnite(): void {
    this.playTone(240, 880, 0.19, 'sawtooth', 0.1);
    this.playTone(480, 1260, 0.15, 'sine', 0.085, 0.03);
  }

  private sfxBombBlast(): void {
    this.playTone(130, 36, 0.32, 'sine', 0.28);
    this.playTone(180, 50, 0.24, 'triangle', 0.16);
    this.sfxNoiseBurst(0.28, 900, 'lowpass', 0.22);
  }

  private sfxPocketEnter(col: number, combo?: number): void {
    const nowMs = performance.now();
    if (nowMs - this.lastPocketHitAt > 1800) {
      this.pocketChainStreak = 0;
    }
    this.lastPocketHitAt = nowMs;
    this.pocketChainStreak = Math.min(12, this.pocketChainStreak + 1);

    const effectiveChain = Math.max(this.pocketChainStreak, combo ?? 1);
    const pitchBoost = Math.min(1.78, Math.pow(1.062, Math.max(0, effectiveChain - 1)));
    const colFreq = ([392.0, 440.0, 493.88, 587.33, 659.25][col % 5] ?? 493.88) * pitchBoost;

    // Authentic pachinko prize-chute bell chime ("チュリン♪") with chain pitch escalation
    this.playTone(colFreq * 1.5, colFreq * 2.0, 0.11, 'triangle', 0.125);
    this.playTone(colFreq * 2.0, colFreq * 2.03, 0.14, 'sine', 0.095, 0.042);
    if (effectiveChain >= 3) {
      // Bright harmonic overtone sparkle as chain climbs
      this.playTone(colFreq * 3.0, colFreq * 3.04, 0.12, 'sine', 0.055, 0.055);
    }
  }

  /**
   * Iconic Japanese Pachinko "キュイン♪" high-harmonic confirmation chime.
   * Crafted with a fast glassy pitch glide + shimmering dual-detuned bell harmonics.
   */
  private sfxKyuin(pitchScale = 1.0, doubleRing = false): void {
    if (!this.ctx || !this.sfxGain) return;
    const nowMs = performance.now();
    if (!doubleRing && nowMs - this.lastKyuinAt < 180) return;
    this.lastKyuinAt = nowMs;

    const triggerPulse = (offsetSec: number, lift: number) => {
      const s = pitchScale * lift;
      // Fast upward glassy laser-bell glide ("キュイ-")
      this.playTone(920 * s, 2637 * s, 0.072, 'sine', 0.115, offsetSec);
      this.playTone(1380 * s, 3136 * s, 0.068, 'triangle', 0.065, offsetSec + 0.008);

      // Shimmering high-harmonic sustain ("-ン♪") with subtle stereo-like beat detune
      this.playTone(2637 * s, 2637 * s, 0.34, 'sine', 0.095, offsetSec + 0.062);
      this.playTone(2654 * s, 2648 * s, 0.32, 'sine', 0.075, offsetSec + 0.066);
      this.playTone(3951 * s, 3951 * s, 0.24, 'sine', 0.048, offsetSec + 0.078);
      this.playTone(5274 * s, 5200 * s, 0.15, 'sine', 0.028, offsetSec + 0.092);
    };

    triggerPulse(0, 1.0);
    if (doubleRing) {
      triggerPulse(0.24, 1.122);
    }
  }

  /**
   * Escalating "ジャラジャラ" metallic ball/coin payout shimmer cascade.
   */
  private sfxJaraPayout(intensity: number): void {
    if (!this.ctx || !this.sfxGain) return;
    const count = Math.min(18, Math.max(7, Math.round(6 + intensity * 4)));
    const clinkFreqs = [2349.3, 2637.0, 3136.0, 3520.0, 4186.0, 4698.6];

    for (let i = 0; i < count; i++) {
      const delay = 0.08 + i * 0.036 + (i % 3) * 0.008;
      const f = clinkFreqs[(i * 2 + (i % 3)) % clinkFreqs.length] * (0.96 + (i / count) * 0.12);
      const decayFactor = 1 - (i / count) * 0.45;
      this.playTone(f, f * 0.985, 0.055, 'sine', 0.058 * decayFactor, delay);
      if (i % 2 === 0) {
        this.playTone(f * 0.5, f * 0.505, 0.045, 'triangle', 0.042 * decayFactor, delay + 0.004);
      }
    }
    this.sfxNoiseBurst(0.22 + intensity * 0.08, 4200, 'bandpass', 0.055);
  }

  private sfxCellOpen(): void {
    const nowMs = performance.now();
    if (nowMs - this.lastCellOpenTime < 22) return;
    this.lastCellOpenTime = nowMs;

    this.playTone(587.33, 880, 0.14, 'triangle', 0.12);
    this.playTone(1174.66, 1174.66, 0.1, 'sine', 0.085, 0.035);
  }

  private sfxCellReignite(combo?: number, text?: string): void {
    const nowMs = performance.now();
    if (nowMs - this.lastCellReigniteTime < 22) return;
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
    this.playTone(root, root * 1.45, 0.15, 'triangle', 0.1);
    this.playTone(root * 2, root * 2.4, 0.13, 'sine', 0.09, 0.025);
  }

  private sfxOverdrive(awaken: boolean): void {
    if (!awaken) {
      const nowMs = performance.now();
      if (nowMs - this.lastOverdriveTriggerTime < 45) return;
      this.lastOverdriveTriggerTime = nowMs;
    }

    this.playTone(220, 660, 0.22, 'sawtooth', 0.12);
    this.playTone(440, 1320, 0.24, 'triangle', 0.095, 0.03);
    this.sfxNoiseBurst(0.14, 3200, 'bandpass', 0.1);
    if (awaken) {
      this.sfxKyuin(1.06, false);
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        this.playTone(f, f * 1.02, 0.22, 'triangle', 0.105, 0.08 + i * 0.045);
      });
    }
  }

  private sfxBingoLine(combo: number, value?: number): void {
    const shift = combo >= 3 ? 1.189 : combo === 2 ? 1.122 : 1.0;
    this.sfxKyuin(shift, false);

    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
    notes.forEach((n, i) => {
      this.playTone(n * shift, n * shift * 1.01, 0.26, 'triangle', 0.12, 0.05 + i * 0.052);
      this.playTone(n * shift * 0.5, n * shift * 0.5, 0.26, 'sine', 0.075, 0.05 + i * 0.052);
    });

    if (combo >= 2 || (value !== undefined && value >= 3000)) {
      this.sfxJaraPayout(Math.min(3, Math.max(1, combo)));
    }
  }

  private sfxFullBingoFever(): void {
    // Double Pachinko "キュイン♪キュイン♪" + Ooatari (大当たり) fanfare + Jara-Jara coin shower!
    this.sfxKyuin(1.04, true);
    const fanfare = [523.25, 659.25, 783.99, 1046.5, 987.77, 1046.5, 1318.51, 1567.98];
    fanfare.forEach((f, i) => {
      this.playTone(f, f * 1.01, 0.32, 'triangle', 0.13, 0.08 + i * 0.062);
      this.playTone(f * 0.5, f * 0.5, 0.34, 'sine', 0.095, 0.08 + i * 0.062);
    });
    this.sfxJaraPayout(3.2);
  }

  private sfxShopBuy(): void {
    // Crisp pachinko ball tray payout clink
    this.playTone(1046.5, 1046.5, 0.09, 'sine', 0.12, 0);
    this.playTone(1567.98, 1567.98, 0.15, 'triangle', 0.13, 0.065);
  }

  private sfxStageClear(): void {
    const chord = [440, 554.37, 659.25, 880, 1108.73];
    chord.forEach((f, i) => {
      this.playTone(f, f, 0.36, 'triangle', 0.12, i * 0.075);
    });
  }

  private sfxGameOver(): void {
    [392.0, 349.23, 311.13, 261.63].forEach((f, i) => {
      this.playTone(f, f * 0.96, 0.32, 'triangle', 0.12, i * 0.13);
    });
  }

  private sfxRelicProc(): void {
    const nowMs = performance.now();
    if (nowMs - this.lastRelicProcTime < 28) return;
    this.lastRelicProcTime = nowMs;

    this.playTone(880, 1318.5, 0.09, 'sine', 0.08);
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
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);

    src.start(now);
    src.stop(now + duration + 0.02);
  }
}
