// [file name]: main.js
// [file content begin]
const ROWS = 12;
const COLS = 12;
const DEFAULT_SNAP_THRESHOLD = 22;
const CONNECT_TOLERANCE = 0.4;
const REVEAL_DELAY_SECONDS = 5;
const IMAGE_PATH = 'assets/image.webp';

const board = document.getElementById('board');
const boardWrapper = document.querySelector('.board-wrapper');
const pile = document.getElementById('piecePile');
const workspace = document.querySelector('.workspace');
const finished = document.getElementById('finishedOverlay');
const countdownDisplay = document.getElementById('countdownTimer');
const reshuffleBtn = document.getElementById('reshuffle');

const puzzleImage = new Image();
puzzleImage.src = IMAGE_PATH;

let puzzlePieces = [];
let workspaceRect;
let boardRect;
let pileRect;
let placedPieces = 0;
let zSeed = 5;
let resizeTimer;
let snapDistance = DEFAULT_SNAP_THRESHOLD;
let connectDistance = DEFAULT_SNAP_THRESHOLD * CONNECT_TOLERANCE;

let groups = new Map();
let groupSequence = 0;
let dragState = null;
let revealTimer = null;
let remainingSeconds = REVEAL_DELAY_SECONDS;
let pieceWidthPx = 0;
let pieceHeightPx = 0;

puzzleImage.addEventListener('load', () => {
  requestAnimationFrame(setupPuzzle);
});

reshuffleBtn.addEventListener('click', () => {
  if (puzzleImage.complete) {
    setupPuzzle();
  }
});

window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (puzzleImage.complete) {
      setupPuzzle();
    }
  }, 250);
});

function resetCompletionState() {
  if (revealTimer) {
    clearInterval(revealTimer);
    revealTimer = null;
  }
  remainingSeconds = REVEAL_DELAY_SECONDS;
  updateCountdownDisplay(remainingSeconds);
  finished.classList.remove('show');
  board.classList.remove('completed');
  workspace.classList.remove('puzzle-completed');
}

function updateCountdownDisplay(value) {
  if (!countdownDisplay) return;
  countdownDisplay.textContent = value.toFixed(1);
}

function startRevealCountdown() {
  if (revealTimer) {
    clearInterval(revealTimer);
    revealTimer = null;
  }
  
  // Animate pieces before reveal
  document.querySelectorAll('.puzzle-piece.settled').forEach((piece, index) => {
    setTimeout(() => {
      piece.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
      piece.style.opacity = '0';
      piece.style.transform = 'scale(0.95)';
    }, index * 30);
  });
  
  finished.classList.add('show');
  remainingSeconds = REVEAL_DELAY_SECONDS;
  updateCountdownDisplay(remainingSeconds);
  
  // Smoother countdown with 100ms intervals
  revealTimer = setInterval(() => {
    remainingSeconds -= 0.1;
    updateCountdownDisplay(remainingSeconds);
    if (remainingSeconds <= 0) {
      clearInterval(revealTimer);
      revealTimer = null;
      
      // Add completed class to workspace for layout animation
      workspace.classList.add('puzzle-completed');
      
      // Then show the final image
      setTimeout(() => {
        board.classList.add('completed');
        createConfetti();
        
        setTimeout(() => {
          finished.classList.remove('show');
        }, 1500);
      }, 800);
    }
  }, 100);
}

function createConfetti() {
  const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#6c5ce7', '#fd79a8'];
  const confettiCount = 50;
  
  for (let i = 0; i < confettiCount; i++) {
    const confetti = document.createElement('div');
    confetti.className = 'confetti';
    confetti.style.left = Math.random() * 100 + '%';
    confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
    confetti.style.animationDelay = Math.random() * 0.5 + 's';
    confetti.style.animationDuration = (Math.random() * 2 + 2) + 's';
    finished.appendChild(confetti);
    
    setTimeout(() => confetti.remove(), 4000);
  }
}

