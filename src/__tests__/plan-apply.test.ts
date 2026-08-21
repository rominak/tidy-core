import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Point the store at a scratch dir before anything imports it.
const HOME = mkdtempSync(join(tmpdir(), "tidy-core-test-"));
process.env.TIDY_HOME = HOME;

const { plan, assessRisks, fingerprint, summarise } = await import("../core/plan.js");
const { apply } = await import("../core/apply.js");
const { canonical, sha256, loadPlan } = await import("../core/store.js");
type Operation = import("../core/plan.js").Operation;
type ResolvedTarget = import("../core/plan.js").ResolvedTarget;

/** A bridge stand-in that returns scripted plugin responses. */
function fakeBridge(responses: Record<string, unknown | (() => unknown)>) {
  const calls: Array<{ command: string; params: unknown }> = [];
  return {
    calls,
    sendCommand: async (command: string, params: Record<string, unknown>) => {
      calls.push({ command, params });
      const r = responses[command];
      if (r === undefined) throw new Error(`unexpected command ${command}`);
      return typeof r === "function" ? (r as () => unknown)() : r;
    },
  } as never;
}

const token = (over: Partial<ResolvedTarget> = {}): ResolvedTarget => ({
  ref: "bg-primary",
  found: true,
  id: "VariableID:1:1",
  name: "bg-primary",
  resolvedType: "COLOR",
  collection: "Theme",
  description: "",
  aliasReferences: 0,
  nodeBindings: 0,
  bindingsExact: true,
  ...over,
});

const preview = (targets: ResolvedTarget[]) => ({
  file: { name: "Design System", key: "abc123" },
  targets,
});

afterEach(() => {
  /* plans accumulate in the scratch dir; harmless */
});

describe("canonical hashing", () => {
  it("is stable across key order", () => {
    expect(canonical({ b: 1, a: 2 })).toBe(canonical({ a: 2, b: 1 }));
    expect(sha256({ b: 1, a: 2 })).toBe(sha256({ a: 2, b: 1 }));
  });

  it("distinguishes different values", () => {
    expect(sha256({ a: 1 })).not.toBe(sha256({ a: 2 }));
  });

  it("does not confuse nesting", () => {
    expect(canonical({ a: { b: 1 } })).not.toBe(canonical({ "a.b": 1 }));
  });
});

describe("fingerprint", () => {
  it("ignores target order", () => {
    const a = token({ ref: "a", name: "a" });
    const b = token({ ref: "b", name: "b" });
    expect(fingerprint([a, b])).toBe(fingerprint([b, a]));
  });

  it("changes when a target is renamed", () => {
    const before = fingerprint([token()]);
    const after = fingerprint([token({ name: "surface-primary" })]);
    expect(before).not.toBe(after);
  });

  it("changes when alias references change", () => {
    expect(fingerprint([token({ aliasReferences: 0 })])).not.toBe(
      fingerprint([token({ aliasReferences: 3 })]),
    );
  });

  it("ignores node binding counts, which drift constantly", () => {
    expect(fingerprint([token({ nodeBindings: 1 })])).toBe(
      fingerprint([token({ nodeBindings: 900 })]),
    );
  });
});

describe("assessRisks", () => {
  const rename: Operation = { type: "renameVariable", target: "bg-primary", newName: "surface" };

  it("blocks deleting a variable that is still used", () => {
    const risks = assessRisks(
      [{ type: "deleteVariable", target: "bg-primary" }],
      [token({ aliasReferences: 4 })],
    );
    expect(risks[0].level).toBe("blocking");
    expect(risks[0].message).toMatch(/still used in 4 places/);
  });

  it("allows deleting an unused variable", () => {
    const risks = assessRisks([{ type: "deleteVariable", target: "bg-primary" }], [token()]);
    expect(risks.filter((r) => r.level === "blocking")).toHaveLength(0);
  });

  it("blocks when a target cannot be resolved", () => {
    const risks = assessRisks([rename], [token({ found: false, reason: "no such variable" })]);
    expect(risks[0].level).toBe("blocking");
    expect(risks[0].message).toMatch(/no such variable/);
  });

  it("blocks two operations on the same variable", () => {
    const risks = assessRisks(
      [rename, { type: "deleteVariable", target: "bg-primary" }],
      [token()],
    );
    expect(risks.some((r) => r.level === "blocking" && /both target/.test(r.message))).toBe(true);
  });

  it("escalates a rename with heavy usage", () => {
    const risks = assessRisks([rename], [token({ aliasReferences: 30 })]);
    expect(risks[0].level).toBe("high");
  });

  it("flags a rename to the name it already has", () => {
    const risks = assessRisks(
      [{ type: "renameVariable", target: "bg-primary", newName: "bg-primary" }],
      [token()],
    );
    expect(risks[0].level).toBe("low");
    expect(risks[0].message).toMatch(/does nothing/);
  });

  it("warns when the binding scan was capped", () => {
    const risks = assessRisks([rename], [token({ bindingsExact: false })]);
    expect(risks.some((r) => /lower bound/.test(r.message))).toBe(true);
  });
});

