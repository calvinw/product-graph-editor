# Team Rooms: Create / Join Plan

## Goal

Let authenticated users collaborate in a private room. A room owns its saved product-graph files, and members can open the same room to view and edit those files.

The first version is intentionally simple:

- A signed-in user creates a room and becomes its owner.
- The app shows a short, shareable join code.
- Another signed-in user enters that code to join the room.
- Members see the room's saved files; only owners can manage membership.

## Experience direction — a shared analysis studio

This should not resemble a generic “invite users” admin panel. The room is a visible, living layer of the Prism workspace: precise, calm, and graph-native.

- **Mood:** dark mineral surfaces, electric violet/cyan room accents, deliberate motion, and the same technical confidence as the graph canvas.
- **Identity:** every room receives a small generated mark (a four-node constellation derived from the room ID), a room color, and an abbreviated name. It appears as a compact presence chip in the top bar.
- **Live feeling:** overlapping member avatars, a soft “Live” pulse when someone else is present, and concise activity language such as “Mina saved Cotton tote · 2m ago.”
- **Focused transitions:** clicking a room control opens a dedicated dialog/sheet with a subtly blurred graph backdrop, rather than expanding a dense form inside the small Settings popover.
- **No dashboard sprawl:** the workspace remains the product. Rooms add collaboration context without displacing the graph or turning the app into a project-management product.

### Visual primitives

| Element | Direction |
| --- | --- |
| Room badge | 28px constellation mark, room name, member-avatar stack, live dot; compact enough for the top bar. |
| Room cards | Dark translucent cards with a faint graph-grid texture, 1px tinted border, and a color rail tied to the room mark. |
| Invite code | Four large, individually framed monospaced digits; a subtle copy confirmation changes the button to a checkmark. |
| Presence | Avatar stack with a “+N” overflow badge; tooltips reveal names and current activity. |
| Motion | 160–220ms opacity/scale transitions; no looping decorative animation except a restrained live-status pulse. |
| Empty state | A small constellation illustration and a clear invitation to “Start a shared analysis.” |

## Proposed layout

Add a **Team room** section directly beneath **Appearance** (Dark / Light) in the existing Settings popover. It is a compact launch point, not the full management interface.

```text
┌───────────────────────────── Settings ─────────────────────────────┐
│ Decimal places                                                     │
│ [ − ]  2  [ + ]                                                    │
│                                                                     │
│ Appearance                                                          │
│ [ Dark ] [ Light ]                                                  │
│                                                                     │
│ ── Team room ───────────────────────────────────────────────────── │
│ ◌  Personal workspace                                               │
│ Start a shared analysis with your team.                             │
│ [ Create room ]                         [ Join with code → ]       │
└───────────────────────────────────────────────────────────────────┘
```

When a user belongs to a room, the same compact card becomes:

```text
┌─ ◌  Aether Materials ────────────────────────────────  ● Live ────┐
│   3 collaborators                 [ Open room studio → ]          │
└───────────────────────────────────────────────────────────────────┘
```

Selecting **Create room**, **Join with code**, or **Open room studio** opens the dedicated Team Room dialog. On mobile, use a contained bottom sheet with the same sections and a visible close button.

### Team Room dialog

```text
┌──────────────────────────  AETHER MATERIALS  ─────────────────────┐
│  ◌  Room studio                                  ● 3 people live   │
│  Collaborate on models, scenarios, and saved analyses.             │
│                                                                      │
│  FILES IN THIS ROOM                                                  │
│  ┌─ Cotton tote ─────────── Edited by Mina · just now ───────────┐ │
│  └─ Transport sensitivity ─ Saved 12m ago ───────────────────────┘ │
│                                                                      │
│  PEOPLE                                                              │
│  [Ava] [Mina] [You]     Invite code  [ 4 ] [ 8 ] [ 2 ] [ 7 ] [Copy]│
│                                                                      │
│  [ Manage people ]                           [ Leave room ]        │
└──────────────────────────────────────────────────────────────────────┘
```

The dialog has three visual states: **Personal workspace**, **Create / join**, and **Active room**. It avoids introducing a separate full-page team dashboard in the first release.

### Create room dialog

```text
Start a shared analysis
Create a private room for models, files, and teammates.

Room name     [ Aether Materials                       ]
Room accent   [ Violet constellation ] [ Cyan ] [ Amber ]

[ Cancel ]                                  [ Create room → ]
```

After creation, replace the Settings section with:

```text
◌  Aether Materials                                      ● Live
    [A] [M] [+1]  3 collaborators

Your invite code
[ 4 ] [ 8 ] [ 2 ] [ 7 ]                         [ Copy code ]
Expires tomorrow · Owner controls this code

[ Manage room ]                                      [ Leave room ]
```

### Join room dialog

```text
Join a shared analysis
Enter the four-digit code from a room owner.

                 [  _  ] [  _  ] [  _  ] [  _  ]

No room yet?                                  [ Create one → ]

[ Cancel ]                                  [ Join room → ]
```

Use one input that accepts four digits, with visual digit grouping. It must support paste, keyboard navigation, a clear validation error, and accessible labels. On valid entry, show a brief confirmation preview—room mark, room name, and member count—before the person confirms they want to join.

### File workspace behavior

