import test from "node:test";
import assert from "node:assert/strict";
import { allowedOrigins } from "./origins.ts";

test("sandbox keeps localhost", () => {
  assert.deepEqual(allowedOrigins({}), [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]);
});

test("production allows the domain and Amplify address only", () => {
  assert.deepEqual(allowedOrigins({ AWS_BRANCH: "main", AWS_APP_ID: "d123" }), [
    "https://round-about.chreisel.net",
    "https://main.d123.amplifyapp.com",
  ]);
});

test("missing app id leaves out the Amplify address", () => {
  assert.deepEqual(allowedOrigins({ AWS_BRANCH: "main" }), [
    "https://round-about.chreisel.net",
  ]);
});
