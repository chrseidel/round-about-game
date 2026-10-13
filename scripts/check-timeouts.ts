// Exercises Task 10 against the sandbox: queued clue/grace/Overtime timeouts.
// Writes game state directly into the sandbox table, so it needs AWS
// credentials (AWS_PROFILE=chreisel). Never point it at production.
import WebSocket from "ws";
import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  ListQueuesCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { apply } from "../game/rules.ts";
import type { PublicSnapshot, Session } from "../shared/protocol.ts";

const [apiUrl, eventUrl] = process.argv.slice(2);
if (!apiUrl || !eventUrl)
  throw new Error("Usage: check-timeouts <game-api-url> <event-api-url>");
const base = apiUrl.replace(/\/$/, "");

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sqs = new SQSClient({});
const table = (await db.send(new ListTablesCommand({}))).TableNames?.find(
  (name) => name.startsWith("amplify-roundabout-roundaboutdev"),
);
const queueUrl = (await sqs.send(new ListQueuesCommand({}))).QueueUrls?.find(
  (url) => url.includes("roundaboutdev") && url.includes("TimeoutQueue"),
);
if (!table || !queueUrl)
  throw new Error("Sandbox table or timeout queue not found");

async function post(path: string, body: object) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

const host = await post("/sessions", { nickname: "Alice" });
const squid: string = host.snapshot.squid;
await post(`/sessions/${squid}/participants`, { nickname: "Bob" });

// Collect every broadcast snapshot with its arrival time.
const received: { at: number; snapshot: PublicSnapshot }[] = [];
const httpHost = new URL(eventUrl).host;
const socket = new WebSocket(
  `wss://${httpHost.replace(".appsync-api.", ".appsync-realtime-api.")}/event/realtime`,
  [
    `header-${Buffer.from(JSON.stringify({ host: httpHost, Authorization: host.token })).toString("base64url")}`,
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
          authorization: { Authorization: host.token },
        }),
      );
    if (message.type === "subscribe_success") resolve();
    if (message.type === "data")
      received.push({
        at: Date.now(),
        snapshot: JSON.parse(message.event).snapshot,
      });
  });
});

const load = async () =>
  (
    await db.send(
      new GetCommand({
        TableName: table,
        Key: { squid },
        ConsistentRead: true,
      }),
    )
  ).Item as Session;

async function write(change: (session: Session, now: number) => Session) {
  const session = await load();
  const now = Date.now();
  const next = change(session, now);
  next.version = session.version + 1;
  await db.send(
    new PutCommand({
      TableName: table,
      Item: next,
      ConditionExpression: "#version = :version",
      ExpressionAttributeNames: { "#version": "version" },
      ExpressionAttributeValues: { ":version": session.version },
    }),
  );
  return { now, version: next.version };
}

async function waitFor(
  test: (snapshot: PublicSnapshot) => boolean,
  ms: number,
) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const hit = received.find((event) => test(event.snapshot));
    if (hit) return hit;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

const failures: string[] = [];
const report: Record<string, unknown> = { squid };

// 1. Clue runs out after 5 s: grace, then the card is discarded 3 s later.
const clue = await write((session, now) => {
  const game = apply(session.game, { type: "DRAW" }, now);
  return {
    ...session,
    status: "playing",
    tipsterId: session.hostId,
    game: { ...game, deadline: now + 5_000 },
  };
});
const grace = await waitFor((s) => s.phase === "grace", 15_000);
const discarded = await waitFor(
  (s) => s.phase === "result" && s.result?.discarded === true,
  20_000,
);
if (!grace) failures.push("no grace event");
if (!discarded) failures.push("no discarded result event");
else if (discarded.snapshot.lives !== 2 || discarded.snapshot.pile !== 12)
  failures.push(
    `after discard lives ${discarded.snapshot.lives}, pile ${discarded.snapshot.pile}`,
  );
report.graceLateMs = grace && grace.at - (clue.now + 5_000);
report.discardLateMs = discarded && discarded.at - (clue.now + 8_000);

// 2. A read during an overdue deadline shows it without saving (best effort:
// the queued timeout may land in between, which makes this inconclusive).
const overdue = await write((session, now) => ({
  ...session,
  game: {
    ...session.game,
    phase: "tip",
    current: session.game.deck.at(-1)!,
    deadline: now - 1_000,
  },
}));
const read = await (
  await fetch(`${base}/sessions/${squid}`, {
    headers: { authorization: `Bearer ${host.token}` },
  })
).json();
const storedAfterRead = (await load()).version;
report.readPhase = read.phase;
report.readSaved =
  storedAfterRead === overdue.version ? "no" : "inconclusive (timeout ran)";
if (read.phase !== "grace") failures.push(`overdue read shows ${read.phase}`);
await waitFor(
  (s) => s.version > overdue.version && s.phase === "result",
  20_000,
);

// 3. Overtime runs out after 4 s: the team loses.
const overtime = await write((session, now) => ({
  ...session,
  game: {
    ...session.game,
    phase: "guess",
    lives: 0,
    current: session.game.deck.at(-1)!,
    selectedGap: null,
    deadline: now + 4_000,
  },
}));
const lost = await waitFor(
  (s) => s.version > overtime.version && s.result?.lost === true,
  20_000,
);
if (!lost) failures.push("no Overtime loss event");
report.overtimeLateMs = lost && lost.at - (overtime.now + 4_000);

// 4. A stale message (wrong deadline) changes nothing.
const before = (await load()).version;
await sqs.send(
  new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify({
      squid,
      turn: 1,
      phase: "tip",
      deadline: 123,
    }),
  }),
);
await new Promise((resolve) => setTimeout(resolve, 4_000));
const after = (await load()).version;
if (after !== before)
  failures.push(`stale message changed version ${before}→${after}`);

socket.terminate();
console.log({ ...report, failures });
if (failures.length) process.exitCode = 1;