function setupPuzzle() {
  workspaceRect = workspace.getBoundingClientRect();
  const wrapperRect = boardWrapper.getBoundingClientRect();
  const workspaceHeight = workspaceRect.height || wrapperRect.height || window.innerHeight;
  const targetSize = Math.min(wrapperRect.width, workspaceHeight);
  const boardSize = Math.max(targetSize, 200);
  board.style.width = `${boardSize}px`;
  board.style.height = `${boardSize}px`;
  boardRect = board.getBoundingClientRect();
  pileRect = pile.getBoundingClientRect();

  pieceWidthPx = boardRect.width / COLS;
  pieceHeightPx = boardRect.height / ROWS;
  resetCompletionState();
  placedPieces = 0;
  dragState = null;
  groups.clear();
  groupSequence = 0;

  document.querySelectorAll('.puzzle-piece').forEach((piece) => piece.remove());

  const pieceWidth = pieceWidthPx;
  const pieceHeight = pieceHeightPx;
  const tabSize = Math.min(pieceWidth, pieceHeight) * 0.45;
  snapDistance = Math.min(pieceWidth, pieceHeight) * 0.28;
  connectDistance = snapDistance * CONNECT_TOLERANCE;

  const blueprints = createPieceMap();
  puzzlePieces = blueprints.map((piece, index) => {
    const { canvas, offset } = renderPieceCanvas(
      piece,
      pieceWidth,
      pieceHeight,
      tabSize,
      { top: false, right: false, bottom: false, left: false } // No connections initially
    );

    const element = document.createElement('div');
    element.className = 'puzzle-piece';
    element.style.width = `${canvas.width}px`;
    element.style.height = `${canvas.height}px`;
    element.style.zIndex = zSeed;
    element.dataset.index = String(index);
    element.appendChild(canvas);
    element.addEventListener('pointerdown', handlePointerDown);

    const correctX = boardRect.left - workspaceRect.left + piece.col * pieceWidth - offset.x;
    const correctY = boardRect.top - workspaceRect.top + piece.row * pieceHeight - offset.y;

    const startX = randomInRange(
      pileRect.left - workspaceRect.left,
      pileRect.left - workspaceRect.left + Math.max(pileRect.width - canvas.width, 10)
    );
    const startY = randomInRange(
      pileRect.top - workspaceRect.top,
      pileRect.top - workspaceRect.top + Math.max(pileRect.height - canvas.height, 10)
    );

    workspace.appendChild(element);

    const record = {
      ...piece,
      element,
      index,
      correctX,
      correctY,
      offset,
      width: canvas.width,
      height: canvas.height,
      placed: false,
      x: startX,
      y: startY,
      dragStartX: null,
      dragStartY: null,
      neighbors: createNeighborMap(piece.row, piece.col),
      group: null,
    };

    positionPiece(record, startX, startY);
    const group = createGroup(record);
    record.group = group;
    return record;
  });
}

function handlePointerDown(event) {
  const target = event.currentTarget;
  const pieceIndex = Number(target.dataset.index);
  if (Number.isNaN(pieceIndex)) {
    return;
  }
  const piece = puzzlePieces[pieceIndex];
  if (!piece || piece.placed || !piece.group || piece.group.placed) {
    return;
  }

  event.preventDefault();
  workspaceRect = workspace.getBoundingClientRect();
  const group = piece.group;
  const origin = getGroupOrigin(group);

  zSeed += 1;
  group.pieces.forEach((member) => {
    member.dragStartX = member.x;
    member.dragStartY = member.y;
    member.element.style.zIndex = zSeed;
  });

  dragState = {
    group,
    pointerId: event.pointerId,
    grabOffset: {
      x: event.clientX - workspaceRect.left - origin.x,
      y: event.clientY - workspaceRect.top - origin.y,
    },
    origin,
    handle: target,
  };

  piece.element.classList.add('dragging');
  piece.element.setPointerCapture(event.pointerId);
  piece.element.addEventListener('pointermove', handlePointerMove);
  piece.element.addEventListener('pointerup', handlePointerUp);
  piece.element.addEventListener('pointercancel', handlePointerUp);
}

