import { defineFunction } from "@aws-amplify/backend";

export const gameApi = defineFunction({
  name: "round-about-game-api",
  resourceGroupName: "round-about-game",
  entry: "./handler.ts",
  runtime: 22,
  timeoutSeconds: 10,
  environment: { SESSION_TABLE: "" },
});
