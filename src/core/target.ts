import type { FigmaBridge } from "../bridge.js";

/**
 * Pin every subsequent command to one connected file.
 *
 * With several files connected and no target, the bridge refuses to route
 * rather than picking the first open socket. Picking is a coin flip, and
 * losing it silently writes to the wrong file.
 */
export function target(bridge: FigmaBridge, opts: { file?: string; clear?: boolean }) {
  if (opts.clear) {
    bridge.setTarget(undefined);
  } else if (opts.file) {
    bridge.setTarget(opts.file);
  }

  const s = bridge.getStatus();
  return { target: s.target, routing: s.routing, connections: s.connections };
}
