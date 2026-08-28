"use strict";

/* =====================================================================
   EMBERDEEP — game.js
   A grid-based roguelike: procedurally generated levels, BFS pathfinding
   enemies, coins, health/invulnerability, and a localStorage high score.

   Sections in this file:
     1. Constants & canvas setup
     2. Utility helpers
     3. Procedural dungeon generation (rooms + corridors + BFS check)
     4. BFS pathfinding (used both for connectivity checks and enemy AI)
     5. Entity spawning (coins, enemies)
     6. Player state & movement / collision
     7. Enemy class & AI
     8. Score & high score (localStorage)
     9. Fog of war (explored/visible tile tracking)
    10. Rendering (incl. smooth grid-to-grid motion interpolation)
    11. Procedural sound effects (Web Audio API, no audio files)
    12. Game loop
    13. Event handling (keyboard + buttons)
    14. Level / game-over flow
   ===================================================================== */

/* ---------------------------------------------------------------------
   1. CONSTANTS & CANVAS SETUP
   --------------------------------------------------------------------- */
const COLS = 20;             // grid columns
const ROWS = 15;             // grid rows
const TILE = 32;             // pixel size of one grid cell

const WALL = 0;
const FLOOR = 1;

const STARTING_HEALTH = 3;
const INVULNERABILITY_MS = 1200;     // grace period after taking a hit
const LEVEL_TRANSITION_MS = 1400;    // how long the "Level X" banner shows

const VISION_RADIUS = 5.5;           // tiles the player's torch reveals around them
const MOTION_SMOOTHING_RATE = 14;    // higher = grid-to-grid sliding snaps in faster

const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");

/* ---------------------------------------------------------------------
   2. UTILITY HELPERS
   --------------------------------------------------------------------- */
function randInt(min, max) {
  // Inclusive random integer between min and max.
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(array) {
  // Fisher-Yates shuffle, used so enemy wander direction isn't biased.
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function key(x, y) {
  return x + "," + y;
}

function isInBounds(x, y) {
  return x >= 0 && x < COLS && y >= 0 && y < ROWS;
}

function isFloor(grid, x, y) {
  return isInBounds(x, y) && grid[y][x] === FLOOR;
}

function smoothTowards(entity, deltaMs) {
  // Eases an entity's on-screen (display) position toward its logical grid
  // position each frame. Frame-rate independent exponential decay: it never
  // overshoots and settles in about the same amount of real time regardless
  // of how choppy or smooth the frame rate is. Gameplay (collision, AI)
  // always uses entity.x/entity.y directly — only rendering reads
  // displayX/displayY, so this is purely a visual touch-up.
  const t = 1 - Math.exp((-MOTION_SMOOTHING_RATE * deltaMs) / 1000);
  entity.displayX += (entity.x - entity.displayX) * t;
  entity.displayY += (entity.y - entity.displayY) * t;
}

function snapDisplayPosition(entity) {
  // Instantly aligns display position with logical position — used when an
  // entity teleports (level transitions, respawns) so it doesn't visibly
  // slide across the whole map.
  entity.displayX = entity.x;
  entity.displayY = entity.y;
}

/* ---------------------------------------------------------------------
   3. PROCEDURAL DUNGEON GENERATION
   Algorithm: random, non-overlapping rectangular rooms are carved into
   a grid that starts as solid wall. Rooms are then connected in sequence
   with L-shaped corridors, guaranteeing every room is reachable from the
   first one. As a safety net (bugs like "exit unreachable" should never
   happen), a BFS flood-fill from the spawn point verifies every coin,
   enemy, and the exit are actually reachable before the level is used;
   if not, the whole thing is regenerated.
   --------------------------------------------------------------------- */

function createEmptyGrid() {
  const grid = [];
  for (let y = 0; y < ROWS; y++) {
    grid.push(new Array(COLS).fill(WALL));
  }
  return grid;
}

function carveRoom(grid, room) {
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      grid[y][x] = FLOOR;
    }
  }
}

function roomsOverlap(a, b) {
  // Treat rooms as overlapping if they (or a 1-tile buffer around them)
  // intersect, so rooms never end up sharing a wall.
  return (
    a.x - 1 < b.x + b.w &&
    a.x + a.w + 1 > b.x &&
    a.y - 1 < b.y + b.h &&
    a.y + a.h + 1 > b.y
  );
}

