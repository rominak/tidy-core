import type { FigmaBridge } from "../bridge.js";

export interface ContextOptions {
  detail?: "summary" | "full";
  include?: Array<"tokens" | "components" | "rules">;
  figmaFile?: string;
}

interface RawContext {
  file?: { name?: string; key?: string };
  collections?: Array<{ name: string; modes: string[]; variableCount: number }>;
  variables?: Array<{ name: string; type: string; collection: string; isAlias?: boolean }>;
  components?: Array<{ name: string; variantCount: number; properties?: Record<string, string[]> }>;
  styles?: Array<{ name: string; type: string }>;
}

/**
 * The system contract in one call: what exists, what it is called, and how it
 * is meant to be used.
 *
 * This is what an agent needs before it writes anything. Without it every
 * session starts by guessing token names, and guessed token names are how raw
 * hex ends up in a component.
 */
export async function context(bridge: FigmaBridge, opts: ContextOptions = {}) {
  const detail = opts.detail ?? "summary";
  const include = opts.include ?? ["tokens", "components", "rules"];

  const raw = (await bridge.sendCommand(
    "getContext",
    { include, detail },
    60_000,
    opts.figmaFile,
  )) as RawContext;

  const out: Record<string, unknown> = {
    file: raw.file ?? null,
  };

  if (include.includes("tokens")) {
    out.collections = raw.collections ?? [];
    out.tokens =
      detail === "full"
        ? (raw.variables ?? [])
        : groupByPrefix((raw.variables ?? []).map((v) => v.name));
  }

  if (include.includes("components")) {
    out.components =
      detail === "full"
        ? (raw.components ?? [])
        : (raw.components ?? []).map((c) => ({ name: c.name, variantCount: c.variantCount }));
  }

  if (include.includes("rules")) {
    out.rules = deriveRules(raw);
  }

  return out;
}

/**
 * Collapse a flat token list into its naming groups.
 *
 * A summary of 400 token names is not 400 names, it is the shape: which
 * intents exist and how deep the naming goes.
 */
function groupByPrefix(names: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const name of names) {
    const [head] = name.split(/[/.-]/);
    (groups[head] ??= []).push(name);
  }
  for (const key of Object.keys(groups)) {
    if (groups[key].length > 12) {
      groups[key] = [...groups[key].slice(0, 12), `... ${groups[key].length - 12} more`];
    }
  }
  return groups;
}

/**
 * Infer the conventions actually in use rather than asserting house style.
 *
 * A system's real rules are visible in its data. Stating them back is more
 * useful than a generic style guide, and it stays correct when the system
 * changes.
 */
function deriveRules(raw: RawContext): Record<string, unknown> {
  const names = (raw.variables ?? []).map((v) => v.name);
  const slash = names.filter((n) => n.includes("/")).length;
  const dot = names.filter((n) => n.includes(".")).length;
  const dash = names.filter((n) => n.includes("-")).length;

  const delimiter =
    Math.max(slash, dot, dash) === 0
      ? "none detected"
      : slash >= dot && slash >= dash
        ? "/"
        : dot >= dash
          ? "."
          : "-";

  const aliased = (raw.variables ?? []).filter((v) => v.isAlias).length;

  return {
    delimiter,
    delimiterConsistency:
      names.length === 0 ? null : `${Math.round((Math.max(slash, dot, dash) / names.length) * 100)}%`,
    aliasRatio: names.length === 0 ? null : `${Math.round((aliased / names.length) * 100)}%`,
    modes: (raw.collections ?? []).map((c) => ({ collection: c.name, modes: c.modes })),
    binding: [
      "Bind to semantic tokens. Never write a raw hex value into a component.",
      "Do not bind primitives directly where a semantic token exists for the same intent.",
      "Component-level tokens are bound inside the component. Do not re-bind them on an instance.",
    ],
  };
}
