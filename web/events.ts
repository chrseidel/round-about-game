import type { PublicEvent, PublicSnapshot } from "../shared/protocol.ts";

type EventsConfig = { endpoint: string; squid: string; token: string };
type Listener = (snapshot: PublicSnapshot) => void;

/**
 * AppSync sends a keep-alive every 60 s but allows 5 minutes of silence. A
 * phone's socket can die silently (screen lock, network change), so give up
 * on it after about two missed keep-alives instead.
 */
const SILENCE_MS = 130_000;
/** On resume, a socket this long without a keep-alive is replaced at once. */
const STALE_MS = 70_000;

export class GameEvents {
  private socket: WebSocket | null = null;
  private version = 0;
  private closed = false;
  private retries = 0;
  private subscribed = false;
  private rejected = false;
  private lastKeepalive = 0;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private config: EventsConfig,
    private onUpdate: Listener,
    private catchUp: () => Promise<PublicSnapshot>,
    private onStatus: (connected: boolean) => void = () => {},
    private onEnded: () => void = () => {},
  ) {}

  async connect() {
    this.closed = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
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
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }

  /**
   * The page is visible again or the network is back (a phone was locked or
   * the player switched apps). Events sent meanwhile are not replayed, so
   * fetch the current state now, and replace a connection that has gone
   * quiet without waiting for the growing reconnect delay.
   */
  resume() {
    if (this.closed) return;
    this.retries = 0;
    void this.refresh();
    const stale = Date.now() - this.lastKeepalive > STALE_MS;
    if (this.reconnectTimer || !this.subscribed || stale) {
      const socket = this.socket;
      this.socket = null;
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
      if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
      void this.connect();
    }
  }

  /** Fetches the current state over HTTP (safety net for missed events). */
  catchUpNow() {
    if (!this.closed) void this.refresh();
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
          Math.min(message.connectionTimeoutMs ?? 300000, SILENCE_MS)
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
        if (update.snapshot.version > this.version) this.apply(update.snapshot);
      }
    }
  }

  /** Shows a snapshot unless a newer version is already displayed. */
  apply(snapshot: PublicSnapshot) {
    if (snapshot.version <= this.version) return;
    this.version = snapshot.version;
    this.onUpdate(snapshot);
  }

  private async refresh() {
    try {
      this.apply(await this.catchUp());
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
        this.apply(await this.catchUp());
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
    this.reconnectTimer = setTimeout(() => void this.connect(), delay);
  }
}
