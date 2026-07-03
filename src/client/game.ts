/**
 * Shape Memoize — Devvit Game Client
 *
 * Pure Three.js (no React). Face planes use CanvasTexture — each face is its
 * own PlaneGeometry mesh so raycasting is per-face with no bounding-box overlap.
 *
 * HIGHLIGHT FIX: makeSymbolTexture ALWAYS draws the actual symbol.
 * During playing the TARGET face gets a bright vivid purple background + thick
 * glowing border so the player can visually locate it. Its opacity is pulsed
 * in the animation loop for extra pop. Non-target faces use a dim/subtle style.
 *
 * CLICK FIX: front-face dot-product guard — back-facing planes are silently
 * skipped so overlapping colliders never steal a click event.
 */

import * as THREE from 'three';
import { context } from '@devvit/web/client';
import {
  LEVELS,
  getLevel,
  getRandomSymbols,
  shuffleArray,
} from '../lib/gameLogic';
import { extractFaces } from '../lib/geometryUtils';
import type { ShapeType } from '../lib/gameLogic';
import type {
  LeaderboardEntry,
  LeaderboardResponse,
  SaveScoreResponse,
} from '../shared/api';

// ─────────────────────────────────────────────────────────────────────────────
// Sound Manager (Procedural Web Audio)
// ─────────────────────────────────────────────────────────────────────────────
class SoundManager {
  private ctx: AudioContext | null = null;
  private enabled = true;

