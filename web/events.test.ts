import test from "node:test";
import assert from "node:assert/strict";
import type { PublicSnapshot } from "../shared/protocol.ts";
import { GameEvents } from "./events.ts";

class FakeSocket {
  static instances: FakeSocket[] = [];
  sent: { type: string }[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.onclose?.();
  }
  receive(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const squid = "7K9M2Q4V8P6R";
const snapshot = (version: number) => ({ squid, version }) as PublicSnapshot;
const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup(catchUp: () => Promise<PublicSnapshot>) {
  FakeSocket.instances = [];
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeSocket;
  const updates: number[] = [];
  let ended = 0;
  const events = new GameEvents(
    {
      endpoint: "https://abc.appsync-api.eu-central-1.amazonaws.com/event",
      squid,
      token: "token",
    },
    (update) => updates.push(update.version),
    catchUp,
    () => {},
    () => ended++,
  );
  return { events, updates, ended: () => ended };
}

async function subscribe(socket: FakeSocket) {
  socket.onopen?.();
  socket.receive({ type: "connection_ack", connectionTimeoutMs: 300000 });
  socket.receive({ type: "subscribe_success" });
  await flush();
}

test("duplicate and out-of-order events never roll back the board", async () => {
  const { events, updates } = setup(async () => snapshot(1));
  void events.connect();
  const socket = FakeSocket.instances[0]!;
  await subscribe(socket);
  for (const version of [2, 1, 2, 3]) {
    socket.receive({
      type: "data",
      event: JSON.stringify({
        type: "game_updated",
        snapshot: snapshot(version),
      }),
    });
    await flush();
  }
  assert.deepEqual(updates, [1, 2, 3]);
  events.close();
});

test("a rejected subscription for an ended session stops reconnecting", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { events, ended } = setup(async () => {
    throw Object.assign(new Error("Join this session first."), {
      status: 401,
    });
  });
  void events.connect();
  const socket = FakeSocket.instances[0]!;
  socket.onopen?.();
  socket.receive({ type: "connection_ack" });
  socket.receive({ type: "subscribe_error" });
  await flush();
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(ended(), 1);
  assert.equal(FakeSocket.instances.length, 1);
});

test("a rejected subscription for a live session keeps retrying", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { events, ended } = setup(async () => snapshot(1));
  void events.connect();
  const socket = FakeSocket.instances[0]!;
  socket.onopen?.();
  socket.receive({ type: "connection_ack" });
  socket.receive({ type: "subscribe_error" });
  await flush();
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(ended(), 0);
  assert.equal(FakeSocket.instances.length, 2);
  events.close();
});

test("closing the connection stops reconnect attempts", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { events } = setup(async () => snapshot(1));
  void events.connect();
  await subscribe(FakeSocket.instances[0]!);
  events.close();
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(FakeSocket.instances.length, 1);
});

test("resuming fetches the current state at once", async () => {
  let current = 1;
  const { events, updates } = setup(async () => snapshot(current));
  void events.connect();
  await subscribe(FakeSocket.instances[0]!);
  // The clue's event was lost while the phone slept; no later event comes.
  current = 2;
  events.resume();
  await flush();
  assert.deepEqual(updates, [1, 2]);
  events.close();
});

test("resuming replaces a connection without a recent keep-alive", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const { events } = setup(async () => snapshot(1));
  void events.connect();
  await subscribe(FakeSocket.instances[0]!);
  t.mock.timers.tick(80_000);
  events.resume();
  await flush();
  assert.equal(FakeSocket.instances.length, 2);
  events.close();
});

test("resuming keeps a connection with a recent keep-alive", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const { events } = setup(async () => snapshot(1));
  void events.connect();
  const socket = FakeSocket.instances[0]!;
  await subscribe(socket);
  t.mock.timers.tick(50_000);
  socket.receive({ type: "ka" });
  t.mock.timers.tick(20_000);
  events.resume();
  await flush();
  assert.equal(FakeSocket.instances.length, 1);
  events.close();
});

test("a connection silent for two keep-alive intervals is replaced", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const { events } = setup(async () => snapshot(1));
  void events.connect();
  await subscribe(FakeSocket.instances[0]!);
  // The server promises 5 minutes, but sends a keep-alive every minute.
  t.mock.timers.tick(140_000);
  await flush();
  t.mock.timers.tick(2_000);
  await flush();
  assert.equal(FakeSocket.instances.length, 2);
  events.close();
});

test("resuming skips the growing reconnect delay", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const { events } = setup(async () => snapshot(1));
  void events.connect();
  // Several failed attempts while the phone was locked.
  for (let i = 0; i < 4; i++) {
    FakeSocket.instances.at(-1)!.close();
    await flush();
    t.mock.timers.tick(40_000);
    await flush();
  }
  const before = FakeSocket.instances.length;
  FakeSocket.instances.at(-1)!.close();
  await flush();
  events.resume();
  await flush();
  assert.equal(FakeSocket.instances.length, before + 1);
  events.close();
});

test("resuming a closed connection does nothing", async () => {
  const { events, updates } = setup(async () => snapshot(1));
  void events.connect();
  await subscribe(FakeSocket.instances[0]!);
  events.close();
  events.resume();
  await flush();
  assert.equal(FakeSocket.instances.length, 1);
  assert.deepEqual(updates, [1]);
});
