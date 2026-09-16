/**
 * Breadboard definitions.
 *
 * A board is described by *where its clips are*, not by a picture. Everything the
 * renderer draws and everything the net resolver connects is derived from these
 * structures, so adding a new board model is a data change.
 *
 * Vertical layout of a standard board, in grid units (1 unit = 0.1 in):
 *
 *   y=0   + rail
 *   y=1   - rail
 *   y=3   row a          the five holes of one column share a clip
 *   ...
 *   y=7   row e
 *         centre trench  (e -> f is 0.3 in, exactly a narrow DIP body)
 *   y=10  row f
 *   ...
 *   y=14  row j
 *   y=16  + rail
 *   y=17  - rail
 */

/** One electrically isolated stretch of a power rail. */
export interface RailSegmentDefinition {
  id: string;
  /** Inclusive column range covered by this segment. */
  fromColumn: number;
  toColumn: number;
}

export interface RailDefinition {
  id: string;
  label: string;
  polarity: 'positive' | 'negative';
  /** Grid offset from the board origin. */
  y: number;
  segments: RailSegmentDefinition[];
}

/** A bank is a group of rows whose holes are connected column by column. */
export interface BankDefinition {
  id: string;
  /** Row letters, top to bottom. */
  rows: string[];
  /** Grid offset of the first row. */
  y: number;
}

/** The void between two banks. Nothing is connected across it. */
export interface TrenchDefinition {
  id: string;
  upperBankId: string;
  lowerBankId: string;
  /** Grid offset of the top of the gap, and its height. */
  y: number;
  height: number;
}

export interface BreadboardDefinition {
  id: string;
  name: string;
  description: string;
  /** Number of numbered columns, 1-based. */
  columns: number;
  banks: BankDefinition[];
  rails: RailDefinition[];
  trenches: TrenchDefinition[];
  /** Outer body of the board relative to the origin (column 1, rail row 0). */
  body: { x: number; y: number; width: number; height: number };
  /** Columns that carry a printed number label. */
  labelEvery: number;
}

/**
 * Rails have holes in groups of five with a missing hole between groups, which is
 * also where split rails break. Column numbers divisible by six have no rail hole.
 */
export function railHasHole(column: number): boolean {
  return column % 6 !== 0;
}

const TERMINAL_ROWS_UPPER = ['a', 'b', 'c', 'd', 'e'];
const TERMINAL_ROWS_LOWER = ['f', 'g', 'h', 'i', 'j'];

function bankPair(prefix: string, y: number, upperRows: string[], lowerRows: string[]) {
  const upper: BankDefinition = { id: `${prefix}-upper`, rows: upperRows, y };
  const lower: BankDefinition = { id: `${prefix}-lower`, rows: lowerRows, y: y + 7 };
  const trench: TrenchDefinition = {
    id: `${prefix}-trench`,
    upperBankId: upper.id,
    lowerBankId: lower.id,
    y: y + 5,
    height: 2,
  };
  return { upper, lower, trench };
}

function continuousRail(
  id: string,
  label: string,
  polarity: 'positive' | 'negative',
  y: number,
  columns: number,
): RailDefinition {
  return {
    id,
    label,
    polarity,
    y,
    segments: [{ id: `${id}-s1`, fromColumn: 1, toColumn: columns }],
  };
}

/**
 * Split rails are the real behaviour of most full-size boards: the clip is broken
 * near the middle and the far half is dead until the student adds a jumper.
 */
function splitRail(
  id: string,
  label: string,
  polarity: 'positive' | 'negative',
  y: number,
  columns: number,
  breakAt: number,
): RailDefinition {
  return {
    id,
    label,
    polarity,
    y,
    segments: [
      { id: `${id}-s1`, fromColumn: 1, toColumn: breakAt - 1 },
      { id: `${id}-s2`, fromColumn: breakAt + 1, toColumn: columns },
    ],
  };
}

