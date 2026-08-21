import type { FigmaBridge } from "../bridge.js";
import { fingerprint, summarise, type Operation, type ResolvedTarget } from "./plan.js";
import {
  loadPlan,
  recentPlanHashes,
  saveDecision,
  decisionId,
  shortHash,
  PLAN_TTL_MS,
  type Decision,
} from "./store.js";

export interface ApplyResult {
  planHash: string;
  status: "applied" | "partial";
  intent: string;
  file: { name: string | null; key: string | null };
  results: Array<{ operation: string; ok: boolean; detail: string }>;
  decision: Decision;
  decisionPath: string;
}

interface PreviewResponse {
  file: { name: string | null; key: string | null };
  targets: ResolvedTarget[];
}

interface ExecuteResponse {
  results: Array<{ ok: boolean; detail: string }>;
}

/**
 * Apply a plan by hash. The only mutation path in tidy-core.
 *
 * Four gates before anything is written:
 *   1. the hash must name a plan this machine generated
 *   2. the plan must not have expired
 *   3. the caller must confirm
 *   4. the plan's targets must still look the way they did when it was built
 *
 * Gate 4 is the one that matters. Between planning and applying, a designer
 * may have renamed the very token the plan is about. Applying anyway would do
 * something nobody reviewed.
 */
export async function apply(
  bridge: FigmaBridge,
  opts: { planHash: string; confirm?: boolean; note?: string; figmaFile?: string },
  now: Date = new Date(),
): Promise<ApplyResult> {
  const stored = loadPlan(opts.planHash);

  if (!stored) {
    const recent = recentPlanHashes();
    throw new Error(
      `No plan found with hash "${opts.planHash}". ` +
        `tidy_apply only runs plans produced by tidy_plan on this machine. ` +
        (recent.length
          ? `Recent plans: ${recent.map(shortHash).join(", ")}.`
          : `No plans have been created yet. Run tidy_plan first.`),
    );
  }

  const age = now.getTime() - new Date(stored.createdAt).getTime();
  if (age > PLAN_TTL_MS) {
    throw new Error(
      `Plan "${opts.planHash}" was created ${Math.round(age / 60000)} minutes ago and has expired. ` +
        `Plans are only valid for ${PLAN_TTL_MS / 60000} minutes because the file moves on. Run tidy_plan again.`,
    );
  }

  if (!opts.confirm) {
    throw new Error(
      `tidy_apply needs confirm: true. This plan will: ${stored.operations
        .map((o) => summarise(o as Operation))
        .join("; ")}.`,
    );
  }

  // Re-read the targets and compare against what the plan was built on.
  const preview = (await bridge.sendCommand(
    "planPreview",
    { targets: (stored.operations as Operation[]).map((o) => o.target) },
    60_000,
    opts.figmaFile,
  )) as PreviewResponse;

  const current = fingerprint(preview.targets ?? []);
  if (current !== stored.targetFingerprint) {
    throw new Error(
      `The file changed since this plan was built, so it was not applied. ` +
        `${describeDrift(stored.targets as ResolvedTarget[], preview.targets ?? [])} ` +
        `Run tidy_plan again to see the current picture.`,
    );
  }

  if (stored.fileKey && preview.file.key && stored.fileKey !== preview.file.key) {
    throw new Error(
      `This plan was built against "${stored.fileName}" but the active file is "${preview.file.name}". ` +
        `Point at the right file with tidy_target, or pass figmaFile.`,
    );
  }

  const execution = (await bridge.sendCommand(
    "applyOperations",
    { operations: stored.operations },
    120_000,
    opts.figmaFile,
  )) as ExecuteResponse;

  const results = (stored.operations as Operation[]).map((op, i) => ({
    operation: summarise(op),
    ok: execution.results?.[i]?.ok ?? false,
    detail: execution.results?.[i]?.detail ?? "No result returned for this operation.",
  }));

  const failed = results.filter((r) => !r.ok);

  // The decision is written whether or not every operation succeeded. A
  // partial apply is exactly the kind of thing you want a record of.
  const decision: Decision = {
    id: decisionId(now, { planHash: stored.planHash, at: now.toISOString() }),
    recordedAt: now.toISOString(),
    subject: stored.intent,
    decision: results.map((r) => `${r.ok ? "applied" : "FAILED"}: ${r.operation}`).join("; "),
    rationale:
      opts.note ??
      `Applied plan ${shortHash(stored.planHash)}. No rationale supplied at apply time.`,
    fileKey: preview.file.key ?? null,
    fileName: preview.file.name ?? null,
    planHash: stored.planHash,
    operations: stored.operations,
  };
  const decisionPath = saveDecision(decision);

  return {
    planHash: stored.planHash,
    status: failed.length ? "partial" : "applied",
    intent: stored.intent,
    file: preview.file,
    results,
    decision,
    decisionPath,
  };
}

/** Say what moved, not just that something did. */
function describeDrift(before: ResolvedTarget[], after: ResolvedTarget[]): string {
  const now = new Map(after.map((t) => [t.ref, t]));
  const changes: string[] = [];

  for (const was of before) {
    const is = now.get(was.ref);
    if (!is || !is.found) {
      changes.push(`"${was.name ?? was.ref}" no longer exists`);
    } else if (is.name !== was.name) {
      changes.push(`"${was.name}" was renamed to "${is.name}"`);
    } else if (is.id !== was.id) {
      changes.push(`"${was.name}" was replaced`);
    } else if (is.description !== was.description) {
      changes.push(`the description of "${was.name}" changed`);
    } else if (is.aliasReferences !== was.aliasReferences) {
      changes.push(
        `"${was.name}" now has ${is.aliasReferences} alias references instead of ${was.aliasReferences}`,
      );
    }
  }

  return changes.length ? `${changes.join(", ")}.` : "Its targets no longer match.";
}
