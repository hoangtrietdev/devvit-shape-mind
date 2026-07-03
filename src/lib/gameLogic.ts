// ─── Types ───────────────────────────────────────────────────────────────────

export type ShapeType = 'tetrahedron' | 'cube' | 'octahedron' | 'dodecahedron';

export type ShapeLayer = {
  type: ShapeType;
  faces: number; // 4, 6, 8, 12
};

export type Level = {
  id: number;
  layers: ShapeLayer[];
  timeLimit: number;
};

// ─── Level Data ───────────────────────────────────────────────────────────────

export const LEVELS: Level[] = [
  { id: 1, timeLimit: 45, layers: [{ type: 'tetrahedron', faces: 4 }] },
  { id: 2, timeLimit: 45, layers: [{ type: 'cube', faces: 6 }] },
  { id: 3, timeLimit: 45, layers: [{ type: 'octahedron', faces: 8 }] },
  { id: 4, timeLimit: 60, layers: [{ type: 'dodecahedron', faces: 12 }] },
  {
    id: 5,
    timeLimit: 90,
    layers: [
      { type: 'dodecahedron', faces: 12 },
      { type: 'cube', faces: 6 },
    ],
  },
];

export function getLevel(index: number): Level {
  if (index < LEVELS.length) {
    return LEVELS[index] as Level;
  }

  // Infinite procedural levels (index 5 = Level 6)
  // Base time limit for Level 4 (index 3) is 60s
  const baseTimeLimit = 60;
  const timeLimit = Math.floor(baseTimeLimit * Math.pow(1.5, index - 3));

  const shapes: { type: ShapeType; faces: number }[] = [
    { type: 'tetrahedron', faces: 4 },
    { type: 'cube', faces: 6 },
    { type: 'octahedron', faces: 8 },
    { type: 'dodecahedron', faces: 12 },
  ];

  const numLayers = Math.random() > 0.6 ? 3 : 2;
  const layers: ShapeLayer[] = [];
  for (let i = 0; i < numLayers; i++) {
    layers.push(
      shapes[Math.floor(Math.random() * shapes.length)] as ShapeLayer
    );
  }

  return {
    id: index + 1,
    layers,
    timeLimit,
  };
}

// ─── Sequence Generator ───────────────────────────────────────────────────────

type SymbolType = 'letter' | 'number' | 'emoji';

const EMOJIS = [
  '🍎',
  '🐶',
  '🚀',
  '💎',
  '🔥',
  '🎸',
  '🍔',
  '⚽',
  '🌈',
  '🧩',
  '👑',
  '💡',
];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const NUMBERS = '0123456789'.split('');

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}

export function getRandomSymbols(count: number): string[] {
  const types: SymbolType[] = ['letter', 'number', 'emoji'];
  const type = types[Math.floor(Math.random() * types.length)];

  let source: string[];
  if (type === 'emoji') source = shuffle(EMOJIS);
  else if (type === 'letter') source = shuffle(LETTERS);
  else source = shuffle(NUMBERS);

  // Fallback: if count > source length (e.g. 12-face dodecahedron but only 10 digits)
  if (count > source.length) {
    source = shuffle(LETTERS);
  }

  return source.slice(0, count);
}

export function shuffleArray<T>(arr: T[]): T[] {
  return shuffle(arr);
}
