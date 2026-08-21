#!/usr/bin/env node
/**
 * tidy-core — design system governance over MCP.
 *
 * Thirteen tools, not a hundred. Each one answers a question a design system
 * lead actually asks, rather than exposing an API verb. See docs/spec.md for
 * why the surface is deliberately small.
 *
 * Architecture:
 *   MCP client <-stdio-> this server <-WebSocket-> Figma plugin -> Figma
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { FigmaBridge } from "./bridge.js";
import { MCP_ID, withIdentity } from "./identity.js";
import { mcpLogger } from "./logger.js";
import { status } from "./core/status.js";
import { target } from "./core/target.js";
import { context } from "./core/context.js";
import { PLANNED, notImplemented } from "./core/stubs.js";

const PORT = Number(process.env.TIDY_PORT ?? 9240);

const bridge = new FigmaBridge(PORT);

const server = withIdentity(
  new McpServer({ name: MCP_ID, version: "0.1.0" }),
);

const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

// ---------------------------------------------------------------------------
// Implemented
// ---------------------------------------------------------------------------

server.tool(
  "tidy_status",
  "Check where tidy-core is connected and where the next command will land. Read the `routing` field first: it says in plain language which Figma file commands go to. When nothing is connected it returns concrete fixes rather than just `connected: false`.",
  {},
  async () => json(status(bridge)),
);

server.tool(
  "tidy_target",
  "Pin every subsequent command to one connected Figma file. Accepts a file name (for example 'Design System') or a file key. Call with no arguments to see the current target, or clear: true to unpin. When several files are connected and no target is set, commands fail with a list of the files rather than guessing, because guessing means writing to the wrong file.",
  {
    file: z
      .string()
      .optional()
      .describe("File name or key to pin. Names match exactly first, then case-insensitively."),
    clear: z.boolean().optional().describe("Unpin the current target."),
  },
  async ({ file, clear }) => json(target(bridge, { file, clear })),
);

server.tool(
  "tidy_context",
  "Get the design system contract in one call: collections, modes, token names grouped by intent, component variant axes, and the naming and binding conventions actually in use. Call this before writing anything into the file. Without it an agent guesses token names, and guessed names are how raw hex ends up in a component.",
  {
    detail: z
      .enum(["summary", "full"])
      .optional()
      .describe("summary groups tokens by naming prefix. full returns every token. Default summary."),
    include: z
      .array(z.enum(["tokens", "components", "rules"]))
      .optional()
      .describe("Which parts to return. Default all three."),
    figmaFile: z
      .string()
      .optional()
      .describe("Run against a specific connected file, overriding the target lock for this call."),
  },
  async ({ detail, include, figmaFile }) => json(await context(bridge, { detail, include, figmaFile })),
);

// ---------------------------------------------------------------------------
// Specified, not yet built
//
// Registered deliberately. A visible, honest refusal beats a hidden tool or a
// plausible-looking empty result.
// ---------------------------------------------------------------------------

for (const planned of PLANNED) {
  server.tool(
    planned.name,
    `[NOT IMPLEMENTED YET] ${planned.description}`,
    {},
    async () => notImplemented(planned),
  );
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Report the port it actually got, not the one it asked for. They differ
  // whenever the preferred port was busy.
  const port = await bridge.start();
  mcpLogger.info({ port, preferred: PORT }, "Bridge listening");

  const transport = new StdioServerTransport();
  await server.connect(transport);
  mcpLogger.info({ tools: 3 + PLANNED.length }, "tidy-core ready");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void bridge.stop().finally(() => process.exit(0));
  });
}

main().catch((error) => {
  mcpLogger.error({ err: error }, "Failed to start");
  process.exit(1);
});
