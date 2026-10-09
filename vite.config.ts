import { defineConfig } from "vite";
import { existsSync, readFileSync } from "node:fs";

export default defineConfig({
  plugins: [
    {
      name: "sandbox-outputs",
      configureServer(server) {
        server.middlewares.use(
          "/amplify_outputs.json",
          (_request, response, next) => {
            if (!existsSync("amplify_outputs.json")) return next();
            response.setHeader("content-type", "application/json");
            response.end(readFileSync("amplify_outputs.json"));
          },
        );
      },
    },
  ],
});
