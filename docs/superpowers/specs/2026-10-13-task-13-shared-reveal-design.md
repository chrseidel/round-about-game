# Task 13: synchronized Reveal

**Status:** design approved 2026-10-13. Implements Task 13 in [TASKS.md](../../../TASKS.md); background in [ARCHITECTURE.md](../../../ARCHITECTURE.md) ("Shared reveal and short timers").

## Goal

Acceptance criteria from TASKS.md:

- All connected screens show the result around the same target time, including the locking Guesser.
- A slow or reconnected player catches up; a pre-reveal GET does not render the result early.
- A wrong guess still inserts the correct card and deducts a life once; double-lock retries cannot advance twice (already guaranteed by Task 12).
- `NEXT_TURN` is rejected until the target time passes (implemented with `NEXT_TURN` in Task 14).

And from the design discussion: **the wait must not feel like a hang.** The tap responds instantly and the 2 seconds are a shared, visible build-up.

The projection already supports this: while `now < revealAtUtc` it returns the pre-lock view (phase `guess`, previous circle and lives, `selectedGap` = guessed gap, `result: null`) plus `pendingReveal` with the result, the final circle, lives and status. Nothing sets `revealAtUtc` yet.

## Decisions

1. **2-second delay** after a lock.
2. **Timeouts reveal immediately.** Only `LOCK_GAP` sets a reveal time; an Overtime timeout result shows at once.
3. **Timing, not secrecy.** The result is in the payload during the wait; the shared reveal is a UX feature, as ARCHITECTURE.md states.

## Server

- `REVEAL_DELAY_MS = 2000` in `amplify/functions/game-api/session.ts`. `lockGap` additionally sets `revealAtUtc: now + REVEAL_DELAY_MS` and `lockedBy: participantId`.
- `Session.lockedBy: string | null` (new sessions: `null`). `PublicSnapshot.lockedBy` exposes it (a participant ID, already public). Task 14's `NEXT_TURN` resets `revealAtUtc` and `lockedBy` and refuses to run before `revealAtUtc`; that rule is added to Task 14 in TASKS.md.
- The `LOCK_GAP` response is the caller's projection like any command, so the locking player also gets the pre-reveal view.

## Browser

**Reveal timing** (`web/turn.ts`):

- `revealed(snapshot: CallerSnapshot, serverNow: number): CallerSnapshot`: with `pendingReveal` and `serverNow >= revealAtUtc`, returns the snapshot with phase `result`, `cards`, `result`, `lives` and `status` from `pendingReveal`, `selectedGap: null` and `pendingReveal: null`; otherwise the snapshot unchanged.
- Every render uses `revealed(latest, Date.now() + offset)`. While a reveal is pending, one timer re-renders at `revealAtUtc` (server time, corrected by the clock offset). A snapshot that arrives after the target is shown revealed at once, without the build-up.
- `gapCommand` returns `null` while `pendingReveal` is set.

**What players see:**

| Time | Locking player | Everyone else |
| --- | --- | --- |
| 0 ms (tap) | The tapped gap switches to the locked look in the same frame; panel "Locking in…". | — |
| Server confirms (~0.2–0.5 s) | Panel "Locked in" / "Carol locked in. Revealing…"; a progress bar fills until the reveal time; the hourglass on the locked gap flips. | Same, from the live event. |
| Reveal time | The card appears in its correct place with the `is-recent` highlight; heading "Correct!" (green) or "Wrong gap" (coral); a lost life crosses out with a short animation. | Same, at the same server time. |

- The optimistic locked look comes from local state (`lockingGap`) and is cleared when the command fails; a `STALE_VERSION` message then shows as in Task 12.
- `renderBoard` gains `lockedGap: number | null` (locked look) and uses `recent` for the revealed card (`result.number`).
- The progress bar's CSS animation runs for the remaining time (`animationDuration` set from `revealAtUtc − serverNow`).
- `prefers-reduced-motion`: no flip, fill or life animation; the panel still shows "Revealing…".
- Copy: "Locking in…", "Locked in", "<Name> locked in. Revealing…" (the locking player sees "You locked in. Revealing…"). Result copy is unchanged from Task 12.

## Testing

- **Unit:** `session.test.ts`: `lockGap` sets `revealAtUtc = now + 2000` and `lockedBy`; a DISCUSSION timeout leaves `revealAtUtc` null. `protocol.test.ts`: `lockedBy` in snapshots; pre-reveal snapshot has no result and keeps the lost life (existing test extended). `web/turn.test.ts`: `revealed` before/at/after the target; `gapCommand` null while pending; pending panel texts for the locker and others.
- **Sandbox script** `scripts/check-reveal.ts`: Tipster Bob, Guessers Alice and Carol, subscribed as Alice over the WebSocket. Carol locks: the response has `result: null`, `pendingReveal` set, `revealAtUtc` ≈ `serverTimeUtc + 2000`, `lockedBy` = Carol. Alice's `GET` before the target has `result: null`; the live event with `pendingReveal` arrives before the target; Alice's `GET` 2.5 s later has the result and the card in the circle.
- **Browser:** three tabs (Tipster, two Guessers). A `MutationObserver` in each records when the result heading appears; report the spread between tabs (target: a few hundred milliseconds at most). Check that the locker's gap gets the locked look synchronously on the tap, the progress bar shows in all tabs, and a reload during the build-up does not show the result early.
- `npm run check`; redeploy; earlier sandbox scripts pass.

## Out of scope

`NEXT_TURN`, game end and new session (Task 14).
