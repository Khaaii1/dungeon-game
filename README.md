# Emberdeep — Dungeon Crawler

A browser-based, grid-based roguelike built with vanilla HTML, CSS, and JavaScript. Every level is procedurally generated, enemies chase the player using BFS pathfinding, and a fog-of-war system reveals the dungeon as you explore it. No frameworks, no build step, no external assets.

## Overview

Emberdeep is a top-down dungeon crawler where the player explores randomly generated levels, collects coins, and avoids enemies while trying to reach the exit and descend as deep as possible before running out of health. The project was built to demonstrate core computer science and game-development fundamentals — procedural generation, graph search algorithms, collision detection, and real-time rendering — inside a small, self-contained codebase that runs by simply opening a file in a browser.

## Features

- **Procedurally generated dungeons** — rooms and corridors are randomly placed each level, with a connectivity check (and safe fallback) guaranteeing every level is always fully solvable.
- **BFS-driven enemy AI** — enemies path toward the player using breadth-first search once in range, and wander otherwise, with per-enemy move cooldowns so combat feels fair rather than instant.
- **Fog of war** — a flickering torch radius reveals the dungeon in real time; explored terrain is remembered, but enemies only appear when they're actually in the light.
- **Smooth motion interpolation** — grid-based movement is eased frame-by-frame for fluid animation without sacrificing simple, discrete collision logic.
- **Procedural sound effects** — coin pickup, damage, level-up, and game-over sounds are all synthesized live with the Web Audio API (no audio files).
- **Persistent high score** — saved to `localStorage` so it survives page refreshes.
- **Scaling difficulty** — enemy count and level layout complexity increase as the player descends.
- **Polished HUD** — live score, level, health hearts, mute toggle, level-transition banners, and a game-over screen.

## Technologies Used

- **HTML5** — page structure and semantic layout
- **CSS3** — dungeon-themed styling, responsive layout, animations
- **HTML5 Canvas API** — real-time 2D rendering of the grid, entities, and lighting
- **Vanilla JavaScript (ES6+)** — game logic, classes, and state management
- **Web Audio API** — procedurally generated sound effects
- **Web Storage API (`localStorage`)** — persistent high score

No external libraries, frameworks, or build tools are used.

## How to Run Locally

1. Download or clone the project files (`index.html`, `style.css`, `game.js`).
2. Keep all three files in the same folder.
3. Open `index.html` directly in any modern browser (Chrome, Firefox, Edge, or Safari).

That's it — no `npm install`, no server, and no build process required.

**Controls:** Move with `WASD` or the arrow keys. Reach the ◆ stairwell to descend a level.

## What I Learned

Building Emberdeep was an exercise in keeping a project both complete and manageable. Some of the biggest takeaways:

- **Algorithm application beyond theory** — implementing BFS twice, for both level-connectivity validation and enemy pathfinding, showed how the same graph-search concept can solve two very different practical problems in one project.
- **Procedural generation trade-offs** — guaranteeing a solvable dungeon required thinking defensively: retry loops and a fallback layout were necessary because random generation can occasionally fail in ways that are easy to overlook until tested.
- **Separating logic from presentation** — adding smooth motion and fog-of-war reinforced the value of keeping gameplay state (grid position, visibility) independent from rendering state (display position, lighting), which made both systems easier to reason about and test in isolation.
- **Testing without a UI** — since the game logic lives in plain functions and classes, I could stub out the DOM and stress-test dungeon generation and AI behavior hundreds of times in a headless environment, catching edge cases (unreachable exits, entities spawning on walls) before they ever appeared on screen.
- **Working within constraints** — building without any frameworks or external assets forced simpler, more transparent solutions (e.g., synthesizing sound with oscillators instead of loading audio files), which made the whole codebase easier to read and reason about end-to-end.

## License

No license has been specified for this project.