  init() {
    if (!this.ctx) {
      const AudioCtx = (window.AudioContext ??
        (window as Window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext)!;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  playTone(freq: number, type: OscillatorType, duration: number, vol = 0.1) {
    if (!this.enabled || !this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

    gain.gain.setValueAtTime(vol, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.01,
      this.ctx.currentTime + duration
    );

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  playClick() {
    this.playTone(600, 'sine', 0.1, 0.05);
  }
  playCorrect() {
    this.playTone(600, 'sine', 0.1, 0.05);
    setTimeout(() => this.playTone(900, 'sine', 0.15, 0.05), 100);
  }
  playWrong() {
    this.playTone(300, 'sawtooth', 0.2, 0.05);
    setTimeout(() => this.playTone(250, 'sawtooth', 0.3, 0.05), 150);
  }
  playLevelComplete() {
    [400, 500, 600, 800].forEach((f, i) =>
      setTimeout(() => this.playTone(f, 'sine', 0.2, 0.05), i * 150)
    );
  }
  playGameOver() {
    [400, 350, 300, 200].forEach((f, i) =>
      setTimeout(() => this.playTone(f, 'sawtooth', 0.4, 0.05), i * 300)
    );
  }
}

const sounds = new SoundManager();
window.addEventListener('pointerdown', () => sounds.init(), { once: true });

// ─────────────────────────────────────────────────────────────────────────────
// DOM References
// ─────────────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('bg') as HTMLCanvasElement;

// Overlays
const overlayMenu = document.getElementById('overlay-menu') as HTMLDivElement;
const overlayLb = document.getElementById('overlay-lb') as HTMLDivElement;
const overlayWon = document.getElementById('overlay-won') as HTMLDivElement;
const overlayLost = document.getElementById('overlay-lost') as HTMLDivElement;

// HUD
const hudEl = document.getElementById('hud') as HTMLDivElement;
const seqRow = document.getElementById('seq-row') as HTMLDivElement;
const hudPhaseLabel = document.getElementById(
  'hud-phase-label'
) as HTMLSpanElement;
const timerLabel = document.getElementById('timer-label') as HTMLSpanElement;
const timerVal = document.getElementById('timer-val') as HTMLSpanElement;
const progressFill = document.getElementById('progress-fill') as HTMLDivElement;
const hudLevel = document.getElementById('hud-level') as HTMLDivElement;
const hudScore = document.getElementById('hud-score') as HTMLDivElement;
const btnSkip = document.getElementById('btn-skip') as HTMLButtonElement;
const memorizeBadge = document.getElementById(
  'memorize-badge'
) as HTMLDivElement;
const feedbackEl = document.getElementById('feedback') as HTMLDivElement;

// Won overlay
const wonScore = document.getElementById('won-score') as HTMLParagraphElement;
const wonBonus = document.getElementById('won-bonus') as HTMLParagraphElement;

// Lost overlay
const lostScore = document.getElementById('lost-score') as HTMLParagraphElement;
const nameInput = document.getElementById('name-input') as HTMLInputElement;
const btnSave = document.getElementById('btn-save') as HTMLButtonElement;
const saveError = document.getElementById('save-error') as HTMLParagraphElement;
const saveSection = document.getElementById('save-section') as HTMLDivElement;

// Leaderboard list (full overlay)
const lbFullList = document.getElementById('lb-full-list') as HTMLOListElement;

// Menu greeting
const menuGreeting = document.getElementById(
  'menu-greeting'
) as HTMLHeadingElement;
menuGreeting.textContent = context.username
  ? `Hi ${context.username} 👋`
  : 'Memory Spin';

// ─────────────────────────────────────────────────────────────────────────────
// Button wiring
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('btn-start')!.addEventListener('click', () => {
  sounds.playClick();
  startGame(true);
});
document.getElementById('btn-view-lb')!.addEventListener('click', () => {
  sounds.playClick();
  showOverlay('lb');
});
document.getElementById('btn-lb-back')!.addEventListener('click', () => {
  sounds.playClick();
  showOverlay('menu');
});
document.getElementById('btn-next')!.addEventListener('click', () => {
  sounds.playClick();
  nextLevel();
});
document.getElementById('btn-retry')!.addEventListener('click', () => {
  sounds.playClick();
  startGame(true);
});
btnSkip.addEventListener('click', () => {
  sounds.playClick();
  enterPlayingState();
});
btnSave.addEventListener('click', () => {
  sounds.playClick();
  void handleSaveScore();
});

// ─────────────────────────────────────────────────────────────────────────────
// Three.js Setup
// ─────────────────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0f1a);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(0, 0, 6);

const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Lights
scene.add(new THREE.AmbientLight(0xffffff, 1.2));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
dirLight.position.set(5, 8, 5);
scene.add(dirLight);
const fillLight = new THREE.DirectionalLight(0x8080ff, 0.6);
fillLight.position.set(-5, -3, -3);
scene.add(fillLight);

// Stars
for (let i = 0; i < 200; i++) {
  const star = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  star.position.set(
    THREE.MathUtils.randFloatSpread(120),
    THREE.MathUtils.randFloatSpread(120),
    THREE.MathUtils.randFloatSpread(120) - 30
  );
  scene.add(star);
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

// ─────────────────────────────────────────────────────────────────────────────
// Game State
// ─────────────────────────────────────────────────────────────────────────────
type GameState = 'menu' | 'memorizing' | 'playing' | 'won' | 'lost';

let gameState: GameState = 'menu';
let currentLevelIdx = 0;
let hearts = 3;
let score = 0;
let timeLeft = 45;
let memorizeTimeLeft = 10;
let timerInterval: ReturnType<typeof setInterval> | null = null;
let activeLayerIdx = 0;
let sequenceProgress = 0;
let targetSequence: string[] = [];
let clearedFaceIds: Set<number> = new Set();
let layerSymbols: string[][] = [];

const shapeGroup = new THREE.Group();
shapeGroup.position.set(0, -0.65, 0); // Lower the shape to prevent UI overlap
scene.add(shapeGroup);

let facePlanes: THREE.Mesh[] = [];

// ─────────────────────────────────────────────────────────────────────────────
// Leaderboard
// ─────────────────────────────────────────────────────────────────────────────
let leaderboard: LeaderboardEntry[] = [];
let hasSavedScore = false;

async function fetchLeaderboard(): Promise<void> {
  try {
    const res = await fetch('/api/leaderboard');
    if (!res.ok) return;
    const data = (await res.json()) as LeaderboardResponse;
    leaderboard = data.entries;
    renderLeaderboard();
  } catch (e) {
    console.error('Leaderboard fetch failed', e);
  }
}

function renderLeaderboard(): void {
  if (leaderboard.length === 0) {
    lbFullList.innerHTML =
      '<li class="lb-empty">No scores yet. Be the first!</li>';
    return;
  }

  lbFullList.innerHTML = leaderboard
    .map((e, i) => {
      const rankClass =
        i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
      const medal =
        i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
      return `
      <li class="lb-item">
        <span class="lb-rank ${rankClass}">${medal}</span>
        <span class="lb-name">${escapeHtml(e.name)}</span>
        <span class="lb-score">${e.score.toLocaleString()}</span>
      </li>`;
    })
    .join('');
}

function escapeHtml(s: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return s.replace(/[&<>"']/g, (c) => map[c] ?? c);
}

async function handleSaveScore(): Promise<void> {
  const name = nameInput.value.trim();

  // Validate input
  if (!name) {
    saveError.style.display = '';
    nameInput.focus();
    return;
  }

  if (hasSavedScore) return;
  hasSavedScore = true;
  btnSave.disabled = true;
  saveError.style.display = 'none';

  try {
    const res = await fetch('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, score }),
    });
    if (res.ok) {
      const data = (await res.json()) as SaveScoreResponse;
      leaderboard = data.entries;
      renderLeaderboard();
    }
  } catch (e) {
    console.error('Save score failed', e);
  }

  // Navigate to leaderboard after saving
  showOverlay('lb');
}

// ─────────────────────────────────────────────────────────────────────────────
// Shape Building — CanvasTexture face planes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Draw a face tile texture on an offscreen canvas.
 *
 * HIGHLIGHT FIX: Always draws the actual symbol — never replaced with ★ or
 * any placeholder. The TARGET face gets:
 *   - Vivid purple filled background
 *   - Thick bright violet border (lineWidth 20)
 *   - Inner glowing ring
 *   - White symbol text
 * Non-target faces are dim/subtle so the target is unmistakably distinct.
 */
function makeSymbolTexture(
  symbol: string,
  cleared: boolean
): THREE.CanvasTexture {
  const size = 256;
  const oc = document.createElement('canvas');
  oc.width = size;
  oc.height = size;
  const ctx = oc.getContext('2d')!;

  const r = 44; // corner radius

  // ── Background ──────────────────────────────────────
  ctx.beginPath();
  ctx.roundRect(10, 10, size - 20, size - 20, r);
  ctx.fillStyle = cleared
    ? 'rgba(52, 211, 153, 0.28)'
    : 'rgba(255, 255, 255, 0.09)';
  ctx.fill();

  // ── Border ──────────────────────────────────────────
  ctx.beginPath();
  ctx.roundRect(10, 10, size - 20, size - 20, r);
  ctx.strokeStyle = cleared
    ? 'rgba(52, 211, 153, 0.9)'
    : 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 9;
  ctx.stroke();

  // ── Symbol text ─────────────────────────────────────
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.floor(size * 0.42)}px -apple-system, Helvetica, sans-serif`;
  ctx.fillStyle = cleared ? '#34d399' : '#ffffff';
  ctx.fillText(symbol, size / 2, size / 2 + 4);

  // ── Thick underline for "6" to distinguish from "9" ──
  // The bar must be large enough to be clearly visible on a small rendered face.
  // lineH = 6% of canvas (~15px in a 256px texture), lineW = 50% of canvas.
  if (symbol === '6') {
    const barH = Math.round(size * 0.06); // ~15px
    const barW = Math.round(size * 0.5); // ~128px (wide!)
    const barY = Math.round(size * 0.73); // below the digit
    const barX = size / 2 - barW / 2;
    ctx.fillStyle = cleared ? '#34d399' : '#ffffff';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, barH / 2);
    ctx.fill();
  }

  return new THREE.CanvasTexture(oc);
}

function buildGeometry(type: ShapeType, radius: number): THREE.BufferGeometry {
  switch (type) {
    case 'tetrahedron':
      return new THREE.TetrahedronGeometry(radius).toNonIndexed();
    case 'cube':
      return new THREE.BoxGeometry(
        radius * 1.6,
        radius * 1.6,
        radius * 1.6
      ).toNonIndexed();
    case 'octahedron':
      return new THREE.OctahedronGeometry(radius).toNonIndexed();
    case 'dodecahedron':
      return new THREE.DodecahedronGeometry(radius).toNonIndexed();
  }
}

type FacePlaneUserData = {
  faceId: number;
  symbol: string;
  faceNormal: THREE.Vector3; // local-space normal
  cleared: boolean;
};

/**
 * Rebuild the entire 3D scene for a given level + active layer.
 * Each face becomes a dedicated PlaneGeometry mesh so raycasting is unambiguous.
 */
function buildShapeScene(levelIdx: number, layerIdx: number): void {
  shapeGroup.clear();
  facePlanes = [];

  const level = getLevel(levelIdx);
  if (!level) return;

  level.layers.forEach((layer, lIdx) => {
    if (lIdx < layerIdx) return; // already cleared layer — remove it

    const isActive = lIdx === layerIdx;
    const scale = 1.35 - lIdx * 0.45;

    const geo = buildGeometry(layer.type, scale);
    const faces = extractFaces(geo, layer.type);

    // Glass main mesh (visual only, not interactive)
    const mat = new THREE.MeshPhysicalMaterial({
      color: isActive ? 0xffffff : 0x8888cc,
      transparent: true,
      opacity: isActive ? 0.55 : 0.18,
      roughness: 0.05,
      metalness: 0.0,
      transmission: isActive ? 0.5 : 0.8,
      thickness: 0.4,
      clearcoat: 1,
      side: THREE.DoubleSide,
    });
    shapeGroup.add(new THREE.Mesh(geo, mat));

    if (!isActive) return;

    const symbols = layerSymbols[lIdx];
    if (!symbols) return;

    faces.forEach((face) => {
      const planeSize = scale * 0.55;
      const planeGeo = new THREE.PlaneGeometry(planeSize, planeSize);
      const isCleared = clearedFaceIds.has(face.id);
      const faceSym = symbols[face.id] ?? '?';
      // Target = this face's symbol is the NEXT one the player must click
      // const isTarget   = !isCleared && faceSym === targetSequence[sequenceProgress];

      const texture = makeSymbolTexture(faceSym, isCleared);
      texture.colorSpace = THREE.SRGBColorSpace;

      const planeMat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      const plane = new THREE.Mesh(planeGeo, planeMat);

      // Position slightly above face surface along its normal
      const offset = face.normal.clone().multiplyScalar(scale * 0.025 + 0.02);
      plane.position.copy(face.centroid.clone().add(offset));

      // Orient the plane along the face normal
      const quat = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        face.normal.clone().normalize()
      );
      plane.setRotationFromQuaternion(quat);

      plane.userData = {
        faceId: face.id,
        symbol: faceSym,
        faceNormal: face.normal.clone().normalize(),
        cleared: isCleared,
      } satisfies FacePlaneUserData;

      shapeGroup.add(plane);
      if (!isCleared) facePlanes.push(plane);
    });
  });
}

/** Refresh textures on existing face planes (called after each correct click or state change). */
function refreshFacePlaneTextures(): void {
  const symbols = layerSymbols[activeLayerIdx];
  if (!symbols) return;

  facePlanes.forEach((plane) => {
    const ud = plane.userData as FacePlaneUserData;
    const isCleared = clearedFaceIds.has(ud.faceId);
    const faceSym = symbols[ud.faceId] ?? '?';
    // const isTarget   = !isCleared && faceSym === targetSequence[sequenceProgress];

    const mat = plane.material as THREE.MeshBasicMaterial;
    const oldTex = mat.map;
    mat.map = makeSymbolTexture(faceSym, isCleared);
    mat.map.colorSpace = THREE.SRGBColorSpace;
    mat.needsUpdate = true;
    if (oldTex) oldTex.dispose();

    if (isCleared) ud.cleared = true;
  });

  facePlanes = facePlanes.filter(
    (p) => !(p.userData as FacePlaneUserData).cleared
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HUD Updates
// ─────────────────────────────────────────────────────────────────────────────

function updateHUDSequence(): void {
  seqRow.innerHTML = '';
  targetSequence.forEach((sym, i) => {
    const cell = document.createElement('div');
    cell.className = 'seq-cell';
    const isCleared = i < sequenceProgress;
    const isCurrent = i === sequenceProgress;

    if (isCleared) {
      cell.classList.add('cleared');
      cell.textContent = sym; // revealed once cleared
    } else if (gameState === 'memorizing') {
      cell.textContent = sym; // show all during memorize
    } else {
      cell.textContent = '?'; // hide ALL unguessed during playing
    }

    if (isCurrent && gameState === 'playing') cell.classList.add('current');
    seqRow.appendChild(cell);
  });
}

function updateHUDHearts(): void {
  for (let i = 1; i <= 3; i++) {
    const el = document.getElementById(`heart-${i}`) as HTMLSpanElement;
    el.classList.toggle('lost', i > hearts);
  }
}

function updateHUDTimer(
  timeValue: number,
  maxValue: number,
  isMemorize: boolean
): void {
  const pct = Math.max(0, (timeValue / maxValue) * 100);
  timerVal.textContent = `${timeValue}s`;
  progressFill.style.width = `${pct}%`;
  progressFill.classList.toggle('memorize', isMemorize);
  progressFill.classList.toggle('urgent', !isMemorize && timeValue < 10);
  timerVal.classList.toggle('urgent', !isMemorize && timeValue < 10);
  timerLabel.textContent = isMemorize ? 'MEMORIZE' : 'TIME REMAINING';
}

function updateHUDInfo(): void {
  const level = getLevel(currentLevelIdx);
  hudLevel.textContent = level ? `Level ${level.id}` : '';
  hudScore.textContent = `Score: ${score}`;
}

function showFeedback(correct: boolean): void {
  feedbackEl.textContent = correct ? '✓' : '✗';
  feedbackEl.style.color = correct ? '#34d399' : '#f87171';
  feedbackEl.classList.remove('show');
  void feedbackEl.offsetWidth;
  feedbackEl.classList.add('show');
}

// ─────────────────────────────────────────────────────────────────────────────
// Overlay Management
// ─────────────────────────────────────────────────────────────────────────────

function showOverlay(which: 'menu' | 'lb' | 'won' | 'lost' | 'none'): void {
  overlayMenu.classList.toggle('active', which === 'menu');
  overlayLb.classList.toggle('active', which === 'lb');
  overlayWon.classList.toggle('active', which === 'won');
  overlayLost.classList.toggle('active', which === 'lost');
  hudEl.style.display = which === 'none' ? '' : 'none';
}

// ─────────────────────────────────────────────────────────────────────────────
// State Machine
// ─────────────────────────────────────────────────────────────────────────────

function clearTimer(): void {
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function startGame(resetScore = true): void {
  if (resetScore) {
    currentLevelIdx = 0;
    score = 0;
    hasSavedScore = false;
  }

  hearts = 3;
  const lvl = getLevel(resetScore ? 0 : currentLevelIdx);
  timeLeft = lvl?.timeLimit ?? 45;
  activeLayerIdx = 0;
  sequenceProgress = 0;
  clearedFaceIds = new Set();

  const level = LEVELS[currentLevelIdx];
  if (!level) return;
  layerSymbols = level.layers.map((l) => getRandomSymbols(l.faces));
  targetSequence = shuffleArray([...(layerSymbols[0] ?? [])]);

  buildShapeScene(currentLevelIdx, activeLayerIdx);
  enterMemorizingState();
}

function enterMemorizingState(): void {
  gameState = 'memorizing';
  memorizeTimeLeft = 10;
  showOverlay('none');
  hudEl.style.display = '';
  hudPhaseLabel.textContent = 'MEMORIZE THE ORDER';
  btnSkip.style.display = '';
  memorizeBadge.style.display = '';

  updateHUDSequence();
  updateHUDHearts();
  updateHUDTimer(memorizeTimeLeft, 10, true);
  updateHUDInfo();
  refreshFacePlaneTextures(); // show all symbols clearly during memorize

  clearTimer();
  timerInterval = setInterval(() => {
    memorizeTimeLeft--;
    updateHUDTimer(memorizeTimeLeft, 10, true);
    if (memorizeTimeLeft <= 0) {
      clearTimer();
      enterPlayingState();
    }
  }, 1000);
}

function enterPlayingState(): void {
  clearTimer();
  gameState = 'playing';
  btnSkip.style.display = 'none';
  memorizeBadge.style.display = 'none';
  hudPhaseLabel.textContent = 'TARGET SEQUENCE';

  updateHUDSequence();
  refreshFacePlaneTextures(); // rebuild textures: target face → vivid highlight

  const level = LEVELS[currentLevelIdx];
  const maxTime = level?.timeLimit ?? 45;
  updateHUDTimer(timeLeft, maxTime, false);

  timerInterval = setInterval(() => {
    timeLeft--;
    updateHUDTimer(timeLeft, maxTime, false);
    if (timeLeft <= 0) {
      clearTimer();
      enterLostState();
    }
  }, 1000);
}

function enterLostState(): void {
  clearTimer();
  gameState = 'lost';
  shapeGroup.clear();
  facePlanes = [];
  sounds.playGameOver();

  // Reset save section
  hasSavedScore = false;
  btnSave.disabled = false;
  nameInput.value = '';
  saveError.style.display = 'none';
  saveSection.style.display = '';

  showOverlay('lost');
  lostScore.textContent = `Score: ${score}`;
}

function enterWonState(): void {
  clearTimer();
  gameState = 'won';
  const level = getLevel(currentLevelIdx);
  const timeBonus = timeLeft * 10;
  score += 100 * (level?.id ?? 1) + timeBonus;

  shapeGroup.clear();
  facePlanes = [];
  sounds.playLevelComplete();
  showOverlay('won');
  wonScore.textContent = `Score: ${score}`;
  wonBonus.textContent = `Time bonus: +${timeBonus} pts`;
}

function nextLevel(): void {
  currentLevelIdx++;
  startGame(false);
}

// ─────────────────────────────────────────────────────────────────────────────
// Click / Input Handling
// ─────────────────────────────────────────────────────────────────────────────

function handleFaceClick(faceId: number, symbol: string): void {
  if (gameState !== 'playing') return;

  const expectedSymbol = targetSequence[sequenceProgress];
  if (symbol === expectedSymbol) {
    sounds.playCorrect();
    showFeedback(true);
    clearedFaceIds.add(faceId);
    sequenceProgress++;

    if (sequenceProgress === targetSequence.length) {
      const level = getLevel(currentLevelIdx);
      if (!level) return;

      if (activeLayerIdx < level.layers.length - 1) {
        // Advance to next inner layer
        clearTimer();
        activeLayerIdx++;
        sequenceProgress = 0;
        clearedFaceIds = new Set();
        const lvl = getLevel(currentLevelIdx);
        timeLeft = lvl.timeLimit ?? 45;

        targetSequence = shuffleArray([
          ...(layerSymbols[activeLayerIdx] ?? []),
        ]);
        buildShapeScene(currentLevelIdx, activeLayerIdx);
        enterMemorizingState();
      } else {
        enterWonState();
      }
    } else {
      refreshFacePlaneTextures();
      updateHUDSequence();
    }
  } else {
    sounds.playWrong();
    showFeedback(false);
    hearts--;
    updateHUDHearts();
    if (hearts <= 0) enterLostState();
  }
}

/**
 * Pointer-down handler with FRONT-FACE CULLING.
 *
 * After finding the first raycaster hit on facePlanes, we transform the face's
 * stored local normal into world space and reject any face whose worldNormal
 * has a negative dot product with the toCamera vector — meaning it is facing
 * away from the camera and its plane bounding box should not be clickable.
 */
function onPointerDown(event: PointerEvent): void {
  if (gameState !== 'playing') return;

  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const intersects = raycaster.intersectObjects(facePlanes, false);

  for (const hit of intersects) {
    const ud = hit.object.userData as FacePlaneUserData;
    if (ud.cleared || clearedFaceIds.has(ud.faceId)) continue;

    // ── Front-face culling ──────────────────────────────────────────────────
    const worldNormal = ud.faceNormal
      .clone()
      .applyQuaternion(shapeGroup.quaternion);
    const toCamera = camera.position
      .clone()
      .sub(shapeGroup.position)
      .normalize();
    if (worldNormal.dot(toCamera) < 0.1) continue; // back-facing — skip
    // ────────────────────────────────────────────────────────────────────────

    handleFaceClick(ud.faceId, ud.symbol);
    break;
  }
}

canvas.addEventListener('pointerdown', onPointerDown);

// ─────────────────────────────────────────────────────────────────────────────
// Orbit / Inertia Drag
// ─────────────────────────────────────────────────────────────────────────────
let isDragging = false;
let prevPointer = { x: 0, y: 0 };
let rotVelocity = { x: 0, y: 0 };

canvas.addEventListener('pointerdown', (e) => {
  isDragging = true;
  prevPointer = { x: e.clientX, y: e.clientY };
  rotVelocity = { x: 0, y: 0 };
});

canvas.addEventListener('pointermove', (e) => {
  if (!isDragging) return;
  const dx = e.clientX - prevPointer.x;
  const dy = e.clientY - prevPointer.y;
  prevPointer = { x: e.clientX, y: e.clientY };
  rotVelocity.x = dy * 0.01;
  rotVelocity.y = dx * 0.01;
});

canvas.addEventListener('pointerup', () => {
  isDragging = false;
});
canvas.addEventListener('pointercancel', () => {
  isDragging = false;
});

// ─────────────────────────────────────────────────────────────────────────────
// Animation Loop
// ─────────────────────────────────────────────────────────────────────────────
const autoRotateSpeed = { x: 0.0008, y: 0.002 };

function animate(): void {
  requestAnimationFrame(animate);

  if (
    shapeGroup.children.length > 0 &&
    (gameState === 'memorizing' || gameState === 'playing')
  ) {
    if (isDragging) {
      shapeGroup.rotation.x += rotVelocity.x;
      shapeGroup.rotation.y += rotVelocity.y;
      rotVelocity.x *= 0.85;
      rotVelocity.y *= 0.85;
    } else {
      rotVelocity.x *= 0.92;
      rotVelocity.y *= 0.92;
      shapeGroup.rotation.x += rotVelocity.x + autoRotateSpeed.x;
      shapeGroup.rotation.y += rotVelocity.y + autoRotateSpeed.y;
    }
  }

  renderer.render(scene, camera);
}

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────
showOverlay('menu');
void fetchLeaderboard();
animate();
