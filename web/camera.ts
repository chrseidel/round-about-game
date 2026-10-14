/**
 * The roundabout's world and the camera that looks at it. Everything on the
 * ground is laid out top-down in ground units around the ring's centre and
 * turned into screen pixels by one projection, so the isometric lobby, the
 * top-down game and every frame of the move between them stay consistent.
 */

/** Outer edge of the road, in ground units. */
export const RING = 300;
/** Middle of the lane, where cars drive. */
export const LANE = RING - 38;
/** Kerb and island edges. */
export const KERB = RING - 76;
export const ISLAND = RING - 84;
/** Exits run from just inside the road edge to this far out. */
export const EXIT_INNER = RING - 8;
export const EXIT_OUTER = RING + 56;
export const EXIT_WIDTH = 40;
/** Signs stand just beyond the exits' ends. */
export const SIGN_RING = RING + 62;
/** Half the side of the grass block in the lobby. */
export const BLOCK = 340;

export type Camera = {
  /** Screen position of the ring's centre. */
  cx: number;
  cy: number;
  /** Pixels per ground unit. */
  s: number;
  /** Vertical squash: 1 looks straight down, about 0.6 is isometric. */
  tilt: number;
  /** Rotation of the ground in degrees: 45 isometric, 0 top-down. */
  angle: number;
  /** How far the ring is stretched into an oval along its vertical axis. */
  stretch: number;
};

export type Region = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Ground → screen. */
export function project(
  camera: Camera,
  gx: number,
  gy: number,
): [number, number] {
  const a = (camera.angle * Math.PI) / 180;
  const rx = gx * Math.cos(a) - gy * Math.sin(a);
  const ry = gx * Math.sin(a) + gy * Math.cos(a);
  return [camera.cx + rx * camera.s, camera.cy + ry * camera.s * camera.tilt];
}

export function lerpCamera(from: Camera, to: Camera, t: number): Camera {
  const mix = (a: number, b: number) => a + (b - a) * t;
  return {
    cx: mix(from.cx, to.cx),
    cy: mix(from.cy, to.cy),
    s: mix(from.s, to.s),
    tilt: mix(from.tilt, to.tilt),
    angle: mix(from.angle, to.angle),
    stretch: mix(from.stretch, to.stretch),
  };
}

export const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export type RingPoint = {
  x: number;
  y: number;
  /** Outward normal, unit length, in ground units. */
  nx: number;
  ny: number;
  /** Ellipse parameter: 0 at the top, increasing clockwise. */
  t: number;
};

/** Point on an a × b ellipse at parameter t (0 at the top, clockwise). */
export function ellipsePoint(a: number, b: number, t: number): RingPoint {
  const nx = Math.sin(t) / a;
  const ny = -Math.cos(t) / b;
  const length = Math.hypot(nx, ny);
  return {
    x: a * Math.sin(t),
    y: -b * Math.cos(t),
    nx: nx / length,
    ny: ny / length,
    t,
  };
}

/**
 * `count` points on an a × b ellipse, spaced evenly by arc length, starting
 * at the top (`offset` 0.5 puts them halfway between).
 */
export function ringPoints(
  a: number,
  b: number,
  count: number,
  offset: number,
): RingPoint[] {
  const steps = 720;
  const length = [0];
  for (let j = 1; j <= steps; j++) {
    const t0 = ((j - 1) / steps) * 2 * Math.PI;
    const t1 = (j / steps) * 2 * Math.PI;
    length.push(
      length[j - 1]! +
        Math.hypot(
          a * (Math.sin(t1) - Math.sin(t0)),
          b * (Math.cos(t1) - Math.cos(t0)),
        ),
    );
  }
  const total = length[steps]!;
  return Array.from({ length: count }, (_, i) => {
    const target = ((i + offset) / count) * total;
    let j = length.findIndex((value) => value >= target);
    if (j < 1) j = 1;
    // Interpolate within the step for an exact spacing.
    const before = length[j - 1]!;
    const step = length[j]! - before || 1;
    const t = ((j - 1 + (target - before) / step) / steps) * 2 * Math.PI;
    return ellipsePoint(a, b, t);
  });
}

/** Isometric camera that fits the whole grass block into the lobby region. */
export function fitLobbyCamera(region: Region): Camera {
  const tilt = 0.6;
  const halfWidth = BLOCK * Math.SQRT2;
  const halfHeight = halfWidth * tilt + 60;
  const s = Math.min(
    (region.width / 2 - 10) / halfWidth,
    (region.height / 2 - 30) / halfHeight,
  );
  return {
    cx: region.left + region.width / 2,
    cy: region.top + region.height / 2 - 20 * s,
    s,
    tilt,
    angle: 45,
    stretch: 1,
  };
}

/** Estimated sign boxes in px (a two-line word, shadow included). */
export const FULL_SIGN = { width: 128, height: 76 };
export const COMPACT_SIGN = { width: 88, height: 56 };

export type GameFit = {
  camera: Camera;
  /** Signs use the compact style. */
  compact: boolean;
  /** Every other sign stands this much further out (ground units); 0 = none. */
  stagger: number;
  /** Overlapping pairs of neighbouring signs at this size. */
  overlaps: number;
  /** Board height at which the signs would fit (≥ the current one if they do). */
  minHeight: number;
};

