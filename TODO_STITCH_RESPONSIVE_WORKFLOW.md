# Todo App → Google Stitch → Responsive React/shadcn Workflow

This guide assumes you already created a **desktop-first Todo app** using:

- React
- Tailwind CSS 4
- shadcn/ui
- Radix UI
- Lucide icons

The goal is:

```text
Desktop Todo app in repo
        ↓
Extract current design
        ↓
Google Stitch
        ↓
Design tablet + mobile versions
        ↓
Bring approved design back
        ↓
Existing React + Tailwind + shadcn app
```

The repository remains the source of truth for application logic. Stitch is the source of truth for the redesigned visual layout.

---

## 1. First build the desktop Todo app

If the repo already contains the React/Tailwind/shadcn stack, give your coding agent this prompt.

### Prompt: create the desktop Todo app

```text
Build a desktop-first Todo application in this existing repository.

Use the existing:
- React
- TypeScript
- Tailwind CSS 4
- shadcn/ui
- Radix UI
- Lucide icons

Do not introduce another component library.

For this first version, optimize for a desktop viewport around 1280px wide.
We will redesign it for tablet and mobile later using Google Stitch.

Create a polished Todo interface with:

- application header
- left navigation/sidebar
- Inbox, Today, Upcoming, and Completed views
- task list
- checkboxes for completion
- task title
- optional due date
- optional priority
- Add Task action
- task editing
- search
- filter controls
- task details dialog or panel
- useful empty states

Use shadcn components wherever appropriate instead of recreating primitives.

Good candidates include:
- Button
- Input
- Checkbox
- Dialog
- DropdownMenu
- Select
- Badge
- Tabs
- Separator
- Sidebar
- Tooltip

Keep application logic simple and local for now. No backend is required.

Keep components reasonably modular.

Use the existing shadcn theme tokens and Tailwind classes.
Do not hardcode a new unrelated design system.

Before finishing:
- make sure the app builds
- make sure there are no TypeScript errors
- make sure the desktop UI is visually coherent

Do NOT spend significant effort making this first version mobile responsive.
The purpose of the next phase is to take this desktop design into Stitch and
redesign the responsive behavior there.
```

At this point you should have something like:

```text
Desktop Todo
┌──────────────────────────────────────────────┐
│ Todo                                  + Task │
├──────────────┬───────────────────────────────┤
│ Inbox        │ Today                         │
│ Today        │                               │
│ Upcoming     │ □ Finish report        High  │
│ Completed    │ □ Call supplier        Aug 12│
│              │ ☑ Buy groceries              │
└──────────────┴───────────────────────────────┘
```

Commit this version before doing the Stitch round trip.

```bash
git add .
git commit -m "Create desktop Todo application"
```

---

# 2. Install the normal shadcn agent tooling

For an agent-built shadcn application, I recommend **both**:

1. the official shadcn Agent Skill
2. the official shadcn MCP server

They serve different purposes.

```text
shadcn Agent Skill
    ↓
teaches the agent how this project's
shadcn configuration and components work

shadcn MCP
    ↓
lets the agent search, inspect, and install
components from the shadcn registry
```

## Install the official shadcn skill

From the repository root:

```bash
npx skills add shadcn/ui
```

Install it project-locally for the coding agents working in this repo.

The shadcn skill reads the project's `components.json` and can determine things
such as the framework, Tailwind version, aliases, icon library, base library,
installed components, and resolved component paths.

## Configure the shadcn MCP

The simplest approach is:

```bash
npx shadcn@latest mcp init
```

If you are configuring Claude Code explicitly:

```bash
npx shadcn@latest mcp init --client claude
```

### Claude Code manual configuration

Project `.mcp.json`:

```json
{
  "mcpServers": {
    "shadcn": {
      "command": "npx",
      "args": ["shadcn@latest", "mcp"]
    }
  }
}
```

### Codex manual configuration

Add to:

```text
~/.codex/config.toml
```

