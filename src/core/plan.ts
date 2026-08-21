import type { FigmaBridge } from "../bridge.js";
import { sha256, savePlan, type StoredPlan } from "./store.js";

/**
 * Operations a plan can contain.
 *
 * Deliberately small. Every one of these is reversible in principle and
 * scoped to variables, which is where design system migrations actually hurt.
 * Arbitrary node mutation is not here on purpose: a plan you cannot summarise
 * in one line is a plan nobody reviews.
 */
export type Operation =
  | { type: "renameVariable"; target: string; newName: string }
  | { type: "setVariableDescription"; target: string; description: string }
  | { type: "deleteVariable"; target: string };

export interface ResolvedTarget {
  ref: string;
  found: boolean;
  id?: string;
  name?: string;
  resolvedType?: string;
  collection?: string;
  description?: string;
  /** Other variables that alias this one. Exact. */
  aliasReferences?: number;
  /** Layer properties bound to this variable. */
  nodeBindings?: number;
  /** False when the document was large enough that traversal was capped. */
  bindingsExact?: boolean;
  reason?: string;
}

export interface Risk {
  level: "blocking" | "high" | "medium" | "low";
  operation: number;
  message: string;
}

export interface PlanResult {
  planHash: string | null;
  status: "ready" | "blocked";
  intent: string;
  file: { name: string | null; key: string | null };
  operations: Operation[];
  targets: ResolvedTarget[];
  risks: Risk[];
  estimatedBudget: {
    operations: number;
    aliasReferences: number;
    nodeBindings: number;
    bindingsExact: boolean;
  };
  nextStep: string;
}

interface PreviewResponse {
  file: { name: string | null; key: string | null };
  targets: ResolvedTarget[];
}

/**
 * Fingerprint of exactly the things this plan depends on.
 *
 * Scoped to the plan's own targets rather than the whole file. A whole-file
 * hash would invalidate every outstanding plan the moment anyone touches any
 * token, which trains people to ignore the check. This invalidates a plan only
 * when something it actually relies on has moved.
 */
export function fingerprint(targets: ResolvedTarget[]): string {
  return sha256(
    targets
      .map((t) => ({
        ref: t.ref,
        // `found` is material. A target that has stopped resolving must never
        // hash the same as one that still does, whatever else survives on the
        // object.
        found: t.found,
        id: t.id ?? null,
        name: t.name ?? null,
        type: t.resolvedType ?? null,
        description: t.description ?? null,
        aliasReferences: t.aliasReferences ?? null,
      }))
      .sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)),
  );
}

export function assessRisks(operations: Operation[], targets: ResolvedTarget[]): Risk[] {
  const risks: Risk[] = [];
  const byRef = new Map(targets.map((t) => [t.ref, t]));
  const seen = new Map<string, number>();

  operations.forEach((op, index) => {
    const target = byRef.get(op.target);

    if (!target || !target.found) {
      risks.push({
        level: "blocking",
        operation: index,
        message: `No variable matches "${op.target}"${target?.reason ? `: ${target.reason}` : ""}.`,
      });
      return;
    }

    // Two operations on one variable is almost always a mistake, and the
    // second one silently wins. Catch it here rather than after the fact.
    const previous = seen.get(target.id!);
    if (previous !== undefined) {
      risks.push({
        level: "blocking",
        operation: index,
        message: `Operation ${index} and operation ${previous} both target "${target.name}". Split them into separate plans.`,
      });
    }
    seen.set(target.id!, index);

    const uses = (target.aliasReferences ?? 0) + (target.nodeBindings ?? 0);

    if (op.type === "deleteVariable" && uses > 0) {
      risks.push({
        level: "blocking",
        operation: index,
        message: `"${target.name}" is still used in ${uses} place${uses === 1 ? "" : "s"} (${target.aliasReferences ?? 0} alias references, ${target.nodeBindings ?? 0} layer bindings). Deleting it breaks them. Repoint them first.`,
      });
    }

    if (op.type === "renameVariable") {
      if (op.newName === target.name) {
        risks.push({
          level: "low",
          operation: index,
          message: `"${target.name}" already has that name. This operation does nothing.`,
        });
      } else if (uses > 20) {
        risks.push({
          level: "high",
          operation: index,
          message: `"${target.name}" is used in ${uses} places. Renaming keeps bindings intact in Figma, but anything outside Figma that refers to it by name will break.`,
        });
      } else if (uses > 0) {
        risks.push({
          level: "medium",
          operation: index,
          message: `"${target.name}" is used in ${uses} place${uses === 1 ? "" : "s"}. Check code and docs that refer to it by name.`,
        });
      }
    }

    if (target.bindingsExact === false) {
      risks.push({
        level: "medium",
        operation: index,
        message: `Layer binding count for "${target.name}" is a lower bound: the document was too large to traverse fully.`,
      });
    }
  });

  return risks;
}

