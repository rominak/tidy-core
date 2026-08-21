/**
 * WebSocket Bridge — connects the MCP server to the Figma plugin
 *
 * The Figma plugin opens a WebSocket connection to this server.
 * The MCP server sends commands through the bridge and receives
 * results, snapshots, and real-time events.
 */

import { WebSocketServer, WebSocket } from "ws";
import { EventEmitter } from "events";
import { bridgeLogger } from "./logger.js";
import { withRetry } from "./utils/retry.js";

export interface PluginConnection {
  ws: WebSocket;
  pluginId: string;
  fileKey: string;
  fileName: string;
  connectedAt: Date;
}

export interface CommandResult {
  id: string;
  result: unknown;
  error: string | null;
}

export class FigmaBridge extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private connections: Map<string, PluginConnection> = new Map();
  private pendingCommands: Map<string, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();
  private commandId = 0;
  private targetFileKey: string | null = null;
  private port: number;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private aliveFlags: Map<string, boolean> = new Map();

  constructor(preferredPort: number = 9240) {
    super();
    this.port = preferredPort;
  }

  /** How many ports past the preferred one to try. The plugin scans the same range. */
  private static readonly PORT_SCAN = 10;

  /**
   * Start the WebSocket server, moving to the next free port if the preferred
   * one is taken.
   *
   * It deliberately does not kill whatever holds the port. On your own machine
   * that is usually your own stale instance, but it might equally be someone
   * else's tool, and a design system server has no business sending SIGKILL to
   * a process it cannot identify. The plugin scans the whole range anyway, so
   * moving over costs nothing.
   */
  async start(): Promise<number> {
    const first = this.port;
    const last = first + FigmaBridge.PORT_SCAN - 1;

    for (let candidate = first; candidate <= last; candidate++) {
      try {
        await this.startOnPort(candidate);
        this.port = candidate;
        if (candidate !== first) {
          bridgeLogger.info(
            { port: candidate, preferred: first },
            "Preferred port was busy, listening on the next free one",
          );
        } else {
          bridgeLogger.info({ port: candidate }, "WebSocket bridge listening");
        }
        return candidate;
      } catch (e: unknown) {
        const err = e as NodeJS.ErrnoException;
        if (err.code !== "EADDRINUSE") throw e;
        this.wss = null;
      }
    }

    throw new Error(
      `Every port from ${first} to ${last} is in use, so tidy-core cannot start. ` +
        `Close another copy of it if one is running, or set TIDY_PORT to a free port.`,
    );
  }

  private startOnPort(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      // No host = listen on :: (dual-stack: both IPv4 and IPv6)
      // Figma's WebView resolves "localhost" to either, so we accept both
      this.wss = new WebSocketServer({ port });

      this.wss.on("listening", () => {
        this.startHeartbeat();
        resolve();
      });
      this.wss.on("error", (err) => reject(err));

      this.wss.on("connection", (ws: WebSocket) => {
        this.handleConnection(ws);
      });
    });
  }

  private handleConnection(ws: WebSocket): void {
    let connectionId: string | null = null;

    // Heartbeat: mark alive on pong
    (ws as unknown as Record<string, boolean>).__alive = true;
    ws.on("pong", () => {
      if (connectionId) this.aliveFlags.set(connectionId, true);
    });

    ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        switch (msg.type) {
          case "register":
            connectionId = `${msg.fileKey}-${Date.now()}`;
            this.connections.set(connectionId, {
              ws,
              pluginId: msg.pluginId,
              fileKey: msg.fileKey,
              fileName: msg.fileName,
              connectedAt: new Date(),
            });
            this.aliveFlags.set(connectionId, true);
            bridgeLogger.info({ fileName: msg.fileName, fileKey: msg.fileKey }, "Plugin connected");
            ws.send(JSON.stringify({ type: "ack", message: "Registered with Tidy" }));
            this.emit("pluginConnected", { fileKey: msg.fileKey, fileName: msg.fileName });
            break;

          case "commandResult":
            this.handleCommandResult(msg);
            break;

          case "snapshot":
            this.emit("snapshot", msg.data, msg.timestamp);
            break;

          case "selectionChange":
            this.emit("selectionChange", msg);
            break;

          case "documentChange":
            this.emit("documentChange", msg);
            break;
        }
      } catch (e) {
        bridgeLogger.error({ err: e }, "Invalid message from plugin");
      }
    });

    ws.on("close", () => {
      if (connectionId) {
        const conn = this.connections.get(connectionId);
        if (conn) {
          bridgeLogger.info({ fileName: conn.fileName }, "Plugin disconnected");
          this.emit("pluginDisconnected", { fileKey: conn.fileKey, fileName: conn.fileName });
        }
        this.connections.delete(connectionId);
        this.aliveFlags.delete(connectionId);
      }
    });
  }

  /**
   * Send a command to the Figma plugin and wait for a response.
   * Retries up to 2 additional times on timeout errors (1s, 2s backoff).
   * Does NOT retry on "No Figma plugin connected" errors.
   *
   * `fileRef` (file key or file name) overrides the target lock for this call
   * only. Omit it to use the target lock, or the sole connected file.
   */
  async sendCommand(
    command: string,
    params: Record<string, unknown> = {},
    timeoutMs: number = 30000,
    fileRef?: string,
  ): Promise<unknown> {
    return withRetry(
      () => this.sendCommandOnce(command, params, timeoutMs, fileRef),
      {
        maxAttempts: 3,
        baseDelayMs: 1000,
        backoffFactor: 2,
        retryOn: (err) => {
          // Only retry on timeout errors, not on plugin-not-connected
          if (err instanceof Error && err.message.includes("timed out")) return true;
          return false;
        },
      },
    );
  }

  private async sendCommandOnce(
    command: string,
    params: Record<string, unknown>,
    timeoutMs: number,
    fileRef?: string,
  ): Promise<unknown> {
    const conn = this.routeConnection(fileRef);

    const id = `cmd-${++this.commandId}`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(id);
        reject(new Error(`Command "${command}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingCommands.set(id, { resolve, reject, timeout });

      conn.ws.send(JSON.stringify({
        type: "command",
        id,
        command,
        params,
      }));
    });
  }

  private handleCommandResult(msg: CommandResult): void {
    const pending = this.pendingCommands.get(msg.id);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingCommands.delete(msg.id);

    if (msg.error) {
      pending.reject(new Error(msg.error));
    } else {
      pending.resolve(msg.result);
    }
  }

  /**
   * Get the first active connection (or a specific one by fileKey)
   */
  private getActiveConnection(fileKey?: string): PluginConnection | null {
    if (fileKey) {
      for (const conn of this.connections.values()) {
        if (conn.fileKey === fileKey && conn.ws.readyState === WebSocket.OPEN) {
          return conn;
        }
      }
      return null;
    }

    // Return first active connection
    for (const conn of this.connections.values()) {
      if (conn.ws.readyState === WebSocket.OPEN) {
        return conn;
      }
    }
    return null;
  }

  /** Every currently open connection. */
  private openConnections(): PluginConnection[] {
    return [...this.connections.values()].filter(
      (c) => c.ws.readyState === WebSocket.OPEN,
    );
  }

  /**
   * Resolve a file reference to a connection.
   *
   * Accepts a file key or a file name, because an agent almost always knows
   * "Foundation" and almost never knows "Ae276dKFEtgbkeIBMRdrBG".
   * Match order: exact key, exact name, case-insensitive name.
   *
   * Throws on an ambiguous name rather than guessing. Guessing is the bug
   * this whole mechanism exists to remove.
   */
  private resolveConnection(ref: string): PluginConnection {
    const open = this.openConnections();
    const available = open.map((c) => `${c.fileName} (${c.fileKey})`).join(", ") || "none";

    const byKey = open.find((c) => c.fileKey === ref);
    if (byKey) return byKey;

    const exactName = open.filter((c) => c.fileName === ref);
    const named = exactName.length
      ? exactName
      : open.filter((c) => c.fileName.toLowerCase() === ref.toLowerCase());

    if (named.length === 1) return named[0];
    if (named.length > 1) {
      throw new Error(
        `Ambiguous file reference "${ref}": ${named.length} connected files share that name. ` +
          `Use a file key instead. Connected: ${available}`,
      );
    }

    throw new Error(
      `No connected Figma file matches "${ref}". Connected: ${available}. ` +
        `Open the Tidy plugin in the file you want, then retry.`,
    );
  }

  /**
   * Pin all subsequent commands to one file. Pass undefined to clear.
   * Returns the resolved connection so callers can confirm what they locked.
   */
  setTarget(ref?: string): { fileKey: string; fileName: string } | null {
    if (!ref) {
      this.targetFileKey = null;
      bridgeLogger.info("Target lock cleared");
      return null;
    }
    const conn = this.resolveConnection(ref);
    this.targetFileKey = conn.fileKey;
    bridgeLogger.info({ fileKey: conn.fileKey, fileName: conn.fileName }, "Target lock set");
    return { fileKey: conn.fileKey, fileName: conn.fileName };
  }

  /** The currently pinned file, if any. */
  getTarget(): { fileKey: string; fileName: string } | null {
    if (!this.targetFileKey) return null;
    const conn = this.openConnections().find((c) => c.fileKey === this.targetFileKey);
    return conn ? { fileKey: conn.fileKey, fileName: conn.fileName } : null;
  }

  /**
   * Pick the connection a command should go to.
   *
   * 1. Explicit per-call reference wins.
   * 2. Otherwise the target lock.
   * 3. Otherwise the sole open connection.
   * 4. With several files open and no target, throw. "First socket wins" is a
   *    coin flip, and losing it silently writes to the wrong file.
   */
  private routeConnection(ref?: string): PluginConnection {
    if (ref) return this.resolveConnection(ref);

    const open = this.openConnections();
    if (open.length === 0) {
      throw new Error("No Figma plugin connected. Open the tidy-core plugin in Figma Desktop.");
    }

    if (this.targetFileKey) {
      const pinned = open.find((c) => c.fileKey === this.targetFileKey);
      if (pinned) return pinned;
      throw new Error(
        `Target file ${this.targetFileKey} is no longer connected. ` +
          `Connected: ${open.map((c) => `${c.fileName} (${c.fileKey})`).join(", ")}. ` +
          `Set a new target with tidy_target.`,
      );
    }

    if (open.length === 1) return open[0];

    throw new Error(
      `${open.length} Figma files are connected and no target is set, so Tidy cannot tell ` +
        `which one you mean: ${open.map((c) => `${c.fileName} (${c.fileKey})`).join(", ")}. ` +
        `Call tidy_target to pin one, or pass figmaFile on this call.`,
    );
  }

  /**
   * Check if any plugin is connected
   */
  isConnected(): boolean {
    return this.getActiveConnection() !== null;
  }

  /**
   * Get status of all connections
   */
  getStatus(): {
    connected: boolean;
    port: number;
    connections: Array<{ fileKey: string; fileName: string; connectedAt: string; isTarget: boolean }>;
    target: { fileKey: string; fileName: string } | null;
    routing: string;
  } {
    const conns = [];
    for (const conn of this.connections.values()) {
      if (conn.ws.readyState === WebSocket.OPEN) {
        conns.push({
          fileKey: conn.fileKey,
          fileName: conn.fileName,
          connectedAt: conn.connectedAt.toISOString(),
          isTarget: conn.fileKey === this.targetFileKey,
        });
      }
    }

    const target = this.getTarget();
    const routing = !conns.length
      ? "No plugin connected. Open the Tidy plugin in Figma Desktop."
      : target
        ? `Commands go to "${target.fileName}". Change it with tidy_target.`
        : conns.length === 1
          ? `Commands go to "${conns[0].fileName}" (the only connected file).`
          : `${conns.length} files connected and no target set. Commands will fail until you call tidy_target.`;

    return { connected: conns.length > 0, port: this.port, connections: conns, target, routing };
  }

  /**
   * Start heartbeat: ping every 30s, terminate if no pong within 10s.
   * Prevents silent connection drops from going unnoticed.
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const [id, conn] of this.connections) {
        if (!this.aliveFlags.get(id)) {
          // No pong received since last ping — connection is dead
          bridgeLogger.warn({ fileName: conn.fileName }, "Heartbeat timeout, terminating dead connection");
          conn.ws.terminate();
          this.connections.delete(id);
          this.aliveFlags.delete(id);
          this.emit("pluginDisconnected", { fileKey: conn.fileKey, fileName: conn.fileName });
          continue;
        }
        // Mark as not-alive, then ping. If pong comes back, it gets marked alive again.
        this.aliveFlags.set(id, false);
        if (conn.ws.readyState === WebSocket.OPEN) {
          conn.ws.ping();
        }
      }
    }, 30_000);
    this.heartbeatInterval.unref();
  }

  /**
   * Shutdown
   */
  async stop(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    for (const conn of this.connections.values()) {
      conn.ws.close();
    }
    this.connections.clear();
    this.aliveFlags.clear();
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }
}
