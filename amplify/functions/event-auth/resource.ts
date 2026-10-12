import { defineFunction } from "@aws-amplify/backend";

export const eventAuth = defineFunction({
  name: "round-about-event-auth",
  resourceGroupName: "round-about-game",
  entry: "./handler.ts",
  runtime: 22,
  timeoutSeconds: 5,
});
