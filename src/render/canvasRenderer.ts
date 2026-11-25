import {
  ALL_BINGO_LINES,
  BALL_CATALOG,
  PIN_CATALOG,
  formatScore,
} from '../data/catalog';
import {
  BallEntity,
  BingoCell,
  GameEvent,
  GameStateSnapshot,
  IGameEngine,
  PinEntity,
  PocketState,
  TrailPoint,
  WORLD,
} from '../types';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

interface ShockwaveRing {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  life: number;
  maxLife: number;
  color: string;
  lineWidth: number;
}

interface LaserBeam {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
  maxLife: number;
  color: string;
  width: number;
  jagged: boolean;
}

interface LineFlash {
  cells: Array<[number, number]>;
  life: number;
  maxLife: number;
  color: string;
}

interface FloatingPopup {
  x: number;
  y: number;
  vy: number;
  text: string;
  subtext: string;
  color: string;
  scale: number;
  life: number;
  maxLife: number;
}

export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;

  private bgImage: HTMLImageElement | null = null;
  private bgLoaded = false;
  private feverVideo: HTMLVideoElement | null = null;
  private feverVideoReady = false;

  // Offscreen static backdrop cache (playfield_bg + dome + chute + dividers + matrix shell)
  private bgCacheCanvas: HTMLCanvasElement | null = null;
  private bgCacheDirty = true;
  private bgCacheDpr = 0;

  // Offscreen dirty-checked 5x5 Bingo Grid cache
  private bingoCacheCanvas: HTMLCanvasElement | null = null;
  private bingoCacheDpr = 0;
  private lastBingoSignature = '';

  // Trajectory preview memoization
  private cachedPreviewPowerKey = -1;
  private cachedPreviewPts: TrailPoint[] = [];

  private particles: Particle[] = [];
  private rings: ShockwaveRing[] = [];
  private beams: LaserBeam[] = [];
  private lineFlashes: LineFlash[] = [];
  private popups: FloatingPopup[] = [];

  private shakeIntensity = 0;
  private flashAlpha = 0;
  private flashColor = '#00f0ff';

  private hoveredPinId: number | null = null;
  private boardTuneHighlight = false;
  private showAimGuide = true;
  private ballGradientCache = new Map<string, CanvasGradient>();
  private labelWidthCache = new Map<string, number>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      throw new Error('Failed to obtain 2D canvas context');
    }
    this.ctx = context;
    this.configureResolution();
    this.loadMediaAssets();
  }

  private loadMediaAssets(): void {
    if (typeof Image !== 'undefined') {
      const img = new Image();
      img.onload = () => {
        this.bgLoaded = true;
        this.bgCacheDirty = true;
      };
      img.onerror = () => {
        this.bgLoaded = false;
        this.bgCacheDirty = true;
      };
      img.src = './assets/images/playfield_bg.webp';
      this.bgImage = img;
    }

    if (typeof document !== 'undefined') {
      const video = document.createElement('video');
      video.src = './assets/video/fever_jackpot.mp4';
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.addEventListener('canplay', () => {
        this.feverVideoReady = true;
      });
      video.addEventListener('error', () => {
        this.feverVideoReady = false;
      });
      this.feverVideo = video;
    }
  }

  public configureResolution(): void {
    const rawDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.dpr = Math.min(2, Math.max(1, rawDpr));
    const targetW = Math.round(WORLD.WIDTH * this.dpr);
    const targetH = Math.round(WORLD.HEIGHT * this.dpr);
    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
      this.bgCacheDirty = true;
      this.lastBingoSignature = '';
    }
  }

  public setBoardTuneHighlight(active: boolean): void {
    this.boardTuneHighlight = active;
  }

  public setShowAimGuide(show: boolean): void {
    this.showAimGuide = show;
  }

  public setHoveredPinId(pinId: number | null): void {
    this.hoveredPinId = pinId;
  }

  public canvasToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return { x: -100, y: -100 };
    }
    const x = ((clientX - rect.left) / rect.width) * WORLD.WIDTH;
    const y = ((clientY - rect.top) / rect.height) * WORLD.HEIGHT;
    return { x, y };
  }

  public findCustomizablePinAt(
    pins: PinEntity[],
    worldX: number,
    worldY: number,
    maxDist = 24
  ): PinEntity | null {
    let best: PinEntity | null = null;
    let bestDistSq = maxDist * maxDist;
    for (const pin of pins) {
      if (!pin.customizable) continue;
      const dx = pin.x - worldX;
      const dy = pin.y - worldY;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestDistSq) {
        bestDistSq = d2;
        best = pin;
      }
    }
    return best;
  }

  public clearVfx(): void {
    this.particles.length = 0;
    this.rings.length = 0;
    this.beams.length = 0;
    this.lineFlashes.length = 0;
    this.popups.length = 0;
    this.shakeIntensity = 0;
    this.flashAlpha = 0;
    if (this.feverVideo && !this.feverVideo.paused) {
      this.feverVideo.pause();
    }
  }

  public ingestEvents(events: GameEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'LAUNCH': {
          this.spawnParticles(ev.x, ev.y, 12, '#00f0ff', 220, 0.32, 2.8);
          this.spawnRing(ev.x, ev.y, 26, '#00f0ff', 0.24, 2);
          break;
        }
        case 'PIN_HIT': {
          const c = ev.color ?? '#00f0ff';
          this.spawnParticles(ev.x, ev.y, 7, c, 150, 0.28, 2.3);
          this.spawnRing(ev.x, ev.y, 22, c, 0.22, 2);
          if (ev.text) {
            this.spawnPopup(ev.x, ev.y - 10, ev.text, '', c, 0.78, 0.55);
          }
          break;
        }
        case 'BALL_SPLIT': {
          const c = ev.color ?? '#00ff88';
          this.spawnParticles(ev.x, ev.y, 20, c, 240, 0.45, 3.2);
          this.spawnRing(ev.x, ev.y, 44, c, 0.34, 3);
          if (ev.text) {
            this.spawnPopup(ev.x, ev.y - 14, ev.text, '', c, 1.0, 0.75);
          }
          break;
        }
        case 'BOMB_IGNITE': {
          this.spawnParticles(ev.x, ev.y, 16, '#ff6b00', 200, 0.4, 3);
          this.spawnRing(ev.x, ev.y, 38, '#ff2a5f', 0.3, 2.5);
          this.spawnPopup(ev.x, ev.y - 14, ev.text ?? 'BOMB!', '', '#ff6b00', 0.95, 0.7);
          break;
        }
        case 'BOMB_BLAST': {
          this.spawnParticles(ev.x, ev.y, 36, '#ff5500', 340, 0.62, 4.2);
          this.spawnParticles(ev.x, ev.y, 18, '#ffd000', 260, 0.5, 3.2);
          this.spawnRing(ev.x, ev.y, 110, '#ff2a5f', 0.45, 4.5);
          this.spawnRing(ev.x, ev.y, 75, '#ffb800', 0.36, 3);
          this.addShake(6.5);
          this.triggerFlash('#ff5500', 0.2);
          if (ev.text) {
            this.spawnPopup(ev.x, ev.y - 16, ev.text, ev.subtext ?? '', '#ff8a00', 1.25, 0.95);
          }
          break;
        }
        case 'POCKET_ENTER': {
          const c = ev.color ?? '#00f0ff';
          this.spawnParticles(ev.x, ev.y, 14, c, 200, 0.4, 3);
          this.spawnRing(ev.x, ev.y, 38, c, 0.3, 2.5);
          if (ev.targetX !== undefined && ev.targetY !== undefined) {
            this.pushBeam({
              x1: ev.x,
              y1: ev.y,
              x2: ev.targetX,
              y2: ev.targetY,
              life: 0.38,
              maxLife: 0.38,
              color: c,
              width: 5,
              jagged: false,
            });
          }
          if (ev.value && ev.value > 0) {
            const scale = ev.value >= 10000 ? 1.35 : ev.value >= 1500 ? 1.15 : 0.98;
            this.spawnPopup(
              ev.x,
              ev.y - 14,
              `+${formatScore(ev.value)}`,
              ev.subtext ?? '',
              c,
              scale,
              0.9
            );
          }
          break;
        }
        case 'CELL_OPEN': {
          const c = ev.color ?? '#00f0ff';
          this.spawnParticles(ev.x, ev.y, 18, c, 190, 0.45, 3.1);
          this.spawnRing(ev.x, ev.y, 46, c, 0.36, 3);
          if (ev.targetX !== undefined && ev.targetY !== undefined) {
            this.pushBeam({
              x1: ev.targetX,
              y1: ev.targetY,
              x2: ev.x,
              y2: ev.y,
              life: 0.34,
              maxLife: 0.34,
              color: c,
              width: 3.5,
              jagged: false,
            });
          }
          if (ev.text) {
            this.spawnPopup(ev.x, ev.y - 12, ev.text, '', c, 0.95, 0.72);
          }
          break;
        }
        case 'CELL_REIGNITE': {
          const c = ev.color ?? '#ffb800';
          this.spawnParticles(ev.x, ev.y, 14, c, 210, 0.4, 2.8);
          this.spawnRing(ev.x, ev.y, 40, c, 0.32, 2.6);
          if (ev.text) {
            this.spawnPopup(ev.x, ev.y - 10, ev.text, '', c, 0.92, 0.7);
          }
          break;
        }
        case 'OVERDRIVE_AWAKEN': {
          this.spawnParticles(ev.x, ev.y, 26, '#00ff88', 250, 0.55, 3.4);
          this.spawnRing(ev.x, ev.y, 64, '#00ff88', 0.45, 3.5);
          this.addShake(4.0);
          this.spawnPopup(
            ev.x,
            ev.y - 22,
            ev.text ?? 'OVERDRIVE AWAKENED!',
            ev.subtext ?? '',
            '#00ff88',
            1.15,
            1.1
          );
          break;
        }
        case 'OVERDRIVE_TRIGGER': {
          if (ev.targetX !== undefined && ev.targetY !== undefined) {
            this.pushBeam({
              x1: ev.x,
              y1: ev.y,
              x2: ev.targetX,
              y2: ev.targetY,
              life: 0.42,
              maxLife: 0.42,
              color: '#00ff88',
              width: 4.5,
              jagged: true,
            });
          }
          if (ev.text) {
            this.spawnParticles(ev.x, ev.y, 20, '#00ff88', 270, 0.46, 3.3);
            this.addShake(3.5);
            this.spawnPopup(
              ev.x,
              ev.y - 18,
              ev.text,
              ev.subtext ?? '',
              '#00ff88',
              1.12,
              0.95
            );
          }
          break;
        }
        case 'BINGO_LINE': {
          const c = ev.color ?? '#ffb800';
          this.spawnParticles(ev.x, ev.y, 34, c, 320, 0.65, 3.8);
          this.spawnRing(ev.x, ev.y, 92, c, 0.48, 4);
          if (ev.lineCells && ev.lineCells.length >= 2) {
            if (this.lineFlashes.length >= 16) {
              this.lineFlashes.shift();
            }
            this.lineFlashes.push({
              cells: ev.lineCells,
              life: 0.95,
              maxLife: 0.95,
              color: c,
            });
          }
          this.addShake(5.5);
          this.triggerFlash(c, 0.16);
          const bingoSub =
            ev.subtext ?? (ev.value !== undefined ? `+${formatScore(ev.value)}` : '');
          this.spawnPopup(
            ev.x,
            ev.y - 18,
            ev.text ?? 'BINGO!!',
            bingoSub,
            c,
            1.38,
            1.2
          );
          break;
        }
        case 'FULL_BINGO_FEVER': {
          this.spawnParticles(WORLD.BOARD_LEFT + WORLD.BOARD_WIDTH / 2, 720, 65, '#ffd000', 420, 0.95, 4.5);
          this.spawnParticles(WORLD.BOARD_LEFT + WORLD.BOARD_WIDTH / 2, 720, 40, '#00ff88', 360, 0.85, 3.6);
          this.spawnRing(WORLD.BOARD_LEFT + WORLD.BOARD_WIDTH / 2, 720, 190, '#ffd000', 0.65, 5);
          this.addShake(7.0);
          this.triggerFlash('#ffd000', 0.28);
          const feverSub =
            ev.value !== undefined
              ? `${ev.subtext ? `${ev.subtext} ` : ''}+${formatScore(ev.value)}`
              : (ev.subtext ?? '');
          this.spawnPopup(
            WORLD.BOARD_LEFT + WORLD.BOARD_WIDTH / 2,
            640,
            ev.text ?? 'FULL BINGO FEVER!!',
            feverSub,
            '#ffd000',
            1.55,
            1.5
          );
          break;
        }
        case 'RELIC_PROC': {
          if (ev.targetX !== undefined && ev.targetY !== undefined) {
            this.pushBeam({
              x1: ev.x,
              y1: ev.y,
              x2: ev.targetX,
              y2: ev.targetY,
              life: 0.36,
              maxLife: 0.36,
              color: ev.color ?? '#00f0ff',
              width: 3,
              jagged: true,
            });
          }
          if (ev.text) {
            this.spawnPopup(ev.x, ev.y - 12, ev.text, '', ev.color ?? '#ffb800', 0.9, 0.72);
          }
          break;
        }
        case 'ANTI_STUCK_NUDGE': {
          this.spawnRing(ev.x, ev.y, 24, '#38bdf8', 0.24, 2);
          break;
        }
        default:
          break;
      }
    }
  }

  private pushBeam(beam: LaserBeam): void {
    if (this.beams.length >= 48) {
      this.beams.shift();
    }
    this.beams.push(beam);
  }

  private spawnParticles(
    x: number,
    y: number,
    count: number,
    color: string,
    maxSpeed: number,
    life: number,
    size: number
  ): void {
    if (this.particles.length > 360) {
      this.particles.splice(0, count);
    }
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = (0.25 + Math.random() * 0.75) * maxSpeed;
      this.particles.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life,
        maxLife: life,
        size: size * (0.65 + Math.random() * 0.7),
        color,
      });
    }
  }

  private spawnRing(
    x: number,
    y: number,
    maxRadius: number,
    color: string,
    life: number,
    lineWidth: number
  ): void {
    if (this.rings.length >= 64) {
      this.rings.shift();
    }
    this.rings.push({
      x,
      y,
      radius: 4,
      maxRadius,
      life,
      maxLife: life,
      color,
      lineWidth,
    });
  }

  private spawnPopup(
    x: number,
    y: number,
    text: string,
    subtext: string,
    color: string,
    scale: number,
    life: number
  ): void {
    if (this.popups.length > 26) {
      this.popups.shift();
    }
    const clampedX = Math.max(85, Math.min(WORLD.WIDTH - 70, x));
    let adjustedY = Math.max(36, y);

    // Prevent vertical label overlap between simultaneous popups (e.g., x3 SPLIT! clusters)
    for (let pass = 0; pass < 4; pass++) {
      const collides = this.popups.some(
        (p) => Math.abs(p.x - clampedX) < 55 && Math.abs(p.y - adjustedY) < 24
      );
      if (!collides) break;
      adjustedY = Math.max(32, adjustedY - 22);
    }

    this.popups.push({
      x: clampedX,
      y: adjustedY,
      vy: -36,
      text,
      subtext,
      color,
      scale,
      life,
      maxLife: life,
    });
  }

  private addShake(amount: number): void {
    this.shakeIntensity = Math.min(7, Math.max(this.shakeIntensity, amount));
  }

  private triggerFlash(color: string, alpha: number): void {
    this.flashColor = color;
    this.flashAlpha = Math.max(this.flashAlpha, alpha);
  }

  public updateVfx(dt: number): void {
    const safeDt = Math.min(0.05, Math.max(0, dt));
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= safeDt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * safeDt;
      p.y += p.vy * safeDt;
      p.vy += 280 * safeDt;
      p.vx *= 0.96;
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= safeDt;
      if (r.life <= 0) {
        this.rings.splice(i, 1);
        continue;
      }
      const progress = 1 - r.life / r.maxLife;
      r.radius = 4 + (r.maxRadius - 4) * (1 - Math.pow(1 - progress, 2));
    }

    for (let i = this.beams.length - 1; i >= 0; i--) {
      this.beams[i].life -= safeDt;
      if (this.beams[i].life <= 0) {
        this.beams.splice(i, 1);
      }
    }

    for (let i = this.lineFlashes.length - 1; i >= 0; i--) {
      this.lineFlashes[i].life -= safeDt;
      if (this.lineFlashes[i].life <= 0) {
        this.lineFlashes.splice(i, 1);
      }
    }

    for (let i = this.popups.length - 1; i >= 0; i--) {
      const pop = this.popups[i];
      pop.life -= safeDt;
      if (pop.life <= 0) {
        this.popups.splice(i, 1);
        continue;
      }
      pop.y += pop.vy * safeDt;
      pop.vy *= 0.94;
    }

    this.shakeIntensity = Math.max(0, this.shakeIntensity - safeDt * 24);
    this.flashAlpha = Math.max(0, this.flashAlpha - safeDt * 0.9);
  }

  private syncFeverVideo(feverActive: boolean): void {
    if (!this.feverVideo) return;
    if (feverActive) {
      if (this.feverVideo.paused) {
        void this.feverVideo.play().catch(() => {});
      }
    } else if (!this.feverVideo.paused) {
      this.feverVideo.pause();
    }
  }

  private ensureBgCache(): void {
    if (typeof document === 'undefined') return;
    if (!this.bgCacheCanvas) {
      this.bgCacheCanvas = document.createElement('canvas');
      this.bgCacheDirty = true;
    }
    if (!this.bgCacheDirty && this.bgCacheDpr === this.dpr) return;

    const w = Math.round(WORLD.WIDTH * this.dpr);
    const h = Math.round(WORLD.HEIGHT * this.dpr);
    this.bgCacheCanvas.width = w;
    this.bgCacheCanvas.height = h;
    this.bgCacheDpr = this.dpr;
    this.bgCacheDirty = false;

    const bctx = this.bgCacheCanvas.getContext('2d', { alpha: false });
    if (!bctx) return;

    bctx.save();
    bctx.scale(this.dpr, this.dpr);

    // 1. Rich dark lacquered mahogany-obsidian cabinet outer casing
    const outerGrad = bctx.createLinearGradient(0, 0, WORLD.WIDTH, WORLD.HEIGHT);
    outerGrad.addColorStop(0, '#181016');
    outerGrad.addColorStop(0.5, '#110d14');
    outerGrad.addColorStop(1, '#0b0a10');
    bctx.fillStyle = outerGrad;
    bctx.fillRect(0, 0, WORLD.WIDTH, WORLD.HEIGHT);

    // 2. Clip playfield board tightly inside the pachinko dome arch + board frame
    bctx.save();
    bctx.beginPath();
    bctx.moveTo(WORLD.RAIL_X_MIN, WORLD.BINGO_BOTTOM + 12);
    bctx.lineTo(WORLD.RAIL_X_MIN, 116);
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const theta = Math.PI + t * (Math.PI - 0.12);
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const rx = 239.5 - 9.5 * cosT + 13;
      const ry = 88 + 13;
      bctx.lineTo(WORLD.DOME_CENTER_X + rx * cosT, WORLD.DOME_CENTER_Y + ry * sinT);
    }
    bctx.lineTo(WORLD.BOARD_RIGHT, 116);
    bctx.lineTo(WORLD.BOARD_RIGHT, WORLD.BINGO_BOTTOM + 12);
    bctx.closePath();
    bctx.clip();

    if (this.bgLoaded && this.bgImage) {
      bctx.save();
      bctx.globalAlpha = 0.88;
      bctx.drawImage(this.bgImage, 0, 0, WORLD.WIDTH, WORLD.HEIGHT);
      bctx.restore();
    } else {
      // Fallback: rich lacquered deep crimson-navy Japanese pachinko board (セル盤面)
      const grad = bctx.createRadialGradient(288, 250, 20, 288, 280, 340);
      grad.addColorStop(0, '#2c1424');
      grad.addColorStop(0.55, '#1a1122');
      grad.addColorStop(1, '#0f0c16');
      bctx.fillStyle = grad;
      bctx.fillRect(0, 0, WORLD.WIDTH, WORLD.HEIGHT);
    }

    // Warm parlor lighting vignette + depth shading so brass nails & chrome balls pop cleanly
    const veil = bctx.createLinearGradient(0, 0, 0, WORLD.HEIGHT);
    veil.addColorStop(0, 'rgba(12, 8, 14, 0.56)');
    veil.addColorStop(0.16, 'rgba(14, 9, 16, 0.24)');
    veil.addColorStop(0.52, 'rgba(12, 9, 15, 0.34)');
    veil.addColorStop(0.62, 'rgba(10, 10, 16, 0.82)');
    veil.addColorStop(1, 'rgba(8, 9, 14, 0.94)');
    bctx.fillStyle = veil;
    bctx.fillRect(0, 0, WORLD.WIDTH, WORLD.HEIGHT);

    // Subtle real pachinko cabinet front-glass diagonal reflection sheen
    bctx.save();
    const glassSheen = bctx.createLinearGradient(60, 40, 440, 360);
    glassSheen.addColorStop(0, 'rgba(255, 250, 240, 0.0)');
    glassSheen.addColorStop(0.38, 'rgba(255, 248, 235, 0.045)');
    glassSheen.addColorStop(0.46, 'rgba(255, 255, 255, 0.09)');
    glassSheen.addColorStop(0.52, 'rgba(255, 248, 235, 0.02)');
    glassSheen.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
    bctx.fillStyle = glassSheen;
    bctx.fillRect(WORLD.BOARD_LEFT, 24, WORLD.BOARD_WIDTH, 468);
    bctx.restore();

    // Subtle decorative brass parlor pinstripe arch inside the upper board
    bctx.strokeStyle = 'rgba(245, 185, 66, 0.14)';
    bctx.lineWidth = 1.5;
    bctx.beginPath();
    bctx.arc(WORLD.BOARD_LEFT + WORLD.BOARD_WIDTH / 2, 290, 195, Math.PI * 1.12, Math.PI * 1.88);
    bctx.stroke();

    bctx.restore();

    // 3. Realistic Brushed Steel Launch Chute (発射レール溝)
    const chuteGrad = bctx.createLinearGradient(WORLD.RAIL_X_MIN, 0, WORLD.RAIL_X_MAX, 0);
    chuteGrad.addColorStop(0, '#181a22');
    chuteGrad.addColorStop(0.5, '#0b0d14');
    chuteGrad.addColorStop(1, '#1e222e');
    bctx.fillStyle = chuteGrad;
    bctx.fillRect(WORLD.RAIL_X_MIN, 116, WORLD.RAIL_X_MAX - WORLD.RAIL_X_MIN, 412);

    // Thick Brushed Chrome Outer Rail + Dome Arch (外レール)
    const drawOuterArchPath = (offset: number) => {
      bctx.beginPath();
      bctx.moveTo(WORLD.RAIL_X_MIN + offset, 528);
      bctx.lineTo(WORLD.RAIL_X_MIN + offset, 116);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const theta = Math.PI + t * (Math.PI - 0.12);
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);
        const rx = 239.5 - 9.5 * cosT + 13 - offset;
        const ry = 88 + 13 - offset;
        bctx.lineTo(WORLD.DOME_CENTER_X + rx * cosT, WORLD.DOME_CENTER_Y + ry * sinT);
      }
      bctx.lineTo(WORLD.BOARD_RIGHT + 2 - offset * 0.5, 116);
      bctx.lineTo(WORLD.BOARD_RIGHT + 2 - offset * 0.5, WORLD.POCKET_BOTTOM + 4);
    };

    // Dark recessed rail housing shadow
    bctx.strokeStyle = '#090a0f';
    bctx.lineWidth = 8.5;
    drawOuterArchPath(2);
    bctx.stroke();

    // Brushed steel body
    bctx.strokeStyle = '#788496';
    bctx.lineWidth = 5.5;
    drawOuterArchPath(2);
    bctx.stroke();

    // Gleaming chrome inner highlight + warm brass outer trim
    bctx.strokeStyle = '#e8edf5';
    bctx.lineWidth = 2;
    drawOuterArchPath(3);
    bctx.stroke();

    bctx.strokeStyle = 'rgba(245, 185, 66, 0.65)';
    bctx.lineWidth = 1.2;
    drawOuterArchPath(0.5);
    bctx.stroke();

    // Inner Stainless Steel Rail separating chute and playfield (内レール)
    bctx.strokeStyle = '#384152';
    bctx.lineWidth = 5;
    bctx.beginPath();
    bctx.moveTo(WORLD.RAIL_X_MAX, 528);
    bctx.lineTo(WORLD.RAIL_X_MAX, 116);
    bctx.stroke();

    bctx.strokeStyle = '#d8e1ec';
    bctx.lineWidth = 2;
    bctx.beginPath();
    bctx.moveTo(WORLD.RAIL_X_MAX - 0.5, 528);
    bctx.lineTo(WORLD.RAIL_X_MAX - 0.5, 116);
    bctx.stroke();

    // Subtle inner dome chrome rim guide
    bctx.strokeStyle = 'rgba(226, 232, 240, 0.16)';
    bctx.lineWidth = 1.5;
    bctx.beginPath();
    bctx.moveTo(WORLD.RAIL_X_MAX - 2, 116);
    for (let i = 1; i <= steps - 2; i++) {
      const t = i / steps;
      const theta = Math.PI + t * (Math.PI - 0.12);
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const rx = 239.5 - 9.5 * cosT - 13;
      const ry = 88 - 13;
      bctx.lineTo(WORLD.DOME_CENTER_X + rx * cosT, WORLD.DOME_CENTER_Y + ry * sinT);
    }
    bctx.stroke();

    // Authentic Brass & Rubber One-Way Return Flap (返し弁) at x=50, y=102
    bctx.strokeStyle = '#1f1608';
    bctx.lineWidth = 5;
    bctx.lineCap = 'round';
    bctx.beginPath();
    bctx.moveTo(WORLD.BOARD_LEFT, 102);
    bctx.lineTo(WORLD.BOARD_LEFT + 14, 122);
    bctx.stroke();

    bctx.strokeStyle = '#f5b942';
    bctx.lineWidth = 2.6;
    bctx.beginPath();
    bctx.moveTo(WORLD.BOARD_LEFT, 102);
    bctx.lineTo(WORLD.BOARD_LEFT + 14, 122);
    bctx.stroke();

    bctx.fillStyle = '#fde68a';
    bctx.strokeStyle = '#78350f';
    bctx.lineWidth = 1.2;
    bctx.beginPath();
    bctx.arc(WORLD.BOARD_LEFT, 102, 3.8, 0, Math.PI * 2);
    bctx.fill();
    bctx.stroke();

    // 4. Bake Static Idle Mechanical Pockets (入賞口 B・I・N・G・O)
    const top = WORLD.POCKET_TOP;
    const bottom = WORLD.POCKET_BOTTOM;
    const pocketH = bottom - top;
    const pocketLabels = ['B', 'I', 'N', 'G', 'O'] as const;

    // Continuous metallic pocket rail bar behind all 5 chutes
    const pocketBarGrad = bctx.createLinearGradient(0, top, 0, bottom + 6);
    pocketBarGrad.addColorStop(0, '#333b4d');
    pocketBarGrad.addColorStop(0.5, '#191d28');
    pocketBarGrad.addColorStop(1, '#0c0f16');
    bctx.fillStyle = pocketBarGrad;
    bctx.fillRect(WORLD.BOARD_LEFT - 2, top + 1, WORLD.BOARD_WIDTH + 4, pocketH + 4);

    for (let c = 0; c < 5; c++) {
      const xLeft = WORLD.BOARD_LEFT + c * WORLD.COL_WIDTH;
      const xCenter = xLeft + WORLD.COL_WIDTH / 2;
      const px = xLeft + 4;
      const pw = WORLD.COL_WIDTH - 8;

      // Recessed backlit acrylic pocket lens
      const lensGrad = bctx.createLinearGradient(px, top + 5, px, bottom - 2);
      lensGrad.addColorStop(0, '#2a1d28');
      lensGrad.addColorStop(0.32, '#1a1523');
      lensGrad.addColorStop(1, '#0d0c14');
      bctx.fillStyle = lensGrad;
      this.roundedRectPath(bctx, px, top + 5, pw, pocketH - 8, 5);
      bctx.fill();

      // Glossy top glass edge inside pocket
      bctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      bctx.fillRect(px + 3, top + 6, pw - 6, 8);

      // Brass-gold recessed pocket border
      bctx.strokeStyle = 'rgba(245, 185, 66, 0.55)';
      bctx.lineWidth = 1.4;
      this.roundedRectPath(bctx, px, top + 5, pw, pocketH - 8, 5);
      bctx.stroke();

      // Illuminated pocket letter (B I N G O)
      bctx.fillStyle = '#fff3d1';
      bctx.font = '900 20px Orbitron, "Chakra Petch", sans-serif';
      bctx.textAlign = 'center';
      bctx.textBaseline = 'middle';
      bctx.fillText(pocketLabels[c], xCenter, top + 27);

      bctx.fillStyle = 'rgba(245, 185, 66, 0.72)';
      bctx.font = '700 8.5px "Chakra Petch", sans-serif';
      bctx.fillText(`入賞口 ${c + 1}`, xCenter, top + 47);
    }

    // Metallic Chrome & Brass Chute Divider Fins (入賞口仕切り羽根)
    for (let i = 0; i <= 5; i++) {
      const fx = WORLD.BOARD_LEFT + i * WORLD.COL_WIDTH;
      const finGrad = bctx.createLinearGradient(fx - 5, top, fx + 5, top);
      finGrad.addColorStop(0, '#64748b');
      finGrad.addColorStop(0.45, '#f8fafc');
      finGrad.addColorStop(1, '#334155');
      bctx.fillStyle = finGrad;
      bctx.strokeStyle = '#92400e';
      bctx.lineWidth = 1.4;
      bctx.beginPath();
      bctx.moveTo(fx - 5, bottom + 2);
      bctx.lineTo(fx - 3, top + 6);
      bctx.lineTo(fx, top - 7);
      bctx.lineTo(fx + 3, top + 6);
      bctx.lineTo(fx + 5, bottom + 2);
      bctx.closePath();
      bctx.fill();
      bctx.stroke();

      // Brass rivet head on each divider fin
      bctx.fillStyle = '#f5b942';
      bctx.beginPath();
      bctx.arc(fx, top + 12, 2.2, 0, Math.PI * 2);
      bctx.fill();
    }

    // 5. Recessed Illuminated Acrylic Bingo Unit Frame (電飾ビンゴユニット枠)
    const gridTop = WORLD.BINGO_TOP;
    const gridH = WORLD.BINGO_BOTTOM - WORLD.BINGO_TOP;
    const frameGrad = bctx.createLinearGradient(0, gridTop - 8, 0, WORLD.BINGO_BOTTOM + 8);
    frameGrad.addColorStop(0, '#303644');
    frameGrad.addColorStop(0.5, '#191d27');
    frameGrad.addColorStop(1, '#272c38');
    bctx.fillStyle = frameGrad;
    this.roundedRectPath(bctx, WORLD.BOARD_LEFT - 6, gridTop - 7, WORLD.BOARD_WIDTH + 12, gridH + 14, 10);
    bctx.fill();

    // Inner jet-black LED display cavity
    bctx.fillStyle = '#090b12';
    this.roundedRectPath(bctx, WORLD.BOARD_LEFT - 2, gridTop - 3, WORLD.BOARD_WIDTH + 4, gridH + 6, 7);
    bctx.fill();

    // Brushed gold cabinet trim border
    bctx.strokeStyle = 'rgba(245, 185, 66, 0.72)';
    bctx.lineWidth = 1.8;
    this.roundedRectPath(bctx, WORLD.BOARD_LEFT - 6, gridTop - 7, WORLD.BOARD_WIDTH + 12, gridH + 14, 10);
    bctx.stroke();

    // 4 Corner brass mounting rivets on the Bingo unit
    const rivetPts = [
      [WORLD.BOARD_LEFT - 2, gridTop - 3],
      [WORLD.BOARD_RIGHT + 2, gridTop - 3],
      [WORLD.BOARD_LEFT - 2, WORLD.BINGO_BOTTOM + 3],
      [WORLD.BOARD_RIGHT + 2, WORLD.BINGO_BOTTOM + 3],
    ];
    for (const [rx, ry] of rivetPts) {
      bctx.fillStyle = '#f5b942';
      bctx.beginPath();
      bctx.arc(rx, ry, 2.5, 0, Math.PI * 2);
      bctx.fill();
    }

    bctx.restore();
  }

  public render(state: GameStateSnapshot, engine: IGameEngine): void {
    this.configureResolution();
    this.syncFeverVideo(state.feverActive);
    this.ensureBgCache();

    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    if (this.shakeIntensity > 0.2) {
      const sx = (Math.random() * 2 - 1) * this.shakeIntensity;
      const sy = (Math.random() * 2 - 1) * this.shakeIntensity;
      ctx.translate(sx, sy);
    }

    // 1-blit static background, rails, dome, dividers & matrix shell
    if (this.bgCacheCanvas) {
      ctx.drawImage(this.bgCacheCanvas, 0, 0, WORLD.WIDTH, WORLD.HEIGHT);
    }

    this.drawDynamicBackdrop(ctx, state);
    this.drawDynamicRailControls(ctx, state);
    this.drawTrajectoryPreview(ctx, state, engine);
    this.drawPockets(ctx, state);
    this.drawBingoGrid(ctx, state);
    this.drawPins(ctx, state);
    this.drawBalls(ctx, state.balls);
    this.drawVfxLayer(ctx);

    if (this.flashAlpha > 0.01) {
      ctx.fillStyle = this.flashColor;
      ctx.globalAlpha = this.flashAlpha;
      ctx.fillRect(0, 0, WORLD.WIDTH, WORLD.HEIGHT);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  private drawDynamicBackdrop(ctx: CanvasRenderingContext2D, state: GameStateSnapshot): void {
    // Fever jackpot additive video overlay
    if (state.feverActive && this.feverVideo && this.feverVideoReady && this.feverVideo.readyState >= 2) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.28;
      ctx.drawImage(this.feverVideo, 0, 0, WORLD.WIDTH, WORLD.HEIGHT);
      ctx.restore();
    }

    if (state.feverActive) {
      const pulse = 0.12 + 0.08 * Math.sin(state.simTime * 10);
      ctx.strokeStyle = `rgba(255, 208, 0, ${0.45 + pulse})`;
      ctx.lineWidth = 4;
      ctx.strokeRect(4, 4, WORLD.WIDTH - 8, WORLD.HEIGHT - 8);
    }

    // Column vertical lane highlights aligned 1:1 with Pockets and Bingo Grid
    for (let c = 0; c < 5; c++) {
      const colX = WORLD.BOARD_LEFT + c * WORLD.COL_WIDTH;
      const pocket = state.pockets[c];
      if (pocket?.overdrive) {
        ctx.fillStyle = 'rgba(0, 255, 136, 0.08)';
        ctx.fillRect(colX, WORLD.PIN_AREA_TOP, WORLD.COL_WIDTH, WORLD.POCKET_BOTTOM - WORLD.PIN_AREA_TOP);
      } else if (pocket?.isReachTarget) {
        ctx.fillStyle = 'rgba(255, 184, 0, 0.065)';
        ctx.fillRect(colX, WORLD.PIN_AREA_TOP, WORLD.COL_WIDTH, WORLD.POCKET_BOTTOM - WORLD.PIN_AREA_TOP);
      }
    }
  }

  private drawDynamicRailControls(ctx: CanvasRenderingContext2D, state: GameStateSnapshot): void {
    // Warm golden LED guide pips inside the brushed steel chute
    const scroll = (state.simTime * 90) % 30;
    ctx.strokeStyle = state.strokeLocked ? 'rgba(52, 211, 153, 0.55)' : 'rgba(245, 185, 66, 0.36)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let y = 496 - scroll; y >= 128; y -= 30) {
      ctx.moveTo(23, y + 5);
      ctx.lineTo(WORLD.RAIL_X_CENTER, y);
      ctx.lineTo(39, y + 5);
    }
    ctx.stroke();

    // Mechanical steel coil spring + brass striker hammer compressing to launchPower
    const basePlungerY = 505;
    const compress = state.launchPower * 22;
    const headY = basePlungerY + compress;

    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    const coils = 5;
    for (let i = 0; i <= coils; i++) {
      const cy = headY + ((528 - headY) * i) / coils;
      const cx = i % 2 === 0 ? 23 : 39;
      if (i === 0) ctx.moveTo(WORLD.RAIL_X_CENTER, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.stroke();

    // Brass striker hammer head with chrome rim
    const headGrad = ctx.createLinearGradient(20, headY - 8, 42, headY + 2);
    headGrad.addColorStop(0, '#fde68a');
    headGrad.addColorStop(0.5, '#d97706');
    headGrad.addColorStop(1, '#78350f');
    ctx.fillStyle = headGrad;
    ctx.fillRect(20, headY - 8, 22, 10);
    ctx.strokeStyle = '#fef3c7';
    ctx.lineWidth = 1.1;
    ctx.strokeRect(20, headY - 8, 22, 10);

    // Power percentage indicator at bottom of chute
    ctx.fillStyle = '#fde68a';
    ctx.font = '800 10px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(state.launchPower * 100)}%`, WORLD.RAIL_X_CENTER, 546);
  }

  private getStrokeLabel(power: number): { text: string; color: string } {
    if (power < 0.24) return { text: '左打ち', color: '#34d399' };
    if (power <= 0.42) return { text: 'ぶっ込み', color: '#fbbf24' };
    if (power < 0.68) return { text: '中央', color: '#fde68a' };
    if (power < 0.85) return { text: '右狙い', color: '#f97316' };
    return { text: '右打ち全開', color: '#fb7185' };
  }

  private drawTrajectoryPreview(
    ctx: CanvasRenderingContext2D,
    state: GameStateSnapshot,
    engine: IGameEngine
  ): void {
    if (!this.showAimGuide) return;

    const powerKey = Math.round(state.launchPower * 500);
    if (powerKey !== this.cachedPreviewPowerKey || this.cachedPreviewPts.length === 0) {
      this.cachedPreviewPowerKey = powerKey;
      this.cachedPreviewPts = engine.getTrajectoryPreview(state.launchPower);
    }

    const pts = this.cachedPreviewPts;
    if (pts.length < 2) return;

    const stroke = this.getStrokeLabel(state.launchPower);
    const endPt = pts[pts.length - 1];
    const targetCol = Math.max(
      0,
      Math.min(4, Math.floor((endPt.x - WORLD.BOARD_LEFT) / WORLD.COL_WIDTH))
    );
    const isReachAim = Boolean(state.reachColumns[targetCol]);
    const guideColor = isReachAim ? '#fde047' : stroke.color;

    ctx.save();
    ctx.strokeStyle = guideColor;
    ctx.lineWidth = isReachAim ? 2.8 : 2;
    ctx.globalAlpha = isReachAim ? 0.85 : 0.62;
    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = -Math.floor(state.simTime * 12) * 3;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Reticle locked tightly to preview end point
    const rx = Math.max(WORLD.BOARD_LEFT + 14, Math.min(WORLD.BOARD_RIGHT - 14, endPt.x));
    const ry = Math.max(66, Math.min(310, endPt.y));

    ctx.globalAlpha = 0.92;
    ctx.strokeStyle = guideColor;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(rx, ry, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(rx - 14, ry);
    ctx.lineTo(rx - 6, ry);
    ctx.moveTo(rx + 6, ry);
    ctx.lineTo(rx + 14, ry);
    ctx.moveTo(rx, ry - 14);
    ctx.lineTo(rx, ry - 6);
    ctx.moveTo(rx, ry + 6);
    ctx.lineTo(rx, ry + 14);
    ctx.stroke();

    const labelText = isReachAim ? `${stroke.text} [REACH]` : stroke.text;
    ctx.font = '700 11px "Chakra Petch", "M PLUS 1p", sans-serif';
    let w = this.labelWidthCache.get(labelText);
    if (w === undefined) {
      w = Math.ceil(ctx.measureText(labelText).width + 14);
      this.labelWidthCache.set(labelText, w);
    }
    const bx = Math.max(WORLD.BOARD_LEFT + 6, Math.min(WORLD.BOARD_RIGHT - w - 6, rx - w / 2));
    const by = Math.max(28, ry - 30);

    ctx.fillStyle = 'rgba(20, 12, 16, 0.92)';
    this.roundedRectPath(ctx, bx, by, w, 20, 5);
    ctx.fill();
    ctx.strokeStyle = guideColor;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.fillStyle = guideColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelText, bx + w / 2, by + 10.5);
    ctx.restore();
  }

  private drawPins(ctx: CanvasRenderingContext2D, state: GameStateSnapshot): void {
    const inShopBoardTune =
      state.phase === 'SHOP' &&
      (this.boardTuneHighlight || state.pendingPinInventory.length > 0 || state.selectedPinBrush !== null);

    // 1. Batched realistic drop shadows for all idle brass nails (真鍮釘の落ち影)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    for (const pin of state.pins) {
      if (pin.kind === 'NORMAL' && pin.hitAnim <= 0.05) {
        ctx.moveTo(pin.x + 2.5 + pin.radius, pin.y + 3.2);
        ctx.arc(pin.x + 2.5, pin.y + 3.2, pin.radius + 0.5, 0, Math.PI * 2);
      }
    }
    ctx.fill();

    // 2. Batched polished brass nail bodies + antique bronze rims
    ctx.fillStyle = '#e5a93b';
    ctx.strokeStyle = '#6b3a08';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (const pin of state.pins) {
      if (pin.kind === 'NORMAL' && pin.hitAnim <= 0.05) {
        ctx.moveTo(pin.x + pin.radius, pin.y);
        ctx.arc(pin.x, pin.y, pin.radius, 0, Math.PI * 2);
      }
    }
    ctx.fill();
    ctx.stroke();

    // 3. Batched bright metallic brass crown highlights
    ctx.fillStyle = '#fff8dc';
    ctx.beginPath();
    for (const pin of state.pins) {
      if (pin.kind === 'NORMAL' && pin.hitAnim <= 0.05) {
        const sr = pin.radius * 0.42;
        ctx.moveTo(pin.x - 1.6 + sr, pin.y - 1.8);
        ctx.arc(pin.x - 1.6, pin.y - 1.8, sr, 0, Math.PI * 2);
      }
    }
    ctx.fill();

    for (const pin of state.pins) {
      if (inShopBoardTune && pin.customizable) {
        const pulse = 0.5 + 0.5 * Math.sin(state.simTime * 6 + pin.id * 0.5);
        const isHovered = this.hoveredPinId === pin.id;
        const isRelocatableInstalled =
          !state.selectedPinBrush && state.pendingPinInventory.length === 0 && pin.kind !== 'NORMAL';

        if (state.pendingPinInventory.length > 0 || state.selectedPinBrush || isRelocatableInstalled) {
          ctx.save();
          ctx.strokeStyle = isHovered ? '#ffd000' : isRelocatableInstalled ? '#38bdf8' : '#34d399';
          ctx.lineWidth = isHovered ? 2.8 : 1.8;
          ctx.globalAlpha = isHovered ? 0.98 : 0.48 + pulse * 0.45;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.arc(pin.x, pin.y, pin.radius + 9 + pulse * 2.5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
      }

      if (pin.kind === 'NORMAL' && pin.hitAnim <= 0.05) {
        continue;
      }

      const def = PIN_CATALOG[pin.kind];
      const hitScale = 1 + pin.hitAnim * 0.32;

      ctx.save();
      ctx.translate(pin.x, pin.y);
      ctx.scale(hitScale, hitScale);

      // Physical drop shadow under special yakumono / hit nail
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.beginPath();
      ctx.arc(2.5, 3.5, pin.radius + 1, 0, Math.PI * 2);
      ctx.fill();

      if (pin.hitAnim > 0.05) {
        ctx.fillStyle = pin.kind === 'NORMAL' ? '#fde68a' : def.color;
        ctx.globalAlpha = pin.hitAnim * 0.52;
        ctx.beginPath();
        ctx.arc(0, 0, pin.radius + 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      switch (pin.kind) {
        case 'NORMAL': {
          // Struck brass nail flashing warm white-gold
          ctx.fillStyle = pin.hitAnim > 0.25 ? '#fef3c7' : '#f5b942';
          ctx.strokeStyle = '#92400e';
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.arc(0, 0, pin.radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(-1.6, -1.8, pin.radius * 0.45, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'SPLITTER': {
          // Emerald Acrylic 3-Blade Prism Yakumono with Brass Hub
          ctx.rotate(pin.spinAngle);
          const r = pin.radius + 3;
          ctx.fillStyle = '#065f46';
          ctx.strokeStyle = '#6ee7b7';
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          for (let i = 0; i < 3; i++) {
            const a = (i * Math.PI * 2) / 3 - Math.PI / 2;
            const px = Math.cos(a) * r;
            const py = Math.sin(a) * r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#34d399';
          for (let i = 0; i < 3; i++) {
            const a = (i * Math.PI * 2) / 3 - Math.PI / 2;
            ctx.beginPath();
            ctx.arc(Math.cos(a) * (r * 0.48), Math.sin(a) * (r * 0.48), 2.1, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = '#fde68a';
          ctx.strokeStyle = '#78350f';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(0, 0, 3.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          break;
        }
        case 'BUMPER': {
          // Classic Chrome-Gold & Ruby Arcade Rebound Bumper Cap
          const r = pin.radius;
          ctx.fillStyle = '#991b1b';
          ctx.strokeStyle = '#f5b942';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.strokeStyle = '#fef3c7';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.65, 0, Math.PI * 2);
          ctx.stroke();

          ctx.fillStyle = '#fde047';
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.36, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(-1.8, -1.8, 2.2, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'SPINNER': {
          // Authentic Japanese Pachinko Plastic Pinwheel (風車) with brass nail axle!
          ctx.rotate(pin.spinAngle);
          const r = pin.radius + 2.5;
          for (let i = 0; i < 6; i++) {
            ctx.rotate(Math.PI / 3);
            ctx.fillStyle = i % 2 === 0 ? '#f43f5e' : '#ffe4e6';
            ctx.strokeStyle = '#9f1239';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(0, -1.8);
            ctx.quadraticCurveTo(r * 0.65, -4.2, r, -0.5);
            ctx.lineTo(r * 0.82, 2.4);
            ctx.lineTo(0, 1.8);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
          ctx.fillStyle = '#fde68a';
          ctx.strokeStyle = '#78350f';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(0, 0, 3.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          break;
        }
        case 'BOMB_PIN': {
          // Brass-Bezel Crimson Hazard Detonator Cap
          const pulse = 0.92 + 0.1 * Math.sin(state.simTime * 9);
          ctx.scale(pulse, pulse);
          ctx.fillStyle = '#450a0a';
          ctx.strokeStyle = '#f97316';
          ctx.lineWidth = 2.6;
          ctx.beginPath();
          ctx.arc(0, 0, pin.radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.strokeStyle = '#fde047';
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.moveTo(-pin.radius + 3, 0);
          ctx.lineTo(pin.radius - 3, 0);
          ctx.moveTo(0, -pin.radius + 3);
          ctx.lineTo(0, pin.radius - 3);
          ctx.stroke();

          ctx.fillStyle = '#ff2a5f';
          ctx.beginPath();
          ctx.arc(0, 0, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fffbeb';
          ctx.beginPath();
          ctx.arc(-1.2, -1.2, 1.4, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'MAGNET': {
          // Copper-Coil Electromagnetic Ring Yakumono
          ctx.fillStyle = '#0c2742';
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.arc(0, 0, pin.radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.strokeStyle = '#d97706';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, pin.radius * 0.58, 0, Math.PI * 2);
          ctx.stroke();

          ctx.rotate(state.simTime * 3.5);
          ctx.strokeStyle = '#7dd3fc';
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.arc(0, 0, pin.radius + 3.5, 0, Math.PI * 0.75);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, 0, pin.radius + 3.5, Math.PI, Math.PI * 1.75);
          ctx.stroke();
          break;
        }
      }
      ctx.restore();
    }
  }

  private getBallGradient(
    ctx: CanvasRenderingContext2D,
    kind: BallEntity['kind'],
    radius: number
  ): CanvasGradient {
    const key = `${kind}:${radius.toFixed(1)}`;
    const cached = this.ballGradientCache.get(key);
    if (cached) return cached;

    const grad = ctx.createRadialGradient(-2.8, -3.0, 0.8, 0, 0, radius);
    if (kind === 'STEEL') {
      // Authentic mirror-polished silver chrome pachinko ball (銀玉)
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.28, '#f1f5f9');
      grad.addColorStop(0.62, '#94a3b8');
      grad.addColorStop(0.88, '#475569');
      grad.addColorStop(1, '#cbd5e1');
    } else if (kind === 'GOLD') {
      grad.addColorStop(0, '#fffbeb');
      grad.addColorStop(0.4, '#fde047');
      grad.addColorStop(0.82, '#b45309');
      grad.addColorStop(1, '#fef08a');
    } else if (kind === 'BOMB') {
      grad.addColorStop(0, '#fed7aa');
      grad.addColorStop(0.42, '#ea580c');
      grad.addColorStop(0.85, '#7f1d1d');
      grad.addColorStop(1, '#fb923c');
    } else if (kind === 'MULTI') {
      grad.addColorStop(0, '#ecfdf5');
      grad.addColorStop(0.45, '#34d399');
      grad.addColorStop(0.85, '#065f46');
      grad.addColorStop(1, '#6ee7b7');
    } else {
      grad.addColorStop(0, '#ecfeff');
      grad.addColorStop(0.45, '#38bdf8');
      grad.addColorStop(0.85, '#0369a1');
      grad.addColorStop(1, '#7dd3fc');
    }
    this.ballGradientCache.set(key, grad);
    return grad;
  }

  private drawBalls(ctx: CanvasRenderingContext2D, balls: BallEntity[]): void {
    if (balls.length === 0) return;

    // 1. Subtle metallic motion trails batched by kind color
    const trailsByColor = new Map<string, BallEntity[]>();
    for (const ball of balls) {
      if (ball.trail.length < 2) continue;
      const color = ball.kind === 'STEEL' ? '#e2e8f0' : BALL_CATALOG[ball.kind].glowColor;
      let list = trailsByColor.get(color);
      if (!list) {
        list = [];
        trailsByColor.set(color, list);
      }
      list.push(ball);
    }

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    trailsByColor.forEach((group, color) => {
      ctx.strokeStyle = color;

      ctx.globalAlpha = 0.14;
      ctx.lineWidth = 4;
      ctx.beginPath();
      for (const b of group) {
        const mid = Math.floor(b.trail.length * 0.5);
        if (mid < 1) continue;
        ctx.moveTo(b.trail[0].x, b.trail[0].y);
        for (let i = 1; i <= mid; i++) {
          ctx.lineTo(b.trail[i].x, b.trail[i].y);
        }
      }
      ctx.stroke();

      ctx.globalAlpha = 0.34;
      ctx.lineWidth = 7.4;
      ctx.beginPath();
      for (const b of group) {
        const mid = Math.floor(b.trail.length * 0.5);
        ctx.moveTo(b.trail[mid].x, b.trail[mid].y);
        for (let i = mid + 1; i < b.trail.length; i++) {
          ctx.lineTo(b.trail[i].x, b.trail[i].y);
        }
      }
      ctx.stroke();
    });
    ctx.restore();

    // 2. Draw physical chrome spheres with subtle cast drop shadow onto the board
    for (const ball of balls) {
      const def = BALL_CATALOG[ball.kind];

      ctx.save();
      ctx.translate(ball.x, ball.y);

      // Soft physical drop shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.arc(2.4, 3.2, ball.radius, 0, Math.PI * 2);
      ctx.fill();

      // Special balls carry a subtle backlit halo
      if (ball.kind !== 'STEEL') {
        ctx.fillStyle = def.glowColor;
        ctx.globalAlpha = ball.kind === 'GOLD' || ball.kind === 'BOMB' ? 0.3 : 0.2;
        ctx.beginPath();
        ctx.arc(0, 0, ball.radius + 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      ctx.fillStyle = this.getBallGradient(ctx, ball.kind, ball.radius);
      ctx.beginPath();
      ctx.arc(0, 0, ball.radius, 0, Math.PI * 2);
      ctx.fill();

      // Crisp specular pinpoint highlight
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.beginPath();
      ctx.arc(-ball.radius * 0.34, -ball.radius * 0.34, ball.radius * 0.24, 0, Math.PI * 2);
      ctx.fill();

      if (ball.kind === 'BOMB') {
        ctx.strokeStyle = ball.megaBomb ? '#fde047' : '#ff2a5f';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(0, 0, ball.radius + (ball.megaBomb ? 2.4 : 1), 0, Math.PI * 2);
        ctx.stroke();
      } else if (ball.kind === 'LASER') {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(-ball.radius + 1.5, 0);
        ctx.lineTo(ball.radius - 1.5, 0);
        ctx.stroke();
      } else if (ball.kind === 'MULTI') {
        ctx.strokeStyle = '#a7f3d0';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(0, 0, ball.radius * 0.55, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  private drawPockets(ctx: CanvasRenderingContext2D, state: GameStateSnapshot): void {
    const top = WORLD.POCKET_TOP;
    const bottom = WORLD.POCKET_BOTTOM;
    const height = bottom - top;

    for (const p of state.pockets) {
      if (p.overdrive || p.isReachTarget || p.hitAnim > 0.02) {
        this.drawSinglePocket(ctx, p, top, height, state.simTime);
      }
    }
  }

  private drawSinglePocket(
    ctx: CanvasRenderingContext2D,
    p: PocketState,
    top: number,
    height: number,
    simTime: number
  ): void {
    const x = p.xLeft + 4;
    const w = WORLD.COL_WIDTH - 8;

    ctx.fillStyle = p.overdrive
      ? 'rgba(6, 78, 59, 0.95)'
      : p.isReachTarget
        ? 'rgba(110, 48, 8, 0.94)'
        : 'rgba(34, 24, 34, 0.94)';
    this.roundedRectPath(ctx, x, top + 5, w, height - 8, 5);
    ctx.fill();

    // Glossy acrylic lens highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.fillRect(x + 3, top + 6, w - 6, 9);

    const borderColor = p.overdrive ? '#34d399' : p.isReachTarget ? '#fbbf24' : '#f5b942';
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = p.overdrive || p.isReachTarget ? 2.4 : 1.5;
    this.roundedRectPath(ctx, x, top + 5, w, height - 8, 5);
    ctx.stroke();

    if (p.hitAnim > 0.02) {
      ctx.fillStyle = '#fffbeb';
      ctx.globalAlpha = p.hitAnim * 0.48;
      this.roundedRectPath(ctx, x, top + 5, w, height - 8, 5);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = p.overdrive ? '#ecfdf5' : '#fffbeb';
    ctx.font = '900 20px Orbitron, "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.label, p.xCenter, top + 27);

    if (p.overdrive) {
      const flash = 0.78 + 0.22 * Math.sin(simTime * 12);
      ctx.save();
      ctx.globalAlpha = flash;
      ctx.fillStyle = '#6ee7b7';
      ctx.font = '800 8.5px "Chakra Petch", sans-serif';
      ctx.fillText(`OVERDRIVE LV.${Math.max(1, p.overdriveLevel)}`, p.xCenter, top + 47);
      ctx.restore();

      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      const segs = 5;
      for (let s = 0; s <= segs; s++) {
        const sx = x + 4 + ((w - 8) * s) / segs;
        const sy = top + 6 + (s === 0 || s === segs ? 0 : Math.sin(simTime * 28 + s * 3) * 3.2);
        if (s === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    } else if (p.isReachTarget) {
      const bob = Math.sin(simTime * 8) * 3.5;
      ctx.fillStyle = '#fde047';
      ctx.font = '800 10px "Chakra Petch", sans-serif';
      ctx.fillText('REACH!', p.xCenter, top - 16 + bob);

      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(p.xCenter - 7, top - 9 + bob);
      ctx.lineTo(p.xCenter, top - 2 + bob);
      ctx.lineTo(p.xCenter + 7, top - 9 + bob);
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(245, 185, 66, 0.72)';
      ctx.font = '700 8.5px "Chakra Petch", sans-serif';
      ctx.fillText(`入賞口 ${p.col + 1}`, p.xCenter, top + 47);
    }
  }

  private computeBingoSignature(state: GameStateSnapshot): string {
    const parts: string[] = [String(state.cardLevel)];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const cell = state.grid[r]?.[c];
        if (!cell) continue;
        parts.push(
          `${cell.number}:${cell.opened ? 1 : 0}:${cell.reigniteCount}:${cell.inBingoLine ? 1 : 0}:${cell.inReachLine ? 1 : 0}`
        );
      }
    }
    return parts.join('|');
  }

  private rebuildBingoCache(state: GameStateSnapshot): void {
    if (typeof document === 'undefined') return;
    if (!this.bingoCacheCanvas) {
      this.bingoCacheCanvas = document.createElement('canvas');
    }

    const gridH = WORLD.BINGO_BOTTOM - WORLD.BINGO_TOP; // 336
    const cacheW = WORLD.BOARD_WIDTH;
    const cacheH = gridH;
    const targetW = Math.round(cacheW * this.dpr);
    const targetH = Math.round(cacheH * this.dpr);

    if (
      this.bingoCacheCanvas.width !== targetW ||
      this.bingoCacheCanvas.height !== targetH ||
      this.bingoCacheDpr !== this.dpr
    ) {
      this.bingoCacheCanvas.width = targetW;
      this.bingoCacheCanvas.height = targetH;
      this.bingoCacheDpr = this.dpr;
    }

    const gctx = this.bingoCacheCanvas.getContext('2d');
    if (!gctx) return;

    gctx.save();
    gctx.clearRect(0, 0, targetW, targetH);
    gctx.scale(this.dpr, this.dpr);

    const rowH = gridH / 5;
    const padX = 4;
    const padY = 4;

    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const cell = state.grid[r]?.[c];
        if (!cell) continue;
        this.drawBingoCellToCache(
          gctx,
          cell,
          c * WORLD.COL_WIDTH + padX,
          r * rowH + padY,
          WORLD.COL_WIDTH - padX * 2,
          rowH - padY * 2
        );
      }
    }

    gctx.restore();
  }

  private drawBingoCellToCache(
    ctx: CanvasRenderingContext2D,
    cell: BingoCell,
    x: number,
    y: number,
    w: number,
    h: number
  ): void {
    const r = 7;
    ctx.save();
    this.roundedRectPath(ctx, x, y, w, h, r);

    if (cell.inBingoLine) {
      // Blazing Gold-Ruby Jackpot Acrylic Lamp
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, '#a16207');
      g.addColorStop(0.45, '#78350f');
      g.addColorStop(1, '#451a03');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 2.4;
      ctx.stroke();
    } else if (cell.opened) {
      // Warm Illuminated Amber-Emerald Lamp Tile
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, '#9a3412');
      g.addColorStop(0.5, '#7c2d12');
      g.addColorStop(1, '#431407');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2.0;
      ctx.stroke();
    } else if (cell.inReachLine) {
      // Urgent Pulsing Target Cell
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, '#3b1521');
      g.addColorStop(1, '#1e0b12');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = '#fb7185';
      ctx.lineWidth = 2.0;
      ctx.stroke();
    } else {
      // Unlit Smoked Acrylic Lamp Tile with subtle depth bevel
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, '#222634');
      g.addColorStop(0.55, '#161923');
      g.addColorStop(1, '#0f1119');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = '#3b4254';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    // Glossy 3D acrylic top bevel sheen on every tile
    ctx.fillStyle = cell.opened || cell.inBingoLine ? 'rgba(255, 250, 230, 0.22)' : 'rgba(255, 255, 255, 0.08)';
    this.roundedRectPath(ctx, x + 2.5, y + 2.5, w - 5, h * 0.34, 4);
    ctx.fill();

    // Inner lower rim shadow for physical button/tile depth
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x + 4, y + h - 1.5);
    ctx.lineTo(x + w - 4, y + h - 1.5);
    ctx.stroke();

    const cx = x + w / 2;
    const cy = y + h / 2 - (cell.reigniteCount > 0 ? 4 : 0);

    if (cell.isFree) {
      ctx.fillStyle = '#fde047';
      ctx.font = '800 14px "Chakra Petch", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('FREE', cx, cy);
    } else {
      ctx.fillStyle = cell.inBingoLine
        ? '#ffffff'
        : cell.opened
          ? '#fffbeb'
          : cell.inReachLine
            ? '#fde68a'
            : '#e2e8f0';
      ctx.font = '700 20px "Chakra Petch", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(cell.number), cx, cy);
    }

    if (cell.reigniteCount > 0) {
      ctx.fillStyle = '#fde047';
      ctx.font = '800 9px "Chakra Petch", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`+RE x${cell.reigniteCount}`, cx, y + h - 10);
    } else if (cell.inReachLine && !cell.opened) {
      ctx.fillStyle = '#fda4af';
      ctx.font = '800 8.5px "Chakra Petch", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('REACH', cx, y + h - 9);
    }

    ctx.restore();
  }

  private drawBingoGrid(ctx: CanvasRenderingContext2D, state: GameStateSnapshot): void {
    const gridTop = WORLD.BINGO_TOP;
    const gridH = WORLD.BINGO_BOTTOM - WORLD.BINGO_TOP; // 336
    const rowH = gridH / 5; // 67.2
    const padX = 4;
    const padY = 4;

    const sig = this.computeBingoSignature(state);
    if (sig !== this.lastBingoSignature || this.bingoCacheDpr !== this.dpr || !this.bingoCacheCanvas) {
      this.lastBingoSignature = sig;
      this.rebuildBingoCache(state);
    }

    // 1-blit cached 25 cells
    if (this.bingoCacheCanvas) {
      ctx.drawImage(this.bingoCacheCanvas, WORLD.BOARD_LEFT, gridTop, WORLD.BOARD_WIDTH, gridH);
    }

    // Lightweight dynamic cell open/reignite overlays
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const cell = state.grid[r]?.[c];
        if (!cell) continue;
        const anim = Math.max(cell.openAnim, cell.reigniteAnim);
        if (anim > 0.01) {
          const cx = WORLD.BOARD_LEFT + c * WORLD.COL_WIDTH + padX;
          const cy = gridTop + r * rowH + padY;
          ctx.save();
          ctx.fillStyle = cell.reigniteAnim > cell.openAnim ? '#ffb800' : '#00f0ff';
          ctx.globalAlpha = anim * 0.42;
          this.roundedRectPath(ctx, cx, cy, WORLD.COL_WIDTH - padX * 2, rowH - padY * 2, 6);
          ctx.fill();
          ctx.restore();
        }
      }
    }

    // Full Reach Line dashed indicator + target cell brackets
    const reachPulse = 0.48 + 0.45 * Math.sin(state.simTime * 8.5);
    for (const line of ALL_BINGO_LINES) {
      let openedCount = 0;
      let missing: [number, number] | null = null;
      for (const [lr, lc] of line.cells) {
        if (state.grid[lr]?.[lc]?.opened) {
          openedCount++;
        } else {
          missing = [lr, lc];
        }
      }
      if (openedCount === 4 && missing) {
        const first = line.cells[0];
        const last = line.cells[line.cells.length - 1];
        const x1 = WORLD.BOARD_LEFT + first[1] * WORLD.COL_WIDTH + WORLD.COL_WIDTH / 2;
        const y1 = gridTop + first[0] * rowH + rowH / 2;
        const x2 = WORLD.BOARD_LEFT + last[1] * WORLD.COL_WIDTH + WORLD.COL_WIDTH / 2;
        const y2 = gridTop + last[0] * rowH + rowH / 2;

        ctx.save();
        ctx.strokeStyle = `rgba(255, 184, 0, ${reachPulse * 0.72})`;
        ctx.lineWidth = 2.6;
        ctx.setLineDash([7, 5]);
        ctx.lineDashOffset = -state.simTime * 34;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Coral-amber target corner frame on the exact missing cell
        const mx = WORLD.BOARD_LEFT + missing[1] * WORLD.COL_WIDTH + padX;
        const my = gridTop + missing[0] * rowH + padY;
        const mw = WORLD.COL_WIDTH - padX * 2;
        const mh = rowH - padY * 2;
        ctx.strokeStyle = `rgba(255, 107, 0, ${0.55 + reachPulse * 0.45})`;
        ctx.lineWidth = 2.6;
        this.roundedRectPath(ctx, mx, my, mw, mh, 6);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Completed line laser beams
    for (const flash of this.lineFlashes) {
      const alpha = Math.max(0, flash.life / flash.maxLife);
      const first = flash.cells[0];
      const last = flash.cells[flash.cells.length - 1];
      const x1 = WORLD.BOARD_LEFT + first[1] * WORLD.COL_WIDTH + WORLD.COL_WIDTH / 2;
      const y1 = gridTop + first[0] * rowH + rowH / 2;
      const x2 = WORLD.BOARD_LEFT + last[1] * WORLD.COL_WIDTH + WORLD.COL_WIDTH / 2;
      const y2 = gridTop + last[0] * rowH + rowH / 2;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = flash.color;
      ctx.lineWidth = 8 * alpha + 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3 * alpha;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private roundedRectPath(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  private drawVfxLayer(ctx: CanvasRenderingContext2D): void {
    if (this.beams.length > 0 || this.rings.length > 0 || this.particles.length > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      for (const b of this.beams) {
        const alpha = Math.max(0, b.life / b.maxLife);
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = b.color;
        ctx.lineWidth = b.width * alpha + 1;
        ctx.lineCap = 'round';
        ctx.beginPath();
        if (b.jagged) {
          const steps = 6;
          ctx.moveTo(b.x1, b.y1);
          for (let s = 1; s < steps; s++) {
            const t = s / steps;
            const jx = (Math.random() - 0.5) * 20;
            const jy = (Math.random() - 0.5) * 14;
            ctx.lineTo(b.x1 + (b.x2 - b.x1) * t + jx, b.y1 + (b.y2 - b.y1) * t + jy);
          }
          ctx.lineTo(b.x2, b.y2);
        } else {
          ctx.moveTo(b.x1, b.y1);
          ctx.lineTo(b.x2, b.y2);
        }
        ctx.stroke();

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1, b.width * 0.4 * alpha);
        ctx.stroke();
      }

      for (const r of this.rings) {
        const alpha = Math.max(0, r.life / r.maxLife);
        ctx.globalAlpha = alpha * 0.9;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = r.lineWidth * alpha + 0.6;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
        ctx.stroke();
      }

      for (const p of this.particles) {
        const alpha = Math.max(0, p.life / p.maxLife);
        const s = p.size * alpha + 0.5;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - s, p.y - s, s * 2, s * 2);
      }

      ctx.restore();
    }

    for (const pop of this.popups) {
      const alpha = Math.min(1, (pop.life / pop.maxLife) * 1.6);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(Math.round(pop.x), Math.round(pop.y));
      ctx.scale(pop.scale, pop.scale);

      ctx.font = '900 16px Orbitron, "Chakra Petch", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#050811';
      ctx.strokeText(pop.text, 0, 0);
      ctx.fillStyle = pop.color;
      ctx.fillText(pop.text, 0, 0);

      if (pop.subtext) {
        ctx.font = '700 10px "Chakra Petch", "M PLUS 1p", sans-serif';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#050811';
        ctx.strokeText(pop.subtext, 0, 15);
        ctx.fillStyle = '#f1f5f9';
        ctx.fillText(pop.subtext, 0, 15);
      }
      ctx.restore();
    }
  }
}
