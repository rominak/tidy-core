import { createHash } from "crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

/**
 * Local persistence for plans and decisions.
 *
 * Plans have to survive between the `tidy_plan` call and the `tidy_apply`
 * call, which are separate MCP requests. Decisions have to survive forever,
 * because a decision record you lose is not a record.
 *
 * Everything lives under ~/.tidy-core. Nothing is sent anywhere.
 */

const HOME = process.env.TIDY_HOME || join(homedir(), ".tidy-core");
const PLANS = join(HOME, "plans");
const DECISIONS = join(HOME, "decisions");

/** Plans older than this are refused. A stale plan describes a file that has moved on. */
export const PLAN_TTL_MS = 60 * 60 * 1000;

function ensure(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Deterministic JSON: object keys sorted at every level.
 *
 * The hash is a contract between two separate calls, so the same plan must
 * serialise identically every time. Key order from V8 is not a guarantee to
 * build a safety check on.
 */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

/** Short, human-quotable prefix. Long enough that a typo will not collide. */
export function shortHash(full: string): string {
  return full.slice(0, 12);
}

export interface StoredPlan {
  planHash: string;
  createdAt: string;
  fileKey: string | null;
  fileName: string | null;
  intent: string;
  operations: unknown[];
  targets: unknown[];
  targetFingerprint: string;
  risks: unknown[];
  estimatedBudget: unknown;
}

export function savePlan(plan: StoredPlan): void {
  ensure(PLANS);
  writeFileSync(join(PLANS, `${plan.planHash}.json`), JSON.stringify(plan, null, 2));
}

export function loadPlan(planHash: string): StoredPlan | null {
  const path = join(PLANS, `${planHash}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as StoredPlan;
  } catch {
    return null;
  }
}

export function recentPlanHashes(limit = 5): string[] {
  if (!existsSync(PLANS)) return [];
  return readdirSync(PLANS)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .slice(-limit);
}

export interface Decision {
  id: string;
  recordedAt: string;
  subject: string;
  decision: string;
  rationale: string;
  fileKey: string | null;
  fileName: string | null;
  planHash: string | null;
  operations: unknown[];
}

export function saveDecision(decision: Decision): string {
  ensure(DECISIONS);
  writeFileSync(join(DECISIONS, `${decision.id}.json`), JSON.stringify(decision, null, 2));
  return join(DECISIONS, `${decision.id}.json`);
}

/**
 * Sortable, collision-resistant id. Time-prefixed so the directory reads
 * chronologically without opening anything.
 */
export function decisionId(now: Date, seed: unknown): string {
  const stamp = now.toISOString().replace(/[-:.]/g, "").slice(0, 15);
  return `${stamp}-${sha256(seed).slice(0, 8)}`;
}

export const paths = { home: HOME, plans: PLANS, decisions: DECISIONS };