function roomCenter(room) {
  return {
    x: Math.floor(room.x + room.w / 2),
    y: Math.floor(room.y + room.h / 2),
  };
}

function carveHTunnel(grid, x1, x2, y) {
  const [from, to] = x1 < x2 ? [x1, x2] : [x2, x1];
  const y2 = Math.min(y + 1, ROWS - 1); // widen the corridor to 2 tiles tall
  for (let x = from; x <= to; x++) {
    grid[y][x] = FLOOR;
    grid[y2][x] = FLOOR;
  }
}

function carveVTunnel(grid, y1, y2, x) {
  const [from, to] = y1 < y2 ? [y1, y2] : [y2, y1];
  const x2 = Math.min(x + 1, COLS - 1); // widen the corridor to 2 tiles wide
  for (let y = from; y <= to; y++) {
    grid[y][x] = FLOOR;
    grid[y][x2] = FLOOR;
  }
}

function generateRooms(targetCount) {
  const rooms = [];
  let attempts = 0;
  while (rooms.length < targetCount && attempts < 300) {
    attempts++;
    const w = randInt(3, 6);
    const h = randInt(3, 5);
    const x = randInt(1, COLS - w - 2);
    const y = randInt(1, ROWS - h - 2);
    const candidate = { x, y, w, h };
    if (rooms.some((r) => roomsOverlap(r, candidate))) continue;
    rooms.push(candidate);
  }
  return rooms;
}

/**
 * Builds one full dungeon level: grid, rooms, spawn point and exit.
 * Retries generation if the exit ever ends up unreachable, and falls
 * back to a guaranteed-safe single open room if generation keeps failing
 * (defends against pathological random layouts).
 */
function generateLevel(levelNumber) {
  const roomTarget = 6 + Math.min(levelNumber, 4); // more rooms in later levels
  const MAX_TRIES = 25;

  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const grid = createEmptyGrid();
    const rooms = generateRooms(roomTarget);
    if (rooms.length < 2) continue; // not enough rooms placed, retry

    rooms.forEach((room) => carveRoom(grid, room));

    // Connect rooms sequentially with L-shaped corridors so the whole
    // dungeon forms one connected path (a simple spanning structure).
    for (let i = 1; i < rooms.length; i++) {
      const a = roomCenter(rooms[i - 1]);
      const b = roomCenter(rooms[i]);
      if (Math.random() < 0.5) {
        carveHTunnel(grid, a.x, b.x, a.y);
        carveVTunnel(grid, a.y, b.y, b.x);
      } else {
        carveVTunnel(grid, a.y, b.y, a.x);
        carveHTunnel(grid, a.x, b.x, b.y);
      }
    }

    const spawn = roomCenter(rooms[0]);
    const distances = bfsDistances(grid, spawn);

    // Pick the exit as the reachable room center that is FARTHEST from
    // spawn, so the player always has to traverse a meaningful path.
    let exitRoom = null;
    let bestDist = -1;
    for (let i = 1; i < rooms.length; i++) {
      const c = roomCenter(rooms[i]);
      const d = distances.get(key(c.x, c.y));
      if (d !== undefined && d > bestDist) {
        bestDist = d;
        exitRoom = rooms[i];
      }
    }

    if (!exitRoom) continue; // no reachable exit room found, retry
    const exit = roomCenter(exitRoom);

    return { grid, rooms, spawn, exit, distances };
  }

  // Fallback: a single guaranteed-open room spanning most of the grid.
  // This can only be reached if random generation fails 25 times in a
  // row, but guarantees the game never gets stuck.
  const grid = createEmptyGrid();
  const fallbackRoom = { x: 1, y: 1, w: COLS - 2, h: ROWS - 2 };
  carveRoom(grid, fallbackRoom);
  const spawn = { x: 2, y: 2 };
  const exit = { x: COLS - 3, y: ROWS - 3 };
  const distances = bfsDistances(grid, spawn);
  return { grid, rooms: [fallbackRoom], spawn, exit, distances };
}

/* ---------------------------------------------------------------------
   4. BFS PATHFINDING
   One BFS implementation serves two purposes in this game:
     - bfsDistances(): flood-fills the whole grid from a point, used to
       (a) verify level connectivity and (b) find good spawn spots for
       coins/enemies at a safe distance from the player.
     - bfsNextStep(): finds the shortest path between two points and
       returns just the next step, used for enemy chase behaviour.
   --------------------------------------------------------------------- */