function makeStandardBoard(options: {
  id: string;
  name: string;
  description: string;
  columns: number;
  rails: 'none' | 'continuous' | 'split';
}): BreadboardDefinition {
  const { id, name, description, columns } = options;
  const hasRails = options.rails !== 'none';
  const railTopY = 0;
  const bankY = hasRails ? 3 : 1;
  const { upper, lower, trench } = bankPair('main', bankY, TERMINAL_ROWS_UPPER, TERMINAL_ROWS_LOWER);
  const railBottomY = lower.y + 6;

  const rails: RailDefinition[] = [];
  if (hasRails) {
    const breakAt = Math.round(columns / 2 / 6) * 6;
    const build = (rid: string, label: string, pol: 'positive' | 'negative', y: number) =>
      options.rails === 'split'
        ? splitRail(rid, label, pol, y, columns, breakAt)
        : continuousRail(rid, label, pol, y, columns);
    rails.push(
      build('TP', '+', 'positive', railTopY),
      build('TN', '-', 'negative', railTopY + 1),
      build('BP', '+', 'positive', railBottomY),
      build('BN', '-', 'negative', railBottomY + 1),
    );
  }

  const lastY = hasRails ? railBottomY + 1 : lower.y + 4;
  return {
    id,
    name,
    description,
    columns,
    banks: [upper, lower],
    rails,
    trenches: [trench],
    body: { x: -2, y: -1.6, width: columns + 3, height: lastY + 3.2 },
    labelEvery: 5,
  };
}

/** Mini board: no rails, one bank pair, the classic 170 tie-point module. */
const MINI: BreadboardDefinition = makeStandardBoard({
  id: 'bb-mini',
  name: 'Breadboard (Mini)',
  description: '170 tie points, 17 columns, no power rails.',
  columns: 17,
  rails: 'none',
});

/** Half board: 30 columns with continuous rails - the usual teaching board. */
const HALF: BreadboardDefinition = makeStandardBoard({
  id: 'bb-half',
  name: 'Breadboard (Half)',
  description: '400 tie points, 30 columns, continuous power rails.',
  columns: 30,
  rails: 'continuous',
});

/** Full board: 63 columns with split rails, exactly like the bench article. */
const FULL: BreadboardDefinition = makeStandardBoard({
  id: 'bb-full',
  name: 'Breadboard (Full)',
  description: '830 tie points, 63 columns, power rails split at the middle.',
  columns: 63,
  rails: 'split',
});

/** Double board: two bank pairs and three rail pairs on one body. */
function makeDoubleBoard(): BreadboardDefinition {
  const columns = 63;
  const breakAt = 30;
  const first = bankPair('a', 3, TERMINAL_ROWS_UPPER, TERMINAL_ROWS_LOWER);
  const second = bankPair('b', 19, ['k', 'l', 'm', 'n', 'o'], ['p', 'q', 'r', 's', 't']);
  const rails: RailDefinition[] = [
    splitRail('TP', '+', 'positive', 0, columns, breakAt),
    splitRail('TN', '-', 'negative', 1, columns, breakAt),
    splitRail('MP', '+', 'positive', 16, columns, breakAt),
    splitRail('MN', '-', 'negative', 17, columns, breakAt),
    splitRail('BP', '+', 'positive', 32, columns, breakAt),
    splitRail('BN', '-', 'negative', 33, columns, breakAt),
  ];
  return {
    id: 'bb-double',
    name: 'Breadboard (Double)',
    description: '1660 tie points: two terminal-strip banks and three split rail pairs.',
    columns,
    banks: [first.upper, first.lower, second.upper, second.lower],
    rails,
    trenches: [first.trench, second.trench],
    body: { x: -2, y: -1.6, width: columns + 3, height: 38.2 },
    labelEvery: 5,
  };
}

const DOUBLE = makeDoubleBoard();

export const BREADBOARD_DEFINITIONS: BreadboardDefinition[] = [MINI, HALF, FULL, DOUBLE];

export function getBreadboardDefinition(id: string): BreadboardDefinition | undefined {
  return BREADBOARD_DEFINITIONS.find((b) => b.id === id);
}