```toml
[mcp_servers.shadcn]
command = "npx"
args = ["shadcn@latest", "mcp"]
```

Restart the agent after changing MCP configuration.

### Test the shadcn MCP

Ask the agent:

```text
Use the shadcn MCP and tell me which shadcn components are currently
installed in this project.

Then suggest any additional shadcn components that would be useful
for this Todo application.

Do not install anything yet.
```

Then, if the suggestions look good:

```text
Use the shadcn MCP to install the missing components that are actually
needed for this Todo application.

Do not replace existing components unnecessarily.
```

---

# 3. Install the Stitch skills

Repository:

```text
https://github.com/google-labs-code/stitch-skills
```

Run:

```bash
npx skills add google-labs-code/stitch-skills
```

For this workflow, install/select these Stitch skills:

```text
code-to-design
generate-design
extract-design-md

Dependencies used by code-to-design:
extract-static-html
manage-design-system
upload-to-stitch
```

So the practical set is:

```text
code-to-design
generate-design
extract-design-md
extract-static-html
manage-design-system
upload-to-stitch
```

## Optional: `react-components`

You may also install:

```text
react-components
```

but I recommend treating it as **optional for an existing shadcn application**.

The current `react-components` Stitch skill is fairly opinionated about React
architecture. It can be useful for creating React from Stitch or synchronizing
design assets, but for an existing shadcn application I prefer to let:

```text
Stitch MCP          → provide the approved design
official shadcn Skill → guide component implementation
shadcn MCP          → find/install primitives
your existing repo  → preserve application architecture
```

This reduces the risk of a generic Stitch-to-React workflow unnecessarily
restructuring an application that already has good React/shadcn components.

---

# 4. Configure the Stitch MCP

The Stitch skills require access to the Stitch MCP server.

Use Google's current Stitch MCP setup instructions:

```text
https://stitch.withgoogle.com/docs/mcp/setup
```

The current Stitch API/MCP tooling uses:

```text
STITCH_API_KEY
```

and Google's Stitch SDK identifies the MCP endpoint as:

```text
https://stitch.googleapis.com/mcp
```

Do **not** commit your Stitch API key to the repository.

A Codespace secret or other environment secret is preferable.

After setup, restart the coding agent and ask:

```text
Check whether the Stitch MCP is connected.

List my Stitch projects.

Do not create or modify anything yet.
```

If the agent can list Stitch projects, the connection is working.

---

# 5. Take the desktop Todo app into Stitch

Start the application:

```bash
npm run dev
```

For Vite this will commonly be something like:

```text
http://localhost:5173
```

Keep the dev server running.

Now give the coding agent this prompt.

### Prompt: repo → Stitch

```text
Use the Stitch code-to-design workflow to move the current Todo application
into Google Stitch.

The current application is running locally at:

http://localhost:5173

Create or use a Stitch project named:

Todo Responsive Redesign

Use the existing rendered application as the starting design.

Also analyze the current React/Tailwind/shadcn source and create:

.stitch/DESIGN.md

The design document should capture the existing:
- color roles
- typography
- spacing
- radii
- component styling
- layout conventions
- current design language

Upload the design system and the current desktop Todo screen into Stitch.

Do not modify the React application yet.

When finished, report:
- Stitch project name
- Stitch project ID
- imported screen name
- screen ID
- path to .stitch/DESIGN.md
```

`code-to-design` should orchestrate the static HTML extraction, design-system
extraction, design-system upload, and screen upload.

Commit the Stitch metadata/design document once it looks correct:

```bash
git add .stitch
git commit -m "Add Stitch design metadata"
```

---

# 6. Redesign the app responsively in Stitch

Now use the imported desktop design as the starting point.

You can work directly in the Stitch UI, through the coding agent using
`generate-design`, or use both.

### Prompt: create responsive Stitch designs