function bfsDistances(grid, start) {
  const distances = new Map();
  const startKey = key(start.x, start.y);
  distances.set(startKey, 0);
  const queue = [start];
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++];
    const d = distances.get(key(current.x, current.y));
    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ];
    for (const n of neighbors) {
      if (!isFloor(grid, n.x, n.y)) continue;
      const nKey = key(n.x, n.y);
      if (distances.has(nKey)) continue;
      distances.set(nKey, d + 1);
      queue.push(n);
    }
  }
  return distances;
}

function bfsNextStep(grid, start, target) {
  if (start.x === target.x && start.y === target.y) return null;

  const visited = new Set([key(start.x, start.y)]);
  const cameFrom = new Map();
  const queue = [start];
  let head = 0;
  let found = false;

  while (head < queue.length && !found) {
    const current = queue[head++];
    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ];
    for (const n of neighbors) {
      if (!isFloor(grid, n.x, n.y)) continue;
      const nKey = key(n.x, n.y);
      if (visited.has(nKey)) continue;
      visited.add(nKey);
      cameFrom.set(nKey, current);
      if (n.x === target.x && n.y === target.y) {
        found = true;
        break;
      }
      queue.push(n);
    }
  }

  if (!found) return null; // no path exists (shouldn't happen on a
                            // connected level, but AI degrades gracefully)

  // Walk the cameFrom chain back from target to the step right after start.
  let step = { x: target.x, y: target.y };
  let prev = cameFrom.get(key(step.x, step.y));
  while (prev && !(prev.x === start.x && prev.y === start.y)) {
    step = prev;
    prev = cameFrom.get(key(step.x, step.y));
  }
  return step;
}

/* ---------------------------------------------------------------------
   5. ENTITY SPAWNING (coins & enemies)
   --------------------------------------------------------------------- */

function pickRandomFloorCells(distances, exclude, count, minDistance) {
  // Gathers eligible floor cells (as {x,y}) that are at least minDistance
  // steps from spawn and not already taken, then samples `count` of them.
  const candidates = [];
  for (const [posKey, dist] of distances.entries()) {
    if (dist < minDistance) continue;
    if (exclude.has(posKey)) continue;
    const [x, y] = posKey.split(",").map(Number);
    candidates.push({ x, y });
  }
  const shuffled = shuffle(candidates);
  return shuffled.slice(0, count);
}

function spawnCoins(level) {
  const exclude = new Set([key(state.exit.x, state.exit.y), key(state.spawn.x, state.spawn.y)]);
  const coinCount = 6 + level; // more coins to collect on later levels
  const spots = pickRandomFloorCells(state.distances, exclude, coinCount, 1);
  return spots.map((s) => ({ x: s.x, y: s.y }));
}

function spawnEnemies(level) {
  const exclude = new Set([key(state.exit.x, state.exit.y), key(state.spawn.x, state.spawn.y)]);
  state.coins.forEach((c) => exclude.add(key(c.x, c.y)));

  const enemyCount = Math.min(Math.ceil(level / 2) + 1, 9); // scales up more gradually, capped
  const minDistanceFromSpawn = 5; // never spawn an enemy right on top of the player
  const spots = pickRandomFloorCells(state.distances, exclude, enemyCount, minDistanceFromSpawn);
  return spots.map((s) => new Enemy(s.x, s.y, level));
}

/* ---------------------------------------------------------------------
   6. PLAYER STATE, MOVEMENT & COLLISION
   --------------------------------------------------------------------- */

const player = {
  x: 0,
  y: 0,
  displayX: 0, // interpolated position used only for rendering, see smoothTowards()
  displayY: 0,
  health: STARTING_HEALTH,
  invulnerableUntil: 0, // timestamp (ms) until which the player can't take damage
};

function isPlayerInvulnerable(now) {
  return now < player.invulnerableUntil;
}

function tryMovePlayer(dx, dy) {
  if (state.mode !== "playing") return;

  const nx = player.x + dx;
  const ny = player.y + dy;
  if (!isFloor(state.grid, nx, ny)) return; // wall or out of bounds: no-op

  player.x = nx;
  player.y = ny;

  collectCoinIfPresent();
  checkForExit();
}

function collectCoinIfPresent() {
  const idx = state.coins.findIndex((c) => c.x === player.x && c.y === player.y);
  if (idx === -1) return;
  state.coins.splice(idx, 1);
  state.coinsCollected++;
  addScore(10);
  playCoinSound();
}

