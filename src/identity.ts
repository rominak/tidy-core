/**
 * Cross-MCP identity tagging.
 *
 * Real setups run several Figma MCP servers side by side. Without attribution
 * an agent cannot tell whose response it is reading, and a failure from any of
 * them reads as a failure of this one. This module stamps every response and
 * every error so attribution stays unambiguous.
 *
 * Applied once by wrapping `server.tool`, so all tool registrations inherit it
 * without touching call sites.
 */

export const MCP_ID = "tidy-core";
export const ERROR_PREFIX = `[${MCP_ID}]`;

interface TextBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

interface ToolResult {
  content?: TextBlock[];
  isError?: boolean;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Inject `_mcp` / `_tool` into a JSON-object payload.
 *
 * Only plain objects are rewritten. Arrays, scalars and non-JSON text are
 * returned untouched: wrapping them would change their shape and break any
 * consumer that expects a bare array. Those responses still carry attribution
 * via `_meta` on the result envelope.
 */
export function tagText(text: string, toolName: string): string {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("{")) return text;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return text;
  }

  const payload = parsed as Record<string, unknown>;
  if (payload._mcp === MCP_ID) return text;

  return JSON.stringify({ _mcp: MCP_ID, _tool: toolName, ...payload }, null, 2);
}

/** Prefix an error message with the server id, without double-prefixing. */
export function tagError(message: string, toolName: string): string {
  return message.startsWith(ERROR_PREFIX)
    ? message
    : `${ERROR_PREFIX} ${toolName}: ${message}`;
}

/** Stamp a tool result: identity in the payload, identity in the envelope. */
export function tagResult(result: ToolResult, toolName: string): ToolResult {
  if (!result || typeof result !== "object") return result;

  const content = Array.isArray(result.content)
    ? result.content.map((block) => {
        if (block?.type !== "text" || typeof block.text !== "string") return block;
        return {
          ...block,
          text: result.isError
            ? tagError(block.text, toolName)
            : tagText(block.text, toolName),
        };
      })
    : result.content;

  return {
    ...result,
    ...(content ? { content } : {}),
    _meta: { ...(result._meta ?? {}), mcp: MCP_ID, tool: toolName },
  };
}

type AnyFn = (...args: unknown[]) => unknown;

/**
 * Wrap `server.tool` so every registered handler returns tagged results and
 * throws tagged errors.
 *
 * Arity-agnostic on purpose: the SDK's `tool()` is overloaded
 * (name, [description], [schema], [annotations], handler). We locate the
 * handler as the last function argument and leave everything else alone.
 */
export function withIdentity<T extends { tool: (...args: never[]) => unknown }>(
  server: T,
): T {
  const original = (server.tool as unknown as AnyFn).bind(server) as AnyFn;

  const wrapped = (...args: unknown[]) => {
    const name = typeof args[0] === "string" ? args[0] : "unknown";

    let handlerIndex = -1;
    for (let i = args.length - 1; i > 0; i--) {
      if (typeof args[i] === "function") {
        handlerIndex = i;
        break;
      }
    }
    if (handlerIndex === -1) return original(...args);

    const handler = args[handlerIndex] as AnyFn;
    const next = [...args];

    next[handlerIndex] = async (...handlerArgs: unknown[]) => {
      try {
        const result = await handler(...handlerArgs);
        return tagResult(result as ToolResult, name);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const tagged = new Error(tagError(message, name));
        if (error instanceof Error && error.stack) tagged.stack = error.stack;
        throw tagged;
      }
    };

    return original(...next);
  };

  (server as { tool: unknown }).tool = wrapped;
  return server;
}
