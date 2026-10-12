import WebSocket from "ws";

const [apiUrl, eventUrl] = process.argv.slice(2);
if (!apiUrl || !eventUrl)
  throw new Error("Usage: check-events <game-api-url> <event-api-url>");
const httpHost = new URL(eventUrl).host;
const realtime = `wss://${httpHost.replace(".appsync-api.", ".appsync-realtime-api.")}/event/realtime`;

async function host(
  nickname: string,
): Promise<{ token: string; snapshot: { squid: string } }> {
  const response = await fetch(new URL("/sessions", apiUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nickname }),
  });
  if (!response.ok) throw new Error(`Host failed: ${response.status}`);
  return response.json();
}

async function operation(
  token: string,
  channel: string,
  type: "subscribe" | "publish",
): Promise<string> {
  const protocol = `header-${Buffer.from(JSON.stringify({ host: httpHost, Authorization: token })).toString("base64url")}`;
  const socket = new WebSocket(realtime, [protocol, "aws-appsync-event-ws"]);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error(`Timeout during ${type}`));
    }, 12000);
    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.on("open", () =>
      socket.send(JSON.stringify({ type: "connection_init" })),
    );
    socket.on("message", (buffer) => {
      const message = JSON.parse(buffer.toString());
      if (message.type === "connection_ack") {
        socket.send(
          JSON.stringify({
            type,
            id: "1",
            channel,
            authorization: { Authorization: token },
            ...(type === "publish"
              ? { events: [JSON.stringify({ forged: true })] }
              : {}),
          }),
        );
      }
      if (
        [
          "subscribe_success",
          "subscribe_error",
          "publish_success",
          "publish_error",
          "connection_error",
        ].includes(message.type)
      ) {
        clearTimeout(timeout);
        socket.terminate();
        resolve(message.type);
      }
    });
  });
}

async function receiveEvent(
  token: string,
  room: string,
  squid: string,
): Promise<boolean> {
  const protocol = `header-${Buffer.from(JSON.stringify({ host: httpHost, Authorization: token })).toString("base64url")}`;
  const socket = new WebSocket(realtime, [protocol, "aws-appsync-event-ws"]);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error("No event received"));
    }, 12000);
    socket.on("error", reject);
    socket.on("open", () =>
      socket.send(JSON.stringify({ type: "connection_init" })),
    );
    socket.on("message", async (buffer) => {
      const message = JSON.parse(buffer.toString());
      if (message.type === "connection_ack")
        socket.send(
          JSON.stringify({
            type: "subscribe",
            id: "1",
            channel: room,
            authorization: { Authorization: token },
          }),
        );
      if (message.type === "subscribe_success") {
        // A real committed write; the table stream must publish it.
        const response = await fetch(
          new URL(`/sessions/${squid}/participants`, apiUrl),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ nickname: "Probe" }),
          },
        );
        if (!response.ok) {
          clearTimeout(timeout);
          socket.terminate();
          reject(new Error(`Join failed: ${response.status}`));
        }
      }
      if (message.type === "data") {
        clearTimeout(timeout);
        socket.terminate();
        const events = Array.isArray(message.event)
          ? message.event
          : [message.event];
        resolve(
          events.some((raw: string | object) => {
            const text = typeof raw === "string" ? raw : JSON.stringify(raw);
            const event = JSON.parse(text);
            return (
              event?.type === "game_updated" &&
              event.snapshot.version === 2 &&
              event.snapshot.participants.length === 2 &&
              !/tokenHash|currentDraw|deck/.test(text)
            );
          }),
        );
      }
    });
  });
}

const member = await host("Member");
const outsider = await host("Outsider");
const room = `/games/${member.snapshot.squid}`;
const results = {
  member: await operation(member.token, room, "subscribe"),
  outsider: await operation(outsider.token, room, "subscribe"),
  wildcard: await operation(member.token, "/games/*", "subscribe"),
  forgedPublish: await operation(member.token, room, "publish"),
  backendDelivered: await receiveEvent(
    member.token,
    room,
    member.snapshot.squid,
  ),
};
console.log(results);
if (
  results.member !== "subscribe_success" ||
  results.outsider !== "subscribe_error" ||
  results.wildcard !== "subscribe_error" ||
  results.forgedPublish !== "publish_error" ||
  !results.backendDelivered
)
  process.exitCode = 1;
