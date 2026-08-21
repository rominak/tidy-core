/**
 * Tools that are specified but not yet built.
 *
 * They are registered rather than hidden so the surface is honest and
 * discoverable: an agent can see what this server intends to do, and gets a
 * clear refusal instead of a plausible-looking empty result. A tool that
 * silently returns `{}` is worse than one that says it does not exist yet.
 */

export interface Planned {
  name: string;
  description: string;
  /** What it will return once built. */
  returns: string;
  /** Section anchor in docs/spec.md. */
  spec: string;
}

export const PLANNED: Planned[] = [
  {
    name: "tidy_health",
    description:
      "Six-category health score plus the delta since the last snapshot plus what caused the delta. Persists a snapshot on every call, so the second run has a delta.",
    returns: "score, per-category breakdown, delta, cause attribution",
    spec: "#4-tidy_health",
  },
  {
    name: "tidy_adoption",
    description:
      "Instance counts, detach rate, override patterns, variant entropy, and the correlation between adoption and health. Persists a measurement on every call, which is what builds the series.",
    returns: "per-component adoption, detach rate, adoption vs health correlation",
    spec: "#5-tidy_adoption",
  },
  {
    name: "tidy_drift",
    description:
      "One drift report across four surfaces: design versus code specs, versus Storybook, versus docs, and page-to-page inside the file.",
    returns: "scored diff per surface with a fix list",
    spec: "#6-tidy_drift",
  },
  {
    name: "tidy_impact",
    description:
      "Blast radius for a token, component or style. What breaks if you rename it, what the migration costs, what the regression risk is. Read-only.",
    returns: "affected bindings, files touched, change budget, regression risk",
    spec: "#7-tidy_impact",
  },
  {
    name: "tidy_cleanup",
    description:
      "A ranked worklist: ghost variables, dead styles, unused tokens, raw colors, deprecation candidates. Ranked by impact over effort, not by count.",
    returns: "ordered findings with evidence and estimated effort",
    spec: "#8-tidy_cleanup",
  },
  {
    name: "tidy_plan",
    description:
      "Turn a finding into an ordered, dry-runnable mutation plan. Returns a plan hash. Never mutates.",
    returns: "planHash, operations, estimated budget, risks",
    spec: "#9-tidy_plan",
  },
  {
    name: "tidy_apply",
    description:
      "The only mutation tool. Applies a plan by hash, refusing any plan it did not generate or whose hash no longer matches file state. Writes a decision entry automatically.",
    returns: "per-operation result, resulting health delta, decision id",
    spec: "#10-tidy_apply",
  },
  {
    name: "tidy_decisions",
    description:
      "Search the decision record, find components with no recorded rationale, and detect decisions that contradict each other. Read-only.",
    returns: "matching decisions, coverage gaps, detected conflicts",
    spec: "#11-tidy_decisions",
  },
  {
    name: "tidy_record_decision",
    description:
      "Record why a change was made. Called automatically by tidy_apply, and manually when a decision happens in a meeting rather than in a diff.",
    returns: "decision id",
    spec: "#12-tidy_record_decision",
  },
  {
    name: "tidy_gate",
    description:
      "CI and pre-push verdict. Runs drift, cleanup regressions, publish readiness and decision compliance, then passes or fails with reasons.",
    returns: "pass/fail with reasons, exit-code friendly",
    spec: "#13-tidy_gate",
  },
];

const REPO = "https://github.com/rominak/tidy-core";

export function notImplemented(tool: Planned) {
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: [
          `${tool.name} is specified but not implemented yet.`,
          ``,
          `Planned behaviour: ${tool.description}`,
          `Will return: ${tool.returns}`,
          ``,
          `Spec: ${REPO}/blob/main/docs/spec.md${tool.spec}`,
          `Do not retry. Do not substitute another tool and present its output as this one's.`,
        ].join("\n"),
      },
    ],
  };
}
