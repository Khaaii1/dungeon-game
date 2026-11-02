// Headless stress test for Emberdeep: runs game.js in Node with a fake DOM.
const fs = require("fs");
const vm = require("vm");
const path = require("path");

// A stub object that accepts any property access or method call.
function stub() {
  const fn = function () { return stub(); };
  return new Proxy(fn, {
    get: (t, p) => (p === Symbol.toPrimitive ? () => 0 : p in t ? t[p] : stub()),
    set: () => true,
  });
}
const store = {};
const sandbox = {
  console, Math, Map, Set, Date, Number, String, parseInt, Infinity,
  document: stub(), window: stub(),
  localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } },
  requestAnimationFrame: () => 0, performance: { now: () => 0 },
  setTimeout: () => 0, clearTimeout: () => {},
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "game.js"), "utf8"), sandbox);
const { generateLevel, bfsDistances, bfsNextStep, isFloor, key } = sandbox;

const RUNS = 500;
let failures = 0;
function check(cond, msg) { if (!cond) { failures++; console.error("FAIL:", msg); } }

for (let run = 0; run < RUNS; run++) {
  const level = generateLevel(1 + (run % 10));
  const { grid, spawn, exit } = level;
  check(isFloor(grid, spawn.x, spawn.y), `run ${run}: spawn is inside a wall`);
  check(isFloor(grid, exit.x, exit.y), `run ${run}: exit is inside a wall`);
  const dist = bfsDistances(grid, spawn);
  check(dist.has(key(exit.x, exit.y)), `run ${run}: exit unreachable from spawn`);
  // An enemy's next step from the exit must be a floor cell adjacent to it.
  const step = bfsNextStep(grid, exit, spawn);
  check(step && isFloor(grid, step.x, step.y) &&
        Math.abs(step.x - exit.x) + Math.abs(step.y - exit.y) === 1,
        `run ${run}: enemy next step is invalid`);
}
console.log(`${RUNS} levels generated, ${failures} failures`);
process.exit(failures ? 1 : 0);
