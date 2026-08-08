# Peg Rush design QA

## Visual truth and evidence

- Reference mechanic: `.qa/reference-video/early/frame-00-000.00s.png`, extracted from the user-provided screen recording at `00:00` (220 × 480 px).
- Final compact implementation: `.qa/implementation/race-endurance-post-audit-320x568.jpg` (browser CSS viewport 320 × 568 px).
- Final standard implementation: `.qa/implementation/race-endurance-post-audit-390x844.jpg` (browser CSS viewport 390 × 844 px).
- Final side-by-side input: `.qa/implementation/comparison-final.png`.
- Comparison normalization: the source was proportionally scaled from 220 × 480 to 260 × 568 px; the compact implementation remained at its native 320 × 568 px. A 28 px gutter and 44 px label area separate the captures.
- Compared state: active Endurance race at zero moves with 15 colors, 17 bolts, four nuts per filled bolt, and two empty spare bolts. The full board is the focused comparison region because both captures are board-dominant and preserve every playable stack.

## Source-to-implementation review

| Surface | Result |
| --- | --- |
| Mechanic | Passed. Both views use 17 bolts in a 6 / 6 / 5 arrangement, capacity four, two empty spare bolts, one top-nut move at a time, and same-color destination matching. |
| Difficulty and density | Passed. The implementation uses all 15 colors. Every starting stack contains four alternating color segments across three colors, and the generated Endurance solution is 60 legal moves. |
| Typography | Passed. The existing Peg Rush compact uppercase labels, heavy score numerals, and legible instructional copy remain consistent across the multiplayer shell and board. |
| Spacing and sizing | Passed. At 320 × 568 the page has no vertical overflow; the board ends at 466 px and the move prompt ends at 516.5 px. All 17 bolt controls fit above the fold and the minimum control width is 44.328 px. At 390 × 844 the board ends at 684.875 px and the prompt ends at 739.375 px. |
| Colors and tokens | Passed. The requested Peg Rush cream-paper, ink-outline, orange/lime, and hard-shadow system is unchanged. Fifteen logical colors render as fifteen distinct nut styles. The reference's purple theme was intentionally not copied because the user asked to preserve the existing frontend design. |
| Assets and imagery | Passed. The board, loading art, waiting art, brand mark, and opponent preview all use the same nut-and-bolt vocabulary. No retired ring/tower imagery remains in the visible product. |
| Copy | Passed. Product text says “color-sort” and never presents Peg Rush as affiliated with the reference game. Invitations explicitly say no account is required. |
| Multiplayer additions | Passed. Opponent identity, opponent board, progress, timer, and moves fit around the reference-density board without changing the core interaction. |

## Interaction and accessibility QA

- Verified a top nut can be selected and moved to a legal bolt; exactly one nut moves.
- Verified the selected-nut cancel control measures 55.7 × 44 px at 320 × 568; the expanded prompt ends at 531.5 px with no document overflow.
- Verified rapid legal taps queue optimistically and reconcile in order without blocking the entire board.
- Verified completed bolts lock, invalid moves explain the rule, and a no-legal-moves state offers a server-authoritative reset to the shared scramble.
- Verified the opponent preview has one descriptive image role and no nested interactive controls.
- Verified the race progress has progressbar semantics.
- Verified name, invite, leave, and result dialogs receive focus, trap Tab/Shift+Tab, close with Escape where applicable, and restore focus.
- Verified a name dialog and an incoming invite cannot expose two modal layers simultaneously.
- Browser console after the final compact and standard captures: zero warnings and zero errors.

## Iteration history

1. Initial comparison exposed a P0 recovery gap: legal reference-style play can reach a dead end. Added a server-authoritative reset with move-count compare-and-swap protection.
2. Initial generator was P1 too shallow: each stack had only two color segments and solutions topped out at 30 moves. Replaced it with a deterministic, reverse-verified generator whose filled stacks have four alternating segments across three colors and whose Endurance solution is 60 moves.
3. Initial 320 × 568 race was P1 too tall: the prompt fell below the fold. Added a compact board layout that preserves all 17 controls and the 6 / 6 / 5 structure above the fold.
4. Opponent preview was P2 overflowing and exposed decorative buttons to assistive technology. Scoped the short-screen row rule to the main board and rebuilt the preview as non-interactive spans inside one descriptive image role.
5. CTA/micro-label contrast, undersized cancel targets, modal focus, stale network snapshots, and progress semantics were P2 issues. Corrected them and reran browser and automated checks.
6. Post-fix side-by-side review found no remaining P0, P1, or P2 visual or interaction defects.

final result: passed
