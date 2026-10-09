import { defineFunction } from "@aws-amplify/backend";

export const gameApi = defineFunction({
  name: "one-round-game-api",
  resourceGroupName: "one-round-game",
  entry: "./handler.ts",
  runtime: 22,
  timeoutSeconds: 10,
  environment: { SESSION_TABLE: "" },
});
