export type SmokeStep = { name: string; args: string[] };

/** Every sandbox check, in the order a full development smoke runs them. */
export function smokeSteps(api: string, events: string): SmokeStep[] {
  const both = [api, events];
  return [
    { name: "check-events", args: both },
    { name: "check-lobby", args: [api] },
    { name: "check-clue", args: both },
    { name: "check-gaps", args: [api] },
    { name: "check-reveal", args: both },
    { name: "check-timeouts", args: both },
    { name: "check-progress", args: [api] },
  ];
}

/** Runs steps one at a time and stops at the first failure. */
export async function runSteps(
  steps: SmokeStep[],
  run: (step: SmokeStep) => Promise<boolean>,
): Promise<{ passed: string[]; failed: string | null }> {
  const passed: string[] = [];
  for (const step of steps) {
    if (!(await run(step))) return { passed, failed: step.name };
    passed.push(step.name);
  }
  return { passed, failed: null };
}
