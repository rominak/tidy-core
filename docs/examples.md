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

---

## Planned

### The full loop 🚧

```
1. What should I clean up first?     → tidy_cleanup
2. What breaks if I fix #1?          → tidy_impact
3. Plan it, dry run                  → tidy_plan   → planHash a3f9
4. Apply plan a3f9                   → tidy_apply
5. What moved in the score?          → tidy_health
```

Step 4 writes the decision entry by itself. Step 5 has a delta because the previous loop's step 5 captured a snapshot. Nobody scheduled anything.

Six months later:

```
Why did we rename our primary background token?
```

`tidy_decisions` answers with the plan, the file, the date, the rationale, and the health delta it caused.

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
