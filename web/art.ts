/** Pixel-art SVG sprites shared by the entry, lobby and game screens. */

/** Renders a sprite from rows of characters; each character maps to a colour. */
function sprite(
  rows: string[],
  colors: Record<string, string>,
  className: string,
): string {
  const rects: string[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = colors[row[x]!];
      if (color)
        rects.push(
          `<rect x="${x}" y="${y}" width="1" height="1" fill="${color}"/>`,
        );
    }
  });
  return `<svg class="${className}" viewBox="0 0 ${rows[0]!.length} ${rows.length}" shape-rendering="crispEdges" aria-hidden="true">${rects.join("")}</svg>`;
}

const INK = "#1B1A2E";
const LANE = "#F2F0E6";

/** The blue roundabout road sign: three white arrows driving counter-clockwise. */
export const SIGN_SVG =
  '<svg class="roundabout-sign" viewBox="-46 -46 92 92" shape-rendering="crispEdges" aria-hidden="true">' +
  `<circle r="44" fill="${INK}"/><circle r="38" fill="#3366CC"/>` +
  `<g fill="none" stroke="${LANE}" stroke-width="9">` +
  [0, 120, 240]
    .map(
      (turn) =>
        `<path d="M 20.7 3.6 A 21 21 0 0 0 8.2 -19.3" transform="rotate(${turn})"/>`,
    )
    .join("") +
  `</g><g fill="${LANE}">` +
  [0, 120, 240]
    .map(
      (turn) =>
        `<polygon points="0,-22 11,-27 7,-13" transform="rotate(${turn})"/>`,
    )
    .join("") +
  "</g></svg>";

/** A car seen from the side, for the isometric lobby; it faces right. */
export function sideCar(color: string, tipster = false): string {
  return sprite(
    [
      tipster ? "......YY........" : "................",
      "...KKKKKKKKKK...",
      "...KCWWWCWWCK...",
      "..KCCWWWCWWCCK..",
      "KKCCCCCCCCCCCCKK",
      "KCHHHHHHHHHHHHCK",
      "KCCCCCCCCCCCCCCK",
      "KCCCCCCCCCCCCCCK",
      "KKKKKKKKKKKKKKKK",
      "..KKK......KKK..",
      "..KKK......KKK..",
      "................",
    ],
    {
      K: INK,
      C: color,
      W: "#BFE6FF",
      H: "rgba(255,255,255,.35)",
      Y: "#FFC845",
    },
    "car-svg",
  );
}

/** A car seen from above, for the top-down reveal; it faces up. */
export function topCar(color: string): string {
  return sprite(
    [
      ".KKKKKK.",
      "KCCCCCCK",
      "KWWWWWWK",
      "KCCCCCCK",
      "KCCCCCCK",
      "KCCCCCCK",
      "KCWWWWCK",
      "KCCCCCCK",
      ".KKKKKK.",
    ],
    { K: INK, C: color, W: "#BFE6FF" },
    "car-svg",
  );
}

/** A traffic cone, one per life; its colour comes from CSS currentColor. */
export const CONE_SVG = sprite(
  [
    "...KK...",
    "...CC...",
    "...CC...",
    "..WWWW..",
    "..CCCC..",
    "..CCCC..",
    ".WWWWWW.",
    ".CCCCCC.",
    "KKKKKKKK",
    "KKKKKKKK",
  ],
  { K: INK, C: "currentColor", W: LANE },
  "cone-svg",
);

/** The yellow warning diamond behind the Tipster's secret number. */
export const DIAMOND_SVG = sprite(
  [
    ".....KK.....",
    "....KYYK....",
    "...KYYYYK...",
    "..KYYYYYYK..",
    ".KYYYYYYYYK.",
    "KYYYYYYYYYYK",
    "KYYYYYYYYYYK",
    ".KYYYYYYYYK.",
    "..KYYYYYYK..",
    "...KYYYYK...",
    "....KYYK....",
    ".....KK.....",
  ],
  { K: INK, Y: "#FFC845" },
  "diamond-svg",
);

/** Two chevrons pointing out of an exit; colour from currentColor. */
export const CHEVRONS_SVG = sprite(
  [
    "....C....",
    "...CCC...",
    "..CC.CC..",
    ".CC...CC.",
    "....C....",
    "...CCC...",
    "..CC.CC..",
    ".CC...CC.",
  ],
  { C: "currentColor" },
  "chevrons",
);

/** A trophy, for winning. */
export const TROPHY_SVG = sprite(
  [
    "KKKKKKKKKK",
    "KYYYYYYYYK",
    "KYYWYYYYYK",
    ".KYYYYYYK.",
    "..KYYYYK..",
    "...KYYK...",
    "....KK....",
    "...KYYK...",
    "..KKKKKK..",
  ],
  { K: INK, Y: "#FFC845", W: LANE },
  "trophy-svg",
);

/** A small pixel tree for the corners of the lobby's grass block. */
export const TREE_SVG = sprite(
  [
    "...GG...",
    "..GGGG..",
    ".GGLGGG.",
    "GGGGGLGG",
    ".GGGGGG.",
    "...TT...",
    "...TT...",
  ],
  { G: "#3E8F48", L: "#57A85E", T: "#6B4430" },
  "tree-svg",
);

/** Car colours by join order; the Tipster always drives the yellow one. */
export const CAR_COLORS = [
  "#E04848",
  "#2BB3A6",
  "#8A5CD6",
  "#3D7DE0",
  "#F08A3C",
  "#D2508F",
  "#6E7A8A",
  "#8DB33A",
];
export const TIPSTER_CAR = "#FFC845";
