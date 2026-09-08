# Stack Rush

Stack Rush is a mobile-first multiplayer puzzle-racing game with no account
required. Guests enter a live lounge, challenge another available player, choose
a puzzle and tier, then race under the same server-started countdown. The first
server-validated solution wins.

It offers two games:

- **Nuts & Bolts:** group matching top nuts on bolts. Filled bolts hold four
  nuts; two empty bolts are working space; completed monochrome bolts lock.
- **Tower of Hanoi:** move rings among three pegs without placing a larger ring
  on a smaller ring.

Solo practice uses the same rules and remains local. It saves personal records
on this device without creating a multiplayer match or changing race records.

## Solo play and daily challenges

- Start with the Quick tier, or select a difficulty; puzzle preferences are
  remembered on this device.
- The Daily Sort uses one deterministic Nuts & Bolts puzzle per UTC date,
  rotating through all four tiers. Its completion badge and streak are local.
- Practice supports undo for the last 200 moves, hints, reset, and pause/resume.
  The next solo game replaces the previous saved session.
- Hanoi hints find a shortest route from any valid board. Nuts & Bolts hints
  follow the generator's verified solution; after a detour, undo or reset to
  return to that guided route.
- Hints and undo mark an attempt as assisted. Fastest finishes and fewest moves
  are calculated independently from unassisted runs among the last 100 solves.
  Reset begins a fresh attempt on the same puzzle.
- Saved sessions include validated board history and elapsed play time. Resume
  excludes time spent away after the last save; closing the page saves progress.
- Incoming multiplayer challenges remain actionable during solo practice;
  accepting saves the solo puzzle before joining the race.
- Arrow keys navigate puzzle stacks and game/difficulty choices. Enter or Space
  selects a stack. Hanoi rings retain their color as they change pegs.

Device storage can be cleared by the browser and does not sync across devices.
If storage is unavailable, the open page retains progress in memory. Joining
the lounge still requires a successful connection to the game service.

## Features

- Anonymous, cookie-backed guest sessions with editable names
- Live presence, availability, challenges, accept/decline, cancellation, expiry,
  forfeits, rematches, and reconnect-friendly snapshots
- Server-authoritative countdowns, moves, puzzle state, results, and records
- Optimistic, ordered client move queue with stale-move reconciliation
- Nuts & Bolts tiers with 6, 9, 12, or 15 colors; Hanoi tiers with 3–6 rings
- Deterministic match boards, durable Cloudflare D1 state, and result
  accounting that protects against simultaneous finishes
- Responsive keyboard-aware dialogs and a compact 17-bolt phone board

## Match lifecycle

1. The first visit creates a guest record or resumes one from an `HttpOnly`,
   `SameSite=Lax` cookie. The cookie secret is stored as a SHA-256 hash.
2. The lounge polls for presence. Guests active within 25 seconds appear online;
   a challenge reserves both players so they cannot join overlapping races.
3. Accepting an invite within its 35-second window creates a shared match, with
   independent board states and counters for each player, and a three-second
   countdown.
4. The UI renders a legal move immediately, queues it, and sends the expected
   move count. The API checks membership, countdown status, board validity, move
   legality, and the expected count before persisting it.
5. A winner is claimed through a D1 result ledger in the same batch as the
   match and statistics updates. This makes records exactly-once.
6. After a result, both players can opt into a same-mode, same-tier rematch.

## Architecture

```text
React browser client
  ├─ lounge, race views, solo practice, focus-managed dialogs
  ├─ optimistic moves + polling (0.7 s while racing)
  └─ POST /api/game
         │
         ▼
Next App Router API route
  ├─ sessions, presence, invitations, matches, and results
  ├─ shared puzzle-rule validation
  └─ atomic D1 state transitions
         │
         ▼
Cloudflare D1 / SQLite
  ├─ players, invites, active_slots, matches
  ├─ match_results ledger
  └─ session-rate-limit and maintenance state
```

Vinext produces a Next-compatible App Router application for Cloudflare
Workers. `worker/index.ts` is the Worker entry point and `DB` is the D1
binding supplied through `cloudflare:workers`.

## Repository map

```text
app/
  GameApp.tsx          Client lobby, races, dialogs, optimistic moves, practice
  api/game/route.ts    Server-authoritative game API and lifecycle
  globals.css          Responsive visual system and game-board styling
  layout.tsx           Fonts, document metadata, and Open Graph card
  page.tsx             Root route
db/
  index.ts             D1 binding, schema bootstrap, compatibility migrations
  schema.ts            Drizzle schema definitions
lib/
  bolt-sort.ts         Nuts & Bolts rules, validation, progress, generator
  hanoi.ts             Hanoi rules, validation, progress, tiers
  race-timer.ts        Race timer calculation
worker/index.ts        Cloudflare Worker runtime entry
drizzle/               Generated SQL migrations
tests/                 Unit, rendered-page, and multiplayer smoke tests
design-qa.md           Visual, responsive, accessibility, and interaction QA
```

