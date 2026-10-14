import {
  BLOCK,
  EXIT_INNER,
  EXIT_OUTER,
  EXIT_WIDTH,
  ISLAND,
  KERB,
  LANE,
  RING,
  SIGN_RING,
  easeInOut,
  ellipsePoint,
  fitGame,
  fitLobbyCamera,
  lerpCamera,
  project,
  ringPoints,
  type Camera,
  type Region,
} from "./camera.ts";
import {
  CAR_COLORS,
  CHEVRONS_SVG,
  DIAMOND_SVG,
  SIGN_SVG,
  TIPSTER_CAR,
  TREE_SVG,
  sideCar,
  topCar,
} from "./art.ts";
import type { IslandView } from "./turn.ts";

/**
 * The pixel roundabout behind every screen. The entry screen and the lobby
 * look at it isometrically; the game looks straight down. When a game starts
 * for players who watched the lobby, the camera swings overhead.
 */

type Card = { number: number; word: string };

export type SceneCar = {
  id: string;
  name: string;
  tipster: boolean;
  you: boolean;
};

/** A pending shared reveal: the car drives from the locked exit to the correct one. */
export type RevealDrive = {
  from: number;
  to: number;
  /** Server time of the reveal, also the drive's identity. */
  revealAtUtc: number;
  durationMs: number;
};

export type GameBoard = {
  cards: Card[];
  phase: string;
  selectedGap: number | null;
  lockedGap: number | null;
  recent: number | null;
  island: IslandView;
  overtime: boolean;
  exitLabels: string[];
  selectGap?: (index: number) => void;
  drive?: RevealDrive | null;
};

type Mode = "entry" | "lobby" | "game";

const LIGHTS_MS = 1300;
const CAMERA_MS = 1800;
const LAP_MS = 40_000;

const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

let mode: Mode = "entry";
let cars: SceneCar[] = [];
let board: GameBoard | null = null;
/** Camera progress from the lobby (0) to the game (1). */
let progress = 0;
let moveStart: number | null = null;
let moveDone: (() => void) | null = null;
let drive: { spec: RevealDrive; start: number } | null = null;
let frameRequested = false;
/** The circle's cards: exits and signs are rebuilt only when these change. */
let structureKey = "";
/** Layout last measured by checkSigns. */
let checkedKey = "";
/** Camera and state the ground was last drawn for. */
let groundKey = "";
let carKey = "";

const $ = (id: string) => document.getElementById(id)!;

/** Forgets the last game: board, reveal drive, camera move and sign fit. */
function resetGame() {
  board = null;
  drive = null;
  moveStart = null;
  moveDone = null;
  structureKey = "";
  checkedKey = "";
  fit = { count: -1, width: -1, compact: false, minHeight: 0, tries: 0 };
  const boardElement = document.getElementById("board");
  if (boardElement) boardElement.style.minHeight = "";
  $("sceneExits").replaceChildren();
  $("sceneSigns").replaceChildren();
}

/** The isometric look at the entry screen or lobby. */
export function showEntry() {
  resetGame();
  mode = "entry";
  progress = 0;
  carKey = "";
  setCars([
    { id: "a", name: "", tipster: false, you: false },
    { id: "b", name: "", tipster: true, you: false },
    { id: "c", name: "", tipster: false, you: false },
  ]);
  update();
}

/** The lobby; also the first view of any new session (pass no players yet). */
export function showLobby(players: SceneCar[]) {
  if (mode !== "lobby") {
    resetGame();
    // The entry's placeholder cars must not count as known players.
    carKey = "";
    cars = [];
  }
  mode = "lobby";
  progress = 0;
  setCars(players);
  update();
}

/**
 * The top-down game board. With `animate` the camera first runs the start
 * sequence (lights, then the swing overhead) and calls `done` when it lands.
 */
export function showGame(
  next: GameBoard,
  options: { animate?: boolean; done?: () => void } = {},
) {
  board = next;
  if (mode !== "game") {
    mode = "game";
    if (options.animate && !reducedMotion()) {
      moveStart = performance.now() + LIGHTS_MS;
      moveDone = options.done ?? null;
    } else {
      progress = 1;
      options.done?.();
    }
  }
  if (next.drive && drive?.spec.revealAtUtc !== next.drive.revealAtUtc)
    drive =
      reducedMotion() || next.drive.durationMs < 300
        ? null
        : { spec: next.drive, start: performance.now() };
  if (!next.drive) drive = null;
  update();
}

