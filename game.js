const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const levelNameEl = document.getElementById('levelName');
const piecesInfoEl = document.getElementById('piecesInfo');
const timerEl = document.getElementById('levelTimer');
const restartBtn = document.getElementById('restartBtn');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const nextBtn = document.getElementById('nextBtn');
const hintBtn = document.getElementById('hintBtn');
const helpBtn = document.getElementById('helpBtn');
const soundToggle = document.getElementById('soundToggle');
const contrastToggle = document.getElementById('contrastToggle');
const motionToggle = document.getElementById('motionToggle');
const congratsOverlay = document.getElementById('congratsOverlay');
const replayLevel5Btn = document.getElementById('replayLevel5');
const restartAllBtn = document.getElementById('restartAll');
const srLive = document.getElementById('srLive');

const PROGRESS_KEY = 'mirror-maze-progress-v1';
const SIM_DT = 1 / 60;
const EPS = 1e-4;
const MAX_RAYS = 256;
const MAX_BOUNCES = 64;
const HINT_IDLE_SECONDS = 120;
const HINT_DURATION = 3;
const VIEWPORT_MIN = { width: 960, height: 540 };

const COLOR_MAP = {
  white: '#f8fdff',
  red: '#ff4d6d',
  blue: '#4dbdff',
  green: '#6dff9c',
  yellow: '#ffe66d',
  any: '#f8fdff'
};

const state = {
  data: null,
  level: null,
  levelIndex: 0,
  pieces: [],
  beamSegments: [],
  targets: [],
  view: { width: VIEWPORT_MIN.width, height: VIEWPORT_MIN.height, dpr: window.devicePixelRatio || 1, scale: 1, offsetX: 0, offsetY: 0 },
  historyPast: [],
  historyFuture: [],
  selectedId: null,
  hoveredId: null,
  dragging: null,
  timer: 0,
  bestTimes: [],
  settings: { sound: false, highContrast: false, reducedMotion: false },
  savedPlacements: {},
  levelCompleted: false,
  idleSeconds: 0,
  lastInteraction: performance.now(),
  hintUnlocked: false,
  activeHint: null,
  srPending: [],
  accumulator: 0,
  audioCtx: null,
  autoAdvanceHandle: null,
  hintIndex: 0
};

let idCounter = 0;

window.addEventListener('DOMContentLoaded', () => {
  bootstrap();
});

async function bootstrap() {
  bindUI();
  await loadLevels();
  loadProgress();
  applySettings();
  handleResize();
  window.addEventListener('resize', handleResize);
  await startLevel(state.levelIndex);
  requestAnimationFrame(gameLoop);
}

