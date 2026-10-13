import { CHEVRONS_SVG, SIGN_SVG, carSvg } from "./art.ts";
import type { IslandView } from "./turn.ts";

type Card = { number: number; word: string };
type BoardState = {
  cards: Card[];
  phase: string;
  selectedGap: number | null;
  recent: number | null;
  island: IslandView;
  /** Lives are gone: the ring gets hazard stripes. */
  overtime: boolean;
  /** Gap locked in (optimistically or awaiting the shared reveal). */
  lockedGap?: number | null;
  /** Exit names, one per gap, for screen readers. */
  exitLabels: string[];
};

/** A pending shared reveal: the car drives from the locked exit to the correct one. */
export type RevealDrive = {
  from: number;
  to: number;
  /** Server time of the reveal, also the drive's identity. */
  revealAtUtc: number;
  durationMs: number;
};

const $ = (selector: string) =>
  document.querySelector(selector)! as HTMLElement;
const SVG = "http://www.w3.org/2000/svg";

/** Ring measurements for a board of the given size, in px. */
function geometry(width: number, height: number) {
  const size = Math.min(width, height);
  const road = Math.max(28, size * 0.08);
  const radius = size * (size < 430 ? 0.27 : 0.28);
  const exitLength = Math.max(20, size * 0.055);
  return {
    cx: width / 2,
    cy: height / 2,
    size,
    road,
    radius,
    island: radius - road / 2 - Math.max(4, size * 0.012),
    exitLength,
    exitCenter: radius + road / 2 + exitLength / 2,
    signs: radius + road / 2 + size * (size < 430 ? 0.092 : 0.105),
  };
}

/** Clockwise angle from the top, in degrees, of card `index` (gaps sit halfway). */
const angleOf = (index: number, count: number) => (index * 360) / count;

function circle(attributes: Record<string, string | number>) {
  const node = document.createElementNS(SVG, "circle");
  for (const [key, value] of Object.entries(attributes))
    node.setAttribute(key, String(value));
  return node;
}

let drivingFor: number | null = null;

export function renderBoard(
  state: BoardState,
  selectGap?: (index: number) => void,
  drive?: RevealDrive | null,
) {
  const board = $("#board");
  const ring = $("#ringCards");
  const g = geometry(board.clientWidth, board.clientHeight);
  board.style.setProperty("--island-size", `${g.island * 2}px`);
  board.classList.toggle("compact", state.cards.length > 9 || g.size < 430);
  board.classList.toggle("overtime", state.overtime);

  const road = $("#road") as unknown as SVGSVGElement;
  road.setAttribute(
    "viewBox",
    `0 0 ${board.clientWidth} ${board.clientHeight}`,
  );
  const at = { cx: g.cx, cy: g.cy };
  road.replaceChildren(
    circle({
      ...at,
      r: g.radius,
      class: "road-surface",
      "stroke-width": g.road,
    }),
    circle({ ...at, r: g.radius + g.road / 2, class: "road-edge" }),
    circle({ ...at, r: g.radius, class: "lane-marking" }),
    circle({ ...at, r: g.island, class: "island-grass" }),
    circle({ ...at, r: g.island + 2, class: "kerb kerb-white" }),
    circle({ ...at, r: g.island + 2, class: "kerb kerb-red" }),
    circle({ ...at, r: g.radius + g.road / 2 + 3, class: "hazard" }),
  );

  ring.replaceChildren();
  const count = state.cards.length;
  state.cards.forEach((cardData, index) => {
    const angle = angleOf(index, count);
    const radians = (angle * Math.PI) / 180;
    const card = document.createElement("div");
    card.className = `ring-card ${cardData.number === 0 ? "is-anchor" : ""} ${state.recent === cardData.number ? "is-recent" : ""}`;
    const number = document.createElement("span");
    number.className = "ring-number";
    number.textContent =
      cardData.number === 0 ? "0/100" : String(cardData.number);
    const word = document.createElement("span");
    word.className = "ring-word";
    word.textContent = cardData.word;
    card.append(number, word);
    card.style.left = `${g.cx + Math.sin(radians) * g.signs}px`;
    card.style.top = `${g.cy - Math.cos(radians) * g.signs}px`;
    ring.append(card);

    const selected = state.selectedGap === index;
    const locked = state.lockedGap === index;
    const exit = document.createElement("button");
    exit.type = "button";
    exit.className = `ring-gap ${selected ? "selected" : ""} ${locked ? "locked" : ""}`;
    exit.innerHTML = CHEVRONS_SVG;
    exit.setAttribute(
      "aria-label",
      `${state.exitLabels[index] ?? "Exit"}${locked ? ", locked in" : selected ? ", suggested" : ""}`,
    );
    exit.disabled = !selectGap || state.phase !== "guess";
    exit.style.left = `${g.cx}px`;
    exit.style.top = `${g.cy}px`;
    exit.style.width = `${g.exitLength * 1.05}px`;
    exit.style.height = `${g.exitLength}px`;
    exit.style.transform = `translate(-50%, -50%) rotate(${angle + 180 / count}deg) translateY(-${g.exitCenter}px)`;
    if (selectGap) exit.addEventListener("click", () => selectGap(index));
    ring.append(exit);
  });

  renderIsland(state.island);
  renderDrive(board, g, count, drive);
}