function handlePointerMove(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) {
    return;
  }

  const newOriginX =
    event.clientX - workspaceRect.left - dragState.grabOffset.x;
  const newOriginY =
    event.clientY - workspaceRect.top - dragState.grabOffset.y;
  const deltaX = newOriginX - dragState.origin.x;
  const deltaY = newOriginY - dragState.origin.y;

  dragState.group.pieces.forEach((member) => {
    positionPiece(member, member.dragStartX + deltaX, member.dragStartY + deltaY);
  });
}

function handlePointerUp(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) {
    return;
  }

  dragState.handle.classList.remove('dragging');
  dragState.handle.removeEventListener('pointermove', handlePointerMove);
  dragState.handle.removeEventListener('pointerup', handlePointerUp);
  dragState.handle.removeEventListener('pointercancel', handlePointerUp);
  dragState.handle.releasePointerCapture(dragState.pointerId);

  dragState.group.pieces.forEach((member) => {
    member.dragStartX = null;
    member.dragStartY = null;
  });

  let activeGroup = dragState.group;
  activeGroup = checkConnections(activeGroup);
  maybeSnapToBoard(activeGroup);

  dragState = null;
}

function isCloseToTarget(piece) {
  const dx = piece.x - piece.correctX;
  const dy = piece.y - piece.correctY;
  return Math.hypot(dx, dy) < snapDistance;
}

function getGroupOrigin(group) {
  let minX = Infinity;
  let minY = Infinity;
  group.pieces.forEach((piece) => {
    minX = Math.min(minX, piece.x);
    minY = Math.min(minY, piece.y);
  });
  return { x: minX, y: minY };
}

function translateGroup(group, dx, dy) {
  if (!dx && !dy) return;
  group.pieces.forEach((piece) => {
    positionPiece(piece, piece.x + dx, piece.y + dy);
  });
}

function maybeSnapToBoard(group) {
  if (!group || group.placed) return;
  for (const piece of group.pieces) {
    if (piece.placed) continue;
    if (isCloseToTarget(piece)) {
      const deltaX = piece.correctX - piece.x;
      const deltaY = piece.correctY - piece.y;
      translateGroup(group, deltaX, deltaY);
      markGroupPlaced(group);
      return;
    }
  }
}

function updatePieceBorders(piece) {
  // Re-render the piece with borders only on unconnected sides
  const connectedSides = {
    top: false,
    right: false,
    bottom: false,
    left: false
  };
  
  // Check which neighbors are in the same group
  if (piece.group) {
    const groupPieces = new Set(piece.group.pieces);
    if (piece.neighbors.top != null && groupPieces.has(puzzlePieces[piece.neighbors.top])) {
      connectedSides.top = true;
    }
    if (piece.neighbors.right != null && groupPieces.has(puzzlePieces[piece.neighbors.right])) {
      connectedSides.right = true;
    }
    if (piece.neighbors.bottom != null && groupPieces.has(puzzlePieces[piece.neighbors.bottom])) {
      connectedSides.bottom = true;
    }
    if (piece.neighbors.left != null && groupPieces.has(puzzlePieces[piece.neighbors.left])) {
      connectedSides.left = true;
    }
  }
  
  const { canvas, offset } = renderPieceCanvas(
    piece,
    pieceWidthPx,
    pieceHeightPx,
    Math.min(pieceWidthPx, pieceHeightPx) * 0.45,
    connectedSides
  );
  
  // Replace the canvas
  const oldCanvas = piece.element.querySelector('canvas');
  if (oldCanvas) {
    piece.element.removeChild(oldCanvas);
  }
  piece.element.appendChild(canvas);
}

function markGroupPlaced(group) {
  if (!group || group.placed) return;
  group.placed = true;
  group.pieces.forEach((piece) => {
    if (!piece.placed) {
      piece.placed = true;
      placedPieces += 1;
    }
    piece.element.style.zIndex = 1;
    piece.element.removeEventListener('pointerdown', handlePointerDown);
    piece.element.classList.add('settled');
  });

  if (placedPieces === puzzlePieces.length) {
    startRevealCountdown();
  }
}

