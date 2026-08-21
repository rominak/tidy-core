# What you can do with tidy-core

Spec: [spec.md](spec.md)

Tools marked 🚧 are specified but not built yet. They are registered and will tell you so rather than returning an empty result.

---

## Working today

### Onboard an agent to a system it has never seen

```
Load the design system contract, then build a settings panel.
```

`tidy_context` returns collections, modes, token names grouped by intent, component variant axes, and the naming and binding conventions actually in use. One call.

This is the difference between an agent that binds `color/background/danger` and one that writes `#DC2626` because it never learned the token existed.

Conventions are inferred from your data, not asserted. If your system uses `/` as a delimiter and aliases 80% of its tokens, that is what it reports.

### Work safely with several files open

```
Which file am I pointed at?
Pin me to the Foundation file.
```

`tidy_status` answers in plain language:

```json
{
  "routing": "2 files connected and no target set. Commands will fail until you call tidy_target.",
  "connections": [
    { "fileName": "Foundation", "fileKey": "abc123", "isTarget": false },
    { "fileName": "Product Master", "fileKey": "def456", "isTarget": false }
  ]
}
```

Then `tidy_target` with `"Foundation"` pins it. Names match exactly first, then case-insensitively, because an agent knows the file name and never knows the key.

With two files open and no target, commands **fail** rather than picking one. That is deliberate. Silently writing to the wrong file is the failure this prevents.

### Change a token safely

```
Plan renaming bg-primary to surface-primary. It describes the colour,
not the role.
```

`tidy_plan` never touches the file. It reports what depends on the token and what could go wrong:

```json
{
  "status": "ready",
  "planHash": "94a0bacd5f74...",
  "estimatedBudget": {
    "aliasReferences": 2,
    "nodeBindings": 7,
    "bindingsExact": true
  },
  "risks": [
    {
      "level": "medium",
      "message": "\"bg-primary\" is used in 9 places. Check code and docs that refer to it by name."
    }
  ],
  "nextStep": "To execute: tidy_apply with planHash \"94a0...\" and confirm: true."
}
```

Then:

```
Apply that plan. Agreed in the design system sync.
```

The note becomes the rationale in a decision entry written automatically:

```json
{
  "status": "applied",
  "decision": {
    "subject": "Name described the colour, not the role",
    "decision": "applied: Rename \"bg-primary\" to \"surface-primary\"",
    "rationale": "Agreed in the design system sync."
  }
}
```

### What it refuses to do

This is the part that matters more than the happy path.

**Deleting something still in use** never gets a hash at all:

```
"bg-primary" is still used in 9 places (2 alias references, 7 layer
bindings). Deleting it breaks them. Repoint them first.
```

**Applying without confirming** tells you what you were about to do:

```
tidy_apply needs confirm: true. This plan will: Rename "bg-primary"
to "surface-primary".
```

**Applying a plan after the file moved on** stops and says what changed:

```
The file changed since this plan was built, so it was not applied.
"bg-primary" was renamed to "surface-primary". Run tidy_plan again
to see the current picture.
```

That last one is the whole reason the hash exists. Between planning and applying, somebody else may have touched the very token you are about to change. Applying anyway would do something nobody reviewed. It also means a plan cannot be replayed twice by accident.

Plans expire after an hour, for the same reason.

---

## Planned

### The full loop 🚧

```
1. What should I clean up first?     → tidy_cleanup  🚧
2. What breaks if I fix #1?          → tidy_impact   🚧
3. Plan it                           → tidy_plan     ✅
4. Apply plan a3f9                   → tidy_apply    ✅
5. What moved in the score?          → tidy_health   🚧
```

Steps 3 and 4 work today. You supply the operations yourself for now. Once `tidy_cleanup` and `tidy_impact` land, the findings feed straight into `tidy_plan` instead.

Six months later:

```
Why did we rename our primary background token?
```

`tidy_decisions` will answer with the plan, the file, the date, the rationale, and the health delta it caused. The entries are already being written on every apply, so the record is filling up now, before the tool that reads it exists.

### Size a rename before committing to it 🚧

```
What is the blast radius of renaming bg-primary to surface-primary?
```

Affected bindings, files touched, estimated change budget, regression risk. Read-only. This is the tool that sizes a migration before it starts rather than halfway through.

### Decision conflicts 🚧

```
Do any of our recorded decisions contradict each other?
```

Systems accumulate rules. A standing rule and a scoped exception to it are both correct in isolation, and they collide the first time someone applies the exception outside its scope. This surfaces that before it ships.

### Adoption against health 🚧

```
Show me components where the score went up and adoption went down.
```

A component with nineteen style variants is not nineteen useful variants. This shows how many anyone uses, and what designers override when they do not detach outright.

### In CI, not in chat 🚧

```yaml
- run: npx tidy-core gate --strict --against baseline
```

Fails the build on drift, publish-readiness regressions, or a change that violates a recorded decision.
