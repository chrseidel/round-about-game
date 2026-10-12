import type { PublicEvent, PublicSnapshot } from "../shared/protocol.ts";

type EventsConfig = { endpoint: string; squid: string; token: string };
type Listener = (snapshot: PublicSnapshot) => void;

export class GameEvents {
  private socket: WebSocket | null = null;
  private version = 0;
  private closed = false;
  private retries = 0;
  private subscribed = false;
  private rejected = false;
  private lastKeepalive = 0;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private config: EventsConfig,
    private onUpdate: Listener,
    private catchUp: () => Promise<PublicSnapshot>,
    private onStatus: (connected: boolean) => void = () => {},
    private onEnded: () => void = () => {},
  ) {}

  async connect() {
    this.closed = false;
    const host = new URL(this.config.endpoint).host;
    const authorization = btoa(
      JSON.stringify({ host, Authorization: this.config.token }),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const url = `wss://${host.replace(".appsync-api.", ".appsync-realtime-api.")}/event/realtime`;
    const socket = new WebSocket(url, [
      `header-${authorization}`,
      "aws-appsync-event-ws",
    ]);
    this.socket = socket;
    this.subscribed = false;
    this.rejected = false;
    socket.onopen = () =>
      socket.send(JSON.stringify({ type: "connection_init" }));
    socket.onmessage = (event) => void this.handle(JSON.parse(event.data));
    socket.onclose = () => void this.disconnected();
    socket.onerror = () => socket.close();
  }

  close() {
    this.closed = true;
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    this.socket?.close();
  }

  private async handle(message: {
    type: string;
    event?: string | string[];
    connectionTimeoutMs?: number;
  }) {
    if (message.type === "connection_ack") {
      this.retries = 0;
      this.lastKeepalive = Date.now();
      if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = setInterval(() => {
        if (
          Date.now() - this.lastKeepalive >
          (message.connectionTimeoutMs ?? 300000)
        )
          this.socket?.close();
      }, 10000);
      this.socket?.send(
        JSON.stringify({
          type: "subscribe",
          id: "game",
          channel: `/games/${this.config.squid}`,
          authorization: { Authorization: this.config.token },
        }),
      );
    }
    if (message.type === "ka") this.lastKeepalive = Date.now();
    if (message.type === "subscribe_success") {
      this.subscribed = true;
      this.onStatus(true);
      await this.refresh();
    }
    if (
      message.type === "subscribe_error" ||
      message.type === "connection_error"
    ) {
      this.rejected = true;
      this.socket?.close();
    }
    if (message.type === "data") {
      if (!this.subscribed) return;
      const events = Array.isArray(message.event)
        ? message.event
        : [message.event];
      for (const raw of events) {
        if (!raw) continue;
        const update = (
          typeof raw === "string" ? JSON.parse(raw) : raw
        ) as PublicEvent;
        if (
          update.type !== "game_updated" ||
          update.snapshot.squid !== this.config.squid
        )
          continue;
        if (update.snapshot.version <= this.version) continue;
        if (update.snapshot.version > this.version + 1) await this.refresh();
        if (update.snapshot.version > this.version)
          this.accept(update.snapshot);
      }
    }
  }

  private accept(snapshot: PublicSnapshot) {
    if (snapshot.version <= this.version) return;
    this.version = snapshot.version;
    this.onUpdate(snapshot);
  }

  private async refresh() {
    try {
      this.accept(await this.catchUp());
    } catch {
      this.onStatus(false);
    }
  }

  private async disconnected() {
    this.onStatus(false);
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    if (this.closed) return;
    // A rejection is final only if the API also no longer accepts the seat;
    // otherwise treat it as a transient authorizer failure and keep retrying.
    if (this.rejected) {
      try {
        this.accept(await this.catchUp());
      } catch (error) {
        if ([401, 404].includes((error as { status?: number }).status ?? 0)) {
          this.close();
          this.onEnded();
          return;
        }
      }
    }
    const delay =
      Math.min(30000, 1000 * 2 ** Math.min(this.retries++, 5)) +
      Math.random() * 300;
    setTimeout(() => void this.connect(), delay);
  }
}