function checkConnections(group) {
  if (!group || group.placed) return group;

  let merged;
  do {
    merged = false;
    outer: for (const piece of group.pieces) {
      const neighborIndexes = Object.values(piece.neighbors);
      for (const neighborIndex of neighborIndexes) {
        if (neighborIndex == null) continue;
        const neighbor = puzzlePieces[neighborIndex];
        if (
          !neighbor ||
          neighbor.group === group ||
          neighbor.placed ||
          !neighbor.group ||
          neighbor.group.placed
        ) {
          continue;
        }

        const expectedX = piece.x + (neighbor.correctX - piece.correctX);
        const expectedY = piece.y + (neighbor.correctY - piece.correctY);
        const distance = Math.hypot(neighbor.x - expectedX, neighbor.y - expectedY);

        if (distance < connectDistance) {
          revealConnector(piece, neighbor);
          translateGroup(neighbor.group, expectedX - neighbor.x, expectedY - neighbor.y);
          group = mergeGroups(group, neighbor.group);
          merged = true;
          break outer;
        }
      }
    }
  } while (merged);

  // Update borders for all pieces in the group after connections change
  group.pieces.forEach(piece => updatePieceBorders(piece));

  return group;
}

function createGroup(piece) {
  groupSequence += 1;
  const group = {
    id: `group-${groupSequence}`,
    pieces: new Set([piece]),
    placed: false,
  };
  groups.set(group.id, group);
  return group;
}

function revealConnector(piece1, piece2) {
  // This function can be used for visual feedback when pieces connect
  // Currently just a placeholder for future enhancements
}

function mergeGroups(primary, secondary) {
  if (primary === secondary) return primary;
  secondary.pieces.forEach((piece) => {
    primary.pieces.add(piece);
    piece.group = primary;
  });
  groups.delete(secondary.id);
  return primary;
}

function createNeighborMap(row, col) {
  return {
    top: row > 0 ? (row - 1) * COLS + col : null,
    right: col < COLS - 1 ? row * COLS + (col + 1) : null,
    bottom: row < ROWS - 1 ? (row + 1) * COLS + col : null,
    left: col > 0 ? row * COLS + (col - 1) : null,
  };
}

function positionPiece(piece, x, y) {
  piece.x = x;
  piece.y = y;
  piece.element.style.left = `${x}px`;
  piece.element.style.top = `${y}px`;
}

function randomInRange(min, max) {
  if (max <= min) return min;
  return min + Math.random() * (max - min);
}

function createPieceMap() {
  const pieces = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const piece = { row, col, top: 0, right: 0, bottom: 0, left: 0 };

      if (col > 0) {
        piece.left = -pieces[pieces.length - 1].right;
      }
      if (row > 0) {
        piece.top = -pieces[(row - 1) * COLS + col].bottom;
      }

      piece.right = col === COLS - 1 ? 0 : randomConnector();
      piece.bottom = row === ROWS - 1 ? 0 : randomConnector();
      pieces.push(piece);
    }
  }
  return pieces;
}

function randomConnector() {
  return Math.random() > 0.5 ? 1 : -1;
}

