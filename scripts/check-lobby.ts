// Exercises Task 9 against a deployed sandbox: first-claim Tipster, host-only start, late join.
import { PROTOCOL_VERSION } from "../shared/protocol.ts";

const [apiUrl] = process.argv.slice(2);
if (!apiUrl) throw new Error("Usage: check-lobby <game-api-url>");
const base = apiUrl.replace(/\/$/, "");

type Seat = {
  participantId: string;
  token: string;
  snapshot: { squid: string; tipsterId: string | null; status: string };
};

async function post(path: string, body: object, token?: string) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

const command = (squid: string, token: string, type: string) =>
  post(
    `/sessions/${squid}/commands`,
    {
      protocolVersion: PROTOCOL_VERSION,
      turnId: "",
      commandId: crypto.randomUUID(),
      expectedVersion: 0,
      command: { type },
    },
    token,
  );

const failures: string[] = [];
const expect = (ok: boolean, label: string) => {
  if (!ok) failures.push(label);
};

const host = (await post("/sessions", { nickname: "Alice" })).data as Seat;
const squid = host.snapshot.squid;
const join = async (nickname: string) =>
  (await post(`/sessions/${squid}/participants`, { nickname })).data as Seat;
const players = [
  host,
  await join("Bob"),
  await join("Carol"),
  await join("Dave"),
];
const names = ["Alice", "Bob", "Carol", "Dave"];

const badToken = await command(squid, "not-a-token", "CLAIM_TIPSTER");
expect(badToken.status === 401, `bad token → ${badToken.status}, want 401`);

const claims = await Promise.all(
  players.map((seat) => command(squid, seat.token, "CLAIM_TIPSTER")),
);
const winners = claims.flatMap((claim, index) =>
  claim.status === 200 ? [index] : [],
);
expect(winners.length === 1, `claims won: ${winners.length}, want 1`);
const winner = names[winners[0] ?? -1];
for (const claim of claims.filter((claim) => claim.status !== 200))
  expect(
    claim.status === 409 &&
      claim.data.message === `${winner} is already the Tipster.`,
    `losing claim → ${claim.status} ${claim.data.message}`,
  );

const guestStart = await command(squid, players[1]!.token, "START");
expect(guestStart.status === 403, `non-host start → ${guestStart.status}`);
const hostStart = await command(squid, host.token, "START");
expect(
  hostStart.status === 200 && hostStart.data.status === "playing",
  `host start → ${hostStart.status} ${hostStart.data.status}`,
);

const late = await join("Erin");
expect(
  late.snapshot.tipsterId === players[winners[0] ?? 0]!.participantId,
  "late joiner sees a different Tipster",
);
const lateClaim = await command(squid, late.token, "CLAIM_TIPSTER");
expect(
  lateClaim.status === 409 &&
    lateClaim.data.message === "The game has already started.",
  `late claim → ${lateClaim.status} ${lateClaim.data.message}`,
);

console.log({
  squid,
  claimStatuses: claims.map((claim) => claim.status),
  tipster: winner,
  nonHostStart: guestStart.status,
  hostStart: hostStart.status,
  lateClaim: lateClaim.status,
  failures,
});
if (failures.length) process.exitCode = 1;
