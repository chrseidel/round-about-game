import { defineFunction } from "@aws-amplify/backend";

export const eventPublisher = defineFunction({
  name: "one-round-event-publisher",
  resourceGroupName: "one-round-game",
  entry: "./handler.ts",
  runtime: 22,
  timeoutSeconds: 10,
});