/**
 * Build a reviewable plan. Never mutates anything.
 *
 * Returns a hash covering both the operations and the current state of their
 * targets, so `tidy_apply` can tell the difference between "this is the plan I
 * reviewed" and "this is the plan I reviewed, against a file that has since
 * changed".
 */
export async function plan(
  bridge: FigmaBridge,
  opts: { operations: Operation[]; intent?: string; figmaFile?: string },
  now: Date = new Date(),
): Promise<PlanResult> {
  const { operations } = opts;

  if (!operations.length) {
    throw new Error("A plan needs at least one operation.");
  }

  const preview = (await bridge.sendCommand(
    "planPreview",
    { targets: operations.map((o) => o.target) },
    60_000,
    opts.figmaFile,
  )) as PreviewResponse;

  const targets = preview.targets ?? [];
  const risks = assessRisks(operations, targets);
  const blocked = risks.some((r) => r.level === "blocking");

  const aliasReferences = targets.reduce((n, t) => n + (t.aliasReferences ?? 0), 0);
  const nodeBindings = targets.reduce((n, t) => n + (t.nodeBindings ?? 0), 0);

  const estimatedBudget = {
    operations: operations.length,
    aliasReferences,
    nodeBindings,
    bindingsExact: targets.every((t) => t.bindingsExact !== false),
  };

  const intent = opts.intent ?? describe(operations);

  if (blocked) {
    return {
      planHash: null,
      status: "blocked",
      intent,
      file: preview.file,
      operations,
      targets,
      risks,
      estimatedBudget,
      nextStep:
        "This plan cannot be applied. Resolve the blocking risks above and build a new plan. No hash was issued.",
    };
  }

  const targetFingerprint = fingerprint(targets);
  const planHash = sha256({ operations, targetFingerprint, fileKey: preview.file.key ?? null });

  const stored: StoredPlan = {
    planHash,
    createdAt: now.toISOString(),
    fileKey: preview.file.key ?? null,
    fileName: preview.file.name ?? null,
    intent,
    operations,
    targets,
    targetFingerprint,
    risks,
    estimatedBudget,
  };
  savePlan(stored);

  return {
    planHash,
    status: "ready",
    intent,
    file: preview.file,
    operations,
    targets,
    risks,
    estimatedBudget,
    nextStep: `Review the operations and risks above. To execute: tidy_apply with planHash "${planHash}" and confirm: true.`,
  };
}

/** One-line summary used when the caller does not supply an intent. */
function describe(operations: Operation[]): string {
  if (operations.length === 1) return summarise(operations[0]);
  const kinds = new Set(operations.map((o) => o.type));
  return kinds.size === 1
    ? `${operations.length} × ${[...kinds][0]}`
    : `${operations.length} operations across ${kinds.size} kinds`;
}

export function summarise(op: Operation): string {
  switch (op.type) {
    case "renameVariable":
      return `Rename "${op.target}" to "${op.newName}"`;
    case "setVariableDescription":
      return `Describe "${op.target}"`;
    case "deleteVariable":
      return `Delete "${op.target}"`;
  }
}
