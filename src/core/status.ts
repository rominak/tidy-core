import type { FigmaBridge } from "../bridge.js";

/**
 * Where is Tidy connected, and where will the next command land?
 *
 * `routing` is the field to read first. It answers the question in plain
 * language instead of making the caller infer it from a connection array.
 */
export function status(bridge: FigmaBridge) {
  const s = bridge.getStatus();

  return {
    connected: s.connected,
    port: s.port,
    routing: s.routing,
    target: s.target,
    connections: s.connections,
    ...(s.connected
      ? {}
      : {
          fix: [
            "Open the file in Figma Desktop. A browser tab cannot reach a localhost WebSocket, which is the most common cause.",
            "Run the tidy-core plugin: Plugins > Development > Import plugin from manifest, then select plugin/manifest.json from this repo.",
            "If the plugin was already running when this server started, close and re-run it. It does not reconnect on its own.",
          ],
        }),
  };
}