/**
 * Draws now, so the board is current even where animation frames are paused
 * (background tabs), and once more on the next frame, after the page's layout
 * has settled (the panel's height decides the phone board's size).
 */
function update() {
  draw(performance.now());
  request();
}

/** Redraws on the next frame; loops while something moves. */
function request() {
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame((now) => {
    frameRequested = false;
    draw(now);
  });
}

if (typeof window !== "undefined") {
  addEventListener("resize", () => request());
  // The scene is fixed while the page (or the lobby overlay) scrolls; the
  // ring follows its placeholder. Capture catches scrolling inside overlays.
  document.addEventListener("scroll", () => request(), {
    capture: true,
    passive: true,
  });
  // Phones get the tall oval, compact signs, and the island's text in the panel.
  const narrow = matchMedia("(max-width: 760px)");
  const apply = () => {
    document.body.classList.toggle("narrow", narrow.matches);
    request();
  };
  narrow.addEventListener("change", apply);
  apply();
}

function regionOf(selector: string): Region | null {
  const element = document.querySelector(selector);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

const viewport = (): Region => ({
  left: 0,
  top: 0,
  width: innerWidth,
  height: innerHeight,
});

/**
 * How the signs fit: compact once full-size ones would collide, and extra
 * board height (the page scrolls) once even compact ones would. Starts over
 * when the number of cards or the board's width changes.
 */
let fit = { count: -1, width: -1, compact: false, minHeight: 0, tries: 0 };

function cameras(): { lobby: Camera; game: Camera } {
  const lobbyRegion = regionOf(".scene-spot") ?? viewport();
  // Entry and lobby never look at the game board: no fitting needed there.
  if (mode !== "game") {
    const lobby = fitLobbyCamera(lobbyRegion);
    return { lobby, game: lobby };
  }
  const boardElement = document.getElementById("board");
  const gameRegion = regionOf("#board") ?? viewport();
  const count = board?.cards.length ?? 3;
  const width = Math.round(gameRegion.width);
  if (fit.count !== count || fit.width !== width) {
    fit = { count, width, compact: false, minHeight: 0, tries: 0 };
    if (boardElement) boardElement.style.minHeight = "";
  }
  const result = fitGame(gameRegion, count, fit.compact);
  fit.compact = result.compact;
  if (
    result.minHeight > gameRegion.height + 1 &&
    result.minHeight > fit.minHeight
  )
    fit.minHeight = result.minHeight;
  if (boardElement && fit.minHeight)
    boardElement.style.minHeight = `${fit.minHeight}px`;
  return { lobby: fitLobbyCamera(lobbyRegion), game: result.camera };
}

/** Measures the drawn signs; any collision steps up to compact, then height. */
function checkSigns() {
  const signs = Array.from($("sceneSigns").children).map((el) =>
    el.getBoundingClientRect(),
  );
  const n = signs.length;
  let collisions = 0;
  for (let i = 0; i < n && n > 1; i++)
    for (const step of [1, 2]) {
      if (step >= n) continue;
      const a = signs[i]!;
      const b = signs[(i + step) % n]!;
      if (
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0 &&
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0
      )
        collisions++;
    }
  if (!collisions || fit.tries > 40) return;
  fit.tries++;
  if (!fit.compact) fit.compact = true;
  else {
    const height = regionOf("#board")?.height ?? innerHeight;
    fit.minHeight = Math.max(fit.minHeight, height) + 40;
  }
  checkedKey = "";
  request();
}

function draw(now: number) {
  let moving = false;
  if (moveStart !== null) {
    progress = Math.min(1, Math.max(0, (now - moveStart) / CAMERA_MS));
    if (progress >= 1) {
      moveStart = null;
      const done = moveDone;
      moveDone = null;
      done?.();
    } else moving = true;
  }
  const e = easeInOut(progress);
  const { lobby, game } = cameras();
  const camera = lerpCamera(lobby, game, e);
  drawGround(camera, e);
  const carsMove = drawCars(camera, e, now);
  const driving = drawGame(camera, e, now);
  if (moving || carsMove || driving) request();
}

const points = (list: [number, number][]) =>
  list.map(([x, y]) => `${Math.round(x)},${Math.round(y)}`).join(" ");

function ellipse(camera: Camera, a: number, b: number, steps = 120) {
  const list: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const p = ellipsePoint(a, b, (i / steps) * 2 * Math.PI);
    list.push(project(camera, p.x, p.y));
  }
  return list;
}

