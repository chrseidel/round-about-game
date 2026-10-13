import test from "node:test";
import assert from "node:assert/strict";
import { runSteps, smokeSteps } from "./smoke-steps.ts";

test("steps cover every sandbox script in order", () => {
  const steps = smokeSteps("https://api", "https://events");
  assert.deepEqual(
    steps.map((step) => step.name),
    [
      "check-events",
      "check-lobby",
      "check-clue",
      "check-gaps",
      "check-reveal",
      "check-timeouts",
      "check-progress",
    ],
  );
  assert.deepEqual(steps[0]!.args, ["https://api", "https://events"]);
  assert.deepEqual(steps[1]!.args, ["https://api"]);
});

test("runSteps stops at the first failure", async () => {
  const ran: string[] = [];
  const result = await runSteps(
    smokeSteps("https://api", "https://events"),
    async (step) => {
      ran.push(step.name);
      return step.name !== "check-clue";
    },
  );
  assert.equal(result.failed, "check-clue");
  assert.deepEqual(result.passed, ["check-events", "check-lobby"]);
  assert.equal(ran.includes("check-gaps"), false);
});
