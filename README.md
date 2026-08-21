# tidy-core

**Other Figma MCP servers let an agent change your design system. tidy-core tells you whether it should, what will break, whether anyone adopted the last change, and what you decided six months ago.**

Design system governance over the Model Context Protocol. Thirteen tools, not a hundred.

> **Status: v0.1.0, early.** Three of the thirteen tools are implemented. The other ten are registered and will tell you they are not built yet rather than returning an empty result. See [the build sequence](docs/spec.md#build-sequence).

---

## Why this exists

Reading and writing Figma from an agent is a solved problem. Figma ships a first-party MCP server, and there are good third-party ones with a hundred-plus tools.

What none of them do is answer the question a design system lead actually gets asked: **is this working, and is it worth the headcount?**

You can show a component count. You cannot show adoption, drift, decision history, or the cost of the next migration. So the system gets judged on output volume, which is the one metric that rewards the wrong behaviour.

tidy-core is built for that gap. It is not a faster way to draw components.

## What it does

| Capability | The question it answers |
|---|---|
| Decision record | Why is the system like this? Which decisions now contradict each other? |
| Longitudinal health | Is it improving or decaying, and which category moved? |
| Adoption evidence | Do designers use the components, or detach and override them? |
| Blast radius | What breaks if I rename this token, and what will the migration cost? |
| Drift and parity | Does the design still match code, Storybook, and the docs? |
| CI enforcement | Does this change violate a recorded decision? Block it. |

## What it does not do

- Not a design-to-code generator. Figma's own MCP server does that well.
- Not a way to author components faster. Other servers do that well.
- Not a tool-count competition. The small surface is the point.

It is designed to sit **alongside** an authoring MCP server, not replace one. Use those to make the change. Use this to decide whether to make it, and to prove what happened.

---

## Install

> ### 👋 New to this?
>
> **[Read the step-by-step guide instead →](GETTING-STARTED.md)**
>
> It assumes no coding experience, explains every term, and tells you what should happen after each step. About 20 minutes.

The short version, for people who have set up an MCP server before.

Requires Node 18+ and **Figma Desktop**. A browser tab cannot reach a localhost WebSocket, and there is no workaround.

Not on npm yet, so clone and build:

```bash
git clone https://github.com/rominak/tidy-core.git
cd tidy-core
npm install
npm run build
```

**Claude Code**

```bash
claude mcp add tidy-core -s user -- node /absolute/path/to/tidy-core/dist/index.js
```

**Cursor, Windsurf, Claude Desktop**

```json
{
  "mcpServers": {
    "tidy-core": {
      "command": "node",
      "args": ["/absolute/path/to/tidy-core/dist/index.js"]
    }
  }
}
```

Then connect the plugin:

1. Figma Desktop → **Plugins → Development → Import plugin from manifest**
2. Select `plugin/manifest.json` from this repo
3. Run it. It scans ports 9240 to 9249 and connects on its own.

Verify:

```
Check tidy status
```

## First run

```
Load the design system contract.
```

`tidy_context` returns collections, modes, token names grouped by intent, component variant axes, and the naming conventions actually in use, inferred from your data rather than asserted.

More in [docs/examples.md](docs/examples.md).

---

## Design decisions worth knowing

**It refuses to guess which file you mean.** With two or more Figma files connected and no target set, commands fail with a list of the files instead of picking the first open socket. Picking is a coin flip, and losing it writes to the wrong file. Set one with `tidy_target`.

**It tags every response.** Real setups run several Figma MCP servers side by side. Every response carries `_mcp: "tidy-core"` and every error is prefixed `[tidy-core]`, so another server's failure is never blamed on this one.

**Unbuilt tools say so.** The ten planned tools are registered and return an explicit refusal naming what they will do. A tool that silently returns `{}` is worse than one that admits it does not exist yet.

**It will not kill your other tools.** If port 9240 is busy it moves to the next free one in 9240 to 9249, which the plugin scans anyway. It deliberately does not terminate whatever was holding the port.

**Reads will write.** Once `tidy_health` and `tidy_adoption` land, every call persists a snapshot. That is what makes the second run able to show a delta without anyone scheduling anything. A `noCapture` flag will exist for read-only CI checks. See [the reasoning](docs/spec.md#the-record-starts-on-install).

## The thirteen tools

| Tool | Status | Question |
|---|---|---|
| `tidy_status` | ✅ | Where am I connected, and where will the next command land? |
| `tidy_target` | ✅ | Which file am I working in? |
| `tidy_context` | ✅ | What is in this system, so I can work correctly? |
| `tidy_health` | 🚧 | How healthy is it, and which direction is it moving? |
| `tidy_adoption` | 🚧 | Is anyone actually using it? |
| `tidy_drift` | 🚧 | Does design still match code, Storybook, docs? |
| `tidy_impact` | 🚧 | What breaks if I change this? |
| `tidy_cleanup` | 🚧 | What should I fix first? |
| `tidy_plan` | 🚧 | Give me a safe, reviewable sequence of changes. |
| `tidy_apply` | 🚧 | Execute the plan I reviewed. |
| `tidy_decisions` | 🚧 | Why is it like this, and do our decisions contradict? |
| `tidy_record_decision` | 🚧 | Capture why we did this. |
| `tidy_gate` | 🚧 | Should this change be allowed to merge? |

Full definitions in [docs/spec.md](docs/spec.md).

## Development

```bash
npm install
npm run build     # emits dist/, excludes tests
npm test
npm run typecheck # checks everything including tests
npm run dev       # watch mode
```

Everything runs locally. No data leaves your machine, and there is no telemetry.

## Learn more

tidy-core comes out of ongoing work on design systems and AI at **[aidesign.guide](https://aidesign.guide)**, where the thinking behind it is written up in more depth: how design systems get measured, where AI actually helps, and where it quietly makes things worse.

Built by [Romina Kavčič](https://github.com/rominak).

## License

MIT