function drawGround(camera: Camera, e: number) {
  // Rebuilt only when the camera or what lies on the ground changes, not on
  // every frame of the lobby's circling cars.
  const key = JSON.stringify([
    Object.values(camera).map((v) => Math.round(v * 100)),
    Math.round(e * 1000),
    mode,
    board?.overtime ?? false,
    board?.island.kind ?? "",
    document.body.classList.contains("narrow"),
    innerWidth,
    innerHeight,
  ]);
  if (key === groundKey) return;
  groundKey = key;
  const b = (radius: number) => radius + RING * (camera.stretch - 1);
  // Overhead the field fills the screen and the block's sides fold away.
  const half = BLOCK + 2600 * e * e;
  const halfY = half * camera.stretch;
  const corners = (
    [
      [-half, -halfY],
      [half, -halfY],
      [half, halfY],
      [-half, halfY],
    ] as [number, number][]
  ).map(([x, y]) => project(camera, x, y));
  const depth = 60 * camera.s * (1 - e);
  const lowest = corners.reduce(
    (best, p, i) => (p[1] > corners[best]![1] ? i : best),
    0,
  );
  let svg = "";
  if (depth > 0.5) {
    const side = (i: number, j: number, fill: string) => {
      const p = corners[i]!;
      const q = corners[j]!;
      svg += `<polygon points="${points([p, q, [q[0], q[1] + depth], [p[0], p[1] + depth]])}" fill="${fill}"/>`;
    };
    side(lowest, (lowest + 3) % 4, "#8A5A3C");
    side(lowest, (lowest + 1) % 4, "#6B4430");
  }
  svg += `<polygon class="field" points="${points(corners)}"/>`;
  // Side roads belong to the lobby; they fade out on the way to the game.
  if (e < 1) {
    const roads = [
      [-22, -BLOCK, 44, BLOCK],
      [-22, 0, 44, BLOCK],
      [-BLOCK, -22, BLOCK, 44],
      [0, -22, BLOCK, 44],
    ]
      .map(([x, y, w, h]) =>
        points(
          (
            [
              [x!, y!],
              [x! + w!, y!],
              [x! + w!, y! + h!],
              [x!, y! + h!],
            ] as [number, number][]
          ).map(([gx, gy]) => project(camera, gx, gy)),
        ),
      )
      .map((p) => `<polygon class="asphalt" points="${p}"/>`)
      .join("");
    svg += `<g opacity="${(1 - e).toFixed(2)}">${roads}</g>`;
  }
  svg += `<polygon class="asphalt" points="${points(ellipse(camera, RING, b(RING)))}"/>`;
  if (board?.overtime && mode === "game")
    svg += `<polygon class="hazard" points="${points(ellipse(camera, RING + 5, b(RING + 5)))}"/>`;
  svg += `<polygon class="lane-marking" points="${points(ellipse(camera, LANE, b(LANE)))}"/>`;
  svg += `<polygon class="kerb-white" points="${points(ellipse(camera, KERB, b(KERB)))}"/>`;
  svg += `<polygon class="kerb-red" points="${points(ellipse(camera, KERB, b(KERB)))}"/>`;
  svg += `<polygon class="island-grass" points="${points(ellipse(camera, ISLAND, b(ISLAND)))}"/>`;
  if (e < 1) {
    // "ROUND ABOUT" painted around the island, along its projected outline.
    const path = ellipse(camera, ISLAND - 40, b(ISLAND - 40), 90);
    const d = `M ${path.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L ")} Z`;
    const size = Math.max(10, Math.round(30 * camera.s));
    svg += `<defs><path id="islandText" d="${d}"/></defs><g opacity="${(1 - e).toFixed(2)}" class="painted" style="font-size:${size}px"><text><textPath href="#islandText" startOffset="2%">ROUND ABOUT</textPath></text><text><textPath href="#islandText" startOffset="52%">ROUND ABOUT</textPath></text></g>`;
  }
  const ground = $("sceneGround");
  ground.setAttribute("viewBox", `0 0 ${innerWidth} ${innerHeight}`);
  ground.innerHTML = svg;

  // Upright things on the ground: corner trees and the island's sign.
  const trees = $("sceneTrees");
  if (!trees.childElementCount)
    for (let i = 0; i < 3; i++) {
      const tree = document.createElement("div");
      tree.className = "tree";
      tree.innerHTML = TREE_SVG;
      trees.append(tree);
    }
  const treeSpots: [number, number][] = [
    [-BLOCK + 50, BLOCK - 60],
    [BLOCK - 60, -BLOCK + 50],
    [BLOCK - 70, BLOCK - 50],
  ];
  Array.from(trees.children).forEach((tree, i) => {
    const [x, y] = project(camera, treeSpots[i]![0], treeSpots[i]![1]);
    const el = tree as HTMLElement;
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%) scale(${Math.max(0.6, camera.s * 1.2)})`;
    el.style.opacity = String(1 - e);
  });
  const logo = $("sceneLogo");
  if (!logo.innerHTML) logo.innerHTML = SIGN_SVG;
  const [lx, ly] = project(camera, 0, 0);
  const narrowGame =
    mode === "game" && document.body.classList.contains("narrow");
  // Isometric: the sign stands on the island. Top-down: it shows when the
  // island has nothing else to say, and always on phones (text goes to the panel).
  logo.hidden = !(e < 0.5 || narrowGame || board?.island.kind === "logo");
  const logoSize = Math.max(34, 90 * camera.s);
  logo.style.width = logo.style.height = `${logoSize}px`;
  logo.style.transform = `translate(${lx}px, ${ly}px) translate(-50%, ${e < 0.5 ? -80 : -50}%)`;
}

function setCars(next: SceneCar[]) {
  const key = next
    .map((c) => `${c.id}:${c.name}:${c.tipster}:${c.you}`)
    .join("|");
  if (key === carKey) return;
  const layer = $("sceneCars");
  const known = new Set(cars.map((c) => c.id));
  const first = carKey === "";
  carKey = key;
  cars = next;
  layer.replaceChildren(
    ...next.map((car, index) => {
      const el = document.createElement("div");
      el.className = `scene-car ${!first && !known.has(car.id) ? "arriving" : ""}`;
      el.dataset.id = car.id;
      const body = document.createElement("div");
      body.className = "car-body";
      body.innerHTML = sideCar(
        car.tipster ? TIPSTER_CAR : CAR_COLORS[index % CAR_COLORS.length]!,
        car.tipster,
      );
      el.append(body);
      if (car.name) {
        const tag = document.createElement("span");
        tag.className = `name-tag ${car.you ? "you" : ""} ${car.tipster ? "tipster" : ""}`;
        tag.textContent = car.tipster ? `${car.name} (Tipster)` : car.name;
        el.append(tag);
      }
      return el;
    }),
  );
}

/** Lobby cars circle the lane; they fade out while the camera moves overhead. */
function drawCars(camera: Camera, e: number, now: number): boolean {
  const layer = $("sceneCars");
  layer.hidden = e >= 1;
  if (e >= 1) return false;
  const still = reducedMotion();
  const turn = still ? 0 : (now % LAP_MS) / LAP_MS;
  const count = Math.max(cars.length, 1);
  Array.from(layer.children).forEach((child, i) => {
    const el = child as HTMLElement;
    // Counter-clockwise: the parameter decreases over time.
    const t = ((i / count + 0.07 - turn) % 1) * 2 * Math.PI;
    const p = ellipsePoint(LANE, LANE + RING * (camera.stretch - 1), t);
    const ahead = ellipsePoint(
      LANE,
      LANE + RING * (camera.stretch - 1),
      t - 0.05,
    );
    const [x, y] = project(camera, p.x, p.y);
    const [ax] = project(camera, ahead.x, ahead.y);
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    el.style.zIndex = String(Math.round(y));
    el.style.opacity = String(1 - e);
    (el.firstElementChild as HTMLElement).classList.toggle("left", ax < x);
  });
  return !still;
}

function rotationOf(nx: number, ny: number) {
  return (Math.atan2(nx, -ny) * 180) / Math.PI;
}

/** Signs, exits, island and the reveal drive; they appear as the camera lands. */
function drawGame(camera: Camera, e: number, now: number): boolean {
  const layer = $("sceneBoard");
  const visible = mode === "game" && board !== null && e > 0.6;
  layer.hidden = !visible;
  if (!visible || !board) return false;
  layer.style.opacity = String(Math.min(1, (e - 0.6) / 0.3));
  const narrow = document.body.classList.contains("narrow");
  const count = board.cards.length;
  const b = (radius: number) => radius + RING * (camera.stretch - 1);
  const exitLayer = $("sceneExits");
  const signLayer = $("sceneSigns");
  // Exits and signs are built once per circle and then updated in place, so
  // keyboard focus and a click in progress survive other players' updates.
  const structure = JSON.stringify(board.cards);
  if (structure !== structureKey) {
    structureKey = structure;
    exitLayer.replaceChildren(
      ...board.cards.map((_, index) => {
        const exit = document.createElement("button");
        exit.type = "button";
        exit.innerHTML = CHEVRONS_SVG;
        // Reads the current board at click time, never a stale snapshot.
        exit.addEventListener("click", () => board?.selectGap?.(index));
        return exit;
      }),
    );
    signLayer.replaceChildren(
      ...board.cards.map((card) => {
        const sign = document.createElement("div");
        sign.lang = "en";
        const number = document.createElement("span");
        number.className = "sign-number";
        number.textContent = card.number === 0 ? "0/100" : String(card.number);
        const word = document.createElement("span");
        word.className = "sign-word";
        word.textContent = card.word;
        sign.append(number, word);
        return sign;
      }),
    );
  }
  const middle = (EXIT_INNER + EXIT_OUTER) / 2 - RING;
  const exits = ringPoints(RING, b(RING), count, 0.5);
  Array.from(exitLayer.children).forEach((child, index) => {
    const exit = child as HTMLButtonElement;
    const p = exits[index]!;
    const [x, y] = project(camera, p.x + p.nx * middle, p.y + p.ny * middle);
    const selected = board!.selectedGap === index;
    const locked = board!.lockedGap === index;
    exit.className = `exit ${selected ? "selected" : ""} ${locked ? "locked" : ""}`;
    exit.setAttribute(
      "aria-label",
      `${board!.exitLabels[index] ?? "Exit"}${locked ? ", locked in" : selected ? ", suggested" : ""}`,
    );
    exit.disabled = !board!.selectGap || board!.phase !== "guess";
    exit.style.width = `${Math.max(16, EXIT_WIDTH * camera.s)}px`;
    exit.style.height = `${Math.max(22, (EXIT_OUTER - EXIT_INNER) * camera.s)}px`;
    exit.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${rotationOf(p.nx, p.ny)}deg)`;
  });
  const signs = ringPoints(SIGN_RING, b(SIGN_RING), count, 0);
  Array.from(signLayer.children).forEach((child, index) => {
    const sign = child as HTMLElement;
    const card = board!.cards[index]!;
    const p = signs[index]!;
    const [x, y] = project(camera, p.x, p.y);
    sign.className = `sign ${card.number === 0 ? "is-anchor" : ""} ${board!.recent === card.number ? "is-recent" : ""}`;
    // Anchored by the edge nearest the ring, so it never covers an exit.
    sign.style.transform = `translate(${x}px, ${y}px) translate(${-50 + 50 * p.nx}%, ${-50 + 50 * p.ny}%)`;
    sign.style.opacity =
      e >= 1
        ? ""
        : String(Math.max(0, (e - 0.85 - (index / count) * 0.1) * 20));
  });
  renderIsland(camera, narrow);
  layer.classList.toggle("compact", fit.compact);
  // Once the camera has landed, measure the real signs for each new layout.
  const layout = JSON.stringify([
    structure,
    fit.compact,
    Math.round(camera.s * 1000),
    Math.round(camera.stretch * 100),
  ]);
  if (e >= 1 && layout !== checkedKey) {
    checkedKey = layout;
    requestAnimationFrame(checkSigns);
  }
  return drawDrive(camera, now);
}