```text
Use the imported desktop Todo screen in the Stitch project
"Todo Responsive Redesign" as the source design.

Preserve its existing visual language and design system.

Create coordinated responsive versions for:

DESKTOP
approximately 1280px wide

TABLET
approximately 768px wide

MOBILE
approximately 390px wide

Do not merely scale down the desktop screen.

Redesign the information architecture appropriately at each size.

DESKTOP
- keep the navigation/sidebar persistent
- keep the task list as the primary content area
- make good use of available width

TABLET
- make the task list the dominant content area
- reduce persistent secondary UI
- allow navigation or task details to become overlays/drawers when useful
- keep primary actions immediately accessible

MOBILE
- make the task list the primary full-width experience
- move the desktop sidebar into a drawer/Sheet-style navigation pattern
- keep Add Task easy to reach
- move secondary task actions into an overflow menu where appropriate
- make task editing work well in a mobile dialog/drawer/sheet pattern
- maintain comfortable touch targets
- avoid horizontal page overflow
- avoid simply shrinking desktop controls
- preserve search and filtering without overcrowding the header

Keep the same Todo functionality:
- Inbox
- Today
- Upcoming
- Completed
- add task
- edit task
- complete task
- due dates
- priorities
- search
- filters

Generate or edit the responsive Stitch screens.

Do not change the React repository yet.

When finished, list the desktop, tablet, and mobile screen IDs.
```

---

# 7. Review the design in Stitch

This is the human-design checkpoint.

Open Stitch and inspect:

```text
Desktop
Tablet
Mobile
```

Check especially:

- navigation behavior
- header density
- task row density
- Add Task placement
- task-detail behavior
- search/filter behavior
- spacing
- touch targets
- whether anything important disappeared on mobile

Make direct changes in Stitch if needed.

You can also tell the agent:

```text
Use Stitch to refine the mobile Todo screen.

Keep the existing design system.

The task list should have more vertical breathing room.

Keep Add Task visible.

Reduce the number of controls displayed directly in the mobile header.

Put secondary filtering actions into an appropriate compact menu.

Do not change the desktop screen.
```

Repeat until the Stitch versions are the designs you actually want.

---

# 8. Bring the approved Stitch design back into the repo

Now return to the coding agent in the Codespace.

### Prompt: Stitch → existing React/shadcn repo

```text
Implement the latest approved responsive designs from the Stitch project
"Todo Responsive Redesign" in this existing application.

IMPORTANT:
This is an existing React/Tailwind/shadcn application.

Do not create a second application.
Do not replace the application with exported Stitch HTML.
Do not rewrite working business logic merely because Stitch generated
different markup.

Use Stitch as the visual and responsive design source of truth.

Preserve:
- existing React application logic
- existing state management
- existing component architecture where reasonable
- existing shadcn theme and tokens

Implementation stack must remain:
- React
- TypeScript
- Tailwind CSS 4
- shadcn/ui
- Radix UI
- Lucide icons

Use the official shadcn Agent Skill for implementation guidance.

Use the shadcn MCP when you need to discover or install a component.

Translate Stitch concepts into shadcn components rather than copying
Stitch HTML literally.

Examples:

Stitch mobile drawer/navigation
→ shadcn Sheet or Sidebar mobile behavior

Stitch modal
→ Dialog

Stitch overflow actions
→ DropdownMenu

Stitch checkbox
→ Checkbox

Stitch search field
→ Input

Stitch task filters
→ Tabs, Select, DropdownMenu, or appropriate existing controls

Stitch badges
→ Badge

Implement responsive behavior with Tailwind.

Target approximately:
- mobile: 390px
- tablet: 768px
- desktop: 1280px
- large desktop: 1440px

Pay special attention to:
- horizontal overflow
- clipped controls
- overlapping text
- mobile navigation
- dialogs or sheets exceeding the viewport
- minimum usable touch targets
- task rows becoming too dense
- desktop-only fixed widths
- controls disappearing at breakpoints

Modify the existing components rather than generating a parallel component
tree whenever practical.

When complete:
1. run the TypeScript/build checks
2. summarize which components changed
3. list any new shadcn components installed
4. identify any places where the implementation intentionally differs from
   the Stitch design and explain why
```

