# Peg Rush

Peg Rush is a no-login, mobile-first multiplayer Tower of Hanoi race. Guests
enter a live lounge, challenge another online player, and solve identical boards
against a shared countdown. The first server-validated solution wins.

## Highlights

- Anonymous guest sessions with editable display names
- Live player presence, invitations, declines, cancellations, and expiry
- Three race levels: 3, 4, or 5 rings
- Server-authoritative legal moves, timers, results, and win records
- Opponent progress, rematches, reconnect support, and confirmed forfeits
- Touch-friendly tap-to-lift / tap-to-place controls
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
