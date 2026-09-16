/**
 * Colour tokens.
 *
 * Two themes, both designed rather than inverted. The workspace changes between them;
 * the physical objects mostly do not, because a breadboard is cream and a DIP is dark
 * grey whichever theme you are working in, and keeping real objects recognisable
 * matters more than a uniform palette.
 */

export interface Theme {
  name: 'light' | 'dark';

  canvasBackground: string;
  gridDot: string;
  gridDotMajor: string;

  boardBody: string;
  boardEdge: string;
  boardShadow: string;
  boardTrench: string;
  boardText: string;
  boardTextMuted: string;
  hole: string;
  holeRim: string;
  railPositive: string;
  railNegative: string;
  railGap: string;

  dipBody: string;
  dipBodyTop: string;
  dipEdge: string;
  dipText: string;
  dipNotch: string;
  pinMetal: string;
  pinMetalEdge: string;

  bodyNeutral: string;
  bodyNeutralEdge: string;
  moduleBody: string;
  moduleEdge: string;
  moduleText: string;

  selection: string;
  selectionFill: string;
  hover: string;
  validPlacement: string;
  invalidPlacement: string;
  junction: string;

  stateHigh: string;
  stateLow: string;
  stateFloating: string;
  stateConflict: string;
  stateSupply: string;
  stateGround: string;

  warning: string;
  danger: string;
  damaged: string;
  heat: string;
}

const SIGNAL = {
  stateHigh: '#e4443a',
  stateLow: '#3d6fb4',
  stateFloating: '#8a8f98',
  stateConflict: '#e8a32d',
  stateSupply: '#d92b1f',
  stateGround: '#2f3338',
};

export const DARK_THEME: Theme = {
  name: 'dark',

  canvasBackground: '#171a1f',
  gridDot: '#262b33',
  gridDotMajor: '#333a45',

  boardBody: '#d9d6cc',
  boardEdge: '#b3afa2',
  boardShadow: 'rgba(0, 0, 0, 0.45)',
  boardTrench: '#c3bfb2',
  boardText: '#4a4741',
  boardTextMuted: '#7d796f',
  hole: '#4e4b45',
  holeRim: '#b8b4a8',
  railPositive: '#c0392b',
  railNegative: '#2c5d9b',
  railGap: '#c3bfb2',

  dipBody: '#2b2f36',
  dipBodyTop: '#3a3f47',
  dipEdge: '#14161a',
  dipText: '#d7dae0',
  dipNotch: '#15171b',
  pinMetal: '#c9cdd4',
  pinMetalEdge: '#8d939c',

  bodyNeutral: '#d5d8dd',
  bodyNeutralEdge: '#9aa0a8',
  moduleBody: '#232830',
  moduleEdge: '#3b424c',
  moduleText: '#cfd4dc',

  selection: '#3d9be9',
  selectionFill: 'rgba(61, 155, 233, 0.16)',
  hover: '#5fb2f0',
  validPlacement: '#37a860',
  invalidPlacement: '#d64541',
  junction: '#1c1f24',

  ...SIGNAL,

  warning: '#e8a32d',
  danger: '#d64541',
  damaged: '#4a3128',
  heat: 'rgba(214, 69, 65, 0.35)',
};

export const LIGHT_THEME: Theme = {
  name: 'light',

  canvasBackground: '#f2f3f5',
  gridDot: '#dcdee2',
  gridDotMajor: '#c6c9cf',

  boardBody: '#f4f2ec',
  boardEdge: '#c9c5b8',
  boardShadow: 'rgba(30, 34, 40, 0.18)',
  boardTrench: '#e2dfd4',
  boardText: '#55524b',
  boardTextMuted: '#8d8a80',
  hole: '#57544e',
  holeRim: '#d5d1c4',
  railPositive: '#c0392b',
  railNegative: '#2c5d9b',
  railGap: '#e2dfd4',

  dipBody: '#33383f',
  dipBodyTop: '#454b54',
  dipEdge: '#1b1e23',
  dipText: '#e6e9ee',
  dipNotch: '#1b1e23',
  pinMetal: '#b9bec6',
  pinMetalEdge: '#878d96',

  bodyNeutral: '#e8eaee',
  bodyNeutralEdge: '#a8aeb6',
  moduleBody: '#ffffff',
  moduleEdge: '#c4c8ce',
  moduleText: '#2c3037',

  selection: '#1f7fd4',
  selectionFill: 'rgba(31, 127, 212, 0.14)',
  hover: '#3f9ae0',
  validPlacement: '#2d8f52',
  invalidPlacement: '#c93b37',
  junction: '#22252a',

  ...SIGNAL,

  warning: '#b57812',
  danger: '#c93b37',
  damaged: '#6b4a3c',
  heat: 'rgba(201, 59, 55, 0.28)',
};

export function themeFor(name: 'light' | 'dark'): Theme {
  return name === 'dark' ? DARK_THEME : LIGHT_THEME;
}

/**
 * Wire colours.
 *
 * Purely cosmetic - the simulator never reads them. The defaults follow lab
 * convention (red for the positive rail, black for ground) so a circuit reads the way
 * a real one does.
 */
export const WIRE_COLORS: { key: string; label: string; hex: string; shortcut?: string }[] = [
  { key: 'black', label: 'Black', hex: '#23262b', shortcut: '1' },
  { key: 'red', label: 'Red', hex: '#d0342c', shortcut: '2' },
  { key: 'brown', label: 'Brown', hex: '#8a5a33' },
  { key: 'amber', label: 'Amber', hex: '#e08c1a' },
  { key: 'yellow', label: 'Yellow', hex: '#e8c51c' },
  { key: 'green', label: 'Green', hex: '#3aa757' },
  { key: 'blue', label: 'Blue', hex: '#2f7fd0' },
  { key: 'purple', label: 'Purple', hex: '#8256c8' },
  { key: 'gray', label: 'Gray', hex: '#8b9199' },
  { key: 'white', label: 'White', hex: '#eceff3' },
  { key: 'pink', label: 'Pink', hex: '#e06b9a' },
  { key: 'teal', label: 'Teal', hex: '#23a7a0' },
];

const WIRE_COLOR_MAP = new Map(WIRE_COLORS.map((c) => [c.key, c.hex]));

export function wireColorHex(key: string): string {
  return WIRE_COLOR_MAP.get(key) ?? key;
}

export const LED_COLORS: Record<string, { on: string; off: string; glow: string }> = {
  red: { on: '#ff4a3d', off: '#7d2b26', glow: 'rgba(255, 74, 61, 0.55)' },
  green: { on: '#4ee06a', off: '#2a6636', glow: 'rgba(78, 224, 106, 0.5)' },
  yellow: { on: '#ffd83d', off: '#7d6a1f', glow: 'rgba(255, 216, 61, 0.5)' },
  blue: { on: '#59a8ff', off: '#2a4d7d', glow: 'rgba(89, 168, 255, 0.5)' },
  white: { on: '#f6f8ff', off: '#8c8f99', glow: 'rgba(246, 248, 255, 0.5)' },
};

export function ledColor(key: string) {
  return LED_COLORS[key] ?? LED_COLORS.red;
}
