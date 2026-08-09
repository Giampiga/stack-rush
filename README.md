# Stack Rush

Stack Rush is a no-login, mobile-first multiplayer puzzle race. Guests enter a
live lounge, challenge another online player, and compete in Nuts & Bolts or
Tower of Hanoi against a shared countdown. The first server-validated solution
wins.

## Highlights

- Anonymous guest sessions with editable display names
- Live player presence, invitations, declines, cancellations, and expiry
- Four race tiers from 6 colors and 8 bolts to 15 colors and 17 bolts
- One-nut tap-to-lift / tap-to-place moves with two spare bolts
- Server-authoritative legal moves, timers, results, and win records
- Opponent progress, rematches, reconnect support, and confirmed forfeits
- D1-backed durable match state and Cloudflare-compatible output

## Development

```bash
npm install
npm run dev
```

## Verification

```bash
npm test
npm run lint
npx tsc --noEmit
npm run test:multiplayer
```

The multiplayer smoke test expects the local development server at
`http://localhost:3000` and uses two isolated anonymous cookie jars.
