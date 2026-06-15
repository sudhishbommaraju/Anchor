# Anchor hot-path latency

Measured against the live InsForge deployment (`https://2ecpc69u.functions.insforge.app/anchor`), model `openai/gpt-4o-mini`, streaming.
14 calls, first 2 dropped as warm-up; 12 measured.

**Preflight overhead** = everything Anchor adds before the upstream model starts streaming
(key resolve + rate-limit + embed + loop/drift detect + memory retrieval + bounded block build),
measured server-side inside the edge function.

| Metric | Median | Mean | p90 |
|---|---|---|---|
| **Preflight overhead (total)** | **571 ms** | 641 ms | 881 ms |
| ↳ embed (text-embedding-3-small) | 329 ms | 351 ms | 418 ms |
| ↳ detect (loop/drift RPC) | 77 ms | 71 ms | 84 ms |
| ↳ retrieve (memory + plan step) | 108 ms | 103 ms | 118 ms |
| Client TTFB (incl. network + model TTFT) | 1349 ms | 1379 ms | 1730 ms |

The embedding call dominates preflight (it's the irreducible part — detecting a loop/drift
requires embedding the latest turn). Detect and retrieval run **concurrently** (each only needs
the embedding, not the other), and key-resolve / rate-limit / body-parse are also overlapped, so
preflight is roughly `embed + max(detect, retrieve)` rather than their sum. Overlapping these
stages cut median preflight from ~700 ms to ~571 ms.

Anchor's added latency is bounded and independent of session length: the injected block is
token-budgeted, so overhead does not grow as the agent's history grows.

_Regenerate: `node bench/latency.mjs`_