function bindUI() {
  restartBtn.addEventListener('click', () => {
    announce('Level restarted');
    startLevel(state.levelIndex, { forceFresh: true });
  });

  undoBtn.addEventListener('click', undoAction);
  redoBtn.addEventListener('click', redoAction);
  nextBtn.addEventListener('click', () => {
    if (!state.levelCompleted) return;
    if (state.levelIndex < state.data.levels.length - 1) {
      startLevel(state.levelIndex + 1);
    } else {
      showCongrats();
    }
  });

  hintBtn.addEventListener('click', () => {
    requestHint('button');
  });

  helpBtn.addEventListener('click', () => {
    requestHint('button');
  });

  soundToggle.addEventListener('click', () => {
    state.settings.sound = !state.settings.sound;
    soundToggle.setAttribute('aria-pressed', String(state.settings.sound));
    soundToggle.textContent = state.settings.sound ? 'Sound On' : 'Sound Off';
    persistProgress();
    if (state.settings.sound) {
      ensureAudio().catch(() => {});
    }
  });

  contrastToggle.addEventListener('click', () => {
    state.settings.highContrast = !state.settings.highContrast;
    contrastToggle.setAttribute('aria-pressed', String(state.settings.highContrast));
    document.body.classList.toggle('high-contrast', state.settings.highContrast);
    persistProgress();
  });

  motionToggle.addEventListener('click', () => {
    state.settings.reducedMotion = !state.settings.reducedMotion;
    motionToggle.setAttribute('aria-pressed', String(state.settings.reducedMotion));
    document.body.classList.toggle('reduced-motion', state.settings.reducedMotion);
    persistProgress();
  });

  replayLevel5Btn.addEventListener('click', () => {
    hideCongrats();
    startLevel(state.data.levels.length - 1, { forceFresh: true });
  });

  restartAllBtn.addEventListener('click', () => {
    hideCongrats();
    startLevel(0, { forceFresh: true });
  });

  congratsOverlay.addEventListener('keydown', trapCongratsFocus);

  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('keyup', handleKeyUp);

  canvas.addEventListener('mousedown', handlePointerDown);
  canvas.addEventListener('mousemove', handlePointerMove);
  canvas.addEventListener('mouseup', handlePointerUp);
  canvas.addEventListener('mouseleave', handlePointerUp);
  canvas.addEventListener('wheel', handleWheel, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

async function loadLevels() {
  const response = await fetch('levels.json');
  state.data = await response.json();
}

function loadProgress() {
  try {
    const stored = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
    state.levelIndex = stored.currentLevelIndex || 0;
    state.bestTimes = stored.bestTimes || [];
    state.settings = Object.assign(state.settings, stored.settings || {});
    state.savedPlacements = stored.placements || {};
  } catch (err) {
    console.warn('Unable to load progress', err);
  }
}

function persistProgress() {
  const payload = {
    currentLevelIndex: state.levelIndex,
    bestTimes: state.bestTimes,
    settings: state.settings,
    placements: state.savedPlacements
  };
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(payload));
}

function applySettings() {
  soundToggle.textContent = state.settings.sound ? 'Sound On' : 'Sound Off';
  soundToggle.setAttribute('aria-pressed', String(state.settings.sound));
  contrastToggle.setAttribute('aria-pressed', String(state.settings.highContrast));
  motionToggle.setAttribute('aria-pressed', String(state.settings.reducedMotion));
  document.body.classList.toggle('high-contrast', state.settings.highContrast);
  document.body.classList.toggle('reduced-motion', state.settings.reducedMotion);
  if (state.settings.sound) {
    ensureAudio().catch(() => {});
  }
}

async function startLevel(index, options = {}) {
  if (!state.data) return;
  if (state.autoAdvanceHandle) {
    clearTimeout(state.autoAdvanceHandle);
    state.autoAdvanceHandle = null;
  }
  state.levelIndex = index;
  state.level = state.data.levels[index];
  state.timer = 0;
  state.levelCompleted = false;
  state.idleSeconds = 0;
  state.hintUnlocked = false;
  state.hintIndex = 0;
  state.activeHint = null;
  hintBtn.classList.add('hidden');
  nextBtn.disabled = true;
  hideCongrats();

  const saved = state.savedPlacements[state.level.id];
  if (saved && !options.forceFresh) {
    state.pieces = revivePieces(saved);
  } else {
    state.pieces = spawnPieces(state.level);
  }

  state.targets = state.level.targets.map((target, idx) => ({
    id: `target-${state.level.id}-${idx}`,
    x: target.x,
    y: target.y,
    color: target.color,
    radius: 40,
    hitTimer: 0,
    isHit: false,
    satisfied: false,
    pinged: false
  }));

  state.historyPast = [];
  state.historyFuture = [];
  state.selectedId = state.pieces[0]?.id ?? null;
  state.beamSegments = [];
  updateHUD();
  savePlacementSnapshot();
  persistProgress();
  registerInteraction();
  announce(`${state.level.name} loaded`);
}

function revivePieces(snapshot) {
  return snapshot.map((piece) => Object.assign({}, piece, {
    id: piece.id || nextId(),
    length: getPieceLength(piece.type)
  }));
}

function spawnPieces(level) {
  const pieces = [];
  let slotY = 150;
  const spawnX = 140;
  const gap = 90;

  const addPiece = (type, count) => {
    for (let i = 0; i < count; i++) {
      pieces.push({
        id: nextId(),
        type,
        x: spawnX,
        y: slotY,
        angle: 0,
        length: getPieceLength(type)
      });
      slotY += gap;
      if (slotY > state.data.bounds.height - 150) {
        slotY = 150;
      }
    }
  };

  addPiece('mirror', level.availablePieces.mirrors || 0);
  addPiece('splitter', level.availablePieces.splitters || 0);
  return pieces;
}

function getPieceLength(type) {
  if (type === 'splitter') return state.data.common.splitter.length;
  return state.data.common.mirror.length;
}

function nextId() {
  idCounter += 1;
  return `piece-${idCounter}`;
}

function updateHUD() {
  if (!state.level) return;
  levelNameEl.textContent = `${state.level.id}. ${state.level.name}`;
  const mirrorCount = state.pieces.filter((p) => p.type === 'mirror').length;
  const splitterCount = state.pieces.filter((p) => p.type === 'splitter').length;
  piecesInfoEl.textContent = `Mirrors: ${mirrorCount}/${state.level.availablePieces.mirrors || 0} | Splitters: ${splitterCount}/${state.level.availablePieces.splitters || 0}`;
}


function handleResize() {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(rect.width, VIEWPORT_MIN.width);
  const height = Math.max(rect.height, VIEWPORT_MIN.height);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const levelWidth = state.data?.bounds.width || 1920;
  const levelHeight = state.data?.bounds.height || 1080;
  const scale = Math.min(width / levelWidth, height / levelHeight);
  const offsetX = (width - levelWidth * scale) / 2;
  const offsetY = (height - levelHeight * scale) / 2;

  state.view = { width, height, dpr, scale, offsetX, offsetY };
}

function gameLoop(now) {
  if (!state.level) {
    requestAnimationFrame(gameLoop);
    return;
  }

  if (!state.lastTimestamp) state.lastTimestamp = now;
  const delta = (now - state.lastTimestamp) / 1000;
  state.lastTimestamp = now;
  state.accumulator += delta;

  while (state.accumulator >= SIM_DT) {
    update(SIM_DT);
    state.accumulator -= SIM_DT;
  }

  render();
  requestAnimationFrame(gameLoop);
}

function update(dt) {
  state.idleSeconds = (performance.now() - state.lastInteraction) / 1000;
  if (state.idleSeconds >= HINT_IDLE_SECONDS && !state.hintUnlocked) {
    unlockHint({ message: 'Hint available', focusButton: true });
  }

  if (!state.levelCompleted) {
    state.timer += dt;
  }

  state.beamSegments = traceBeams();
  updateTargets(dt);
}

function traceBeams() {
  if (!state.level) return [];
  const segments = [];
  const queue = [];
  const sourceDir = toVector(state.level.source.dirDeg);
  queue.push({
    origin: { x: state.level.source.x, y: state.level.source.y },
    dir: sourceDir,
    color: state.data.common.source.beamColor || 'white',
    bounces: 0
  });

  let processed = 0;
  while (queue.length && processed < MAX_RAYS) {
    const ray = queue.shift();
    processed++;
    castRay(ray, segments, queue);
  }

  return segments;
}

function castRay(ray, segments, queue) {
  const { origin, dir, color, bounces } = ray;
  if (bounces > MAX_BOUNCES) return;

  const hit = findNearestHit(origin, dir);
  const endPoint = hit ? hit.point : projectToBounds(origin, dir);
  segments.push({
    from: origin,
    to: endPoint,
    color
  });

  if (!hit) return;

  switch (hit.type) {
    case 'mirror': {
      const reflected = reflect(dir, hit.normal);
      queue.push({ origin: nudgePoint(endPoint, reflected), dir: reflected, color, bounces: bounces + 1 });
      break;
    }
    case 'splitter': {
      const reflected = reflect(dir, hit.normal);
      queue.push({ origin: nudgePoint(endPoint, reflected), dir: reflected, color, bounces: bounces + 1 });
      queue.push({ origin: nudgePoint(endPoint, dir), dir, color, bounces: bounces + 1 });
      break;
    }
    case 'blocker': {
      break;
    }
    case 'filter': {
      const tintColor = hit.filterColor || color;
      queue.push({ origin: nudgePoint(endPoint, dir), dir, color: tintColor, bounces });
      break;
    }
    case 'portal': {
      const exitCenter = hit.exit;
      const radius = state.data.common.portal.radius;
      const tentative = {
        x: exitCenter.x + dir.x * (radius + 1),
        y: exitCenter.y + dir.y * (radius + 1)
      };
      const bounds = state.data.bounds;
      const spawnPoint = {
        x: clamp(tentative.x, bounds.wallThickness, bounds.width - bounds.wallThickness),
        y: clamp(tentative.y, bounds.wallThickness, bounds.height - bounds.wallThickness)
      };
      queue.push({ origin: spawnPoint, dir, color, bounces });
      break;
    }
    case 'wall': {
      // Walls now absorb light; terminate the ray.
      break;
    }
    default:
      break;
  }
}

function findNearestHit(origin, dir) {
  const intersections = [];
  const bounds = state.data.bounds;

  state.pieces.forEach((piece) => {
    const seg = pieceSegment(piece);
    const intercept = intersectRaySegment(origin, dir, seg.a, seg.b);
    if (intercept) {
      intersections.push({ t: intercept.t, point: intercept.point, type: piece.type, normal: seg.normal });
    }
  });

  (state.level.blockers || []).forEach((block) => {
    const intercept = intersectRayRect(origin, dir, block);
    if (intercept) intersections.push({ t: intercept.t, point: intercept.point, type: 'blocker' });
  });

  (state.level.filters || []).forEach((filter) => {
    const intercept = intersectRayRect(origin, dir, {
      x: filter.x - state.data.common.filter.size / 2,
      y: filter.y - state.data.common.filter.size / 2,
      w: state.data.common.filter.size,
      h: state.data.common.filter.size
    });
    if (intercept) intersections.push({ t: intercept.t, point: intercept.point, type: 'filter', filterColor: filter.color });
  });

  (state.level.portals || []).forEach((portal) => {
    ['a', 'b'].forEach((endKey) => {
      const otherKey = endKey === 'a' ? 'b' : 'a';
      const center = portal[endKey];
      const intercept = intersectRayCircle(origin, dir, center, state.data.common.portal.radius);
      if (intercept) intersections.push({ t: intercept.t, point: intercept.point, type: 'portal', exit: portal[otherKey] });
    });
  });

  const playable = {
    x: bounds.wallThickness,
    y: bounds.wallThickness,
    w: bounds.width - bounds.wallThickness * 2,
    h: bounds.height - bounds.wallThickness * 2
  };
  const wallHit = intersectRayRectBoundary(origin, dir, playable);
  if (wallHit) intersections.push({ t: wallHit.t, point: wallHit.point, type: 'wall', normal: wallHit.normal });

  if (!intersections.length) return null;
  intersections.sort((a, b) => a.t - b.t);
  return intersections[0];
}

function projectToBounds(origin, dir) {
  const bounds = state.data.bounds;
  const far = 9999;
  let x = origin.x + dir.x * far;
  let y = origin.y + dir.y * far;
  x = Math.max(0, Math.min(bounds.width, x));
  y = Math.max(0, Math.min(bounds.height, y));
  return { x, y };
}

function updateTargets(dt) {
  const anyColorMatch = (targetColor, beamColor) => targetColor === 'any' || targetColor === beamColor;

  state.targets.forEach((target) => {
    target.isHit = false;
  });

  state.beamSegments.forEach((segment) => {
    state.targets.forEach((target) => {
      if (target.isHit) return;
      if (!anyColorMatch(target.color, segment.color)) return;
      if (segmentHitsCircle(segment.from, segment.to, target)) {
        target.isHit = true;
      }
    });
  });

  state.targets.forEach((target) => {
    if (target.isHit) {
      target.hitTimer = Math.min(1, target.hitTimer + dt);
      if (!target.pinged) {
        playPing();
        target.pinged = true;
      }
    } else {
      target.hitTimer = Math.max(0, target.hitTimer - dt);
      if (target.hitTimer === 0) {
        target.pinged = false;
      }
    }
    target.satisfied = target.hitTimer >= 1 - EPS;
  });

  const allSatisfied = state.targets.length && state.targets.every((t) => t.satisfied);
  if (allSatisfied && !state.levelCompleted) {
    handleLevelComplete();
  }
}

function handleLevelComplete() {
  state.levelCompleted = true;
  nextBtn.disabled = false;
  playChord();
  const existing = state.bestTimes[state.levelIndex];
  if (!existing || state.timer < existing) {
    state.bestTimes[state.levelIndex] = Number(state.timer.toFixed(2));
  }
  state.savedPlacements[state.level.id] = snapshotPieces(state.pieces);
  persistProgress();
  announce('Level complete');
  const isLast = state.levelIndex === state.data.levels.length - 1;
  if (state.autoAdvanceHandle) {
    clearTimeout(state.autoAdvanceHandle);
  }
  if (isLast) {
    state.autoAdvanceHandle = setTimeout(() => {
      showCongrats();
      state.autoAdvanceHandle = null;
    }, 800);
  } else {
    const nextIndex = Math.min(state.levelIndex + 1, state.data.levels.length - 1);
    announce(`Advancing to ${state.data.levels[nextIndex].name}`);
    state.autoAdvanceHandle = setTimeout(() => {
      startLevel(nextIndex);
      state.autoAdvanceHandle = null;
    }, 1400);
  }
}

function updateTimerDisplay() {
  const minutes = Math.floor(state.timer / 60).toString().padStart(2, '0');
  const seconds = Math.floor(state.timer % 60).toString().padStart(2, '0');
  timerEl.textContent = `${minutes}:${seconds}`;
}

function render() {
  updateTimerDisplay();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  applyViewTransform();
  drawBoard();
  drawPieces();
  drawBeams();
  drawTargets();
  drawHintGhost();
}

function applyViewTransform() {
  const { dpr, scale, offsetX, offsetY } = state.view;
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, offsetX * dpr, offsetY * dpr);
}