- Replace the bare workspace context with a compact active-room badge near the existing workspace title, for example: `◌ Aether Materials · Cotton tote`.
- The File menu lists only files belonging to the active room.
- Creating, saving, renaming, or deleting a file immediately affects the shared room library.
- A person not in a room keeps a private personal workspace; their existing local files must not be uploaded or shared automatically.
- When a member joins a room, show an explicit choice: **Open room files** or **Stay in personal workspace**. Do not silently overwrite current unsaved edits.

## Permissions

| Capability | Owner | Member |
| --- | --- | --- |
| View room and files | Yes | Yes |
| Create / edit room files | Yes | Yes |
| Delete room files | Yes, initially | Yes, initially |
| View members | Yes | Yes |
| Share or rotate join code | Yes | No |
| Remove members / delete room | Yes | No |

Future versions can add viewer and editor roles. Start with owner/member only to keep the first release clear.

## Security decisions

A four-digit code is convenient but has only 10,000 possible values. It must not be the security boundary by itself.

- Require Supabase authentication before creating or joining a room.
- Generate codes server-side, not in the browser.
- Store only a cryptographic hash of the code.
- Make the code expire (for example, 24 hours) and allow the owner to rotate it.
- Rate-limit failed join attempts per user and IP address; temporarily block repeated guesses.
- Validate membership on the server/database for every file operation.
- Use Supabase Row Level Security (RLS) so a browser cannot read or write another room's records just by changing an ID in a request.
- Treat the code as an invitation link equivalent: anyone it is shared with may join until it is rotated or expires.

For a more private production workflow, replace the four-digit code with a longer invite link or a one-time invitation sent to a specific email address.

## Proposed Supabase data model

```text
rooms
  id                 uuid primary key
  name               text
  owner_id           uuid -> auth.users.id
  created_at         timestamptz
  updated_at         timestamptz

room_members
  room_id            uuid -> rooms.id
  user_id            uuid -> auth.users.id
  role               text: owner | member
  joined_at          timestamptz
  primary key (room_id, user_id)

room_invites
  id                 uuid primary key
  room_id            uuid -> rooms.id
  code_hash          text
  expires_at         timestamptz
  max_uses           integer
  use_count          integer
  created_by         uuid -> auth.users.id
  revoked_at         timestamptz nullable

room_files
  id                 uuid primary key
  room_id            uuid -> rooms.id
  name               text
  yaml_content       text
  created_by         uuid -> auth.users.id
  updated_by         uuid -> auth.users.id
  created_at         timestamptz
  updated_at         timestamptz
  version            integer

room_file_versions (phase 2)
  id, room_file_id, yaml_content, created_by, created_at
```

Use a Supabase Edge Function or Postgres RPC for `create_room`, `join_room`, and `rotate_room_code`; do not allow direct browser inserts into `room_invites`.

## Realtime and edit-conflict plan

### First release

- Use Supabase Realtime to notify members when a file is created, renamed, deleted, or saved.
- A save updates one `room_files` row and increments its `version`.
- Before saving, compare the file version loaded by the user with the current version in the database.
- If another member saved first, show: **This file changed in the room. Reload their version or save a copy.**
- Do not attempt simultaneous character-by-character collaboration in the first release.

### Later release

- Add presence indicators (for example, “Mina is editing Cotton tote”).
- Add revision history, restore, and named snapshots.
- Consider CRDT/Yjs collaboration only if simultaneous YAML editing is a confirmed need.

## Implementation phases

### Phase 1 — Foundation

1. Add Supabase migration for rooms, memberships, invitations, and room files.
2. Add RLS policies and server-side RPC/Edge Functions.
3. Add unit/integration tests for ownership, membership, expired codes, and rate limits.

### Phase 2 — Room controls

1. Add the Team room section beneath Appearance in Settings.
2. Build Create room, Join room, and Manage members dialogs with shadcn/Radix primitives already used by the app.
3. Add code copy, expiry/rotation, leaving a room, and clear error states.

### Phase 3 — Shared file library

1. Add a room-aware file repository alongside the existing local workspace persistence.
2. Keep personal and room files clearly separated.
3. Add safe switching, unsaved-change confirmation, and room file CRUD.

### Phase 4 — Collaboration quality

1. Add Realtime updates and optimistic version checks.
2. Add member/activity feedback.
3. Test at 375 × 812, 768 × 1024, and 1440 × 900, ensuring Settings dialogs remain usable and the graph canvas retains space.

## Acceptance criteria for the first release

- Only signed-in users can create or join rooms.
- An owner can create a room and share an active code.
- A listed test user can join with a valid code and cannot join with an expired, revoked, or invalid code.
- A non-member cannot read or write room files through the UI or direct Supabase requests.
- Members see new and changed files without manual page refresh.
- A conflicting save never silently overwrites another member's saved work.
- Personal files remain private unless the user explicitly creates or copies a file into a room.
- The room controls work with keyboard navigation and at the project's supported screen sizes.

## Decisions to make before implementation

1. Should every member be able to delete files, or owners only?
2. Should joining a room give access indefinitely, or should membership expire?
3. Is a four-digit code acceptable for a short-lived beta invitation, or should the first release use a longer code/link?
4. Should a user be able to belong to multiple rooms and switch between them?
5. Should the owner be able to make a room read-only for reviewers?