let islandKey = "";
function renderIsland(camera: Camera, narrow: boolean) {
  const island = $("sceneIsland");
  const view = board!.island;
  const [x, y] = project(camera, 0, 0);
  island.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  island.style.width = `${ISLAND * 2 * camera.s * 0.86}px`;
  // A narrow (phone) island has no room for text: the panel shows it instead.
  island.hidden = narrow || view.kind === "logo";
  const key = `${view.kind}:${view.title}:${view.text}`;
  if (key === islandKey) return;
  islandKey = key;
  island.className = "island";
  island.replaceChildren();
  const text = (tag: string, className: string, value: string) => {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = value;
    return node;
  };
  if (view.kind === "thinking")
    island.append(
      text("p", "island-title", view.title),
      text("p", "island-text", view.text),
    );
  if (view.kind === "secret") {
    const diamond = document.createElement("div");
    diamond.className = "secret-diamond";
    diamond.innerHTML = DIAMOND_SVG;
    diamond.append(text("span", "secret-number", view.text));
    island.append(
      text("p", "island-title", view.title),
      diamond,
      text("p", "island-text", "Only you can see it"),
    );
  }
  if (view.kind === "clue") {
    const sign = document.createElement("div");
    sign.className = "clue-sign";
    sign.append(
      text("span", "clue-title", view.title),
      text("span", "clue-word", view.text),
    );
    island.append(sign);
  }
}

