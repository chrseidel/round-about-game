import test from "node:test";
import assert from "node:assert/strict";
import {
  LANE,
  RING,
  SIGN_RING,
  COMPACT_SIGN,
  FULL_SIGN,
  fitGame,
  fitLobbyCamera,
  lerpCamera,
  project,
  ringPoints,
  type Camera,
} from "./camera.ts";

const close = (actual: number, expected: number, within = 0.01) =>
  assert.ok(
    Math.abs(actual - expected) <= within,
    `${actual} is not within ${within} of ${expected}`,
  );

const iso: Camera = {
  cx: 100,
  cy: 100,
  s: 1,
  tilt: 0.5,
  angle: 45,
  stretch: 1,
};
const top: Camera = { cx: 100, cy: 100, s: 2, tilt: 1, angle: 0, stretch: 1 };

test("isometric camera turns a ground square into a diamond", () => {
  const [x1, y1] = project(iso, 100, -100);
  close(x1, 100 + 100 * Math.SQRT2);
  close(y1, 100);
  const [x2, y2] = project(iso, 100, 100);
  close(x2, 100);
  close(y2, 100 + 50 * Math.SQRT2);
});

test("top-down camera only scales", () => {
  assert.deepEqual(project(top, 10, -20), [120, 60]);
});

test("halfway between cameras interpolates every setting", () => {
  const mid = lerpCamera(iso, top, 0.5);
  assert.deepEqual(mid, {
    cx: 100,
    cy: 100,
    s: 1.5,
    tilt: 0.75,
    angle: 22.5,
    stretch: 1,
  });
});

test("ring points are evenly spaced along an oval", () => {
  const points = ringPoints(300, 750, 18, 0);
  const gaps = points.map((p, i) => {
    const next = points[(i + 1) % points.length]!;
    return Math.hypot(next.x - p.x, next.y - p.y);
  });
  const min = Math.min(...gaps);
  const max = Math.max(...gaps);
  assert.ok(max / min < 1.1, `gaps vary from ${min} to ${max}`);
  for (const p of points) close(Math.hypot(p.nx, p.ny), 1, 1e-9);
  // The first point sits at the top, pointing up.
  close(points[0]!.x, 0, 1);
  close(points[0]!.ny, -1);
});

test("the lobby camera fits the whole diorama", () => {
  const camera = fitLobbyCamera({ left: 0, top: 0, width: 800, height: 760 });
  assert.equal(camera.angle, 45);
  assert.ok(camera.s > 0.5 && camera.s <= 1.2, `scale ${camera.s}`);
  assert.ok(LANE < RING);
});

test("signs never overlap, for every card count and board size", () => {
  const boards = [
    { left: 0, top: 70, width: 900, height: 730 },
    { left: 0, top: 70, width: 640, height: 668 },
    { left: 0, top: 56, width: 351, height: 480 },
    { left: 0, top: 56, width: 351, height: 300 },
  ];
  for (const board of boards)
    for (const count of [3, 12, 18]) {
      const fit = fitGame(board, count);
      // A board that is too short asks for more height; at that height it fits.
      const tall = { ...board, height: Math.max(board.height, fit.minHeight) };
      const final = fitGame(tall, count);
      assert.equal(
        final.overlaps,
        0,
        `${board.width}×${board.height}, ${count} signs: ${final.overlaps} overlaps`,
      );
      const sign = final.compact ? COMPACT_SIGN : FULL_SIGN;
      const reach = SIGN_RING * final.camera.s + sign.width;
      assert.ok(final.camera.cx - reach >= tall.left - 1, "fits left");
      assert.ok(
        final.camera.cx + reach <= tall.left + tall.width + 1,
        "fits right",
      );
    }
});

test("roomy boards keep full-size signs and a round ring", () => {
  const fit = fitGame({ left: 0, top: 70, width: 900, height: 730 }, 12);
  assert.equal(fit.compact, false);
  assert.equal(fit.camera.stretch, 1);
});

test("a board too short for its signs asks for more height", () => {
  const fit = fitGame({ left: 0, top: 56, width: 351, height: 300 }, 18);
  assert.ok(fit.minHeight > 300, `min height ${fit.minHeight}`);
  assert.ok(
    fitGame({ left: 0, top: 56, width: 351, height: 600 }, 5).minHeight <= 600,
  );
});

test("the board can be forced to compact signs", () => {
  const board = { left: 0, top: 70, width: 900, height: 730 };
  assert.equal(fitGame(board, 5, { compact: true }).compact, true);
  assert.equal(fitGame(board, 5).compact, false);
});

test("desktop rings are always perfect circles", () => {
  const boards = [
    { left: 0, top: 72, width: 640, height: 668 },
    { left: 0, top: 72, width: 896, height: 620 },
    { left: 0, top: 72, width: 1016, height: 800 },
    { left: 0, top: 72, width: 500, height: 900 },
  ];
  for (const board of boards)
    for (const count of [3, 12, 18]) {
      const fit = fitGame(board, count, { round: true });
      assert.equal(fit.camera.stretch, 1, `${board.width}×${board.height}`);
      assert.equal(fit.camera.tilt, 1);
    }
});

test("crowded desktop circles stagger their signs instead of overlapping", () => {
  for (const board of [
    { left: 0, top: 72, width: 640, height: 668 },
    { left: 0, top: 72, width: 896, height: 620 },
  ]) {
    const fit = fitGame(board, 18, { round: true });
    assert.equal(fit.overlaps, 0, `${board.width}×${board.height}`);
    assert.ok(fit.stagger > 0, "staggered");
    const reach = (SIGN_RING + fit.stagger) * fit.camera.s + COMPACT_SIGN.width;
    assert.ok(fit.camera.cx - reach >= board.left - 1, "fits left");
  }
  // Roomy circles need no staggering.
  assert.equal(
    fitGame({ left: 0, top: 72, width: 1016, height: 980 }, 18, { round: true })
      .stagger,
    0,
  );
});

test("a leftover stagger never turns a phone oval into a circle", () => {
  const phone = { left: 0, top: 56, width: 351, height: 520 };
  const fit = fitGame(phone, 18, { compact: true, stagger: 100 });
  assert.equal(fit.stagger, 0);
  assert.ok(fit.camera.stretch > 1);
});
