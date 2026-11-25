import { BallKind, PinKind, RelicId } from '../types';

export type UiIconName =
  | 'bgmOn'
  | 'bgmOff'
  | 'seOn'
  | 'seOff'
  | 'medal'
  | 'rotaryHandle'
  | 'lockOn'
  | 'lockOff'
  | 'reroll'
  | 'play'
  | 'bolt'
  | 'autoTune'
  | 'sell'
  | 'brandEmblem'
  | 'aimTarget'
  | 'bingoGrid'
  | 'overdriveCore'
  | 'crown'
  | 'chevronRight';

function svgWrap(size: number, viewBox: string, body: string, cls = ''): string {
  const classAttr = cls ? ` class="${cls}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${viewBox}" fill="none"${classAttr} aria-hidden="true">${body}</svg>`;
}

export function getPinIconSvg(kind: PinKind, size = 24): string {
  switch (kind) {
    case 'NORMAL':
      return svgWrap(
        size,
        '0 0 32 32',
        `<circle cx="16" cy="16" r="11" stroke="#00f0ff" stroke-width="2.2" fill="#0b1526"/>
         <circle cx="16" cy="16" r="5" fill="#e2f8ff"/>
         <path d="M16 3v4M16 25v4M3 16h4M25 16h4" stroke="#00f0ff" stroke-width="1.6" stroke-linecap="round"/>`
      );
    case 'SPLITTER':
      return svgWrap(
        size,
        '0 0 32 32',
        `<polygon points="16,4 28,25 4,25" fill="#07281e" stroke="#00ff88" stroke-width="2.2" stroke-linejoin="round"/>
         <circle cx="16" cy="10" r="2.3" fill="#00ff88"/>
         <circle cx="10.5" cy="21.5" r="2.3" fill="#00ff88"/>
         <circle cx="21.5" cy="21.5" r="2.3" fill="#00ff88"/>
         <path d="M16 12.5L11.5 20M16 12.5L20.5 20M12 21.5h8" stroke="#86efac" stroke-width="1.3"/>`
      );
    case 'BUMPER':
      return svgWrap(
        size,
        '0 0 32 32',
        `<polygon points="11,3 21,3 29,11 29,21 21,29 11,29 3,21 3,11" fill="#291a04" stroke="#ffb800" stroke-width="2.2"/>
         <circle cx="16" cy="16" r="7.5" stroke="#ffd86b" stroke-width="1.8" fill="#422806"/>
         <path d="M16 10.5l1.6 3.9 4.1 1.6-4.1 1.6-1.6 3.9-1.6-3.9-4.1-1.6 4.1-1.6z" fill="#ffb800"/>`
      );
    case 'SPINNER':
      return svgWrap(
        size,
        '0 0 32 32',
        `<circle cx="16" cy="16" r="12" stroke="#ff2a5f" stroke-width="1.4" stroke-dasharray="4 3"/>
         <path d="M16 4l4 10h-8zM28 16l-10 4v-8zM16 28l-4-10h8zM4 16l10-4v8z" fill="#ff2a5f"/>
         <circle cx="16" cy="16" r="3.4" fill="#f1f5f9" stroke="#ff2a5f" stroke-width="1.4"/>`
      );
    case 'BOMB_PIN':
      return svgWrap(
        size,
        '0 0 32 32',
        `<circle cx="16" cy="16" r="10.5" fill="#2b0c09" stroke="#ff6b00" stroke-width="2.2"/>
         <path d="M16 3v5M16 24v5M3 16h5M24 16h5M7 7l3.5 3.5M21.5 21.5L25 25M25 7l-3.5 3.5M10.5 21.5L7 25" stroke="#ff2a5f" stroke-width="1.9" stroke-linecap="round"/>
         <circle cx="16" cy="16" r="4.5" fill="#ff6b00"/>
         <circle cx="16" cy="16" r="2" fill="#fff7ed"/>`
      );
    case 'MAGNET':
      return svgWrap(
        size,
        '0 0 32 32',
        `<path d="M8 15a8 8 0 0116 0" stroke="#38bdf8" stroke-width="2.6" stroke-linecap="round"/>
         <path d="M24 17a8 8 0 01-16 0" stroke="#00f0ff" stroke-width="2.6" stroke-linecap="round"/>
         <circle cx="16" cy="16" r="4.5" fill="#0ea5e9" stroke="#e0f2fe" stroke-width="1.5"/>
         <path d="M5 11l3 4-4 1M27 21l-3-4 4-1" stroke="#00f0ff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`
      );
  }
}

