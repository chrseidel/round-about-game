// Exercises Task 14 against the sandbox: winning, replacement draws, losing
// and the new-session handoff. Near-end states are written straight into the
// sandbox table (AWS_PROFILE=chreisel); never point this at production.
import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { PROTOCOL_VERSION, type Session } from "../shared/protocol.ts";

const [apiUrl] = process.argv.slice(2);
if (!apiUrl) throw new Error("Usage: check-progress <game-api-url>");
const base = apiUrl.replace(/\/$/, "");
const failures: string[] = [];
const expect = (ok: boolean, label: string) => ok || failures.push(label);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

const view = async (squid: string, seat: Seat) =>
  (await call(`/sessions/${squid}`, undefined, seat.token)).data;

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = (await db.send(new ListTablesCommand({}))).TableNames?.find(
  (name) => name.startsWith("amplify-roundabout-roundaboutdev"),
);
if (!table) throw new Error("Sandbox table not found");

/** Overwrites game fields of a stored session (test setup only). */
async function setGame(squid: string, change: Partial<Session["game"]>) {
  const stored = (
    await db.send(
      new GetCommand({
        TableName: table,
        Key: { squid },
        ConsistentRead: true,
      }),
    )
  ).Item as Session;
  await db.send(
    new PutCommand({
      TableName: table,
      Item: {
        ...stored,
        version: stored.version + 1,
        game: { ...stored.game, ...change },
      },
      ConditionExpression: "#version = :version",
      ExpressionAttributeNames: { "#version": "version" },
      ExpressionAttributeValues: { ":version": stored.version },
    }),
  );
  return stored.game.current!;
}

/** Alice hosts, Bob is Tipster and has sent "river"; Carol guesses. */
async function guessing() {
  const alice = (await call("/sessions", { nickname: "Alice" })).data as Seat;
  const squid = alice.snapshot.squid;
  const join = async (nickname: string) =>
    (await call(`/sessions/${squid}/participants`, { nickname })).data as Seat;
  const bob = await join("Bob");
  const carol = await join("Carol");
  await command(squid, bob, { type: "CLAIM_TIPSTER" });
  await command(squid, alice, { type: "START" });
  await command(squid, bob, { type: "DRAW" });
  await command(squid, bob, { type: "SUBMIT_CLUE", clue: "river" });
  return { squid, alice, bob, carol };
}

/** The gap the drawn number belongs in, from the visible circle. */
function correctGap(cards: { number: number }[], current: number) {
  const insertion = cards.findIndex((card) => card.number > current);
  const target = insertion < 0 ? cards.length : insertion;
  return (target - 1 + cards.length) % cards.length;
}

async function lock(
  game: Awaited<ReturnType<typeof guessing>>,
  current: number,
  correct: boolean,
) {
  const { cards } = await view(game.squid, game.carol);
  const right = correctGap(cards, current);
  const index = correct ? right : (right + 1) % cards.length;
  const chosen = await command(game.squid, game.alice, {
    type: "CHOOSE_GAP",
    index,
  });
  return command(
    game.squid,
    game.carol,
    { type: "LOCK_GAP", index },
    chosen.data.version,
  );
}

// (a) Last card placed correctly in Overtime: the team wins at the reveal.
{
  const game = await guessing();
  const current = await setGame(game.squid, { pile: 0, lives: 0 });
  await lock(game, current, true);
  const before = await view(game.squid, game.carol);
  expect(before.status === "playing", `status before reveal: ${before.status}`);
  await wait(2_500);
  const after = await view(game.squid, game.carol);
  expect(after.status === "won", `(a) status after reveal: ${after.status}`);
}

// (b) Wrong last card: the game goes on with a replacement draw.
{
  const game = await guessing();
  const current = await setGame(game.squid, { pile: 0 });
  await lock(game, current, false);
  const early = await command(game.squid, game.bob, { type: "DRAW" });
  expect(
    early.status === 409 && early.data.message === "Wait for the reveal.",
    `(b) draw before reveal → ${early.status} ${early.data.message}`,
  );
  await wait(2_500);
  const replacement = await command(game.squid, game.bob, { type: "DRAW" });
  expect(
    replacement.status === 200 &&
      replacement.data.phase === "tip" &&
      replacement.data.pile === 0 &&
      replacement.data.status === "playing",
    `(b) replacement → ${replacement.status} ${replacement.data.phase} pile ${replacement.data.pile}`,
  );
  expect(
    replacement.data.currentDraw !== current,
    "(b) the replacement repeated the previous number",
  );
}

// (c) Wrong guess in Overtime: the team loses at the reveal.
{
  const game = await guessing();
  const current = await setGame(game.squid, { lives: 0 });
  await lock(game, current, false);
  await wait(2_500);
  const after = await view(game.squid, game.carol);
  expect(after.status === "lost", `(c) status after reveal: ${after.status}`);
}

// (d) New session: host only, old session points to a fresh one.
{
  const game = await guessing();
  const refused = await call(
    "/sessions",
    { replaces: game.squid },
    game.bob.token,
  );
  expect(refused.status === 403, `(d) non-host replace → ${refused.status}`);
  const fresh = await call(
    "/sessions",
    { replaces: game.squid },
    game.alice.token,
  );
  expect(fresh.status === 201, `(d) host replace → ${fresh.status}`);
  const next = fresh.data.snapshot;
  expect(next.squid !== game.squid, "(d) new session reuses the code");
  expect(
    next.status === "lobby" &&
      next.tipsterId === null &&
      next.pile === 12 &&
      next.cards.length === 3,
    "(d) new session is not fresh",
  );
  const old = await view(game.squid, game.carol);
  expect(
    old.nextSquid === next.squid,
    "(d) old session does not point to the new one",
  );
  const moved = await command(game.squid, game.carol, {
    type: "CHOOSE_GAP",
    index: 0,
  });
  expect(
    moved.status === 409 &&
      moved.data.message === "This game has moved to a new session.",
    `(d) command on old session → ${moved.status} ${moved.data.message}`,
  );
  const rejoin = await call(`/sessions/${next.squid}/participants`, {
    nickname: "Carol",
  });
  expect(rejoin.status === 201, `(d) join new session → ${rejoin.status}`);
}

console.log({ failures });
if (failures.length) process.exitCode = 1;