describe("plan", () => {
  const rename: Operation = { type: "renameVariable", target: "bg-primary", newName: "surface" };

  it("issues a hash and persists the plan", async () => {
    const bridge = fakeBridge({ planPreview: preview([token()]) });
    const result = await plan(bridge, { operations: [rename] });

    expect(result.status).toBe("ready");
    expect(result.planHash).toMatch(/^[a-f0-9]{64}$/);
    expect(loadPlan(result.planHash!)?.operations).toEqual([rename]);
  });

  it("issues no hash at all when blocked", async () => {
    const bridge = fakeBridge({
      planPreview: preview([token({ found: false, reason: "gone" })]),
    });
    const result = await plan(bridge, { operations: [rename] });

    expect(result.status).toBe("blocked");
    expect(result.planHash).toBeNull();
    expect(result.nextStep).toMatch(/cannot be applied/);
  });

  it("gives the same hash for the same plan against the same state", async () => {
    const bridge = fakeBridge({ planPreview: preview([token()]) });
    const a = await plan(bridge, { operations: [rename] });
    const b = await plan(bridge, { operations: [rename] });
    expect(a.planHash).toBe(b.planHash);
  });

  it("gives a different hash when the file state differs", async () => {
    const a = await plan(fakeBridge({ planPreview: preview([token()]) }), { operations: [rename] });
    const b = await plan(
      fakeBridge({ planPreview: preview([token({ aliasReferences: 2 })]) }),
      { operations: [rename] },
    );
    expect(a.planHash).not.toBe(b.planHash);
  });

  it("rejects an empty operation list", async () => {
    await expect(plan(fakeBridge({}), { operations: [] })).rejects.toThrow(/at least one operation/);
  });

  it("never sends a mutating command", async () => {
    const bridge = fakeBridge({ planPreview: preview([token()]) });
    await plan(bridge, { operations: [rename] });
    expect((bridge as never as { calls: Array<{ command: string }> }).calls.map((c) => c.command))
      .toEqual(["planPreview"]);
  });
});