function renderIsland(view: IslandView) {
  const island = $("#island");
  if (island.dataset.key === `${view.kind}:${view.title}:${view.text}`) return;
  island.dataset.key = `${view.kind}:${view.title}:${view.text}`;
  island.className = `island island-${view.kind}`;
  island.replaceChildren();
  const text = (tag: string, className: string, value: string) => {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = value;
    return node;
  };
  if (view.kind === "logo" || view.kind === "thinking") {
    const sign = document.createElement("div");
    sign.className = "island-logo";
    sign.innerHTML = SIGN_SVG;
    island.append(sign);
  }
  if (view.kind === "thinking")
    island.append(
      text("p", "island-title", view.title),
      text("p", "island-text", view.text),
    );
  if (view.kind === "secret") {
    const diamond = document.createElement("div");
    diamond.className = "secret-diamond";
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
 * clockwise and turns out of the correct exit when the reveal is due. It runs
 * once per reveal, so re-renders during the build-up do not restart it.
 */
function renderDrive(
  board: HTMLElement,
  g: ReturnType<typeof geometry>,
  count: number,
  drive?: RevealDrive | null,
) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let car = board.querySelector<HTMLElement>(".reveal-car");
  if (!drive || reduced || drive.durationMs < 300) {
    if (!drive) {
      car?.remove();
      drivingFor = null;
    }
    return;
  }
  if (drivingFor === drive.revealAtUtc && car) return;
  drivingFor = drive.revealAtUtc;
  car?.remove();
  car = document.createElement("div");
  car.className = "reveal-car";
  car.innerHTML = carSvg("#FFB81C");
  car.style.left = `${g.cx}px`;
  car.style.top = `${g.cy}px`;
  board.append(car);
  const start = angleOf(drive.from, count) + 180 / count;
  const target = angleOf(drive.to, count) + 180 / count;
  // Counter-clockwise means decreasing angles; always drive at least one lap.
  const end = start - ((((start - target) % 360) + 360) % 360) - 360;
  const lane = `translateY(-${g.radius}px)`;
  const out = `translateY(-${g.radius + g.road / 2 + g.exitLength}px)`;
  car.animate(
    [
      {
        transform: `translate(-50%, -50%) rotate(${start}deg) ${lane} rotate(0deg)`,
        opacity: 0,
      },
      {
        transform: `translate(-50%, -50%) rotate(${start - 20}deg) ${lane} rotate(0deg)`,
        opacity: 1,
        offset: 0.08,
      },
      {
        transform: `translate(-50%, -50%) rotate(${end}deg) ${lane} rotate(0deg)`,
        opacity: 1,
        offset: 0.86,
        easing: "ease-out",
      },
      {
        transform: `translate(-50%, -50%) rotate(${end}deg) ${out} rotate(90deg)`,
        opacity: 1,
      },
    ],
    {
      duration: drive.durationMs,
      easing: "cubic-bezier(.35,0,.25,1)",
      fill: "forwards",
    },
  );
}
