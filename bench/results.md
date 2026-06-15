# Anchor benchmark — a task that loops

Same task, run twice. Model: `openai/gpt-4o-mini`, step cap 12, context window 2 (a transparent stand-in for a long session where early turns scroll out).

The job: implement two functions one-per-turn under an arbitrary naming convention ("prefix every function with `qz_`") stated once up front. By the second function the convention has scrolled out of the window. It is un-guessable on purpose — remembering it is the whole task, which is Anchor's job.

| Metric | Baseline (no Anchor) | With Anchor |
|---|---|---|
| Completed the task? | **NO** (hit 12-step cap) | **yes** (2 steps) |
| Steps spent forgetting the convention | 11× | 0× |
| Tokens (in + out) | 1,102 | 467 |
| Cost (USD) | $0.00025 | $0.00009 |
| Wall-clock | 10.4s | 10.2s |
| Loops Anchor flagged | — | 0 |
| Anchor interventions | — | 0 |

**Net tokens saved: 635** (58%). The task completed **only** with Anchor — the baseline lost the convention and looped on the second function until the step cap.

_Reproduce: `node bench/bench.mjs`._
