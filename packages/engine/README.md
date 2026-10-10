# @oracle/engine

Pure TypeScript rules for The Oracle. No I/O; every function takes a `GameState`
and returns a new one. State is plain JSON (stored in Postgres and Inngest step
outputs) and all randomness comes from a seeded RNG kept on the state, so a game
replays exactly from its seed and inputs.

```
deal -> startNight -> [offerPact/applyPact, recordMessage] -> startDay -> [useAction]
     -> startAction -> playCards / autoPlayIdle -> resolveRound (incl. applyThreat)
     -> vote: [useAction scanner, recordMessage whisper/mercy] applyVotes -> startNight ...
     -> final: finalChoice -> ended: revealLog
```

`publicView` / `playerView` are the only shapes meant for clients; `revealLog`
throws until the game has ended.

## Rule interpretations (agreed defaults)

- Locks track each type separately; a lock opens when every type reaches its target. No cap.
- Resolution: matching cards add, then off-type totals subtract from the first-listed type (min 0).
- Jam adds +3 to the first-listed type until that lock opens.
- Threat applies after the lock result (including the turn the exit opens).
- Quarantine: 3 votes against one player; no self-votes; quarantined players still vote
  and use day cards; it lasts exactly one Action phase.
- Lie Detector questions are claims (`isTraitor`, `playedOffType`, `receivedPact`,
  `traitorExists`, `noTraitorYet`); the engine computes the answer.
- Action cards count toward the hand of 5; any number may be held.
- Claims about a round's plays are only allowed once that round's pile is revealed.
- A player who refused the Pact is not offered it again; an unanswered offer counts as refused.
- Threat deck: 2 of each threat (configurable via `threatCounts`), reshuffled when empty.
- Timeout auto-play: an idle player plays their highest card for the lock's neediest type, or nothing.
- Exit outcomes: traitor left behind = perfect; no traitor and nobody left = clean;
  innocent left = bitter; a traitor who walks out (innocent or nobody left) wins.
