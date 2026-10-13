// Exercises Task 12 against the sandbox: shared selection, strict locking,
// retried locks and an Overtime timeout with only a selection. The Overtime
// game is written straight into the sandbox table (AWS_PROFILE=chreisel);
// never point this at production.
import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { PROTOCOL_VERSION, type Session } from "../shared/protocol.ts";

const [apiUrl] = process.argv.slice(2);
if (!apiUrl) throw new Error("Usage: check-gaps <game-api-url>");
const base = apiUrl.replace(/\/$/, "");
const failures: string[] = [];
const expect = (ok: boolean, label: string) => ok || failures.push(label);

type Seat = { token: string; snapshot: { squid: string } };

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

function command(
  squid: string,
  seat: Seat,
  command: object,
  expectedVersion = 0,
  commandId: string = crypto.randomUUID(),
) {
  return call(
    `/sessions/${squid}/commands`,
    {
      protocolVersion: PROTOCOL_VERSION,
      turnId: "",
      commandId,
      expectedVersion,
      command,
    },
    seat.token,
  );
}

const view = async (squid: string, seat: Seat) =>
  (await call(`/sessions/${squid}`, undefined, seat.token)).data;

/** Alice hosts, Bob is Tipster and has sent "river"; Carol and Dave guess. */
async function guessing() {
  const alice = (await call("/sessions", { nickname: "Alice" })).data as Seat;
  const squid = alice.snapshot.squid;
  const join = async (nickname: string) =>
    (await call(`/sessions/${squid}/participants`, { nickname })).data as Seat;
  const bob = await join("Bob");
  const carol = await join("Carol");
  const dave = await join("Dave");
  await command(squid, bob, { type: "CLAIM_TIPSTER" });
  await command(squid, alice, { type: "START" });
  await command(squid, bob, { type: "DRAW" });
  await command(squid, bob, { type: "SUBMIT_CLUE", clue: "river" });
  return { squid, alice, bob, carol, dave };
}

const report: Record<string, unknown> = {};

// 1. Select, see, lock once, retry the lock.
{
  const { squid, alice, bob, carol, dave } = await guessing();
  const tipster = await command(squid, bob, { type: "CHOOSE_GAP", index: 1 });
  expect(tipster.status === 403, `Tipster choose → ${tipster.status}`);
  const chosen = await command(squid, alice, { type: "CHOOSE_GAP", index: 1 });
  expect(chosen.status === 200, `choose → ${chosen.status}`);
  const carolView = await view(squid, carol);
  const daveView = await view(squid, dave);
  expect(
    carolView.selectedGap === 1 && daveView.selectedGap === 1,
    "others do not see the selection",
  );
  expect(carolView.phase === "guess", "one tap graded the card");
  const lockId = crypto.randomUUID();
  const lock = { type: "LOCK_GAP", index: 1 };
  const locked = await command(squid, carol, lock, carolView.version, lockId);
  expect(
    locked.status === 200 && locked.data.phase === "result",
    `lock → ${locked.status} ${locked.data.phase}`,
  );
  const retried = await command(squid, carol, lock, carolView.version, lockId);
  expect(
    retried.status === 200 && retried.data.version === locked.data.version,
    `retried lock → ${retried.status} v${retried.data.version} (first v${locked.data.version})`,
  );
  report.result = locked.data.result;
}

// 2. Stale locks are refused.
{
  const { squid, alice, carol, dave } = await guessing();
  await command(squid, alice, { type: "CHOOSE_GAP", index: 1 });
  const seen = (await view(squid, carol)).version;
  await command(squid, dave, { type: "CHOOSE_GAP", index: 2 });
  const message = "The selection changed. Tap again to lock in.";
  for (const index of [1, 2]) {
    const stale = await command(
      squid,
      carol,
      { type: "LOCK_GAP", index },
      seen,
    );
    expect(
      stale.status === 409 && stale.data.message === message,
      `stale lock on ${index} → ${stale.status} ${stale.data.message}`,
    );
  }
}

// 3. Overtime runs out with only a selection: a miss that ends the game.
{
  const { squid, alice } = await guessing();
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const table = (await db.send(new ListTablesCommand({}))).TableNames?.find(
    (name) => name.startsWith("amplify-roundabout-roundaboutdev"),
  );
  if (!table) throw new Error("Sandbox table not found");
  const stored = (
    await db.send(
      new GetCommand({
        TableName: table,
        Key: { squid },
        ConsistentRead: true,
      }),
    )
  ).Item as Session;
  const deadline = Date.now() + 4_000;
  await db.send(
    new PutCommand({
      TableName: table,
      Item: {
        ...stored,
        version: stored.version + 1,
        game: { ...stored.game, lives: 0, deadline },
      },
      ConditionExpression: "#version = :version",
      ExpressionAttributeNames: { "#version": "version" },
      ExpressionAttributeValues: { ":version": stored.version },
    }),
  );
  await command(squid, alice, { type: "CHOOSE_GAP", index: 0 });
  const during = await view(squid, alice);
  expect(
    during.deadlineUtc === deadline,
    "choosing moved the Overtime deadline",
  );
  await new Promise((resolve) => setTimeout(resolve, 6_000));
  const after = await view(squid, alice);
  expect(
    after.result?.timedOut === true &&
      after.result?.lost === true &&
      after.result?.correct === false,
    `Overtime with selection → ${JSON.stringify(after.result)}`,
  );
}

console.log({ ...report, failures });
if (failures.length) process.exitCode = 1;