## Run locally

### Vercel deployment

`npm run build:vercel` builds the existing app, then renders its client-only
homepage into `dist/client/index.html`. Vercel serves that directory and runs
`api/game.ts` as a same-origin bridge to the existing Cloudflare game service.
The D1 database and authoritative multiplayer API remain on Cloudflare; no
database migration or new storage dependency is required. Guest sessions on
the Vercel domain are separate from existing Cloudflare-domain cookies.

Deploy the linked project with `npx vercel --prod`. Changes to the authoritative
game API or database also need deployment to the existing Sites backend.
The bridge has the same 4 KiB request limit and origin protection as the API.
Run its check with `node --test tests/vercel-proxy.test.ts`.

### Requirements

- Node.js **22.13+**
- npm

The tracked `.openai/hosting.json` supplies the project-local D1 binding, so
the normal development command includes the local Worker/D1 setup.

```bash
npm install
npm run dev
```

Open the local URL printed by the server (normally
`http://localhost:3000`). To try multiplayer manually, use two distinct
browser profiles or incognito windows.

Build and serve the production-shaped Worker locally:

```bash
npm run build
npm start
```

The build output is written to `dist/`; `npm start` runs the generated
Wrangler configuration.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the app with local Cloudflare bindings. |
| `npm run build` | Build the Vinext/Cloudflare Worker application. |
| `npm start` | Serve the built Worker locally. |
| `npm test` | Unit tests, build, then rendered product-shell verification. |
| `npm run test:unit` | Puzzle-engine and timer tests only. |
| `npm run test:multiplayer` | Two isolated anonymous clients exercise multiplayer flows. |
| `npm run qa:opponent` | Run a 90-second scripted local opponent for hands-on QA. |
| `npm run qa:challenger` | Have the QA client challenge a guest named `Mobile Racer`. |
| `npm run lint` | ESLint, excluding generated build output. |
| `npx tsc --noEmit` | Type-check without output. |
| `npm run db:generate` | Generate Drizzle SQL after a schema change. |

The multiplayer test expects an already-running server at
`http://localhost:3000`. Override it when needed:

```bash
STACK_RUSH_BASE_URL=http://localhost:8787 npm run test:multiplayer
```

## Design and interaction

The design places the puzzle board ahead of generic dashboard chrome: warm
cream paper, ink outlines, bright orange/lime/sky/purple game colors, heavy
uppercase labels, and hard offset shadows. CSS shapes create the nuts, bolts,
pegs, rings, loading art, and opponent previews; no separate illustration
system is needed.

The mobile board is deliberately composed, not merely scaled down. The
15-color Nuts & Bolts tier uses a 6 / 6 / 5 bolt arrangement so all 17 controls
and the move prompt fit above the fold at 320 × 568. Larger screens add space
and supporting context without changing the central interaction.

- Tap/click a source then a destination; legal targets are highlighted and
  invalid attempts explain the rule.
- The client queues and draws legal moves immediately; the API still determines
  the authoritative state.
- A local finish timestamp freezes the clock instantly, then yields to the
  server-confirmed timestamp.
- Resetting a dead-end Nuts & Bolts board is server-authoritative and protected
  by a move-count compare-and-swap.
- Dialogs trap and restore focus, support Escape where appropriate, and use
  touch-friendly controls. Race progress exposes progress-bar semantics.

See [design-qa.md](design-qa.md) for the detailed QA evidence and rationale.

## Persistence and security boundaries

`players` holds guest identity, presence, records, and active match IDs.
`invites` tracks challenges; `active_slots` stops overlapping invites and
matches. `matches` holds serialized independent board states and move counts.
`match_results` is an exactly-once ledger used while recording statistics.

The API checks same-origin requests and caps JSON request bodies at 4 KiB. Guest
creation has global and per-client rate limits plus stale-session cleanup.
Puzzle mode, tier, board, move, expected move count, match status, and
membership are checked on the server. Conditional D1 updates protect invite
acceptance, final moves, cancellation, reset, and rematch races.

## Making changes

- Update game rules and balance in `lib/bolt-sort.ts` or `lib/hanoi.ts`, then
  update the corresponding unit tests.
- Update API behavior in `app/api/game/route.ts`; keep client prediction in
  `app/GameApp.tsx` aligned, but never move result authority to the client.
- For a database change, edit `db/schema.ts`, run `npm run db:generate`, and
  maintain compatibility handling in `db/index.ts`.
- Preserve the compact phone layout, modal behavior, and focus management when
  editing `app/globals.css` or `app/GameApp.tsx`.

Before handoff, run:

```bash
npm run test:unit
npm run lint
npx tsc --noEmit
npm run build
```

For changes involving sessions, invitations, matches, or records, also start
the app and run `npm run test:multiplayer`.