function checkForExit() {
  if (player.x === state.exit.x && player.y === state.exit.y) {
    beginLevelTransition();
  }
}

function checkEnemyCollisions(now) {
  if (isPlayerInvulnerable(now)) return;
  const hit = state.enemies.some((e) => e.x === player.x && e.y === player.y);
  if (hit) damagePlayer(now);
}

function damagePlayer(now) {
  player.health = Math.max(0, player.health - 1);
  player.invulnerableUntil = now + INVULNERABILITY_MS;
  flashHeartsHudOnHit();
  playHitSound();
  if (player.health <= 0) {
    endGame();
  }
}

/* ---------------------------------------------------------------------
   7. ENEMY CLASS & AI
   Enemies use BFS pathfinding to chase the player once within their
   detection radius; otherwise they wander to a random open neighbour.
   A per-enemy move cooldown (moveInterval) keeps movement turn-based
   and fair rather than enemies snapping instantly onto the player.
   --------------------------------------------------------------------- */

class Enemy {
  constructor(x, y, level) {
    this.x = x;
    this.y = y;
    this.displayX = x; // interpolated position used only for rendering
    this.displayY = y;
    // Enemies get slightly faster on deeper levels, capped so they never
    // become unfairly fast. Speed reduced 30% from the previous tuning
    // (lower moveInterval = faster movement, so we divide by 0.7 to slow down).
    this.moveInterval = ((Math.max(600 - level * 35, 260) * 2) / 1.4) / 0.7;
    this.timeSinceLastMove = randInt(0, this.moveInterval); // desync enemies
    this.detectionRadius = 6;
  }

  update(deltaMs, grid, playerPos, allEnemies) {
    this.timeSinceLastMove += deltaMs;
    if (this.timeSinceLastMove < this.moveInterval) return;
    this.timeSinceLastMove = 0;

    const manhattanDist = Math.abs(this.x - playerPos.x) + Math.abs(this.y - playerPos.y);

    let next = null;
    if (manhattanDist <= this.detectionRadius) {
      next = bfsNextStep(grid, { x: this.x, y: this.y }, playerPos);
    }

    if (!next) {
      // Not chasing (or no path found): wander to a random open neighbour
      // so enemies still feel alive rather than statue-still.
      const directions = shuffle([
        { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
      ]);
      for (const { dx, dy } of directions) {
        const candidate = { x: this.x + dx, y: this.y + dy };
        if (isFloor(grid, candidate.x, candidate.y) && !cellHasOtherEnemy(candidate, allEnemies, this)) {
          next = candidate;
          break;
        }
      }
    }

    if (next && !cellHasOtherEnemy(next, allEnemies, this)) {
      this.x = next.x;
      this.y = next.y;
    }
  }
}

function cellHasOtherEnemy(cell, allEnemies, self) {
  return allEnemies.some((e) => e !== self && e.x === cell.x && e.y === cell.y);
}

/* ---------------------------------------------------------------------
   8. SCORE & HIGH SCORE (localStorage)
   --------------------------------------------------------------------- */

const HIGH_SCORE_KEY = "emberdeep_high_score";

function loadHighScore() {
  const stored = localStorage.getItem(HIGH_SCORE_KEY);
  const parsed = stored ? parseInt(stored, 10) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function saveHighScoreIfNeeded() {
  if (state.score > state.highScore) {
    state.highScore = state.score;
    try {
      localStorage.setItem(HIGH_SCORE_KEY, String(state.highScore));
    } catch (err) {
      // localStorage can throw in private-browsing/storage-full edge cases;
      // fail silently rather than crashing the game.
      console.warn("Could not save high score:", err);
    }
    highScoreValueEl.textContent = state.highScore;
  }
}

function addScore(points) {
  state.score += points;
  scoreValueEl.textContent = state.score;
  saveHighScoreIfNeeded();
}

/* ---------------------------------------------------------------------
   9. FOG OF WAR
   Two sets drive what's drawn each frame:
     - state.visible: tiles within torch range of the player RIGHT NOW
       (recomputed every frame from player.x/y — cheap, since the grid
       is only ~300 cells).
     - state.explored: every tile that has EVER been visible this level,
       so previously-seen rooms and corridors stay dimly remembered
       instead of vanishing the moment the torchlight moves on.
   The torch radius flickers slightly frame to frame, which doubles as
   the game's only "lighting" effect — atmospheric AND functional,
   rather than a separate cosmetic overlay.
   --------------------------------------------------------------------- */

function updateVisibility(now) {
  const flicker = Math.sin(now / 140) * 0.4 + Math.sin(now / 55) * 0.2;
  const radiusSquared = Math.pow(VISION_RADIUS + flicker, 2);

  state.visible = new Set();
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (state.grid[y][x] !== FLOOR) continue;
      const dx = x - player.x;
      const dy = y - player.y;
      if (dx * dx + dy * dy <= radiusSquared) {
        const k = key(x, y);
        state.visible.add(k);
        state.explored.add(k);
      }
    }
  }
}

