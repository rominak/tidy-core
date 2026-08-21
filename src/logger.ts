/**
 * Structured logger.
 *
 * All output goes to stderr (fd 2) because stdout is reserved for the MCP
 * protocol over stdio. Writing a stray line to stdout corrupts the stream and
 * the client disconnects with a parse error, so never console.log here.
 *
 * For human-readable local output:
 *   LOG_LEVEL=debug node dist/index.js 2>&1 | pino-pretty
 */

import pino from "pino";

export const logger = pino(
  {
    name: "tidy-core",
    level: process.env.LOG_LEVEL || "info",
  },
  pino.destination(2),
);

export const bridgeLogger = logger.child({ module: "bridge" });
export const mcpLogger = logger.child({ module: "mcp" });
