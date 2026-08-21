# tidy-core: thirteen-tool spec

Status: draft, v0.1.0

## Why thirteen

Most Figma MCP servers are racing past a hundred tools. That is a liability being tracked as a scoreboard.

A hundred tools is roughly 15k tokens of schema loaded before the agent does anything, and tool-selection accuracy degrades badly past about thirty options. Every tool you add makes the other tools slightly harder to pick correctly.

Thirteen tools, budget roughly 1.5k tokens of schema. Every tool answers a question a design system lead actually asks, rather than exposing an API verb. Primitives compose internally.

## Design rules

1. **One question per tool.** If the name does not finish the sentence "as a design system lead I need to know...", it is not core.
2. **No typed write zoo.** Exactly one mutation tool, and it only applies plans that were already generated and reviewed.
3. **Every call feeds the record.** Reads persist a snapshot, mutations write a decision. Automatic, never a separate step. See [The record starts on install](#the-record-starts-on-install).
4. **Progressive disclosure.** Each tool takes a `detail` parameter (`summary` by default) so a first call is cheap.
5. **Identity on every response.** Real setups run several Figma MCP servers side by side. Every response carries `_mcp: "tidy-core"` and every error is prefixed `[tidy-core]`, so a failure from another server is never blamed on this one.
6. **Refuse rather than guess.** With several files connected and no target set, commands fail with a list of the files. Picking the first open socket is a coin flip, and losing it silently writes to the wrong file.

## The record starts on install

Three of the thirteen tools depend on history: `tidy_health` deltas, `tidy_adoption` trends, `tidy_decisions` conflicts. They are also the three that are hardest to copy. That combination is the central design problem for this package.

The wrong fix is to cut them. Without them this is a health scorer, a cleanup ranker and a drift checker, which is a commodity.

The right fix is to make history a side effect of ordinary use.

| Tool | Reads from | Writes on every call |
|---|---|---|
| `tidy_health` | snapshot store | a new snapshot |
| `tidy_adoption` | adoption series | a new adoption measurement |
| `tidy_decisions` | decision log | nothing (`tidy_apply` writes it) |

Nobody has to remember to snapshot. Call two has a delta because call one captured a baseline.

**First run must never say "no data".** It says what it captured and what that unlocks:

```
Health: 71/100  (baseline captured 2026-08-21)

  Naming        62   ← weakest category
  Architecture  78
  Metadata      54
  ...

No delta yet. This is snapshot 1. Run tidy_health again after your
next change and it will show what moved and why.
```

That is the honest version of an empty state. The install is day zero of the record.

| Capability | Available |
|---|---|
| Context, impact, cleanup, drift, score, plan, apply, gate, status, target | immediately |
| Health delta | second run |
| Decision record and conflicts | first `tidy_apply` |
| Adoption trend | roughly two weeks of normal use |

## The thirteen

### 1. `tidy_status` ✅ implemented
**Question:** Is tidy-core connected, and to what?

Every connected file, which one commands route to, the WebSocket port. Read `routing` first: it answers the question in plain language. When nothing is connected it returns concrete fixes rather than `connected: false`.

### 2. `tidy_target` ✅ implemented
**Question:** Which file am I working in?

Pins every subsequent command to one connected file, by name or by key. Names match exactly first, then case-insensitively. Two connected files sharing a name is an error, not a guess.

### 3. `tidy_context` ✅ implemented
**Question:** What is in this design system, so I can work correctly?

Collections, modes, token names grouped by intent, component variant axes, and the naming and binding conventions actually in use. One call, no follow-ups.

Conventions are inferred from the data rather than asserted, so they stay correct as the system changes.

Params: `detail` (`summary` | `full`), `include` (`tokens` | `components` | `rules`), `figmaFile`.

### 4. `tidy_health` 🚧 planned
**Question:** How healthy is the system, and which direction is it moving?

Six-category score plus the delta since the last snapshot plus what caused the delta. Never returns a bare number. A score without a direction is a commodity; a score with a direction is not.

Persists a snapshot on every call. On the first run it reports the baseline it just captured.

Params: `since`, `category`, `format`, `noCapture`.

### 5. `tidy_adoption` 🚧 planned
**Question:** Is anyone actually using this system?

Instance counts per component, detach rate, override patterns, variant entropy, and the correlation between adoption and health. Returns the uncomfortable finding first: components that score well and are ignored.

Persists a measurement on every call, which is what builds the series.

Params: `component`, `since`, `detail`, `noCapture`.

### 6. `tidy_drift` 🚧 planned
**Question:** Does design still match code, Storybook, and the docs?

One drift report across four surfaces: design versus code specs, versus Storybook, versus docs, and page-to-page inside the file. Scored, with a fix list.

Params: `surface`, `component`.

### 7. `tidy_impact` 🚧 planned
**Question:** What breaks if I change this?

Blast radius for a token, component or style. Bindings affected, files touched, estimated change budget, regression risk. Read-only, always safe to run.

Params: `target`, `operation`, `newName`.

### 8. `tidy_cleanup` 🚧 planned
**Question:** What should I fix first?

A ranked, evidence-backed worklist. Ghost variables, dead styles, unused tokens, raw colors, hardcoded values, deprecation candidates. Ranked by impact over effort, not by count.

Params: `limit`, `kind`, `minImpact`.

### 9. `tidy_plan` ✅ implemented
**Question:** Give me a safe, reviewable sequence of changes.

Turns a finding into an ordered, dry-runnable mutation plan. Returns a **plan hash**. Never mutates.

Returns `{ planHash, operations[], estimatedBudget, risks[] }`.

### 10. `tidy_apply` ✅ implemented
**Question:** Execute the plan I reviewed.

The **only** mutation tool. Takes a `planHash` and nothing else. Refuses any plan it did not generate, and any plan whose hash no longer matches current file state.

On success it writes a decision entry automatically: what changed, why, which plan, which file, what the health delta was.

**Why not an arbitrary `execute` tool.** Running arbitrary plugin API code is what every other Figma MCP already provides, better packaged. Shipping it here means competing on their axis and losing. Plan-then-apply with a hash gate and automatic decision capture is different, and it makes the decision record load-bearing instead of optional.

Trade-off, stated plainly: this makes tidy-core unable to do one-shot creative authoring. That is intentional. Use another MCP server for authoring, and this one to decide whether to author and to prove what happened.

### 11. `tidy_decisions` 🚧 planned
**Question:** Why is the system like this, and do our decisions contradict each other?

Search the decision record, find components with no recorded rationale, and detect decisions that conflict. Read-only.

Params: `query`, `component`, `mode` (`search` | `coverage` | `conflicts` | `export`).

### 12. `tidy_record_decision` 🚧 planned
**Question:** Capture why we did this.

Records a decision against a component, token, or the system. Called automatically by `tidy_apply`, and manually when a decision happens in a meeting rather than in a diff.

Kept separate from `tidy_decisions` on purpose: read and write have different trust requirements, and a single tool with a `mode: "write"` parameter invites accidental writes.

### 13. `tidy_gate` 🚧 planned
**Question:** Should this change be allowed to merge?

CI and pre-push verdict. Runs drift, cleanup regressions, publish readiness and decision compliance, then returns pass or fail with reasons. Exit-code friendly.

This is where governance becomes enforcement. A document nobody reads versus a build that fails.

## What is deliberately excluded

| Excluded | Why |
|---|---|
| Arbitrary `execute` | Commodity. Every other Figma MCP has it. |
| Code generation, redlines, spec export | Design to code is well served by first-party tooling. Not winnable. |
| Screenshots, navigation, selection | Every Figma MCP has these. No differentiation, and they cost schema budget. |

## Open questions

- **Does auto-capture on read surprise anyone?** A read tool that writes to disk is mildly unexpected. Mitigations: the store is local, snapshots are small, and `noCapture` exists. The alternative is a `--capture` flag, which returns us to the empty-record problem because nobody passes it. Current call: capture by default, document it prominently.
- **Trust levels.** A permission model for `tidy_apply` adds config burden on a first install. Current call: `confirm: true` and no trust system in core.

## Build sequence

1. ✅ Bridge, file targeting, identity tagging, `tidy_status`, `tidy_target`, `tidy_context`.
2. ✅ Plan hashing and the `tidy_plan` / `tidy_apply` contract.
3. ✅ Auto-decision-write inside `tidy_apply`.
4. Snapshot store and auto-capture, unlocking `tidy_health` and `tidy_adoption`.
5. `tidy_gate` for CI.
