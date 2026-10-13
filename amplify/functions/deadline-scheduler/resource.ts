import { defineFunction } from "@aws-amplify/backend";

export const deadlineScheduler = defineFunction({
  name: "round-about-deadline-scheduler",
  resourceGroupName: "round-about-game",
  entry: "./handler.ts",
  runtime: 22,
  timeoutSeconds: 10,
});