/**
 * The reveal drive: a car leaves the locked exit, laps the ring counter-
 * clockwise and turns out of the correct exit when the reveal is due.
 */
function drawDrive(camera: Camera, now: number): boolean {
  const car = $("sceneDrive");
  if (!drive || !board) {
    car.hidden = true;
    return false;
  }
  const count = board.cards.length;
  const a = LANE;
  const bLane = LANE + RING * (camera.stretch - 1);
  const exits = ringPoints(
    RING,
    RING + RING * (camera.stretch - 1),
    count,
    0.5,
  );
  const from = exits[drive.spec.from];
  const to = exits[drive.spec.to];
  if (!from || !to) {
    car.hidden = true;
    return false;
  }
  if (!car.innerHTML) car.innerHTML = topCar(TIPSTER_CAR);
  const progressOf = Math.min(1, (now - drive.start) / drive.spec.durationMs);
  const start = from.t;
  // Counter-clockwise means a decreasing parameter; always at least one lap.
  const end =
    start -
    ((((start - to.t) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) -
    2 * Math.PI;
  const lap = 0.86;
  let gx: number, gy: number, heading: number;
  if (progressOf < lap) {
    const k = easeInOut(progressOf / lap);
    const t = start + (end - start) * k;
    const p = ellipsePoint(a, bLane, t);
    const q = ellipsePoint(a, bLane, t - 0.02);
    gx = p.x;
    gy = p.y;
    heading = Math.atan2(q.x - p.x, -(q.y - p.y));
  } else {
    const k = (progressOf - lap) / (1 - lap);
    const p = ellipsePoint(a, bLane, end);
    const outer = RING + 70;
    gx = p.x + (to.x + to.nx * (outer - RING) - p.x) * k;
    gy = p.y + (to.y + to.ny * (outer - RING) - p.y) * k;
    heading = Math.atan2(to.nx, -to.ny);
  }
  const [x, y] = project(camera, gx, gy);
  car.hidden = false;
  car.style.width = `${Math.max(26, 44 * camera.s)}px`;
  car.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${(heading * 180) / Math.PI}deg)`;
  if (progressOf >= 1) {
    car.hidden = true;
    return false;
  }
  return true;
}
