import { describe, it, expect, vi } from "vitest";
import {
  MCP_ID,
  ERROR_PREFIX,
  tagText,
  tagError,
  tagResult,
  withIdentity,
} from "../identity.js";

describe("tagText", () => {
  it("injects _mcp and _tool into a JSON object payload", () => {
    const out = JSON.parse(tagText(JSON.stringify({ score: 82 }), "tidy_score"));
    expect(out._mcp).toBe(MCP_ID);
    expect(out._tool).toBe("tidy_score");
    expect(out.score).toBe(82);
  });

  it("puts identity keys first so they survive truncation", () => {
    const keys = Object.keys(JSON.parse(tagText('{"a":1}', "tidy_score")));
    expect(keys.slice(0, 2)).toEqual(["_mcp", "_tool"]);
  });

  it("leaves arrays untouched so bare-array consumers do not break", () => {
    const input = JSON.stringify([1, 2, 3]);
    expect(tagText(input, "tidy_score")).toBe(input);
  });

  it("leaves non-JSON text untouched", () => {
    expect(tagText("plugin not connected", "tidy_status")).toBe("plugin not connected");
  });

  it("leaves malformed JSON untouched", () => {
    expect(tagText("{oops", "tidy_status")).toBe("{oops");
  });

  it("is idempotent", () => {
    const once = tagText('{"a":1}', "tidy_score");
    expect(tagText(once, "tidy_score")).toBe(once);
  });
});

describe("tagError", () => {
  it("prefixes with the server id and tool name", () => {
    expect(tagError("boom", "tidy_execute")).toBe(`${ERROR_PREFIX} tidy_execute: boom`);
  });

  it("does not double-prefix", () => {
    const once = tagError("boom", "tidy_execute");
    expect(tagError(once, "tidy_execute")).toBe(once);
  });
});

describe("tagResult", () => {
  it("tags text payloads and stamps _meta", () => {
    const result = tagResult(
      { content: [{ type: "text", text: '{"ok":true}' }] },
      "tidy_score",
    );
    expect(JSON.parse(result.content![0].text!)._mcp).toBe(MCP_ID);
    expect(result._meta).toEqual({ mcp: MCP_ID, tool: "tidy_score" });
  });

  it("prefixes text on error results instead of injecting keys", () => {
    const result = tagResult(
      { content: [{ type: "text", text: "bridge timeout" }], isError: true },
      "tidy_execute",
    );
    expect(result.content![0].text).toBe(`${ERROR_PREFIX} tidy_execute: bridge timeout`);
  });

  it("passes non-text blocks through unchanged", () => {
    const block = { type: "image", data: "abc", mimeType: "image/png" };
    const result = tagResult({ content: [block] }, "tidy_screenshot");
    expect(result.content![0]).toEqual(block);
  });

  it("stamps _meta even when there is no content", () => {
    expect(tagResult({}, "tidy_status")._meta).toEqual({ mcp: MCP_ID, tool: "tidy_status" });
  });
});

describe("withIdentity", () => {
  it("tags results from a (name, description, schema, handler) registration", async () => {
    const registered: Record<string, Function> = {};
    const server = {
      tool: (name: string, _d: string, _s: unknown, handler: Function) => {
        registered[name] = handler;
      },
    };

    withIdentity(server as never);
    (server.tool as Function)("tidy_score", "desc", {}, async () => ({
      content: [{ type: "text", text: '{"score":91}' }],
    }));

    const result = await registered.tidy_score({});
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      _mcp: MCP_ID,
      _tool: "tidy_score",
      score: 91,
    });
  });

  it("tags thrown errors", async () => {
    const registered: Record<string, Function> = {};
    const server = {
      tool: (name: string, _d: string, _s: unknown, handler: Function) => {
        registered[name] = handler;
      },
    };

    withIdentity(server as never);
    (server.tool as Function)("tidy_execute", "desc", {}, async () => {
      throw new Error("plugin not connected");
    });

    await expect(registered.tidy_execute({})).rejects.toThrow(
      `${ERROR_PREFIX} tidy_execute: plugin not connected`,
    );
  });

  it("forwards registration args untouched apart from the handler", () => {
    const spy = vi.fn();
    const server = { tool: spy };
    withIdentity(server as never);

    const schema = { a: 1 };
    (server.tool as Function)("tidy_status", "desc", schema, async () => ({}));

    expect(spy).toHaveBeenCalledTimes(1);
    const [name, description, passedSchema, handler] = spy.mock.calls[0];
    expect(name).toBe("tidy_status");
    expect(description).toBe("desc");
    expect(passedSchema).toBe(schema);
    expect(typeof handler).toBe("function");
  });

  it("passes through a registration with no handler", () => {
    const spy = vi.fn();
    const server = { tool: spy };
    withIdentity(server as never);
    (server.tool as Function)("tidy_noop");
    expect(spy).toHaveBeenCalledWith("tidy_noop");
  });
});
