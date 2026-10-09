import { defineFunction } from "@aws-amplify/backend";

export const eventAuth = defineFunction({
  name: "one-round-event-auth",
  resourceGroupName: "one-round-game",
  entry: "./handler.ts",
  runtime: 22,
  timeoutSeconds: 5,
});
