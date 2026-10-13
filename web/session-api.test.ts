import test from "node:test";
import assert from "node:assert/strict";
import { codeFromPath } from "./session-api.ts";

test("invite paths give the session code, with or without a trailing slash", () => {
  assert.equal(codeFromPath("/s/M8D7R8AH4JBK"), "M8D7R8AH4JBK");
  assert.equal(codeFromPath("/s/M8D7R8AH4JBK/"), "M8D7R8AH4JBK");
  assert.equal(codeFromPath("/s/m8d7r8ah4jbk"), "M8D7R8AH4JBK");
  assert.equal(codeFromPath("/"), "");
  assert.equal(codeFromPath("/s/"), "");
});