function renderPieceCanvas(piece, width, height, tabSize, connectedSides = {}) {
  const margin = tabSize * 1.2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width + margin * 2);
  canvas.height = Math.ceil(height + margin * 2);
  const ctx = canvas.getContext('2d');

  ctx.translate(margin, margin);
  
  // Draw the image with extended source to fill tabs
  ctx.save();
  drawPiecePath(ctx, piece, width, height, tabSize);
  ctx.clip();
  
  // Calculate the scaled margin in image coordinates
  // This is the key: scale the margin relative to the piece size in the original image
  const size = Math.min(width, height);
  const scaledMargin = Math.min(puzzleImage.width / COLS, puzzleImage.height / ROWS) * (margin / size);
  
  // Draw image with extended source coordinates to fill the tab areas
  ctx.drawImage(
    puzzleImage,
    (piece.col * puzzleImage.width / COLS) - scaledMargin,
    (piece.row * puzzleImage.height / ROWS) - scaledMargin,
    (puzzleImage.width / COLS) + (scaledMargin * 2),
    (puzzleImage.height / ROWS) + (scaledMargin * 2),
    -margin,
    -margin,
    width + margin * 2,
    height + margin * 2
  );
  ctx.restore();

  // Draw clean border on unconnected sides
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(100, 100, 100, 0.8)';
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 10;
  
  // Draw borders only on unconnected edges
  drawSelectiveBorders(ctx, piece, width, height, tabSize, connectedSides);
  ctx.restore();

  ctx.translate(-margin, -margin);
  return { canvas, offset: { x: margin, y: margin } };
}

function drawSelectiveBorders(ctx, piece, width, height, tabSize, connectedSides) {
  // Top edge - draw only if not connected
  if (!connectedSides.top) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    drawHorizontalEdge(ctx, 0, piece.top, width, tabSize, true);
    ctx.stroke();
  }
  
  // Right edge
  if (!connectedSides.right) {
    ctx.beginPath();
    ctx.moveTo(width, 0);
    drawVerticalEdge(ctx, width, piece.right, height, tabSize, true);
    ctx.stroke();
  }
  
  // Bottom edge
  if (!connectedSides.bottom) {
    ctx.beginPath();
    ctx.moveTo(width, height);
    drawHorizontalEdge(ctx, height, piece.bottom, width, tabSize, false);
    ctx.stroke();
  }
  
  // Left edge
  if (!connectedSides.left) {
    ctx.beginPath();
    ctx.moveTo(0, height);
    drawVerticalEdge(ctx, 0, piece.left, height, tabSize, false);
    ctx.stroke();
  }
}

function drawPiecePath(ctx, piece, width, height, tabSize) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  drawHorizontalEdge(ctx, 0, piece.top, width, tabSize, true);
  drawVerticalEdge(ctx, width, piece.right, height, tabSize, true);
  drawHorizontalEdge(ctx, height, piece.bottom, width, tabSize, false);
  drawVerticalEdge(ctx, 0, piece.left, height, tabSize, false);
  ctx.closePath();
}

function drawHorizontalEdge(ctx, y, connector, length, tabSize, forward) {
  if (connector === 0) {
    ctx.lineTo(forward ? length : 0, y);
    return;
  }

  const mid = length / 2;
  const tabWidth = length / 3;
  const dir = connector;
  const advance = forward ? 1 : -1;
  const start = forward ? 0 : length;
  const curveHeight = tabSize * dir * (forward ? -1 : 1);

  ctx.lineTo(start + advance * (mid - tabWidth / 2), y);
  ctx.bezierCurveTo(
    start + advance * (mid - tabWidth / 6),
    y + curveHeight,
    start + advance * (mid + tabWidth / 6),
    y + curveHeight,
    start + advance * (mid + tabWidth / 2),
    y
  );
  ctx.lineTo(forward ? length : 0, y);
}

function drawVerticalEdge(ctx, x, connector, length, tabSize, forward) {
  if (connector === 0) {
    ctx.lineTo(x, forward ? length : 0);
    return;
  }

  const mid = length / 2;
  const tabWidth = length / 3;
  const dir = connector;
  const advance = forward ? 1 : -1;
  const start = forward ? 0 : length;
  const curveWidth = tabSize * dir * (forward ? 1 : -1);

  ctx.lineTo(x, start + advance * (mid - tabWidth / 2));
  ctx.bezierCurveTo(
    x + curveWidth,
    start + advance * (mid - tabWidth / 6),
    x + curveWidth,
    start + advance * (mid + tabWidth / 6),
    x,
    start + advance * (mid + tabWidth / 2)
  );
  ctx.lineTo(x, forward ? length : 0);
}
// [file content end]