describe("apply gates", () => {
  const rename: Operation = { type: "renameVariable", target: "bg-primary", newName: "surface" };

  async function readyPlan(targets = [token()]) {
    const bridge = fakeBridge({ planPreview: preview(targets) });
    const result = await plan(bridge, { operations: [rename], intent: "Clarify naming" });
    return result.planHash!;
  }

  it("refuses a hash it never issued", async () => {
    await expect(
      apply(fakeBridge({}), { planHash: "0".repeat(64), confirm: true }),
    ).rejects.toThrow(/No plan found with hash/);
  });

  it("refuses without confirm, and says what the plan would do", async () => {
    const planHash = await readyPlan();
    await expect(
      apply(fakeBridge({}), { planHash, confirm: false }),
    ).rejects.toThrow(/needs confirm: true.*Rename "bg-primary" to "surface"/s);
  });

  it("refuses an expired plan", async () => {
    const planHash = await readyPlan();
    const later = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await expect(
      apply(fakeBridge({}), { planHash, confirm: true }, later),
    ).rejects.toThrow(/has expired/);
  });

  it("refuses when the target was renamed underneath it, and says so", async () => {
    const planHash = await readyPlan();
    const drifted = fakeBridge({
      planPreview: preview([token({ name: "something-else" })]),
    });
    await expect(apply(drifted, { planHash, confirm: true })).rejects.toThrow(
      /"bg-primary" was renamed to "something-else"/,
    );
  });

  it("refuses when the target disappeared", async () => {
    const planHash = await readyPlan();
    const gone = fakeBridge({ planPreview: preview([token({ found: false })]) });
    await expect(apply(gone, { planHash, confirm: true })).rejects.toThrow(
      /"bg-primary" no longer exists/,
    );
  });

  it("refuses when usage changed underneath it", async () => {
    const planHash = await readyPlan();
    const busier = fakeBridge({ planPreview: preview([token({ aliasReferences: 5 })]) });
    await expect(apply(busier, { planHash, confirm: true })).rejects.toThrow(
      /now has 5 alias references instead of 0/,
    );
  });

  it("refuses when the active file is a different file", async () => {
    const planHash = await readyPlan();
    const elsewhere = fakeBridge({
      planPreview: { file: { name: "Other File", key: "zzz999" }, targets: [token()] },
    });
    await expect(apply(elsewhere, { planHash, confirm: true })).rejects.toThrow(
      /built against "Design System" but the active file is "Other File"/,
    );
  });
});

describe("apply execution", () => {
  const rename: Operation = { type: "renameVariable", target: "bg-primary", newName: "surface" };

  it("applies and writes a decision", async () => {
    const planHash = (
      await plan(fakeBridge({ planPreview: preview([token()]) }), {
        operations: [rename],
        intent: "Clarify naming",
      })
    ).planHash!;

    const bridge = fakeBridge({
      planPreview: preview([token()]),
      applyOperations: { results: [{ ok: true, detail: 'Renamed "bg-primary" to "surface"' }] },
    });

    const result = await apply(bridge, {
      planHash,
      confirm: true,
      note: "Name described the colour, not the role.",
    });

    expect(result.status).toBe("applied");
    expect(result.results[0].ok).toBe(true);
    expect(result.decision.subject).toBe("Clarify naming");
    expect(result.decision.rationale).toBe("Name described the colour, not the role.");
    expect(result.decision.planHash).toBe(planHash);
    expect(result.decisionPath).toContain(HOME);
  });

  it("records a partial apply rather than reporting success", async () => {
    const planHash = (
      await plan(fakeBridge({ planPreview: preview([token()]) }), { operations: [rename] })
    ).planHash!;

    const bridge = fakeBridge({
      planPreview: preview([token()]),
      applyOperations: { results: [{ ok: false, detail: "Name already taken" }] },
    });

    const result = await apply(bridge, { planHash, confirm: true });
    expect(result.status).toBe("partial");
    expect(result.decision.decision).toMatch(/^FAILED:/);
  });

  it("does not silently succeed when the plugin returns nothing", async () => {
    const planHash = (
      await plan(fakeBridge({ planPreview: preview([token()]) }), { operations: [rename] })
    ).planHash!;

    const bridge = fakeBridge({
      planPreview: preview([token()]),
      applyOperations: {},
    });

    const result = await apply(bridge, { planHash, confirm: true });
    expect(result.status).toBe("partial");
    expect(result.results[0].ok).toBe(false);
  });
});

describe("summarise", () => {
  it("reads as a sentence for each operation type", () => {
    expect(summarise({ type: "renameVariable", target: "a", newName: "b" })).toBe(
      'Rename "a" to "b"',
    );
    expect(summarise({ type: "deleteVariable", target: "a" })).toBe('Delete "a"');
    expect(summarise({ type: "setVariableDescription", target: "a", description: "x" })).toBe(
      'Describe "a"',
    );
  });
});

process.on("exit", () => rmSync(HOME, { recursive: true, force: true }));

describe("fingerprint regression", () => {
  it("distinguishes a resolving target from a vanished one carrying the same fields", () => {
    // Regression: `found` was omitted from the fingerprint, so a target that
    // stopped resolving could hash identically to one that still did, and
    // apply would proceed against a variable that was gone.
    expect(fingerprint([token({ found: true })])).not.toBe(
      fingerprint([token({ found: false })]),
    );
  });
});
