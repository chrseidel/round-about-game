// Exercises Task 13 against the sandbox: a lock reveals its result at a
// shared time ~2 s ahead, and nobody gets the result early over HTTP.
import WebSocket from "ws";
import { PROTOCOL_VERSION } from "../shared/protocol.ts";

const [apiUrl, eventUrl] = process.argv.slice(2);
if (!apiUrl || !eventUrl)
  throw new Error("Usage: check-reveal <game-api-url> <event-api-url>");
const base = apiUrl.replace(/\/$/, "");
const httpHost = new URL(eventUrl).host;
const failures: string[] = [];
const expect = (ok: boolean, label: string) => ok || failures.push(label);

type Seat = {
  participantId: string;
  token: string;
  snapshot: { squid: string };
};

async function call(path: string, body?: object, token?: string) {
  const response = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body && JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

const command = (
  squid: string,
  seat: Seat,
  command: object,
  expectedVersion = 0,
) =>
  call(
    `/sessions/${squid}/commands`,
    {
      protocolVersion: PROTOCOL_VERSION,
      turnId: "",
      commandId: crypto.randomUUID(),
      expectedVersion,
      command,
    },
    seat.token,
  );

const alice = (await call("/sessions", { nickname: "Alice" })).data as Seat;
const squid = alice.snapshot.squid;
const join = async (nickname: string) =>
  (await call(`/sessions/${squid}/participants`, { nickname })).data as Seat;
const bob = await join("Bob");
const carol = await join("Carol");

// Alice listens for live events and records when they arrive.
const arrivals: { at: number; event: { snapshot: Record<string, unknown> } }[] =
  [];
const socket = new WebSocket(
  `wss://${httpHost.replace(".appsync-api.", ".appsync-realtime-api.")}/event/realtime`,
  [
    `header-${Buffer.from(JSON.stringify({ host: httpHost, Authorization: alice.token })).toString("base64url")}`,
    "aws-appsync-event-ws",
  ],
);
await new Promise<void>((resolve, reject) => {
  socket.on("error", reject);
  socket.on("open", () =>
    socket.send(JSON.stringify({ type: "connection_init" })),
  );
  socket.on("message", (buffer) => {
    const message = JSON.parse(buffer.toString());
    if (message.type === "connection_ack")
      socket.send(
        JSON.stringify({
          type: "subscribe",
          id: "1",
          channel: `/games/${squid}`,
          authorization: { Authorization: alice.token },
        }),
      );
    if (message.type === "subscribe_success") resolve();
    if (message.type === "data")
      arrivals.push({ at: Date.now(), event: JSON.parse(message.event) });
  });
});

await command(squid, bob, { type: "CLAIM_TIPSTER" });
await command(squid, alice, { type: "START" });
await command(squid, bob, { type: "DRAW" });
await command(squid, bob, { type: "SUBMIT_CLUE", clue: "river" });
const chosen = await command(squid, alice, { type: "CHOOSE_GAP", index: 1 });

const lock = await command(
  squid,
  carol,
  { type: "LOCK_GAP", index: 1 },
  chosen.data.version,
);
const offset = lock.data.serverTimeUtc - Date.now();
const target = lock.data.revealAtUtc;
expect(lock.status === 200, `lock → ${lock.status}`);
expect(lock.data.result === null, "lock response contains the result");
expect(
  lock.data.pendingReveal?.result != null,
  "lock response lacks pendingReveal",
);
expect(
  Math.abs(target - lock.data.serverTimeUtc - 2_000) < 500,
  `revealAtUtc ${target - lock.data.serverTimeUtc} ms after the response`,
);
expect(lock.data.lockedBy === carol.participantId, "lockedBy is not Carol");

const early = await call(`/sessions/${squid}`, undefined, alice.token);
expect(
  Date.now() + offset >= target || early.data.result === null,
  "Alice's GET before the target shows the result",
);

await new Promise((resolve) => setTimeout(resolve, 2_500));
const pendingEvent = arrivals.find((a) => a.event.snapshot.pendingReveal);
expect(Boolean(pendingEvent), "no live event with pendingReveal");
const leadMs = pendingEvent && target - (pendingEvent.at + offset);
expect(
  (leadMs ?? -1) > 0,
  `event arrived ${-(leadMs ?? 0)} ms after the target`,
);

const late = await call(`/sessions/${squid}`, undefined, alice.token);
expect(late.data.result != null, "no result after the target");
expect(
  late.data.cards?.length === 4,
  "card not in the circle after the target",
);

socket.terminate();
console.log({ eventLeadMs: leadMs, result: late.data.result, failures });
if (failures.length) process.exitCode = 1;
