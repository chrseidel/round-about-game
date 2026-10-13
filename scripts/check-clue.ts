// Exercises Task 11 against the sandbox: private draw, clue validation,
// sending in grace, too-late words, and no secret on the socket.
import WebSocket from "ws";
import { PROTOCOL_VERSION } from "../shared/protocol.ts";

const [apiUrl, eventUrl] = process.argv.slice(2);
if (!apiUrl || !eventUrl)
  throw new Error("Usage: check-clue <game-api-url> <event-api-url>");
const base = apiUrl.replace(/\/$/, "");
const httpHost = new URL(eventUrl).host;
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

const command = (squid: string, seat: Seat, type: string, extra = {}) =>
  call(
    `/sessions/${squid}/commands`,
    {
      protocolVersion: PROTOCOL_VERSION,
      turnId: "",
      commandId: crypto.randomUUID(),
      expectedVersion: 0,
      command: { type, ...extra },
    },
    seat.token,
  );

/** A started game: Alice hosts, Bob is Tipster, Carol guesses and listens. */
async function game() {
  const alice = (await call("/sessions", { nickname: "Alice" })).data as Seat;
  const squid = alice.snapshot.squid;
  const join = async (nickname: string) =>
    (await call(`/sessions/${squid}/participants`, { nickname })).data as Seat;
  const bob = await join("Bob");
  const carol = await join("Carol");
  const frames: string[] = [];
  const socket = new WebSocket(
    `wss://${httpHost.replace(".appsync-api.", ".appsync-realtime-api.")}/event/realtime`,
    [
      `header-${Buffer.from(JSON.stringify({ host: httpHost, Authorization: carol.token })).toString("base64url")}`,
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
            authorization: { Authorization: carol.token },
          }),
        );
      if (message.type === "subscribe_success") resolve();
      if (message.type === "data") frames.push(buffer.toString());
    });
  });
  await command(squid, bob, "CLAIM_TIPSTER");
  await command(squid, alice, "START");
  return { squid, bob, carol, frames, close: () => socket.terminate() };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const report: Record<string, unknown> = {};

// 1. Privacy and validation.
{
  const { squid, bob, carol, frames, close } = await game();
  const guesserDraw = await command(squid, carol, "DRAW");
  expect(guesserDraw.status === 403, `Guesser draw → ${guesserDraw.status}`);
  const draw = await command(squid, bob, "DRAW");
  const number = draw.data.currentDraw;
  expect(draw.status === 200 && typeof number === "number", "Tipster draw");
  const guesserView = await call(`/sessions/${squid}`, undefined, carol.token);
  expect(!("currentDraw" in guesserView.data), "Guesser GET has the number");
  const tipsterView = await call(`/sessions/${squid}`, undefined, bob.token);
  expect(tipsterView.data.currentDraw === number, "Tipster reload lost number");
  const twoWords = await command(squid, bob, "SUBMIT_CLUE", {
    clue: "two words",
  });
  expect(
    twoWords.status === 400 && /one word/.test(twoWords.data.message),
    `two words → ${twoWords.status} ${twoWords.data.message}`,
  );
  const duplicate = await command(squid, bob, "SUBMIT_CLUE", {
    clue: ` ${draw.data.cards[1].word.toLowerCase()} `,
  });
  expect(
    duplicate.status === 400 &&
      /already in the circle/.test(duplicate.data.message),
    `duplicate → ${duplicate.status} ${duplicate.data.message}`,
  );
  const sent = await command(squid, bob, "SUBMIT_CLUE", { clue: "river" });
  expect(sent.status === 200 && sent.data.phase === "guess", "valid clue");
  await wait(2_000);
  const seen = await call(`/sessions/${squid}`, undefined, carol.token);
  expect(seen.data.clue === "river", "Guesser does not see the clue");
  expect(
    frames.every((frame) => !frame.includes("currentDraw")),
    "an event contained currentDraw",
  );
  report.events = frames.length;
  close();
}

// 2. Sending during grace, and 3. sending too late, in parallel.
const [graceStatus, lateResult] = await Promise.all([
  (async () => {
    const { squid, bob, close } = await game();
    await command(squid, bob, "DRAW");
    await wait(21_000);
    const sent = await command(squid, bob, "SUBMIT_CLUE", { clue: "river" });
    close();
    return `${sent.status} ${sent.data.phase}`;
  })(),
  (async () => {
    const { squid, bob, carol, close } = await game();
    await command(squid, bob, "DRAW");
    await wait(24_500);
    const sent = await command(squid, bob, "SUBMIT_CLUE", { clue: "river" });
    const view = await call(`/sessions/${squid}`, undefined, carol.token);
    close();
    return {
      status: sent.status,
      message: sent.data.message,
      discarded: view.data.result?.discarded,
    };
  })(),
]);
expect(graceStatus === "200 guess", `send in grace → ${graceStatus}`);
expect(
  lateResult.status === 409 &&
    lateResult.message === "Time is up for this card." &&
    lateResult.discarded === true,
  `send too late → ${JSON.stringify(lateResult)}`,
);

console.log({ ...report, graceStatus, lateResult, failures });
if (failures.length) process.exitCode = 1;
