import { defineFunction } from "@aws-amplify/backend";

export const timeout = defineFunction({
  name: "round-about-timeout",
  resourceGroupName: "round-about-game",
  entry: "./handler.ts",
  runtime: 22,
  timeoutSeconds: 10,
});