export type FitOptions = {
  /** Desktop: the ring stays a perfect circle, never stretched. */
  round?: boolean;
  /** Start at compact signs (the scene measured full-size ones colliding). */
  compact?: boolean;
  /** Start at least at this stagger (the scene measured compact ones colliding). */
  stagger?: number;
};

/** How far out staggered signs may stand, tried in order. */
const STAGGERS = [80, 100, 120];

/**
 * Camera for one sign size. A round ring takes the scale from the smaller of
 * width and height; an oval takes it from the width and stretches into the
 * spare height.
 */
function cameraFor(
  board: Region,
  sign: { width: number; height: number },
  round: boolean,
  stagger = 0,
): Camera {
  const cx = board.left + board.width / 2;
  const cy = board.top + board.height / 2;
  const reach = SIGN_RING + stagger;
  const byWidth = (board.width / 2 - sign.width - 6) / reach;
  const byHeight = (board.height / 2 - sign.height - 6) / reach;
  if (round || byHeight <= byWidth)
    return {
      cx,
      cy,
      s: Math.max(0.05, Math.min(byWidth, byHeight)),
      tilt: 1,
      angle: 0,
      stretch: 1,
    };
  const s = Math.max(0.05, byWidth);
  const room = (board.height / 2 - sign.height - 6) / s - (reach - RING);
  return {
    cx,
    cy,
    s,
    tilt: 1,
    angle: 0,
    stretch: Math.min(4, Math.max(1, room / RING)),
  };
}

/** Where sign `index` stands on the ground, with its outward normal. */
export function signSpots(
  camera: Camera,
  count: number,
  stagger = 0,
): RingPoint[] {
  return ringPoints(
    SIGN_RING,
    RING * camera.stretch + (SIGN_RING - RING),
    count,
    0,
  ).map((p, index) =>
    index % 2 && stagger
      ? { ...p, x: p.x + p.nx * stagger, y: p.y + p.ny * stagger }
      : p,
  );
}

/** Counts overlapping neighbours among signs anchored outward around the ring. */
export function signOverlaps(
  camera: Camera,
  count: number,
  sign: { width: number; height: number },
  stagger = 0,
): number {
  if (count < 2) return 0;
  const boxes = signSpots(camera, count, stagger).map((p) => {
    const [x, y] = project(camera, p.x, p.y);
    // The anchor moves the box outward by half its size along the normal.
    return {
      cx: x + (p.nx * sign.width) / 2,
      cy: y + (p.ny * sign.height) / 2,
    };
  });
  let overlaps = 0;
  for (let i = 0; i < count; i++)
    for (const step of [1, 2]) {
      if (count <= step) continue;
      if (step === 2 && count === 3) continue;
      const a = boxes[i]!;
      const b = boxes[(i + step) % count]!;
      if (
        Math.abs(a.cx - b.cx) < sign.width + 2 &&
        Math.abs(a.cy - b.cy) < sign.height + 2
      )
        overlaps++;
    }
  return count === 2 ? Math.min(overlaps, 1) : overlaps;
}

/**
 * Fits the game camera to the board for a number of cards. Steps up until the
 * signs fit: full-size, compact, then (round desktop rings) staggered signs,
 * or (phone ovals) more board height, reported as `minHeight`.
 */
export function fitGame(
  board: Region,
  count: number,
  options: FitOptions = {},
): GameFit {
  const round = options.round ?? false;
  const fits = (camera: Camera, sign: typeof FULL_SIGN, stagger = 0) =>
    signOverlaps(camera, count, sign, stagger);
  if (!options.compact && !(options.stagger && round)) {
    const full = cameraFor(board, FULL_SIGN, round);
    if (fits(full, FULL_SIGN) === 0)
      return {
        camera: full,
        compact: false,
        stagger: 0,
        overlaps: 0,
        minHeight: board.height,
      };
  }
  // Staggering is for round rings only; ovals grow into more height instead.
  if (!options.stagger || !round) {
    const compact = cameraFor(board, COMPACT_SIGN, round);
    const overlaps = fits(compact, COMPACT_SIGN);
    if (overlaps === 0 || !round) {
      let minHeight = board.height;
      if (overlaps > 0)
        for (let height = board.height + 20; height <= 2400; height += 20) {
          const taller = cameraFor({ ...board, height }, COMPACT_SIGN, round);
          if (fits(taller, COMPACT_SIGN) === 0) {
            minHeight = height;
            break;
          }
        }
      return {
        camera: compact,
        compact: true,
        stagger: 0,
        overlaps,
        minHeight,
      };
    }
  }
  // A circle cannot grow into spare height: alternate signs stand further out.
  const tries = STAGGERS.filter((d) => d >= (options.stagger ?? 0));
  let last: GameFit | null = null;
  for (const stagger of tries.length
    ? tries
    : [STAGGERS[STAGGERS.length - 1]!]) {
    const camera = cameraFor(board, COMPACT_SIGN, true, stagger);
    const overlaps = fits(camera, COMPACT_SIGN, stagger);
    last = {
      camera,
      compact: true,
      stagger,
      overlaps,
      minHeight: board.height,
    };
    if (overlaps === 0) return last;
  }
  return last!;
}
