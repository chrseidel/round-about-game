import test from "node:test";
import assert from "node:assert/strict";
import { handler } from "./handler.ts";

test("browser publishing and wildcard subscriptions are denied", async () => {
  assert.equal(
    (
      await handler({
        authorizationToken: "token",
        requestContext: {
          operation: "EVENT_PUBLISH",
          channel: "/games/7K9M2Q4V8P6R",
        },
      })
    ).isAuthorized,
    false,
  );
  assert.equal(
    (
      await handler({
        authorizationToken: "token",
        requestContext: { operation: "EVENT_SUBSCRIBE", channel: "/games/*" },
      })
    ).isAuthorized,
    false,
  );
  assert.equal(
    (await handler({ requestContext: { operation: "EVENT_CONNECT" } }))
      .isAuthorized,
    false,
  );
});
