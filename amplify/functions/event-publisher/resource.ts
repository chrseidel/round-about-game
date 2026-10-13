import { defineFunction } from "@aws-amplify/backend";

export const eventPublisher = defineFunction({
  name: "round-about-event-publisher",
  resourceGroupName: "round-about-game",
  entry: "./handler.ts",
  runtime: 22,
  logging: { retention: "2 weeks" },
  timeoutSeconds: 10,
});