export function getBallIconSvg(kind: BallKind, size = 24): string {
  switch (kind) {
    case 'STEEL':
      return svgWrap(
        size,
        '0 0 32 32',
        `<circle cx="16" cy="16" r="11.5" fill="#475569" stroke="#00f0ff" stroke-width="1.8"/>
         <circle cx="14.8" cy="14.6" r="8.6" fill="#cbd5e1"/>
         <circle cx="12.6" cy="11.8" r="4.3" fill="#ffffff"/>
         <path d="M10.5 10.5a7 7 0 016.5-2" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"/>`
      );
    case 'BOMB':
      return svgWrap(
        size,
        '0 0 32 32',
        `<circle cx="16" cy="17" r="10.5" fill="#3b0c0c" stroke="#ff5500" stroke-width="2.2"/>
         <path d="M16 6.5V3M16 3l3.5-1.5M12.5 4.5L15 6.5" stroke="#ffb800" stroke-width="1.8" stroke-linecap="round"/>
         <path d="M11 17h10M16 12v10" stroke="#ff2a5f" stroke-width="2" stroke-linecap="round"/>
         <circle cx="16" cy="17" r="3.4" fill="#ff8a00"/>`
      );
    case 'MULTI':
      return svgWrap(
        size,
        '0 0 32 32',
        `<circle cx="12" cy="16" r="7.5" fill="#064e3b" stroke="#00ff88" stroke-width="2"/>
         <circle cx="20" cy="16" r="7.5" fill="#047857" fill-opacity="0.85" stroke="#6ee7b7" stroke-width="2"/>
         <circle cx="16" cy="16" r="2.8" fill="#ecfdf5"/>`
      );
    case 'LASER':
      return svgWrap(
        size,
        '0 0 32 32',
        `<circle cx="16" cy="16" r="11" fill="#06283d" stroke="#00f0ff" stroke-width="2.2"/>
         <polygon points="16,5 20,16 16,27 12,16" fill="#00f0ff"/>
         <path d="M5 16h22" stroke="#e0f2fe" stroke-width="1.8" stroke-linecap="round"/>
         <circle cx="16" cy="16" r="2.5" fill="#ffffff"/>`
      );
    case 'GOLD':
      return svgWrap(
        size,
        '0 0 32 32',
        `<circle cx="16" cy="16" r="11.5" fill="#422a03" stroke="#ffd000" stroke-width="2.2"/>
         <circle cx="16" cy="16" r="7.8" stroke="#ffb800" stroke-width="1.4"/>
         <polygon points="16,9 18.2,13.8 23.2,16 18.2,18.2 16,23 13.8,18.2 8.8,16 13.8,13.8" fill="#ffd000"/>`
      );
  }
}

