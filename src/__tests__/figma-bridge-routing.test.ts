import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { FigmaBridge } from "../bridge.js";

/** Connect a mock "plugin" client to the bridge and register it. */
async function connectPlugin(
  port: number,
  opts: { fileKey?: string; fileName?: string; pluginId?: string } = {},
): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });

  ws.send(
    JSON.stringify({
      type: "register",
      pluginId: opts.pluginId ?? "plugin-1",
      fileKey: opts.fileKey ?? "abc123",
      fileName: opts.fileName ?? "My Design System",
    }),
  );

  await new Promise<void>((resolve) => {
    ws.on("message", function handler(data) {
      const msg = JSON.parse(data.toString());
      if (msg.type === "ack") {
        ws.off("message", handler);
        resolve();
      }
    });
  });

  return ws;
}

/** Auto-reply to any command, echoing which file received it. */
function autoRespond(ws: WebSocket, fileKey: string): void {
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "command") {
      ws.send(JSON.stringify({ type: "commandResult", id: msg.id, result: { ranIn: fileKey }, error: null }));
    }
  });
}

describe("FigmaBridge routing", () => {
  let bridge: FigmaBridge;
  let port: number;
  const basePort = 19600 + Math.floor(Math.random() * 200);
  let portCounter = 0;

  beforeEach(async () => {
    port = basePort + portCounter++ * 10;
    bridge = new FigmaBridge(port);
    await bridge.start();
  });

  afterEach(async () => {
    await bridge.stop();
  });

  it("routes to the sole connected file without a target", async () => {
    const ws = await connectPlugin(port, { fileKey: "foundation", fileName: "Foundation" });
    autoRespond(ws, "foundation");

    expect(await bridge.sendCommand("noop", {}, 2000)).toEqual({ ranIn: "foundation" });
    ws.close();
  });

  it("refuses to guess when several files are connected and no target is set", async () => {
    const a = await connectPlugin(port, { fileKey: "foundation", fileName: "Foundation", pluginId: "p1" });
    const b = await connectPlugin(port, { fileKey: "master", fileName: "Product Master", pluginId: "p2" });
    autoRespond(a, "foundation");
    autoRespond(b, "master");

    await expect(bridge.sendCommand("noop", {}, 2000)).rejects.toThrow(
      /2 Figma files are connected and no target is set/,
    );
    a.close();
    b.close();
  });

  it("names the connected files in the ambiguity error", async () => {
    const a = await connectPlugin(port, { fileKey: "foundation", fileName: "Foundation", pluginId: "p1" });
    const b = await connectPlugin(port, { fileKey: "master", fileName: "Product Master", pluginId: "p2" });

    await expect(bridge.sendCommand("noop", {}, 2000)).rejects.toThrow(/Foundation.*Product Master/s);
    a.close();
    b.close();
  });

  it("routes to the target lock once set, by file name", async () => {
    const a = await connectPlugin(port, { fileKey: "foundation", fileName: "Foundation", pluginId: "p1" });
    const b = await connectPlugin(port, { fileKey: "master", fileName: "Product Master", pluginId: "p2" });
    autoRespond(a, "foundation");
    autoRespond(b, "master");

    expect(bridge.setTarget("Foundation")).toEqual({
      fileKey: "foundation",
      fileName: "Foundation",
    });
    expect(await bridge.sendCommand("noop", {}, 2000)).toEqual({ ranIn: "foundation" });
    a.close();
    b.close();
  });

  it("matches a file name case-insensitively", async () => {
    const a = await connectPlugin(port, { fileKey: "foundation", fileName: "Foundation", pluginId: "p1" });
    const b = await connectPlugin(port, { fileKey: "master", fileName: "Product Master", pluginId: "p2" });
    autoRespond(a, "foundation");
    autoRespond(b, "master");

    // "product master" matches file b by name only. It is not any file's key,
    // so a pass here cannot be explained by the key branch.
    bridge.setTarget("product master");
    expect(await bridge.sendCommand("noop", {}, 2000)).toEqual({ ranIn: "master" });
    a.close();
    b.close();
  });

  it("matches by file key too", async () => {
    const a = await connectPlugin(port, { fileKey: "foundation", fileName: "Foundation", pluginId: "p1" });
    const b = await connectPlugin(port, { fileKey: "master", fileName: "Product Master", pluginId: "p2" });
    autoRespond(a, "foundation");
    autoRespond(b, "master");

    bridge.setTarget("master");
    expect(await bridge.sendCommand("noop", {}, 2000)).toEqual({ ranIn: "master" });
    a.close();
    b.close();
  });

  it("lets a per-call reference override the target lock", async () => {
    const a = await connectPlugin(port, { fileKey: "foundation", fileName: "Foundation", pluginId: "p1" });
    const b = await connectPlugin(port, { fileKey: "master", fileName: "Product Master", pluginId: "p2" });
    autoRespond(a, "foundation");
    autoRespond(b, "master");

    bridge.setTarget("Foundation");
    expect(await bridge.sendCommand("noop", {}, 2000, "Product Master")).toEqual({ ranIn: "master" });
    // lock is untouched by the one-off
    expect(await bridge.sendCommand("noop", {}, 2000)).toEqual({ ranIn: "foundation" });
    a.close();
    b.close();
  });

  it("throws a listing error for an unknown file reference", async () => {
    const ws = await connectPlugin(port, { fileKey: "foundation", fileName: "Foundation" });

    await expect(bridge.sendCommand("noop", {}, 2000, "Nope")).rejects.toThrow(
      /No connected Figma file matches "Nope".*Foundation/s,
    );
    ws.close();
  });

  it("refuses an ambiguous file name rather than picking one", async () => {
    const a = await connectPlugin(port, { fileKey: "k1", fileName: "Untitled", pluginId: "p1" });
    const b = await connectPlugin(port, { fileKey: "k2", fileName: "Untitled", pluginId: "p2" });

    expect(() => bridge.setTarget("Untitled")).toThrow(/Ambiguous file reference "Untitled"/);
    a.close();
    b.close();
  });

  it("clears the target lock", async () => {
    const ws = await connectPlugin(port, { fileKey: "foundation", fileName: "Foundation" });
    bridge.setTarget("Foundation");
    expect(bridge.getTarget()).not.toBeNull();
    expect(bridge.setTarget(undefined)).toBeNull();
    expect(bridge.getTarget()).toBeNull();
    ws.close();
  });

  it("reports routing and the target flag in status", async () => {
    const a = await connectPlugin(port, { fileKey: "foundation", fileName: "Foundation", pluginId: "p1" });
    const b = await connectPlugin(port, { fileKey: "master", fileName: "Product Master", pluginId: "p2" });

    expect(bridge.getStatus().routing).toMatch(/2 files connected and no target set/);

    bridge.setTarget("Product Master");
    const status = bridge.getStatus();
    expect(status.routing).toBe('Commands go to "Product Master". Change it with tidy_target.');
    expect(status.target).toEqual({ fileKey: "master", fileName: "Product Master" });
    expect(status.connections.find((c) => c.fileKey === "master")?.isTarget).toBe(true);
    expect(status.connections.find((c) => c.fileKey === "foundation")?.isTarget).toBe(false);
    a.close();
    b.close();
  });

  it("errors clearly when the pinned file disconnects", async () => {
    const a = await connectPlugin(port, { fileKey: "foundation", fileName: "Foundation", pluginId: "p1" });
    const b = await connectPlugin(port, { fileKey: "master", fileName: "Product Master", pluginId: "p2" });
    bridge.setTarget("Foundation");

    a.close();
    await new Promise((r) => setTimeout(r, 100));

    await expect(bridge.sendCommand("noop", {}, 2000)).rejects.toThrow(/no longer connected/);
    b.close();
  });

  it("still reports plugin-not-connected when nothing is open", async () => {
    await expect(bridge.sendCommand("noop", {}, 2000)).rejects.toThrow(/No Figma plugin connected/);
  });
});
