// Development smoke: runs every sandbox check in order and stops at the
// first failure. Development only: some checks write test state into the
// sandbox table, so this needs AWS_PROFILE=chreisel. Runs sequentially on
// purpose, because parallel runs can hit the account's Lambda limit.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { runSteps, smokeSteps } from "./smoke-steps.ts";

const outputs = JSON.parse(readFileSync("amplify_outputs.json", "utf8")) as {
  custom: { gameApiUrl: string; gameEventsUrl: string };
};
const durations: Record<string, string> = {};
const result = await runSteps(
  smokeSteps(outputs.custom.gameApiUrl, outputs.custom.gameEventsUrl),
  (step) =>
    new Promise((resolve) => {
      const started = Date.now();
      console.log(`\n▶ ${step.name}`);
      const child = spawn(
        "npx",
        ["tsx", `scripts/${step.name}.ts`, ...step.args],
        { stdio: "inherit" },
      );
      child.on("exit", (code) => {
        durations[step.name] =
          `${((Date.now() - started) / 1000).toFixed(1)} s`;
        resolve(code === 0);
      });
    }),
);
console.log("\nSmoke summary:", { ...result, durations });
if (result.failed) process.exitCode = 1;