function drawBoard() {
  const bounds = state.data.bounds;
  ctx.fillStyle = '#030712';
  ctx.fillRect(0, 0, bounds.width, bounds.height);

  ctx.fillStyle = '#0e1529';
  const w = bounds.wallThickness;
  ctx.fillRect(0, 0, bounds.width, w);
  ctx.fillRect(0, bounds.height - w, bounds.width, w);
  ctx.fillRect(0, 0, w, bounds.height);
  ctx.fillRect(bounds.width - w, 0, w, bounds.height);

  (state.level.blockers || []).forEach((block) => {
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(block.x, block.y, block.w, block.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.strokeRect(block.x, block.y, block.w, block.h);
  });

  (state.level.filters || []).forEach((filter) => {
    const size = state.data.common.filter.size;
    const half = size / 2;
    ctx.fillStyle = `${COLOR_MAP[filter.color]}40`;
    ctx.fillRect(filter.x - half, filter.y - half, size, size);
    ctx.strokeStyle = COLOR_MAP[filter.color];
    ctx.strokeRect(filter.x - half, filter.y - half, size, size);
  });

  (state.level.portals || []).forEach((portal) => {
    ['a', 'b'].forEach((key, idx) => {
      const center = portal[key];
      ctx.beginPath();
      ctx.strokeStyle = idx === 0 ? '#75f0ff' : '#ff75f5';
      ctx.lineWidth = 4;
      ctx.arc(center.x, center.y, state.data.common.portal.radius, 0, Math.PI * 2);
      ctx.stroke();
    });
  });

  const source = state.level.source;
  ctx.fillStyle = '#44f3ff';
  ctx.beginPath();
  ctx.arc(source.x, source.y, 18, 0, Math.PI * 2);
  ctx.fill();
}

function drawPieces() {
  state.pieces.forEach((piece) => {
    const seg = pieceSegment(piece);
    ctx.lineWidth = piece.type === 'splitter' ? 8 : 6;
    const selected = piece.id === state.selectedId;
    if (state.settings.highContrast) {
      ctx.strokeStyle = selected ? '#ffffff' : '#cccccc';
    } else {
      ctx.strokeStyle = piece.type === 'splitter' ? '#fffb9c' : '#9ce0ff';
    }
    if (state.hoveredId === piece.id || selected) {
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = state.settings.reducedMotion ? 0 : 12;
    } else {
      ctx.shadowBlur = 0;
    }
    ctx.beginPath();
    ctx.moveTo(seg.a.x, seg.a.y);
    ctx.lineTo(seg.b.x, seg.b.y);
    ctx.stroke();
    ctx.shadowBlur = 0;
  });
}

function drawBeams() {
  ctx.lineCap = 'round';
  state.beamSegments.forEach((segment) => {
    ctx.strokeStyle = COLOR_MAP[segment.color] || COLOR_MAP.white;
    ctx.lineWidth = state.data.common.source.thickness;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = state.settings.reducedMotion ? 0 : 18;
    ctx.beginPath();
    ctx.moveTo(segment.from.x, segment.from.y);
    ctx.lineTo(segment.to.x, segment.to.y);
    ctx.stroke();
  });
  ctx.shadowBlur = 0;
}

function drawTargets() {
  state.targets.forEach((target) => {
    const color = COLOR_MAP[target.color] || COLOR_MAP.white;
    ctx.lineWidth = 4;
    ctx.strokeStyle = color;
    ctx.fillStyle = target.satisfied ? `${color}60` : '#00000055';
    ctx.beginPath();
    ctx.arc(target.x, target.y, target.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (target.isHit) {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(target.x, target.y, target.radius * (0.8 + target.hitTimer * 0.4), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  });
}

function drawHintGhost() {
  if (!state.activeHint) return;
  if (performance.now() > state.activeHint.expires) {
    state.activeHint = null;
    return;
  }
  const { piece, label } = state.activeHint;
  const seg = pieceSegment(piece);
  ctx.strokeStyle = '#ffffff55';
  ctx.lineWidth = 10;
  ctx.setLineDash([16, 12]);
  ctx.beginPath();
  ctx.moveTo(seg.a.x, seg.a.y);
  ctx.lineTo(seg.b.x, seg.b.y);
  ctx.stroke();
  ctx.setLineDash([]);
  if (label) {
    const midX = (seg.a.x + seg.b.x) / 2;
    const midY = (seg.a.y + seg.b.y) / 2;
    ctx.font = '24px Inter, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4 / (state.view.scale || 1);
    ctx.strokeText(label, midX + 12, midY - 12);
    ctx.fillText(label, midX + 12, midY - 12);
  }
}

function handlePointerDown(event) {
  if (event.button === 2) {
    state.dragging = null;
    return;
  }
  if (event.button !== 0) return;
  const world = screenToWorld(event.clientX, event.clientY);
  const piece = findPieceAtPoint(world);
  if (piece) {
    selectPiece(piece.id);
    state.dragging = {
      id: piece.id,
      offsetX: world.x - piece.x,
      offsetY: world.y - piece.y,
      original: snapshotPieces(state.pieces)
    };
    state.historyFuture = [];
  }
  registerInteraction();
}

function handlePointerMove(event) {
  const world = screenToWorld(event.clientX, event.clientY);
  if (state.dragging) {
    const piece = state.pieces.find((p) => p.id === state.dragging.id);
    if (piece) {
      piece.x = world.x - state.dragging.offsetX;
      piece.y = world.y - state.dragging.offsetY;
      clampPiece(piece);
    }
    registerInteraction();
  } else {
    const hover = findPieceAtPoint(world);
    state.hoveredId = hover?.id || null;
  }
}

function handlePointerUp() {
  if (state.dragging) {
    state.historyPast.push(state.dragging.original);
    trimHistory();
    savePlacementSnapshot();
  }
  state.dragging = null;
  state.hoveredId = null;
}

function handleWheel(event) {
  const piece = getSelectedPiece();
  if (!piece) return;
  event.preventDefault();
  recordStateForUndo();
  const delta = event.deltaY < 0 ? 5 : -5;
  rotatePiece(piece, delta, event.shiftKey);
  registerInteraction();
}

function rotatePiece(piece, degrees, snapOverride = false) {
  const snap = snapOverride ? 15 : 0;
  piece.angle += degrees * (Math.PI / 180);
  if (snap) {
    const step = snap * (Math.PI / 180);
    piece.angle = Math.round(piece.angle / step) * step;
  }
  savePlacementSnapshot();
}

function handleKeyDown(event) {
  if (event.key === 'F1' || event.key === 'f1') {
    event.preventDefault();
    requestHint('shortcut');
    return;
  }
  const key = event.key.toLowerCase();
  if (key === 'r') {
    registerInteraction();
    startLevel(state.levelIndex, { forceFresh: true });
    return;
  }
  if (key === 'z') {
    event.preventDefault();
    undoAction();
    return;
  }
  if (key === 'y') {
    event.preventDefault();
    redoAction();
    return;
  }
  if (key === 'n') {
    registerInteraction();
    nextBtn.click();
    return;
  }
  if (key === 'h') {
    requestHint('shortcut');
    return;
  }
  if (key === 'c') {
    registerInteraction();
    contrastToggle.click();
    return;
  }
  if (key === 'm') {
    registerInteraction();
    soundToggle.click();
    return;
  }
  if (key === 'p') {
    registerInteraction();
    motionToggle.click();
    return;
  }

  const piece = getSelectedPiece();
  if (!piece) return;

  if (key === 'q') {
    recordStateForUndo();
    rotatePiece(piece, -5, event.shiftKey);
  } else if (key === 'e' || key === 'd') {
    recordStateForUndo();
    rotatePiece(piece, 5, event.shiftKey);
  } else if (key === 'a') {
    recordStateForUndo();
    rotatePiece(piece, -5, event.shiftKey);
  } else if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
    event.preventDefault();
    recordStateForUndo();
    const step = event.shiftKey ? 10 : 1;
    if (key === 'arrowup') piece.y -= step;
    if (key === 'arrowdown') piece.y += step;
    if (key === 'arrowleft') piece.x -= step;
    if (key === 'arrowright') piece.x += step;
    clampPiece(piece);
    savePlacementSnapshot();
  }
  registerInteraction();
}

function handleKeyUp(event) {
  if (event.key === 'Escape' && !congratsOverlay.classList.contains('hidden')) {
    hideCongrats();
  }
}

function undoAction() {
  if (!state.historyPast.length) return;
  const snapshot = state.historyPast.pop();
  state.historyFuture.push(snapshotPieces(state.pieces));
  restorePieces(snapshot);
  registerInteraction();
}

function redoAction() {
  if (!state.historyFuture.length) return;
  const snapshot = state.historyFuture.pop();
  state.historyPast.push(snapshotPieces(state.pieces));
  restorePieces(snapshot);
  registerInteraction();
}

function restorePieces(snapshot) {
  state.pieces = revivePieces(snapshot);
  savePlacementSnapshot();
}

function trimHistory() {
  const cap = 100;
  if (state.historyPast.length > cap) {
    state.historyPast.shift();
  }
}

function selectPiece(id) {
  state.selectedId = id;
  announce('Piece selected');
}

function getSelectedPiece() {
  return state.pieces.find((piece) => piece.id === state.selectedId);
}

function registerInteraction() {
  state.lastInteraction = performance.now();
}

function findPieceAtPoint(point) {
  const radius = 20;
  for (let i = state.pieces.length - 1; i >= 0; i--) {
    const piece = state.pieces[i];
    const seg = pieceSegment(piece);
    const dist = distanceToSegment(point, seg.a, seg.b);
    if (dist <= radius) return piece;
  }
  return null;
}

function clampPiece(piece) {
  const bounds = state.data.bounds;
  if (!bounds) return;
  const inset = bounds.wallThickness + 8;
  const playable = {
    x: inset,
    y: inset,
    w: bounds.width - inset * 2,
    h: bounds.height - inset * 2
  };
  let attempts = 0;
  while (attempts < 2) {
    attempts += 1;
    const seg = pieceSegment(piece);
    let shiftX = 0;
    let shiftY = 0;
    const minX = Math.min(seg.a.x, seg.b.x);
    const maxX = Math.max(seg.a.x, seg.b.x);
    const minY = Math.min(seg.a.y, seg.b.y);
    const maxY = Math.max(seg.a.y, seg.b.y);

    if (minX < playable.x) shiftX = playable.x - minX;
    else if (maxX > playable.x + playable.w) shiftX = (playable.x + playable.w) - maxX;
    if (minY < playable.y) shiftY = playable.y - minY;
    else if (maxY > playable.y + playable.h) shiftY = (playable.y + playable.h) - maxY;

    if (!shiftX && !shiftY) break;
    piece.x += shiftX;
    piece.y += shiftY;
  }
}

function screenToWorld(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const worldX = (x - state.view.offsetX) / state.view.scale;
  const worldY = (y - state.view.offsetY) / state.view.scale;
  return { x: clamp(worldX, 0, state.data.bounds.width), y: clamp(worldY, 0, state.data.bounds.height) };
}

function pieceSegment(piece) {
  const half = piece.length / 2;
  const dx = Math.cos(piece.angle) * half;
  const dy = Math.sin(piece.angle) * half;
  const ax = piece.x - dx;
  const ay = piece.y - dy;
  const bx = piece.x + dx;
  const by = piece.y + dy;
  const nx = -(by - ay);
  const ny = bx - ax;
  const normal = normalize({ x: nx, y: ny });
  return { a: { x: ax, y: ay }, b: { x: bx, y: by }, normal };
}

function intersectRaySegment(origin, dir, a, b) {
  const r_px = origin.x;
  const r_py = origin.y;
  const r_dx = dir.x;
  const r_dy = dir.y;
  const s_px = a.x;
  const s_py = a.y;
  const s_dx = b.x - a.x;
  const s_dy = b.y - a.y;

  const denom = r_dx * s_dy - r_dy * s_dx;
  if (Math.abs(denom) < EPS) return null;

  const t = ((s_px - r_px) * s_dy - (s_py - r_py) * s_dx) / denom;
  const u = ((s_px - r_px) * r_dy - (s_py - r_py) * r_dx) / denom;

  if (t > EPS && u >= 0 && u <= 1) {
    return {
      t,
      point: {
        x: r_px + r_dx * t,
        y: r_py + r_dy * t
      }
    };
  }
  return null;
}

function intersectRayRect(origin, dir, rect) {
  const invDirX = Math.abs(dir.x) < EPS ? Infinity : 1 / dir.x;
  const invDirY = Math.abs(dir.y) < EPS ? Infinity : 1 / dir.y;

  let tMin = (rect.x - origin.x) * invDirX;
  let tMax = ((rect.x + rect.w) - origin.x) * invDirX;
  if (tMin > tMax) [tMin, tMax] = [tMax, tMin];

  let tyMin = (rect.y - origin.y) * invDirY;
  let tyMax = ((rect.y + rect.h) - origin.y) * invDirY;
  if (tyMin > tyMax) [tyMin, tyMax] = [tyMax, tyMin];

  if (tMin > tyMax || tyMin > tMax) return null;

  const tHit = Math.max(tMin, tyMin);
  if (tHit < EPS || !isFinite(tHit)) return null;
  return {
    t: tHit,
    point: {
      x: origin.x + dir.x * tHit,
      y: origin.y + dir.y * tHit
    }
  };
}

function intersectRayRectBoundary(origin, dir, rect) {
  const walls = [
    { a: { x: rect.x, y: rect.y }, b: { x: rect.x + rect.w, y: rect.y } },
    { a: { x: rect.x + rect.w, y: rect.y }, b: { x: rect.x + rect.w, y: rect.y + rect.h } },
    { a: { x: rect.x + rect.w, y: rect.y + rect.h }, b: { x: rect.x, y: rect.y + rect.h } },
    { a: { x: rect.x, y: rect.y + rect.h }, b: { x: rect.x, y: rect.y } }
  ];
  const normals = [
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
    { x: 1, y: 0 }
  ];
  let closest = null;
  walls.forEach((wall, idx) => {
    const hit = intersectRaySegment(origin, dir, wall.a, wall.b);
    if (hit) {
      if (!closest || hit.t < closest.t) {
        closest = { ...hit, normal: normals[idx] };
      }
    }
  });
  return closest;
}

function intersectRayCircle(origin, dir, center, radius) {
  const oc = { x: origin.x - center.x, y: origin.y - center.y };
  const a = dot(dir, dir);
  const b = 2 * dot(oc, dir);
  const c = dot(oc, oc) - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const sqrtDisc = Math.sqrt(discriminant);
  const t1 = (-b - sqrtDisc) / (2 * a);
  const t2 = (-b + sqrtDisc) / (2 * a);
  let tHit = null;
  if (t1 > EPS) tHit = t1;
  else if (t2 > EPS) tHit = t2;
  if (!tHit) return null;
  return {
    t: tHit,
    point: {
      x: origin.x + dir.x * tHit,
      y: origin.y + dir.y * tHit
    }
  };
}

function segmentHitsCircle(a, b, circle) {
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const abLen = magnitude(ab);
  if (abLen < EPS) return false;
  const dir = { x: ab.x / abLen, y: ab.y / abLen };
  const hit = intersectRayCircle(a, dir, { x: circle.x, y: circle.y }, circle.radius);
  if (!hit) return false;
  return hit.t <= abLen + EPS;
}

function toVector(degrees) {
  const rad = (degrees * Math.PI) / 180;
  return { x: Math.cos(rad), y: Math.sin(rad) };
}

function reflect(dir, normal) {
  const dotVal = dot(dir, normal);
  return normalize({ x: dir.x - 2 * dotVal * normal.x, y: dir.y - 2 * dotVal * normal.y });
}

function nudgePoint(point, dir) {
  return { x: point.x + dir.x * 0.01, y: point.y + dir.y * 0.01 };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function magnitude(vec) {
  return Math.sqrt(vec.x * vec.x + vec.y * vec.y);
}

function normalize(vec) {
  const mag = magnitude(vec);
  if (mag < EPS) return { x: 0, y: 0 };
  return { x: vec.x / mag, y: vec.y / mag };
}

function distanceToSegment(p, a, b) {
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const t = clamp(dot({ x: p.x - a.x, y: p.y - a.y }, ab) / dot(ab, ab), 0, 1);
  const closest = { x: a.x + ab.x * t, y: a.y + ab.y * t };
  return Math.hypot(p.x - closest.x, p.y - closest.y);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function snapshotPieces(pieces) {
  return pieces.map((piece) => ({ id: piece.id, type: piece.type, x: piece.x, y: piece.y, angle: piece.angle }));
}

function recordStateForUndo() {
  state.historyPast.push(snapshotPieces(state.pieces));
  state.historyFuture = [];
  trimHistory();
}

function savePlacementSnapshot() {
  if (!state.level) return;
  state.savedPlacements[state.level.id] = snapshotPieces(state.pieces);
  persistProgress();
}

function unlockHint({ message = 'Hint available', focusButton = false } = {}) {
  if (!state.hintUnlocked) {
    state.hintUnlocked = true;
    hintBtn.classList.remove('hidden');
    if (focusButton) {
      hintBtn.focus();
    }
    if (message) announce(message);
  } else if (message) {
    announce(message);
  }
}

function requestHint(source = 'button') {
  registerInteraction();
  unlockHint({ message: source === 'shortcut' ? 'Hint ready' : null });
  triggerHint();
}

function triggerHint() {
  const hintPieces = state.level.hintPieces || [];
  if (!hintPieces.length) return;
  if (state.hintIndex >= hintPieces.length) {
    state.hintIndex = 0;
  }
  const template = hintPieces[state.hintIndex];
  state.hintIndex += 1;
  const ghost = {
    piece: {
      id: `ghost-${state.hintIndex}`,
      type: template.type,
      x: template.x,
      y: template.y,
      angle: (template.angleDeg * Math.PI) / 180,
      length: getPieceLength(template.type)
    },
    expires: performance.now() + HINT_DURATION * 1000,
    label: template.type === 'splitter' ? 'Split Mirror' : null
  };
  state.activeHint = ghost;
  announce('Hint projected on board');
  return true;
}

function announce(text) {
  srLive.textContent = text;
}

function showCongrats() {
  congratsOverlay.classList.remove('hidden');
  replayLevel5Btn.focus();
}

function hideCongrats() {
  congratsOverlay.classList.add('hidden');
}

function trapCongratsFocus(event) {
  if (event.key !== 'Tab') return;
  if (congratsOverlay.classList.contains('hidden')) return;
  const focusable = Array.from(congratsOverlay.querySelectorAll('button'));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey) {
    if (document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }
  } else if (document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

async function ensureAudio() {
  if (state.audioCtx) return state.audioCtx;
  const ctxAudio = new (window.AudioContext || window.webkitAudioContext)();
  await ctxAudio.resume();
  state.audioCtx = ctxAudio;
  return ctxAudio;
}

function playPing() {
  if (!state.settings.sound) return;
  ensureAudio().then((audioCtx) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.05;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
  });
}

function playChord() {
  if (!state.settings.sound) return;
  ensureAudio().then((audioCtx) => {
    [440, 660, 880].forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = freq;
      gain.gain.value = 0.07;
      osc.connect(gain).connect(audioCtx.destination);
      const start = audioCtx.currentTime + idx * 0.02;
      osc.start(start);
      osc.stop(start + 0.25);
    });
  });
}