export function getRelicIconSvg(id: RelicId, size = 26): string {
  switch (id) {
    case 'reignite_amp':
      return svgWrap(
        size,
        '0 0 32 32',
        `<rect x="6" y="7" width="20" height="18" rx="3" fill="#2b0b16" stroke="#ff2a5f" stroke-width="2"/>
         <path d="M12 11v10M20 11v10M4 16h4M24 16h4" stroke="#ff6b8b" stroke-width="2" stroke-linecap="round"/>
         <path d="M15 9l-2 7h4l-2 7" stroke="#ffd000" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>`
      );
    case 'prism_core':
      return svgWrap(
        size,
        '0 0 32 32',
        `<polygon points="16,5 27,25 5,25" fill="#062e24" stroke="#00ff88" stroke-width="2" stroke-linejoin="round"/>
         <path d="M3 16h9M20 14l9-4M21 18l8 0M20 21l9 4" stroke="#6ee7b7" stroke-width="1.8" stroke-linecap="round"/>`
      );
    case 'blast_furnace':
      return svgWrap(
        size,
        '0 0 32 32',
        `<rect x="5" y="5" width="22" height="22" rx="4" fill="#2a1004" stroke="#ff6b00" stroke-width="2"/>
         <path d="M11 11h10v10H11z" fill="#ff2a5f" fill-opacity="0.35" stroke="#ffb800" stroke-width="1.6"/>
         <path d="M16 3v5M16 24v5M3 16h5M24 16h5" stroke="#ff6b00" stroke-width="2" stroke-linecap="round"/>`
      );
    case 'overdrive_arc':
      return svgWrap(
        size,
        '0 0 32 32',
        `<circle cx="7" cy="16" r="3.5" fill="#00f0ff"/>
         <circle cx="25" cy="16" r="3.5" fill="#00f0ff"/>
         <path d="M10 16l3-6 3 11 3-9 3 4" stroke="#e0f2fe" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>
         <path d="M6 9l3-3M26 9l-3-3M6 23l3 3M26 23l-3 3" stroke="#00ff88" stroke-width="1.6" stroke-linecap="round"/>`
      );
    case 'pinball_wizard':
      return svgWrap(
        size,
        '0 0 32 32',
        `<polygon points="16,4 20,12 28,12 22,18 24,27 16,22 8,27 10,18 4,12 12,12" fill="#2a1e05" stroke="#ffb800" stroke-width="2" stroke-linejoin="round"/>
         <circle cx="16" cy="16" r="3.5" fill="#00f0ff"/>`
      );
    case 'diagonal_king':
      return svgWrap(
        size,
        '0 0 32 32',
        `<rect x="5" y="5" width="22" height="22" rx="3" fill="#230b14" stroke="#ff2a5f" stroke-width="1.8"/>
         <path d="M8 24L24 8M8 8l16 16" stroke="#ff2a5f" stroke-width="2.4" stroke-linecap="round"/>
         <circle cx="16" cy="16" r="3" fill="#ffd000"/>`
      );
    case 'right_stroke':
      return svgWrap(
        size,
        '0 0 32 32',
        `<path d="M7 22a11 11 0 0118-8" stroke="#ffb800" stroke-width="2.6" stroke-linecap="round"/>
         <polygon points="27,16 20,17 24,10" fill="#ffb800"/>
         <path d="M12 24h13" stroke="#ffe082" stroke-width="1.8" stroke-linecap="round"/>`
      );
    case 'left_trick':
      return svgWrap(
        size,
        '0 0 32 32',
        `<path d="M25 22a11 11 0 00-18-8" stroke="#00ff88" stroke-width="2.4" stroke-linecap="round"/>
         <path d="M13 11L6 15l2 7" stroke="#00ff88" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
         <circle cx="9" cy="14" r="2.5" fill="#ecfdf5"/>`
      );
    case 'reach_radar':
      return svgWrap(
        size,
        '0 0 32 32',
        `<circle cx="16" cy="16" r="10.5" stroke="#00f0ff" stroke-width="2"/>
         <circle cx="16" cy="16" r="5" stroke="#ffb800" stroke-width="1.6"/>
         <path d="M16 2v6M16 24v6M2 16h6M24 16h6" stroke="#00f0ff" stroke-width="2" stroke-linecap="round"/>
         <circle cx="16" cy="16" r="2" fill="#ffb800"/>`
      );
    case 'fever_engine':
      return svgWrap(
        size,
        '0 0 32 32',
        `<path d="M11 11a5 5 0 100 10c3 0 5-5 10-5a5 5 0 110 10c-3 0-5-5-10-5" stroke="#ffd000" stroke-width="2.4" stroke-linecap="round"/>
         <circle cx="10.5" cy="16" r="2" fill="#00ff88"/>
         <circle cx="21.5" cy="16" r="2" fill="#00ff88"/>`
      );
    case 'medal_magnet':
      return svgWrap(
        size,
        '0 0 32 32',
        `<path d="M9 8v9a7 7 0 0014 0V8" stroke="#ffb800" stroke-width="3.2" stroke-linecap="round"/>
         <path d="M7.5 8h3M21.5 8h3" stroke="#f1f5f9" stroke-width="2.4" stroke-linecap="round"/>
         <circle cx="16" cy="12" r="3" fill="#ffd000"/>`
      );
    case 'extra_magazine':
      return svgWrap(
        size,
        '0 0 32 32',
        `<rect x="9" y="5" width="14" height="22" rx="3" fill="#0b2239" stroke="#38bdf8" stroke-width="2"/>
         <circle cx="16" cy="10.5" r="2.2" fill="#e2e8f0"/>
         <circle cx="16" cy="16" r="2.2" fill="#e2e8f0"/>
         <circle cx="16" cy="21.5" r="2.2" fill="#ff5500"/>
         <path d="M25 11v6M22 14h6" stroke="#00ff88" stroke-width="2" stroke-linecap="round"/>`
      );
  }
}