---

# 9. Optional responsive verification

If Playwright is installed, validate the UI at:

```text
390px
768px
1280px
1440px
```

A useful agent prompt is:

```text
Test the Todo application at these viewport widths:

390
768
1280
1440

Verify:
- no unintended horizontal page scrolling
- navigation is usable
- Add Task is reachable
- tasks can be completed
- task editing is usable
- search is usable
- filters are usable
- dialogs/sheets remain inside the viewport
- text does not overlap
- controls are not clipped

Take screenshots at each viewport.

Fix responsive implementation problems in React/Tailwind/shadcn.

Do not change the intended Stitch design merely to make testing easier.
```

---

# 10. The complete workflow

```text
PHASE A — BUILD
────────────────────────
Desktop Todo
React
Tailwind
shadcn
Radix


PHASE B — EXTRACT
────────────────────────
code-to-design
      ↓
extract-static-html
extract-design-md
manage-design-system
upload-to-stitch
      ↓
Google Stitch


PHASE C — DESIGN
────────────────────────
generate-design
      ↓
Desktop
Tablet
Mobile


PHASE D — IMPLEMENT
────────────────────────
Stitch MCP
      +
shadcn Agent Skill
      +
shadcn MCP
      ↓
existing React components
      ↓
Tailwind responsive rules
      ↓
shadcn/Radix components


PHASE E — VERIFY
────────────────────────
390
768
1280
1440
```

---

# Recommended agent tooling for this stack

## Core

```text
shadcn Agent Skill      REQUIRED/RECOMMENDED
shadcn MCP              REQUIRED/RECOMMENDED

Stitch MCP              REQUIRED for Stitch agent workflows

Stitch:
code-to-design          RECOMMENDED
generate-design         RECOMMENDED
extract-design-md       RECOMMENDED
extract-static-html     dependency
manage-design-system    dependency
upload-to-stitch        dependency
```

## Optional

```text
Stitch react-components
    Useful for Stitch → React generation/synchronization,
    but more opinionated than necessary for many existing
    shadcn applications.

Playwright
    Useful for automated responsive and visual testing.

Chrome DevTools MCP
    Useful for diagnosing live CSS/layout/overflow problems.
```

---

# Suggested repository structure

After the workflow is set up, the project might contain:

```text
todo-app/
│
├── .agents/
│   └── skills/
│       └── ...
│
├── .stitch/
│   ├── DESIGN.md
│   ├── metadata.json
│   └── designs/
│
├── src/
│   ├── components/
│   ├── pages/
│   └── ...
│
├── components.json
├── package.json
└── ...
```

Keep `.stitch/DESIGN.md` and useful Stitch metadata in Git.

Never commit API keys.

---

# Short version

Once the desktop app exists:

```bash
# shadcn AI knowledge
npx skills add shadcn/ui

# shadcn component registry MCP
npx shadcn@latest mcp init

# Stitch skills
npx skills add google-labs-code/stitch-skills
```

Then configure the Stitch MCP and use these three main prompts in order:

```text
1. Use code-to-design to put this running desktop app into Stitch
   and extract .stitch/DESIGN.md.

2. Use generate-design to create proper tablet and mobile versions
   without merely shrinking desktop.

3. Implement the approved Stitch designs back into the existing
   React/Tailwind/shadcn app. Preserve application logic, use the
   official shadcn skill and MCP, and do not copy Stitch HTML directly.
```

That is the basic round trip:

```text
REPO → STITCH → REDESIGN → REPO
```

---

# Current reference documentation

Google Labs Stitch skills:

https://github.com/google-labs-code/stitch-skills

Stitch MCP setup:

https://stitch.withgoogle.com/docs/mcp/setup

Google Labs Stitch SDK:

https://github.com/google-labs-code/stitch-sdk

shadcn Agent Skills:

https://ui.shadcn.com/docs/skills

shadcn MCP:

https://ui.shadcn.com/docs/mcp