/* ---------------------------------------------------------------------
   10. RENDERING
   --------------------------------------------------------------------- */

function drawGrid(grid) {
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const px = x * TILE;
      const py = y * TILE;
      const cellKey = key(x, y);

      if (!state.explored.has(cellKey)) {
        // Never-seen tiles stay pitch black — classic fog-of-war.
        ctx.fillStyle = "#040302";
        ctx.fillRect(px, py, TILE, TILE);
        continue;
      }

      if (grid[y][x] === WALL) {
        ctx.fillStyle = "#1a140f";
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = "rgba(255,255,255,0.03)";
        ctx.fillRect(px, py, TILE, 4); // subtle top bevel for a block-like feel
      } else {
        ctx.fillStyle = (x + y) % 2 === 0 ? "#3c2c1f" : "#382a1d";
        ctx.fillRect(px, py, TILE, TILE);
      }

      if (!state.visible.has(cellKey)) {
        // Explored but currently out of torch range: remembered, but dim.
        ctx.fillStyle = "rgba(4,3,2,0.62)";
        ctx.fillRect(px, py, TILE, TILE);
      }
    }
  }
}

function drawExit() {
  const exitKey = key(state.exit.x, state.exit.y);
  if (!state.explored.has(exitKey)) return; // stairwell is hidden until discovered

  const px = state.exit.x * TILE + TILE / 2;
  const py = state.exit.y * TILE + TILE / 2;

  if (state.visible.has(exitKey)) {
    const glow = ctx.createRadialGradient(px, py, 2, px, py, TILE * 0.9);
    glow.addColorStop(0, "rgba(232,145,47,0.55)");
    glow.addColorStop(1, "rgba(232,145,47,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(px - TILE, py - TILE, TILE * 2, TILE * 2);
  }

  ctx.fillStyle = "#1a140f";
  ctx.fillRect(state.exit.x * TILE + 4, state.exit.y * TILE + 4, TILE - 8, TILE - 8);
  ctx.fillStyle = state.visible.has(exitKey) ? "#ffcf7a" : "#8a6a4a";
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("◆", px, py + 1);
}

function drawCoins() {
  ctx.font = "18px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const coin of state.coins) {
    if (!state.explored.has(key(coin.x, coin.y))) continue; // not discovered yet
    const px = coin.x * TILE + TILE / 2;
    const py = coin.y * TILE + TILE / 2;
    ctx.fillStyle = "rgba(244,197,66,0.25)";
    ctx.beginPath();
    ctx.arc(px, py, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f4c542";
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#8a6a12";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function drawEnemies() {
  for (const enemy of state.enemies) {
    if (!state.visible.has(key(enemy.x, enemy.y))) continue; // only shown in the light
    const px = enemy.displayX * TILE + TILE / 2;
    const py = enemy.displayY * TILE + TILE / 2;
    ctx.fillStyle = "#9b4fbf";
    ctx.beginPath();
    ctx.arc(px, py, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e9dcc4";
    ctx.beginPath();
    ctx.arc(px - 4, py - 2, 2, 0, Math.PI * 2);
    ctx.arc(px + 4, py - 2, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPlayer(now) {
  const px = player.displayX * TILE + TILE / 2;
  const py = player.displayY * TILE + TILE / 2;
  const flickering = isPlayerInvulnerable(now) && Math.floor(now / 100) % 2 === 0;

  ctx.fillStyle = flickering ? "rgba(85,216,201,0.4)" : "#55d8c9";
  ctx.beginPath();
  ctx.arc(px, py, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#0b0806";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function render(now) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid(state.grid);
  drawExit();
  drawCoins();
  drawEnemies();
  drawPlayer(now);
}

/* ---------------------------------------------------------------------
   11. PROCEDURAL SOUND EFFECTS
   All sound is synthesized on the fly with the Web Audio API — short
   oscillator "blips" — so the game stays fully self-contained with no
   audio files to load. Browsers block audio until a user gesture, so
   the AudioContext is created lazily on the first keypress or click.
   --------------------------------------------------------------------- */

let audioCtx = null;
let audioEnabled = true;

function ensureAudioContext() {
  if (audioCtx) {
    if (audioCtx.state === "suspended") audioCtx.resume();
    return;
  }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return; // unsupported browser: sound quietly disabled
  try {
    audioCtx = new AudioContextClass();
  } catch (err) {
    console.warn("Web Audio API unavailable:", err);
  }
}

function playTone(freq, durationSec, waveType, volume, delaySec) {
  if (!audioEnabled || !audioCtx) return;
  const oscillator = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  oscillator.type = waveType;
  oscillator.frequency.value = freq;

  const startTime = audioCtx.currentTime + (delaySec || 0);
  gain.gain.setValueAtTime(volume, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + durationSec); // quick fade-out

  oscillator.connect(gain);
  gain.connect(audioCtx.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + durationSec);
}

function playCoinSound() {
  playTone(880, 0.08, "square", 0.15, 0);
  playTone(1320, 0.09, "square", 0.12, 0.05);
}

function playHitSound() {
  playTone(160, 0.25, "sawtooth", 0.22, 0);
}

function playLevelUpSound() {
  [523, 659, 784, 1047].forEach((freq, i) => playTone(freq, 0.14, "triangle", 0.16, i * 0.09));
}

function playGameOverSound() {
  [400, 320, 240, 160].forEach((freq, i) => playTone(freq, 0.3, "sawtooth", 0.18, i * 0.15));
}

/* ---------------------------------------------------------------------
   12. GAME LOOP
   --------------------------------------------------------------------- */

let lastFrameTime = 0;

function gameLoop(timestamp) {
  const deltaMs = lastFrameTime ? timestamp - lastFrameTime : 16;
  lastFrameTime = timestamp;

  if (state.mode === "playing") {
    for (const enemy of state.enemies) {
      enemy.update(deltaMs, state.grid, { x: player.x, y: player.y }, state.enemies);
    }
    checkEnemyCollisions(performance.now());
  }

  updateVisibility(timestamp);
  smoothTowards(player, deltaMs);
  for (const enemy of state.enemies) smoothTowards(enemy, deltaMs);

  render(timestamp);
  requestAnimationFrame(gameLoop);
}

/* ---------------------------------------------------------------------
   13. EVENT HANDLING
   --------------------------------------------------------------------- */

const MOVE_KEYS = new Set(["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"]);

function handleKeyDown(e) {
  ensureAudioContext(); // unlock audio on the player's first interaction
  const k = e.key.toLowerCase();
  if (MOVE_KEYS.has(k)) {
    e.preventDefault(); // stop the page from scrolling on arrow/WASD keys
  }
  if (state.mode !== "playing") return;

  if (k === "arrowup" || k === "w") tryMovePlayer(0, -1);
  else if (k === "arrowdown" || k === "s") tryMovePlayer(0, 1);
  else if (k === "arrowleft" || k === "a") tryMovePlayer(-1, 0);
  else if (k === "arrowright" || k === "d") tryMovePlayer(1, 0);
}

window.addEventListener("keydown", handleKeyDown, { passive: false });

document.getElementById("restart-btn").addEventListener("click", () => {
  ensureAudioContext();
  restartGame();
});
document.getElementById("restart-btn-inline").addEventListener("click", () => {
  ensureAudioContext();
  restartGame();
});

const muteBtnEl = document.getElementById("mute-btn");
muteBtnEl.addEventListener("click", () => {
  ensureAudioContext();
  audioEnabled = !audioEnabled;
  muteBtnEl.textContent = audioEnabled ? "🔊" : "🔇";
  muteBtnEl.setAttribute("aria-label", audioEnabled ? "Mute sound" : "Unmute sound");
});

/* ---------------------------------------------------------------------
   14. LEVEL / GAME-OVER FLOW
   --------------------------------------------------------------------- */

const levelValueEl = document.getElementById("level-value");
const scoreValueEl = document.getElementById("score-value");
const highScoreValueEl = document.getElementById("high-score-value");
const heartsValueEl = document.getElementById("hearts-value");
const heartsStatEl = document.querySelector(".hearts-stat");
const levelBannerEl = document.getElementById("level-banner");
const bannerLevelTextEl = document.getElementById("banner-level-text");
const gameOverEl = document.getElementById("game-over-screen");
const finalScoreEl = document.getElementById("final-score");
const finalLevelEl = document.getElementById("final-level");
const finalHighScoreEl = document.getElementById("final-high-score");

const state = {
  mode: "playing", // "playing" | "transition" | "gameover"
  level: 1,
  score: 0,
  highScore: loadHighScore(),
  coinsCollected: 0,
  grid: null,
  rooms: [],
  spawn: { x: 0, y: 0 },
  exit: { x: 0, y: 0 },
  distances: null,
  coins: [],
  enemies: [],
  levelStartTime: 0,
  explored: new Set(), // every tile ever revealed this level (fog-of-war memory)
  visible: new Set(),  // tiles within torch range right now
};

function updateHeartsDisplay() {
  heartsValueEl.textContent = "❤️".repeat(player.health) + "🖤".repeat(STARTING_HEALTH - player.health);
}

function flashHeartsHudOnHit() {
  updateHeartsDisplay();
  heartsStatEl.classList.remove("hit");
  // Force reflow so the animation can be retriggered on consecutive hits.
  void heartsStatEl.offsetWidth;
  heartsStatEl.classList.add("hit");
}

function loadLevelIntoState(levelNumber) {
  const level = generateLevel(levelNumber);
  state.grid = level.grid;
  state.rooms = level.rooms;
  state.spawn = level.spawn;
  state.exit = level.exit;
  state.distances = level.distances;

  player.x = level.spawn.x;
  player.y = level.spawn.y;
  snapDisplayPosition(player); // avoid a visual slide-in from the old level

  state.coins = spawnCoins(levelNumber);
  state.enemies = spawnEnemies(levelNumber);
  state.enemies.forEach(snapDisplayPosition);
  state.levelStartTime = performance.now();

  // Fresh fog-of-war for the new layout, revealed immediately around spawn
  // so the first rendered frame isn't solid black.
  state.explored = new Set();
  state.visible = new Set();
  updateVisibility(performance.now());
}

function beginLevelTransition() {
  state.mode = "transition";
  playLevelUpSound();

  // Reward finishing quickly, but never subtract points for taking your time.
  const secondsTaken = (performance.now() - state.levelStartTime) / 1000;
  const speedBonus = Math.max(0, Math.round(40 - secondsTaken));
  addScore(100 + speedBonus);

  state.level++;
  levelValueEl.textContent = state.level;
  bannerLevelTextEl.textContent = "Level " + state.level;

  levelBannerEl.classList.remove("hidden");
  // Restart the fade animation each time the banner is shown, by removing
  // and re-adding the class that carries it (rather than relying on an
  // always-on animation, which is what caused it to play on page load).
  levelBannerEl.classList.remove("showing");
  void levelBannerEl.offsetWidth;
  levelBannerEl.classList.add("showing");

  setTimeout(() => {
    loadLevelIntoState(state.level);
    // Give the player a fresh moment of safety right after arriving.
    player.invulnerableUntil = performance.now() + 600;
    levelBannerEl.classList.add("hidden");
    levelBannerEl.classList.remove("showing");
    state.mode = "playing";
  }, LEVEL_TRANSITION_MS);
}

function endGame() {
  state.mode = "gameover";
  playGameOverSound();
  saveHighScoreIfNeeded();
  finalScoreEl.textContent = state.score;
  finalLevelEl.textContent = state.level;
  finalHighScoreEl.textContent = state.highScore;
  gameOverEl.classList.remove("hidden");
}

function restartGame() {
  state.mode = "playing";
  state.level = 1;
  state.score = 0;
  state.coinsCollected = 0;
  player.health = STARTING_HEALTH;
  player.invulnerableUntil = 0;

  levelValueEl.textContent = state.level;
  scoreValueEl.textContent = state.score;
  highScoreValueEl.textContent = state.highScore;
  updateHeartsDisplay();
  gameOverEl.classList.add("hidden");
  levelBannerEl.classList.add("hidden");

  loadLevelIntoState(state.level); // also resets fog-of-war and snaps display positions
}

/* ---------------------------------------------------------------------
   INITIALIZATION
   --------------------------------------------------------------------- */
highScoreValueEl.textContent = state.highScore;
updateHeartsDisplay();
loadLevelIntoState(state.level);
requestAnimationFrame(gameLoop);