export function getUiIconSvg(name: UiIconName, size = 20): string {
  switch (name) {
    case 'bgmOn':
      return svgWrap(
        size,
        '0 0 24 24',
        `<path d="M9 17V6l10-2v11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
         <circle cx="6.5" cy="17.5" r="2.5" stroke="currentColor" stroke-width="2"/>
         <circle cx="16.5" cy="15.5" r="2.5" stroke="currentColor" stroke-width="2"/>`
      );
    case 'bgmOff':
      return svgWrap(
        size,
        '0 0 24 24',
        `<path d="M9 14V6l10-2v8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/>
         <circle cx="6.5" cy="17.5" r="2.5" stroke="currentColor" stroke-width="2" opacity="0.55"/>
         <path d="M4 4l16 16" stroke="#ff2a5f" stroke-width="2.2" stroke-linecap="round"/>`
      );
    case 'seOn':
      return svgWrap(
        size,
        '0 0 24 24',
        `<polygon points="4,9 9,9 14,5 14,19 9,15 4,15" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
         <path d="M17.5 8.5a5 5 0 010 7M20 6a8.5 8.5 0 010 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`
      );
    case 'seOff':
      return svgWrap(
        size,
        '0 0 24 24',
        `<polygon points="4,9 9,9 14,5 14,19 9,15 4,15" stroke="currentColor" stroke-width="2" stroke-linejoin="round" opacity="0.55"/>
         <path d="M17 9l4 6M21 9l-4 6" stroke="#ff2a5f" stroke-width="2.2" stroke-linecap="round"/>`
      );
    case 'medal':
      return svgWrap(
        size,
        '0 0 24 24',
        `<polygon points="8,2 16,2 22,8 22,16 16,22 8,22 2,16 2,8" fill="#422a03" stroke="#ffb800" stroke-width="2"/>
         <polygon points="12,6 16,12 12,18 8,12" fill="#ffd000"/>`
      );
    case 'rotaryHandle':
      return svgWrap(
        size,
        '0 0 48 48',
        `<circle cx="24" cy="24" r="20" fill="#0d1424" stroke="#00f0ff" stroke-width="2.2"/>
         <circle cx="24" cy="24" r="14" fill="#131d33" stroke="#334155" stroke-width="1.8" stroke-dasharray="4 3"/>
         <path d="M24 6v6M24 36v6M6 24h6M36 24h6" stroke="#475569" stroke-width="2" stroke-linecap="round"/>
         <rect x="21" y="7" width="6" height="14" rx="2" fill="#ffb800"/>
         <circle cx="24" cy="24" r="5" fill="#00f0ff"/>`
      );
    case 'lockOn':
      return svgWrap(
        size,
        '0 0 24 24',
        `<rect x="5" y="11" width="14" height="10" rx="2" fill="#052e23" stroke="currentColor" stroke-width="2"/>
         <path d="M8 11V7a4 4 0 018 0v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
         <circle cx="12" cy="16" r="1.5" fill="currentColor"/>`
      );
    case 'lockOff':
      return svgWrap(
        size,
        '0 0 24 24',
        `<rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" stroke-width="2"/>
         <path d="M8 11V7a4 4 0 017.5-1.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
         <circle cx="12" cy="16" r="1.5" fill="currentColor"/>`
      );
    case 'reroll':
      return svgWrap(
        size,
        '0 0 24 24',
        `<path d="M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>
         <polygon points="19,3 20,8 15,8" fill="currentColor"/>
         <polygon points="5,21 4,16 9,16" fill="currentColor"/>`
      );
    case 'play':
      return svgWrap(
        size,
        '0 0 24 24',
        `<polygon points="6,4 20,12 6,20" fill="currentColor"/>`
      );
    case 'bolt':
      return svgWrap(
        size,
        '0 0 24 24',
        `<polygon points="13,2 4,14 11,14 9,22 20,10 13,10" fill="currentColor"/>`
      );
    case 'autoTune':
      return svgWrap(
        size,
        '0 0 24 24',
        `<polygon points="12,2 14.5,9.5 22,12 14.5,14.5 12,22 9.5,14.5 2,12 9.5,9.5" stroke="currentColor" stroke-width="1.8" fill="currentColor" fill-opacity="0.22"/>
         <circle cx="19" cy="5" r="1.5" fill="currentColor"/>`
      );
    case 'sell':
      return svgWrap(
        size,
        '0 0 24 24',
        `<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/>
         <path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`
      );
    case 'brandEmblem':
      return svgWrap(
        size,
        '0 0 64 64',
        `<polygon points="32,3 57,17 57,47 32,61 7,47 7,17" fill="#0d1424" stroke="#00f0ff" stroke-width="2.6"/>
         <polygon points="32,9 51,20 51,44 32,55 13,44 13,20" stroke="#ffb800" stroke-width="1.4" opacity="0.75"/>
         <polygon points="35,14 20,34 31,34 27,50 44,29 33,29" fill="#00f0ff"/>
         <circle cx="19" cy="21" r="2.2" fill="#00ff88"/>
         <circle cx="45" cy="21" r="2.2" fill="#ffb800"/>
         <circle cx="19" cy="43" r="2.2" fill="#ff2a5f"/>
         <circle cx="45" cy="43" r="2.2" fill="#00ff88"/>`
      );
    case 'aimTarget':
      return svgWrap(
        size,
        '0 0 24 24',
        `<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2"/>
         <circle cx="12" cy="12" r="2.5" fill="currentColor"/>
         <path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`
      );
    case 'bingoGrid':
      return svgWrap(
        size,
        '0 0 24 24',
        `<rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/>
         <path d="M9 3v18M15 3v18M3 9h18M3 15h18" stroke="currentColor" stroke-width="1.5" opacity="0.6"/>
         <path d="M5 19L19 5" stroke="#ffb800" stroke-width="2.2" stroke-linecap="round"/>`
      );
    case 'overdriveCore':
      return svgWrap(
        size,
        '0 0 24 24',
        `<polygon points="12,2 21,7 21,17 12,22 3,17 3,7" stroke="currentColor" stroke-width="2" fill="#052e23"/>
         <polygon points="13,6 8,13 12,13 11,18 16,11 12,11" fill="#00ff88"/>`
      );
    case 'crown':
      return svgWrap(
        size,
        '0 0 24 24',
        `<polygon points="3,18 5,7 10,12 12,5 14,12 19,7 21,18" fill="#ffb800" stroke="#ffd000" stroke-width="1.6" stroke-linejoin="round"/>
         <rect x="4" y="19" width="16" height="2" rx="1" fill="#ffd000"/>`
      );
    case 'chevronRight':
      return svgWrap(
        size,
        '0 0 24 24',
        `<path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`
      );
  }
}
