// Anchor — a drop-in proxy that keeps AI coding agents on task.
//
// One edge function serves both:
//   • the OpenAI-compatible proxy   POST /v1/chat/completions   (the heart)
//   • the control plane             POST/GET/PATCH /missions...
//
// The InsForge functions host strips the slug, so with the OpenAI SDK pointed at
//   baseURL = https://<appkey>.functions.insforge.app/anchor/v1
// this function receives pathname = /v1/chat/completions.
//
// On EVERY forwarded call Anchor (1) re-injects mission + live memory as a fresh
// system block, (2) detects loops (semantic repeat of a recent step) and drift
// (semantic distance from the goal) and injects a corrective, then (3) after the
// response, extracts/dedupes memory and records the step with token/cost spend.
//
// Reliability rule: anchoring must never break the agent. Every enhancement is
// wrapped so that on any internal failure we fall back to a transparent passthrough.

import { createAdminClient, createClient } from 'npm:@insforge/sdk';
import OpenAI from 'npm:openai';

// ───────────────────────────── constants ─────────────────────────────

const ANCHOR_SENTINEL = '⚓ ANCHOR — MISSION CONTROL';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const EMBED_MODEL = 'openai/text-embedding-3-small';
const EXTRACT_MODEL = 'openai/gpt-4o-mini';
const MAX_EMBED_CHARS = 6000;
const MAX_STORE_CHARS = 8000;

// Thresholds calibrated empirically for openai/text-embedding-3-small (see scripts/calibrate.mjs):
//   off-topic↔goal ≈ 0.07, on-topic↔goal ≈ 0.28–0.63  → drift at ≤ 0.15
//   exact-repeat ≈ 1.0, near-repeat ≈ 0.8, distinct steps ≈ 0.50–0.55 → loop at ≥ 0.85
const DEFAULT_OPTIONS = {
  autoCorrect: true,
  loopThreshold: 0.85,
  driftThreshold: 0.15,
  window: 8,
  windowN: 20,
  loopZ: 1.5,
  driftConsecutive: 2,
  explorationSteps: 3,
  injectionTokenBudget: 1000,
  sequencing: false,
  model: 'openai/gpt-4o-mini',
  embeddingModel: EMBED_MODEL,
  byok: null as null | { apiKey: string; baseUrl?: string },
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-api-key, content-type, anthropic-version, openai-organization, x-anchor-key',
  'Access-Control-Expose-Headers': 'x-anchor-loop, x-anchor-drift, x-anchor-intervened, x-anchor-mission',
};

// ───────────────────────────── small helpers ─────────────────────────────

function env(k: string): string {
  return Deno.env.get(k) ?? '';
}

function admin() {
  // The admin client exposes DB ops under `.database`; return that directly so
  // call sites use admin().from(...) / admin().rpc(...).
  return createAdminClient({ baseUrl: env('INSFORGE_BASE_URL'), apiKey: env('API_KEY') }).database;
}

function internalAI() {
  // Anchor's own gateway for embeddings + memory extraction (never the user's BYOK key).
  return new OpenAI({ baseURL: OPENROUTER_BASE, apiKey: env('OPENROUTER_API_KEY') });
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json', ...extra },
  });
}

function oaiError(message: string, status = 400, type = 'invalid_request_error'): Response {
  return json({ error: { message, type, code: null, param: null } }, status);
}

function appKey(): string {
  try {
    return new URL(env('INSFORGE_BASE_URL')).host.split('.')[0];
  } catch {
    return '';
  }
}

function baseUrls() {
  const k = appKey();
  const root = `https://${k}.functions.insforge.app/anchor`;
  return { openai: `${root}/v1`, anthropic: root, control: root };
}

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function genKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'anc_live_' + b64;
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + ' …[truncated]' : s;
}

function normalizeModel(model?: string): string {
  if (!model) return DEFAULT_OPTIONS.model;
  if (model.includes('/')) return model;
  const m = model.toLowerCase();
  if (/^(gpt|o1|o3|o4|chatgpt|text-embedding|davinci|babbage)/.test(m)) return 'openai/' + model;
  if (m.startsWith('claude')) return 'anthropic/' + model;
  if (m.startsWith('gemini')) return 'google/' + model;
  if (m.startsWith('llama')) return 'meta-llama/' + model;
  if (m.startsWith('mistral') || m.startsWith('mixtral')) return 'mistralai/' + model;
  return model;
}

type Msg = { role: string; content: unknown; tool_calls?: unknown; name?: string };

function messageText(m: Msg): string {
  const c = m.content;
  let text = '';
  if (typeof c === 'string') text = c;
  else if (Array.isArray(c)) {
    text = c
      .map((part: unknown) => {
        if (typeof part === 'string') return part;
        const p = part as { type?: string; text?: string };
        return p?.text ?? '';
      })
      .join(' ');
  }
  // include tool calls so repeated identical tool invocations are detectable
  if (Array.isArray(m.tool_calls)) {
    for (const tc of m.tool_calls as Array<{ function?: { name?: string; arguments?: string } }>) {
      text += ` [tool_call ${tc.function?.name ?? ''} ${tc.function?.arguments ?? ''}]`;
    }
  }
  return text.trim();
}

// The agent's latest intended action = its current input — the last user/tool
// message. Isolating this (rather than blending assistant replies) makes a
// repeated ask score ~1.0 against the prior turn, which is the loop signal.
function extractIncomingAction(messages: Msg[]): string {
  if (!messages?.length) return '';
  let idx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' || messages[i].role === 'tool') {
      idx = i;
      break;
    }
  }
  if (idx === -1) idx = messages.length - 1;
  const parts: string[] = [];
  // for a tool result, include the assistant tool_call that triggered it
  if (messages[idx].role === 'tool' && idx > 0 && messages[idx - 1].role === 'assistant') {
    const prev = messageText(messages[idx - 1]);
    if (prev) parts.push(`assistant: ${prev}`);
  }
  parts.push(`${messages[idx].role}: ${messageText(messages[idx])}`);
  return truncate(parts.join('\n'), MAX_EMBED_CHARS);
}

async function embed(text: string): Promise<number[] | null> {
  try {
    const r = await internalAI().embeddings.create({ model: EMBED_MODEL, input: truncate(text || ' ', MAX_EMBED_CHARS) });
    return r.data[0]?.embedding ?? null;
  } catch (_e) {
    return null;
  }
}

// ───────────────────────────── auth ─────────────────────────────

function bearer(req: Request): string | null {
  const h = req.headers.get('authorization');
  if (h && h.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
  const x = req.headers.get('x-api-key') || req.headers.get('x-anchor-key');
  return x ? x.trim() : null;
}

type Mission = {
  id: string;
  user_id: string | null;
  goal: string;
  constraints: string[];
  status: string;
  memory_summary: string;
  options: Record<string, unknown>;
};

async function resolveMissionFromKey(key: string, touch = false): Promise<Mission | null> {
  if (!key || !key.startsWith('anc_')) return null;
  const hash = await sha256hex(key);
  const db = admin();
  const { data: keyRow } = await db
    .from('api_keys')
    .select('mission_id, revoked')
    .eq('key_hash', hash)
    .eq('revoked', false)
    .maybeSingle();
  if (!keyRow?.mission_id) return null;
  const { data: mission } = await db
    .from('missions')
    .select('id, user_id, goal, constraints, status, memory_summary, options')
    .eq('id', (keyRow as { mission_id: string }).mission_id)
    .maybeSingle();
  if (mission && touch) {
    // fire-and-forget usage bump (only on /v1/* calls, not control-plane reads)
    db.rpc('anchor_touch_key', { p_hash: hash }).then(() => {}, () => {});
  }
  return (mission as Mission) ?? null;
}

function mergedOptions(mission: Mission) {
  return { ...DEFAULT_OPTIONS, ...(mission.options || {}) };
}

// ───────────────────────────── injection block ─────────────────────────────

function stripAnchorBlocks(messages: Msg[]): Msg[] {
  return (messages || []).filter(
    (m) => !(m.role === 'system' && typeof m.content === 'string' && (m.content as string).includes(ANCHOR_SENTINEL)),
  );
}

type Detection = {
  loop: boolean; // CONFIRMED loop (drives headers + corrective)
  drift: boolean; // CONFIRMED drift
  loopSuspected: boolean;
  driftSuspected: boolean;
  loopSimilarity: number | null;
  driftSimilarity: number | null;
  detectionState: string; // none | loop_suspected | loop_confirmed | drift_suspected | drift_confirmed
  match: { seq: number; content: string } | null;
  cluster: { id: string; label: string; attempt_count: number } | null;
  priorOutcome: string | null;
  deadEnds: string[];
  escalate: boolean;
  cyclic: boolean;
};

const EMPTY_DETECTION: Detection = {
  loop: false, drift: false, loopSuspected: false, driftSuspected: false,
  loopSimilarity: null, driftSimilarity: null, detectionState: 'none',
  match: null, cluster: null, priorOutcome: null, deadEnds: [], escalate: false, cyclic: false,
};

const EST_TOK = (s: string) => Math.ceil((s || '').length / 4); // fast token estimate (chars/4)

// Dead-end-aware loop corrective: cite the failed approach + attempt count + known dead-ends, escalate on repeat.
function loopCorrective(det: Detection): string {
  const lines: string[] = ['⚠ LOOP DETECTED.'];
  if (det.cluster?.label) lines.push(`You have attempted "${truncate(det.cluster.label, 120)}" ${det.cluster.attempt_count} time(s) with no progress.`);
  else if (det.match) lines.push(`You are repeating a recent action: "${truncate(det.match.content, 160)}".`);
  const ends = (det.deadEnds || []).slice(0, 3);
  if (ends.length) {
    lines.push('These approaches have ALREADY FAILED — do NOT repeat them:');
    ends.forEach((e) => lines.push(`  - ${truncate(e, 160)}`));
  } else if (det.priorOutcome) {
    lines.push(`You already tried this; the result was: "${truncate(det.priorOutcome, 200)}"`);
  }
  if (det.escalate) {
    lines.push('You have failed this repeatedly. STOP and RE-PLAN from scratch: challenge your core assumption about the problem, or state EXACTLY what information you are missing to proceed. Do not attempt the same class of fix again.');
  } else {
    lines.push('Do something CATEGORICALLY DIFFERENT: change strategy, challenge an assumption, or decompose the problem differently. If you are missing information, state exactly what.');
  }
  return lines.join('\n');
}

function driftCorrective(det: Detection, planStep: string | null): string {
  const pct = det.driftSimilarity != null ? Math.round(det.driftSimilarity * 100) : 0;
  return `⚠ OFF TASK — your recent steps drifted from the mission (relevance ${pct}%). Stop and refocus on the MISSION GOAL above${planStep ? ` (current step: ${planStep})` : ''}.`;
}

// Bounded injection: compose in priority order (goal > constraints > corrective > step > dead-ends > memory > summary),
// truncating lowest-priority items to stay under `budget` tokens. Replaces (never stacks) the prior block.
function buildInjectedBlock(
  mission: Mission,
  summary: string,
  memoryItems: Array<{ type: string; content: string }>,
  planStep: string | null,
  det: Detection,
  autoCorrect: boolean,
  budget = 1000,
): string {
  const out: string[] = [];
  let used = 0;
  const add = (text: string | null): void => {
    if (!text) return;
    const t = EST_TOK(text);
    if (used + t <= budget) { out.push(text); used += t; return; }
    const room = (budget - used) * 4;
    if (room > 160) { out.push(text.slice(0, room - 24) + ' …[trimmed]'); used = budget; }
  };
  add(`${ANCHOR_SENTINEL} (bounded context, re-injected every call)`);
  add(`MISSION GOAL:\n${mission.goal}`);
  const cons = (mission.constraints || []).filter(Boolean);
  add(`CONSTRAINTS (must follow):\n${cons.length ? cons.map((c) => `- ${c}`).join('\n') : '- (none specified)'}`);
  if (autoCorrect && det.loop) add(loopCorrective(det));
  else if (autoCorrect && det.drift) add(driftCorrective(det, planStep));
  if (planStep) add(`CURRENT STEP: ${planStep}`);
  if (det.deadEnds?.length) add(`DEAD ENDS (already failed — avoid):\n${det.deadEnds.slice(0, 4).map((d) => `- ${truncate(d, 160)}`).join('\n')}`);
  if (memoryItems.length) add(`RELEVANT MEMORY:\n${memoryItems.map((m) => `- [${m.type}] ${m.content}`).join('\n')}`);
  if (summary?.trim()) add(`PROGRESS SUMMARY:\n${summary.trim()}`);
  add('Act only in service of the MISSION GOAL above.');
  return out.join('\n\n');
}

// Lightweight periodicity check for A-B-A-B cycles using each prior step's similarity to the incoming action.
function detectCyclic(recent: Array<{ similarity: number }>): boolean {
  const hi = recent.map((r, i) => (Number(r.similarity) >= 0.8 ? i : -1)).filter((i) => i >= 0);
  if (hi.length < 2) return false;
  for (const p of [2, 3]) {
    let count = 0;
    for (const i of hi) if (hi.includes(i - p) || hi.includes(i + p)) count++;
    if (count >= 2) return true;
  }
  return false;
}

// ───────────────────────────── detection ─────────────────────────────

async function detect(missionId: string, embedding: number[], opts: typeof DEFAULT_OPTIONS): Promise<Detection> {
  try {
    const db = admin();
    const window = Number(opts.windowN) || 20;
    const { data, error } = await db.rpc('anchor_detect2', { p_mission_id: missionId, p_query: embedding, p_window: window });
    if (error || !data) return EMPTY_DETECTION;
    const d = data as {
      goal_similarity: number | null; plan_similarity: number | null; progress_count: number; total_steps: number;
      recent: Array<{ seq: number; content: string; similarity: number; loop_similarity: number | null; detection_state: string }>;
      nearest_cluster: { id: string; label: string; attempt_count: number; similarity: number } | null;
    };
    const recent = d.recent || [];
    let top: { seq: number; content: string } | null = null;
    let maxSim = 0;
    for (const r of recent) { const s = Number(r.similarity); if (s > maxSim) { maxSim = s; top = { seq: r.seq, content: r.content }; } }

    // trend stats over prior steps' own max-similarity
    const priorSims = recent.map((r) => Number(r.loop_similarity)).filter((x) => !Number.isNaN(x));
    const mean = priorSims.length ? priorSims.reduce((a, b) => a + b, 0) / priorSims.length : 0;
    const std = priorSims.length ? Math.sqrt(priorSims.reduce((a, b) => a + (b - mean) ** 2, 0) / priorSims.length) : 0;
    const prevMax = recent[0] ? Number(recent[0].loop_similarity) || 0 : 0;
    const prevState = recent[0]?.detection_state || 'none';

    const loopThreshold = Number(opts.loopThreshold) || 0.85;
    const z = Number(opts.loopZ) || 1.5;
    const cluster = d.nearest_cluster;
    const loopByCluster = !!cluster && Number(cluster.similarity) >= 0.85; // re-attempting a known-failed approach
    const loopByThreshold = maxSim >= loopThreshold;
    const loopByTrend = priorSims.length >= 3 && maxSim > mean + z * std && maxSim >= prevMax - 0.02 && maxSim > 0.6;
    const cyclic = detectCyclic(recent);
    const loopSuspected = loopByThreshold || loopByTrend || loopByCluster || cyclic;
    const loopConfirmed = loopSuspected && (maxSim >= 0.97 || loopByCluster || cyclic || prevState.startsWith('loop'));

    // drift — phase-gated (skip exploration) + plan-aware + debounced
    const driftThreshold = Number(opts.driftThreshold) || 0.15;
    const inExploration = d.total_steps < (Number(opts.explorationSteps) || 3) || (d.progress_count || 0) === 0;
    const onTask = Math.max(d.goal_similarity || 0, d.plan_similarity || 0);
    const driftSuspected = !inExploration && onTask <= driftThreshold;
    const driftConfirmed = driftSuspected && prevState.startsWith('drift');

    const detectionState = loopConfirmed ? 'loop_confirmed' : loopSuspected ? 'loop_suspected'
      : driftConfirmed ? 'drift_confirmed' : driftSuspected ? 'drift_suspected' : 'none';

    let priorOutcome: string | null = null;
    let deadEnds: string[] = [];
    if (loopConfirmed) {
      if (top) {
        const { data: outcome } = await db.from('steps').select('content').eq('mission_id', missionId).eq('role', 'model_response').gt('seq', top.seq).order('seq', { ascending: true }).limit(1).maybeSingle();
        priorOutcome = (outcome as { content?: string } | null)?.content ?? null;
      }
      const { data: de } = await db.from('memory_items').select('content').eq('mission_id', missionId).eq('type', 'dead_end').eq('active', true).order('created_at', { ascending: false }).limit(4);
      deadEnds = ((de as Array<{ content: string }>) || []).map((x) => x.content);
    }

    return {
      loop: loopConfirmed, drift: driftConfirmed, loopSuspected, driftSuspected,
      loopSimilarity: maxSim || null, driftSimilarity: onTask || null, detectionState,
      match: top, cluster: cluster ? { id: cluster.id, label: cluster.label, attempt_count: Number(cluster.attempt_count) } : null,
      priorOutcome, deadEnds, escalate: !!cluster && Number(cluster.attempt_count) >= 3, cyclic,
    };
  } catch (_e) {
    return EMPTY_DETECTION;
  }
}

// ───────────────────────────── memory retrieval ─────────────────────────────

async function fetchInjectionMemory(
  missionId: string,
  embedding: number[] | null,
): Promise<Array<{ type: string; content: string }>> {
  const db = admin();
  try {
    if (embedding) {
      const { data } = await db.rpc('anchor_match_memory', {
        p_mission_id: missionId,
        p_query_embedding: embedding,
        p_limit: 6,
        p_threshold: 0.0,
      });
      if (Array.isArray(data) && data.length) {
        return (data as Array<{ type: string; content: string }>).map((m) => ({ type: m.type, content: m.content }));
      }
    }
    const { data } = await db
      .from('memory_items')
      .select('type, content')
      .eq('mission_id', missionId)
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(12);
    return (data as Array<{ type: string; content: string }>) || [];
  } catch (_e) {
    return [];
  }
}

async function activePlanStep(missionId: string): Promise<string | null> {
  try {
    const { data } = await admin()
      .from('plan_steps')
      .select('instruction')
      .eq('mission_id', missionId)
      .eq('status', 'active')
      .order('ord', { ascending: true })
      .limit(1)
      .maybeSingle();
    return (data as { instruction?: string } | null)?.instruction ?? null;
  } catch {
    return null;
  }
}

// ───────────────────────────── post-processing ─────────────────────────────
// No waitUntil in this runtime, so this runs within the request/stream lifecycle.

async function postProcess(opts: {
  mission: Mission;
  incomingText: string;
  incomingEmbedding: number[] | null;
  responseText: string;
  model: string;
  usage: { prompt_tokens?: number; completion_tokens?: number; cost?: number } | null;
  det: Detection;
  intervened: boolean;
  injectedPreview: string;
  failure?: boolean;
}): Promise<void> {
  const db = admin();
  const { mission, incomingText, incomingEmbedding, responseText, model, usage, det, intervened } = opts;
  try {
    const { data: seqData } = await db.rpc('anchor_next_seq', { p_mission_id: mission.id, p_n: 2 });
    const high = typeof seqData === 'number' ? seqData : Number(seqData) || 2;
    const reqSeq = high - 1;
    const respSeq = high;

    // Embed the response and run memory extraction in parallel to bound added latency.
    const [respEmbedding, extracted] = await Promise.all([
      embed(responseText),
      extractMemory(mission, incomingText, responseText),
    ]);

    const reqStep = {
      mission_id: mission.id,
      seq: reqSeq,
      role: 'agent_request',
      content: truncate(incomingText, MAX_STORE_CHARS),
      embedding: incomingEmbedding,
      model,
      tokens_in: usage?.prompt_tokens ?? 0,
      tokens_out: 0,
      cost_usd: 0,
      loop_flag: det.loop,
      loop_similarity: det.loopSimilarity,
      drift_flag: det.drift,
      drift_similarity: det.driftSimilarity,
      detection_state: det.detectionState,
      intervened,
      meta: {
        matched_seq: det.match?.seq ?? null,
        corrective_injected: intervened && (det.loop || det.drift),
        injection_tokens: EST_TOK(opts.injectedPreview),
        cluster: det.cluster ? { label: det.cluster.label, attempt_count: det.cluster.attempt_count } : null,
        escalated: det.escalate,
        injected_preview: truncate(opts.injectedPreview, 1200),
      },
    };
    const { data: insertedReq } = await db.from('steps').insert([reqStep]).select('id');
    const reqId = (insertedReq as Array<{ id: string }> | null)?.[0]?.id ?? null;

    const respStep = {
      mission_id: mission.id,
      seq: respSeq,
      role: 'model_response',
      content: truncate(responseText, MAX_STORE_CHARS),
      embedding: respEmbedding,
      model,
      tokens_in: 0,
      tokens_out: usage?.completion_tokens ?? 0,
      cost_usd: usage?.cost ?? 0,
      meta: { finish: 'stop' },
    };
    const { data: insertedResp } = await db.from('steps').insert([respStep]).select('id');
    const respId = (insertedResp as Array<{ id: string }> | null)?.[0]?.id ?? null;

    // Track failed approaches: on a confirmed loop or a reported failure, cluster the attempt + record a dead-end.
    if ((det.loop || opts.failure) && incomingEmbedding) {
      const label = truncate(incomingText.replace(/^\w+:\s*/, ''), 70);
      let clusterLabel = label;
      try {
        const { data: cl } = await db.rpc('anchor_upsert_cluster', { p_mission_id: mission.id, p_query: incomingEmbedding, p_label: label, p_seq: reqSeq, p_threshold: 0.85 });
        clusterLabel = (cl as { label?: string } | null)?.label || label;
      } catch (_e) { /* best effort */ }
      try {
        const { data: dup } = await db.rpc('anchor_match_memory', { p_mission_id: mission.id, p_query_embedding: incomingEmbedding, p_limit: 1, p_threshold: 0.95 });
        const dupDeadEnd = Array.isArray(dup) && dup.some((x: { type?: string }) => x.type === 'dead_end');
        if (!dupDeadEnd) {
          const content = `Tried "${clusterLabel}" — ${opts.failure ? 'reported failure/partial' : 'looped with no progress'}.`;
          await db.from('memory_items').insert([{ mission_id: mission.id, type: 'dead_end', content: truncate(content, 300), embedding: incomingEmbedding, provenance: 'observed', source_step_id: reqId }]);
        }
      } catch (_e) { /* best effort */ }
    }

    // Apply extracted memory: dedupe via pgvector, then insert; refresh rolling summary.
    if (extracted) {
      if (extracted.summary && extracted.summary.trim()) {
        await db.from('missions').update({ memory_summary: truncate(extracted.summary.trim(), 2000) }).eq('id', mission.id);
      }
      const items = (extracted.items || []).filter((i) => i?.content?.trim()).slice(0, 5);
      if (items.length) {
        const embeddings = await embedBatch(items.map((i) => i.content));
        for (let i = 0; i < items.length; i++) {
          const emb = embeddings?.[i] ?? null;
          if (emb) {
            const { data: dup } = await db.rpc('anchor_match_memory', {
              p_mission_id: mission.id,
              p_query_embedding: emb,
              p_limit: 1,
              p_threshold: 0.95,
            });
            if (Array.isArray(dup) && dup.length) continue; // near-duplicate exists
          }
          await db.from('memory_items').insert([
            {
              mission_id: mission.id,
              type: items[i].type,
              content: truncate(items[i].content, 600),
              embedding: emb,
              source_step_id: respId ?? reqId,
            },
          ]);
        }
      }
    }
  } catch (_e) {
    // best-effort: never throw to the caller
  }
}

async function embedBatch(texts: string[]): Promise<number[][] | null> {
  try {
    const r = await internalAI().embeddings.create({
      model: EMBED_MODEL,
      input: texts.map((t) => truncate(t || ' ', MAX_EMBED_CHARS)),
    });
    return r.data.map((d) => d.embedding);
  } catch {
    return null;
  }
}

async function extractMemory(
  mission: Mission,
  incomingText: string,
  responseText: string,
): Promise<{ summary: string; items: Array<{ type: string; content: string }> } | null> {
  try {
    const sys =
      'You maintain a compact working memory for an AI agent pursuing a mission. ' +
      'From the latest agent action and model response, extract durable, mission-relevant memory and refine a short progress summary. Respond with STRICT JSON only.';
    const user =
      `MISSION: ${mission.goal}\n\n` +
      `PRIOR SUMMARY: ${mission.memory_summary || '(none)'}\n\n` +
      `AGENT ACTION:\n${truncate(incomingText, 2500)}\n\n` +
      `MODEL RESPONSE:\n${truncate(responseText, 2500)}\n\n` +
      'Return JSON: {"summary":"<=3 sentence cumulative progress summary toward the mission",' +
      '"items":[{"type":"decision|fact|progress|todo|dead_end","content":"one concise sentence"}]}. ' +
      'Include only NEW, durable items (max 5). If nothing new, use "items": [].';
    const r = await internalAI().chat.completions.create({
      model: EXTRACT_MODEL,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
      temperature: 0,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });
    const raw = r.choices[0]?.message?.content ?? '';
    const parsed = safeJson(raw);
    if (!parsed) return null;
    const items = Array.isArray(parsed.items)
      ? parsed.items
          .filter((i: unknown) => i && typeof (i as { content?: string }).content === 'string')
          .map((i: { type?: string; content: string }) => ({
            type: ['decision', 'fact', 'progress', 'todo', 'dead_end', 'constraint'].includes(i.type ?? '')
              ? (i.type as string)
              : 'fact',
            content: i.content,
          }))
      : [];
    return { summary: typeof parsed.summary === 'string' ? parsed.summary : '', items };
  } catch {
    return null;
  }
}

function safeJson(s: string): { summary?: string; items?: unknown[] } | null {
  try {
    return JSON.parse(s);
  } catch {
    const m = s.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ───────────────────────────── anchoring (shared) ─────────────────────────────

// Run the full anchoring pass over OpenAI-format messages: detect loop/drift and
// build the fresh BOUNDED system block. Best-effort — any failure yields an empty block.
async function anchorPrepare(
  mission: Mission,
  opts: typeof DEFAULT_OPTIONS,
  oaMessages: Msg[],
): Promise<{ incomingText: string; incomingEmbedding: number[] | null; det: Detection; intervened: boolean; block: string }> {
  try {
    const incomingText = extractIncomingAction(oaMessages);
    const incomingEmbedding = await embed(incomingText);
    let det = EMPTY_DETECTION;
    if (incomingEmbedding) det = await detect(mission.id, incomingEmbedding, opts);
    const intervened = !!opts.autoCorrect && (det.loop || det.drift);
    const [memItems, planStep] = await Promise.all([
      fetchInjectionMemory(mission.id, incomingEmbedding),
      opts.sequencing ? activePlanStep(mission.id) : Promise.resolve(null),
    ]);
    const block = buildInjectedBlock(mission, mission.memory_summary, memItems, planStep, det, !!opts.autoCorrect, Number(opts.injectionTokenBudget) || 1000);
    return { incomingText, incomingEmbedding, det, intervened, block };
  } catch (_e) {
    return { incomingText: '', incomingEmbedding: null, det: EMPTY_DETECTION, intervened: false, block: '' };
  }
}

// ───────────────────────────── the proxy ─────────────────────────────

async function handleChatCompletions(req: Request): Promise<Response> {
  const key = bearer(req);
  if (!key) return oaiError('Missing API key. Pass your Anchor key as the bearer token.', 401, 'authentication_error');

  let mission: Mission | null;
  try {
    mission = await resolveMissionFromKey(key, true);
  } catch (_e) {
    mission = null;
  }
  if (!mission) return oaiError('Invalid or revoked Anchor API key.', 401, 'authentication_error');

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return oaiError('Request body must be valid JSON.', 400);
  }

  const opts = mergedOptions(mission);
  const messages = (Array.isArray(body.messages) ? body.messages : []) as Msg[];
  const stream = body.stream === true;
  const requestedModel = typeof body.model === 'string' ? body.model : undefined;
  const targetModel = normalizeModel(requestedModel || (opts.model as string));

  // ---- anchoring (best-effort; failure falls back to transparent passthrough) ----
  const prep = await anchorPrepare(mission, opts, messages);
  const det = prep.det;
  const incomingText = prep.incomingText;
  const incomingEmbedding = prep.incomingEmbedding;
  const intervened = prep.intervened;
  const injectedPreview = prep.block;
  const outMessages: Msg[] = prep.block
    ? [{ role: 'system', content: prep.block }, ...stripAnchorBlocks(messages)]
    : stripAnchorBlocks(messages);

  // ---- forward to the model (BYOK or Anchor's OpenRouter key) ----
  const byok = opts.byok as null | { apiKey: string; baseUrl?: string };
  const upstreamBase = byok?.baseUrl || OPENROUTER_BASE;
  const upstreamKey = byok?.apiKey || env('OPENROUTER_API_KEY');

  const outBody: Record<string, unknown> = { ...body, model: targetModel, messages: outMessages };
  if (stream) {
    const so = (body.stream_options as Record<string, unknown>) || {};
    outBody.stream_options = { ...so, include_usage: true };
  }

  const flagHeaders: Record<string, string> = {
    'x-anchor-mission': mission.id,
    'x-anchor-loop': String(det.loop),
    'x-anchor-drift': String(det.drift),
    'x-anchor-intervened': String(intervened),
  };

  let upstream: Response;
  try {
    upstream = await fetch(`${upstreamBase}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${upstreamKey}`,
        'content-type': 'application/json',
        'HTTP-Referer': 'https://anchor.dev',
        'X-Title': 'Anchor',
      },
      body: JSON.stringify(outBody),
    });
  } catch (e) {
    return oaiError('Upstream model gateway unreachable: ' + String(e).slice(0, 200), 502, 'api_error');
  }

  if (!upstream.ok || !upstream.body) {
    // pass the upstream error through transparently
    const errText = await upstream.text();
    return new Response(errText, {
      status: upstream.status,
      headers: { ...CORS, 'content-type': upstream.headers.get('content-type') || 'application/json' },
    });
  }

  // ---- non-streaming ----
  if (!stream) {
    const data = await upstream.json();
    const responseText = data?.choices?.[0]?.message?.content ?? '';
    const usage = data?.usage ?? null;
    await postProcess({
      mission,
      incomingText,
      incomingEmbedding,
      responseText: typeof responseText === 'string' ? responseText : JSON.stringify(responseText),
      model: targetModel,
      usage,
      det,
      intervened,
      injectedPreview,
    });
    return json(data, 200, flagHeaders);
  }

  // ---- streaming: pass chunks through; capture content+usage; run postProcess before [DONE] ----
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const out = new ReadableStream({
    async start(controller) {
      let buffer = '';
      let contentBuf = '';
      let usage: { prompt_tokens?: number; completion_tokens?: number; cost?: number } | null = null;

      const handleEvent = (event: string) => {
        const dataLines = event
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim());
        if (!dataLines.length) {
          // comment / keep-alive — pass through as-is
          if (event.trim()) controller.enqueue(encoder.encode(event + '\n\n'));
          return;
        }
        const payload = dataLines.join('\n');
        if (payload === '[DONE]') return; // held; emitted after postProcess
        let j: { choices?: Array<{ delta?: { content?: string } }>; usage?: typeof usage } | null = null;
        try {
          j = JSON.parse(payload);
        } catch {
          controller.enqueue(encoder.encode(event + '\n\n'));
          return;
        }
        if (j?.usage) usage = j.usage;
        const delta = j?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string') contentBuf += delta;
        const usageOnly = j?.usage && (!j.choices || j.choices.length === 0);
        if (usageOnly) return; // capture for billing but don't forward (keep stream transparent)
        controller.enqueue(encoder.encode('data: ' + payload + '\n\n'));
      };

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const event = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            handleEvent(event);
          }
        }
        if (buffer.trim()) handleEvent(buffer);
      } catch (_e) {
        // upstream read error — fall through to close
      }

      try {
        await postProcess({
          mission: mission as Mission,
          incomingText,
          incomingEmbedding,
          responseText: contentBuf,
          model: targetModel,
          usage,
          det,
          intervened,
          injectedPreview,
        });
      } catch (_e) {
        // best-effort
      }

      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
    cancel() {
      try {
        reader.cancel();
      } catch (_e) { /* noop */ }
    },
  });

  return new Response(out, {
    status: 200,
    headers: {
      ...CORS,
      ...flagHeaders,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  });
}

// ───────────────────────── Anthropic-compatible /v1/messages ─────────────────────────
// Translates Anthropic Messages API ⇄ OpenAI chat so the same anchoring core applies,
// then forwards to OpenRouter. Text + tool_use/tool_result supported; streaming covers
// the text path (tool-use streaming is best-effort).

function anthropicError(message: string, status = 400, type = 'invalid_request_error'): Response {
  return json({ type: 'error', error: { type, message } }, status);
}

function antSystemToText(system: unknown): string {
  if (!system) return '';
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system.map((b: { type?: string; text?: string }) => (b?.type === 'text' ? b.text ?? '' : '')).join('\n');
  }
  return '';
}

function antMessagesToOpenAI(messages: Array<{ role: string; content: unknown }>): Msg[] {
  const out: Msg[] = [];
  for (const m of messages || []) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    if (!Array.isArray(m.content)) {
      out.push({ role: m.role, content: String(m.content ?? '') });
      continue;
    }
    const text: string[] = [];
    const toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];
    const toolResults: Msg[] = [];
    for (const b of m.content as Array<Record<string, unknown>>) {
      if (b.type === 'text') text.push(String(b.text ?? ''));
      else if (b.type === 'tool_use')
        toolCalls.push({
          id: String(b.id ?? ''),
          type: 'function',
          function: { name: String(b.name ?? ''), arguments: JSON.stringify(b.input ?? {}) },
        });
      else if (b.type === 'tool_result')
        toolResults.push({
          role: 'tool',
          content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? ''),
          // deno-lint-ignore no-explicit-any
          ...( { tool_call_id: String(b.tool_use_id ?? '') } as any ),
        });
    }
    if (m.role === 'assistant') {
      const msg: Msg = { role: 'assistant', content: text.join('\n') };
      if (toolCalls.length) (msg as { tool_calls?: unknown }).tool_calls = toolCalls;
      out.push(msg);
    } else {
      for (const tr of toolResults) out.push(tr); // OpenAI needs tool messages standalone
      if (text.length) out.push({ role: 'user', content: text.join('\n') });
      else if (!toolResults.length) out.push({ role: 'user', content: '' });
    }
  }
  return out;
}

function antToolsToOpenAI(tools: unknown): unknown {
  if (!Array.isArray(tools)) return undefined;
  return tools.map((t: { name?: string; description?: string; input_schema?: unknown }) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema ?? { type: 'object', properties: {} } },
  }));
}

const STOP_MAP: Record<string, string> = { stop: 'end_turn', length: 'max_tokens', tool_calls: 'tool_use', content_filter: 'end_turn' };

function openAIToAnthropic(data: Record<string, unknown>, model: string): Record<string, unknown> {
  const choice = ((data.choices as unknown[])?.[0] ?? {}) as { message?: Record<string, unknown>; finish_reason?: string };
  const msg = choice.message ?? {};
  const content: Array<Record<string, unknown>> = [];
  if (msg.content) content.push({ type: 'text', text: msg.content });
  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls as Array<{ id?: string; function?: { name?: string; arguments?: string } }>) {
      content.push({ type: 'tool_use', id: tc.id, name: tc.function?.name, input: safeJson(tc.function?.arguments ?? '{}') ?? {} });
    }
  }
  const usage = (data.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number };
  return {
    id: (data.id as string) || 'msg_' + crypto.randomUUID(),
    type: 'message',
    role: 'assistant',
    model,
    content: content.length ? content : [{ type: 'text', text: '' }],
    stop_reason: STOP_MAP[choice.finish_reason ?? 'stop'] ?? 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: usage.prompt_tokens ?? 0, output_tokens: usage.completion_tokens ?? 0 },
  };
}

async function handleMessages(req: Request): Promise<Response> {
  const key = bearer(req);
  if (!key) return anthropicError('Missing API key. Pass your Anchor key via x-api-key or Authorization.', 401, 'authentication_error');
  let mission: Mission | null;
  try {
    mission = await resolveMissionFromKey(key, true);
  } catch {
    mission = null;
  }
  if (!mission) return anthropicError('Invalid or revoked Anchor API key.', 401, 'authentication_error');

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return anthropicError('Request body must be valid JSON.', 400);
  }

  const opts = mergedOptions(mission);
  const stream = body.stream === true;
  const targetModel = normalizeModel((body.model as string) || (opts.model as string));
  const oaMessages = antMessagesToOpenAI((body.messages as Array<{ role: string; content: unknown }>) || []);
  const systemText = antSystemToText(body.system);

  const prep = await anchorPrepare(mission, opts, oaMessages);

  const outMessages: Msg[] = [];
  if (prep.block) outMessages.push({ role: 'system', content: prep.block });
  if (systemText) outMessages.push({ role: 'system', content: systemText });
  outMessages.push(...oaMessages);

  const outBody: Record<string, unknown> = {
    model: targetModel,
    messages: outMessages,
    max_tokens: body.max_tokens ?? 1024,
    stream,
  };
  if (typeof body.temperature === 'number') outBody.temperature = body.temperature;
  if (typeof body.top_p === 'number') outBody.top_p = body.top_p;
  const tools = antToolsToOpenAI(body.tools);
  if (tools) outBody.tools = tools;
  if (stream) outBody.stream_options = { include_usage: true };

  const byok = opts.byok as null | { apiKey: string; baseUrl?: string };
  const upstreamBase = byok?.baseUrl || OPENROUTER_BASE;
  const upstreamKey = byok?.apiKey || env('OPENROUTER_API_KEY');

  const flagHeaders: Record<string, string> = {
    'x-anchor-mission': mission.id,
    'x-anchor-loop': String(prep.det.loop),
    'x-anchor-drift': String(prep.det.drift),
    'x-anchor-intervened': String(prep.intervened),
  };

  let upstream: Response;
  try {
    upstream = await fetch(`${upstreamBase}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${upstreamKey}`, 'content-type': 'application/json', 'HTTP-Referer': 'https://anchor.dev', 'X-Title': 'Anchor' },
      body: JSON.stringify(outBody),
    });
  } catch (e) {
    return anthropicError('Upstream model gateway unreachable: ' + String(e).slice(0, 200), 502, 'api_error');
  }
  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text();
    return anthropicError('Upstream error: ' + errText.slice(0, 400), upstream.status, 'api_error');
  }

  const ppBase = {
    mission: mission as Mission,
    incomingText: prep.incomingText,
    incomingEmbedding: prep.incomingEmbedding,
    model: targetModel,
    det: prep.det,
    intervened: prep.intervened,
    injectedPreview: prep.block,
  };

  if (!stream) {
    const data = await upstream.json();
    const responseText = data?.choices?.[0]?.message?.content ?? '';
    await postProcess({ ...ppBase, responseText: typeof responseText === 'string' ? responseText : JSON.stringify(responseText), usage: data?.usage ?? null });
    return json(openAIToAnthropic(data, targetModel), 200, flagHeaders);
  }

  // streaming: translate OpenAI deltas → Anthropic SSE events (text path)
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const msgId = 'msg_' + crypto.randomUUID();

  const out = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      send('message_start', {
        type: 'message_start',
        message: { id: msgId, type: 'message', role: 'assistant', model: targetModel, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
      });
      send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });

      let buffer = '';
      let contentBuf = '';
      let usage: { prompt_tokens?: number; completion_tokens?: number; cost?: number } | null = null;
      let stopReason = 'end_turn';

      const handleEvent = (event: string) => {
        const dataLines = event.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
        if (!dataLines.length) return;
        const payload = dataLines.join('\n');
        if (payload === '[DONE]') return;
        let j: { choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>; usage?: typeof usage } | null = null;
        try {
          j = JSON.parse(payload);
        } catch {
          return;
        }
        if (j?.usage) usage = j.usage;
        const delta = j?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) {
          contentBuf += delta;
          send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: delta } });
        }
        const fr = j?.choices?.[0]?.finish_reason;
        if (fr) stopReason = STOP_MAP[fr] ?? 'end_turn';
      };

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const ev = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            handleEvent(ev);
          }
        }
        if (buffer.trim()) handleEvent(buffer);
      } catch (_e) { /* fall through */ }

      try {
        await postProcess({ ...ppBase, responseText: contentBuf, usage });
      } catch (_e) { /* best-effort */ }

      send('content_block_stop', { type: 'content_block_stop', index: 0 });
      send('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: usage?.completion_tokens ?? 0 } });
      send('message_stop', { type: 'message_stop' });
      controller.close();
    },
    cancel() {
      try {
        reader.cancel();
      } catch (_e) { /* noop */ }
    },
  });

  return new Response(out, {
    status: 200,
    headers: { ...CORS, ...flagHeaders, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' },
  });
}

// ─────────────────── Path 2: explicit context retrieval (key-read) ───────────────────
// For agents that can't swap their base URL: read the mission's full context behind the
// key, act, then report — closing the same anchoring loop without the proxy.

async function reloadMission(id: string): Promise<Mission | null> {
  const { data } = await admin()
    .from('missions')
    .select('id, user_id, goal, constraints, status, memory_summary, options')
    .eq('id', id)
    .maybeSingle();
  return (data as Mission) ?? null;
}

async function lastFlaggedStep(id: string): Promise<{ loop_flag?: boolean; loop_similarity?: number; drift_flag?: boolean; drift_similarity?: number } | null> {
  const { data } = await admin()
    .from('steps')
    .select('loop_flag, loop_similarity, drift_flag, drift_similarity')
    .eq('mission_id', id)
    .eq('role', 'agent_request')
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { loop_flag?: boolean; loop_similarity?: number; drift_flag?: boolean; drift_similarity?: number }) ?? null;
}

async function advancePlan(id: string): Promise<void> {
  const db = admin();
  const { data: cur } = await db.from('plan_steps').select('id').eq('mission_id', id).eq('status', 'active').order('ord', { ascending: true }).limit(1).maybeSingle();
  if (!cur) return;
  await db.from('plan_steps').update({ status: 'done' }).eq('id', (cur as { id: string }).id);
  const { data: next } = await db.from('plan_steps').select('id').eq('mission_id', id).eq('status', 'pending').order('ord', { ascending: true }).limit(1).maybeSingle();
  if (next) await db.from('plan_steps').update({ status: 'active' }).eq('id', (next as { id: string }).id);
}

function pct(x: number | null | undefined): number { return Math.round((x || 0) * 100); }

async function handleContext(req: Request): Promise<Response> {
  const key = bearer(req);
  if (!key) return json({ error: 'Missing Anchor API key.' }, 401);
  const mission = await resolveMissionFromKey(key, true).catch(() => null);
  if (!mission) return json({ error: 'Invalid or revoked Anchor API key.' }, 401);
  const opts = mergedOptions(mission);
  const [memItems, planStep, last] = await Promise.all([
    fetchInjectionMemory(mission.id, null),
    opts.sequencing ? activePlanStep(mission.id) : Promise.resolve(null),
    lastFlaggedStep(mission.id),
  ]);
  const block = buildInjectedBlock(mission, mission.memory_summary, memItems, planStep, EMPTY_DETECTION, !!opts.autoCorrect, Number(opts.injectionTokenBudget) || 1000);
  const warnings: Array<{ type: string; detail: string }> = [];
  if (last?.loop_flag) warnings.push({ type: 'loop', detail: `Your previous step repeated a recent action (similarity ${pct(last.loop_similarity)}%). Do not repeat it.` });
  if (last?.drift_flag) warnings.push({ type: 'drift', detail: `Your previous step drifted off the mission. Refocus on the goal.` });
  return json({
    mission: { goal: mission.goal, constraints: mission.constraints, status: mission.status },
    current_step: planStep ? { instruction: planStep } : null,
    memory: { summary: mission.memory_summary, items: memItems },
    warnings,
    injection_block: block,
    guidance: 'Read injection_block and treat it as authoritative system context. When you finish a step, POST {action,result,outcome} to /v1/report to update memory and receive refreshed context. Pre-flight an idea with POST {action} to /v1/check.',
  });
}

async function handleReport(req: Request): Promise<Response> {
  const key = bearer(req);
  if (!key) return json({ error: 'Missing Anchor API key.' }, 401);
  const mission = await resolveMissionFromKey(key, true).catch(() => null);
  if (!mission) return json({ error: 'Invalid or revoked Anchor API key.' }, 401);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Body must be valid JSON.' }, 400); }
  const action = typeof body.action === 'string' ? body.action.trim() : '';
  if (!action) return json({ error: 'action is required.' }, 400);
  const result = typeof body.result === 'string' ? body.result : '';
  const outcome = typeof body.outcome === 'string' ? body.outcome : '';

  const opts = mergedOptions(mission);
  const incomingEmbedding = await embed(action);
  let det: Detection = EMPTY_DETECTION;
  if (incomingEmbedding) det = await detect(mission.id, incomingEmbedding, opts);
  const intervened = !!opts.autoCorrect && (det.loop || det.drift);
  const responseText = [result, outcome ? 'Outcome: ' + outcome : ''].filter(Boolean).join('\n');
  const failure = /\b(fail|failed|failure|partial|stuck|error|errors|broken|crash|exception|doesn'?t work|not working|wrong|incorrect|blocked)\b/i.test(`${outcome} ${result}`);

  await postProcess({ mission, incomingText: action, incomingEmbedding, responseText, model: 'anchor-report', usage: null, det, intervened, injectedPreview: '', failure });

  if (opts.sequencing && (body.step_complete === true || /\b(done|complete|completed|finished|works|passing|fixed)\b/i.test(outcome))) {
    await advancePlan(mission.id).catch(() => {});
  }

  const fresh = (await reloadMission(mission.id)) || mission;
  const [memItems, planStep] = await Promise.all([
    fetchInjectionMemory(mission.id, incomingEmbedding),
    opts.sequencing ? activePlanStep(mission.id) : Promise.resolve(null),
  ]);
  const block = buildInjectedBlock(fresh, fresh.memory_summary, memItems, planStep, det, !!opts.autoCorrect, Number(opts.injectionTokenBudget) || 1000);
  const warnings: Array<{ type: string; detail: string }> = [];
  if (det.loop) warnings.push({ type: 'loop', detail: `You repeated "${truncate(det.match?.content || '', 120)}" (similarity ${pct(det.loopSimilarity)}%). You already tried this${det.priorOutcome ? '; result: ' + truncate(det.priorOutcome, 160) : ''}. Do something different.` });
  if (det.drift) warnings.push({ type: 'drift', detail: `That step drifted from the mission (goal relevance ${pct(det.driftSimilarity)}%). Refocus on the goal.` });

  return json({
    recorded: true,
    detection: { loop: det.loop, drift: det.drift, loop_similarity: det.loopSimilarity, drift_similarity: det.driftSimilarity, intervened },
    warnings,
    current_step: planStep ? { instruction: planStep } : null,
    memory: { summary: fresh.memory_summary, items: memItems },
    injection_block: block,
    guidance: 'Follow injection_block. Keep going until the mission is complete, reporting each step.',
  });
}

async function handleCheck(req: Request): Promise<Response> {
  const key = bearer(req);
  if (!key) return json({ error: 'Missing Anchor API key.' }, 401);
  const mission = await resolveMissionFromKey(key, true).catch(() => null);
  if (!mission) return json({ error: 'Invalid or revoked Anchor API key.' }, 401);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Body must be valid JSON.' }, 400); }
  const action = typeof body.action === 'string' ? body.action.trim() : '';
  if (!action) return json({ error: 'action is required.' }, 400);
  const opts = mergedOptions(mission);
  const emb = await embed(action);
  let det: Detection = EMPTY_DETECTION;
  if (emb) det = await detect(mission.id, emb, opts);
  return json({
    loop: det.loop,
    drift: det.drift,
    loop_similarity: det.loopSimilarity,
    drift_similarity: det.driftSimilarity,
    detail: det.loop
      ? `This repeats a recent action (similarity ${pct(det.loopSimilarity)}%) — try a different approach.`
      : det.drift
        ? `This looks off-mission (goal relevance ${pct(det.driftSimilarity)}%) — refocus on the goal.`
        : 'OK — novel and on-task.',
  });
}

// ───────────────────────────── control plane ─────────────────────────────

async function maybeUserId(req: Request): Promise<string | null> {
  const tok = bearer(req);
  if (!tok || tok.startsWith('anc_') || !tok.startsWith('ey')) return null;
  try {
    const client = createClient({ baseUrl: env('INSFORGE_BASE_URL'), edgeFunctionToken: tok });
    const { data } = await client.auth.getCurrentUser();
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

async function createMission(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Body must be valid JSON.' }, 400);
  }
  const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
  if (!goal) return json({ error: 'goal is required.' }, 400);

  const constraints = Array.isArray(body.constraints) ? (body.constraints as string[]).filter((c) => typeof c === 'string') : [];
  const options = { ...DEFAULT_OPTIONS, ...((body.options as Record<string, unknown>) || {}) };
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : goal.slice(0, 48);
  const userId = await maybeUserId(req);

  const db = admin();
  // Embed the goal alone for the drift baseline — constraints dilute the core-objective signal.
  const goalEmbedding = await embed(goal);

  const { data: missionRows, error: mErr } = await db
    .from('missions')
    .insert([
      {
        user_id: userId,
        name,
        goal,
        constraints,
        options,
        goal_embedding: goalEmbedding,
        memory_summary: '',
      },
    ])
    .select('id, name, goal, options, created_at');
  if (mErr || !missionRows?.length) return json({ error: 'Failed to create mission: ' + String(mErr) }, 500);
  const mission = (missionRows as Array<{ id: string }>)[0];

  // mint + store key (hash only)
  const apiKey = genKey();
  const keyHash = await sha256hex(apiKey);
  const keyPrefix = apiKey.slice(0, 16);
  const { error: kErr } = await db
    .from('api_keys')
    .insert([{ mission_id: mission.id, key_prefix: keyPrefix, key_hash: keyHash, label: 'primary' }]);
  if (kErr) return json({ error: 'Failed to create key: ' + String(kErr) }, 500);

  // optional plan decomposition
  if (options.sequencing) {
    try {
      await buildPlan(mission.id, goal, constraints);
    } catch (_e) { /* non-fatal */ }
  }

  const urls = baseUrls();
  return json(
    {
      mission_id: mission.id,
      name,
      api_key: apiKey, // shown ONCE
      key_prefix: keyPrefix,
      base_url: urls.openai,
      anthropic_base_url: urls.anthropic,
      model: options.model,
      options,
      usage_hint: {
        openai_sdk: { baseURL: urls.openai, apiKey: apiKey },
        env: { OPENAI_BASE_URL: urls.openai, OPENAI_API_KEY: apiKey },
      },
      dashboard: `${urls.control}/missions/${mission.id}`,
    },
    201,
  );
}

async function buildPlan(missionId: string, goal: string, constraints: string[]): Promise<void> {
  const r = await internalAI().chat.completions.create({
    model: EXTRACT_MODEL,
    messages: [
      { role: 'system', content: 'Decompose the mission into 3-7 ordered, concrete steps. Respond with STRICT JSON only.' },
      {
        role: 'user',
        content: `MISSION: ${goal}\nCONSTRAINTS: ${constraints.join('; ') || '(none)'}\n\nReturn JSON: {"steps":["step 1","step 2",...]}`,
      },
    ],
    temperature: 0,
    max_tokens: 500,
    response_format: { type: 'json_object' },
  });
  const parsed = safeJson(r.choices[0]?.message?.content ?? '');
  const steps = Array.isArray(parsed?.steps) ? (parsed!.steps as string[]) : [];
  if (!steps.length) return;
  const list = steps.slice(0, 12).map((s) => String(s));
  const embs = await embedBatch(list); // for phase-gated drift (compare to active plan step)
  const rows = list.map((instruction, i) => ({
    mission_id: missionId,
    ord: i,
    instruction,
    embedding: embs?.[i] ?? null,
    status: i === 0 ? 'active' : 'pending',
  }));
  await admin().from('plan_steps').insert(rows);
}

// authorize a control-plane read/write: valid Anchor key for this mission, or owner JWT
async function authorizeMission(req: Request, missionId: string, url: URL): Promise<boolean> {
  const key = bearer(req) || url.searchParams.get('key');
  if (key && key.startsWith('anc_')) {
    const m = await resolveMissionFromKey(key);
    if (m && m.id === missionId) return true;
  }
  const uid = await maybeUserId(req);
  if (uid) {
    const { data } = await admin().from('missions').select('user_id').eq('id', missionId).maybeSingle();
    if ((data as { user_id?: string } | null)?.user_id === uid) return true;
  }
  return false;
}

async function getMission(req: Request, missionId: string, url: URL): Promise<Response> {
  if (!(await authorizeMission(req, missionId, url))) return json({ error: 'Unauthorized.' }, 401);
  const db = admin();
  const { data: mission } = await db
    .from('missions')
    .select('id, name, goal, constraints, status, memory_summary, options, created_at, updated_at')
    .eq('id', missionId)
    .maybeSingle();
  if (!mission) return json({ error: 'Mission not found.' }, 404);

  const [{ data: memory }, { data: steps }, { data: stats }, { data: plan }] = await Promise.all([
    db.from('memory_items').select('id, type, content, active, created_at').eq('mission_id', missionId).eq('active', true).order('created_at', { ascending: false }).limit(100),
    db.from('steps').select('id, seq, role, content, model, tokens_in, tokens_out, cost_usd, loop_flag, loop_similarity, drift_flag, drift_similarity, intervened, meta, created_at').eq('mission_id', missionId).order('seq', { ascending: false }).limit(60),
    db.rpc('anchor_mission_stats', { p_mission_id: missionId }),
    db.from('plan_steps').select('ord, instruction, status').eq('mission_id', missionId).order('ord', { ascending: true }),
  ]);

  const stat = Array.isArray(stats) ? (stats as unknown[])[0] : stats;
  return json({
    mission,
    memory_items: memory || [],
    steps: (steps as unknown[] | null)?.slice().reverse() || [],
    stats: stat || null,
    plan: plan || [],
  });
}

async function getSteps(req: Request, missionId: string, url: URL): Promise<Response> {
  if (!(await authorizeMission(req, missionId, url))) return json({ error: 'Unauthorized.' }, 401);
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
  const offset = Number(url.searchParams.get('offset')) || 0;
  const { data, count } = await admin()
    .from('steps')
    .select('id, seq, role, content, model, tokens_in, tokens_out, cost_usd, loop_flag, loop_similarity, drift_flag, drift_similarity, intervened, meta, created_at', { count: 'exact' })
    .eq('mission_id', missionId)
    .order('seq', { ascending: true })
    .range(offset, offset + limit - 1);
  return json({ steps: data || [], count: count ?? null, limit, offset });
}

async function addMemory(req: Request, missionId: string, url: URL): Promise<Response> {
  if (!(await authorizeMission(req, missionId, url))) return json({ error: 'Unauthorized.' }, 401);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Body must be valid JSON.' }, 400);
  }
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) return json({ error: 'content is required.' }, 400);
  const type = ['decision', 'fact', 'constraint', 'progress', 'todo', 'dead_end'].includes(String(body.type)) ? String(body.type) : 'fact';
  const emb = await embed(content);
  const { data, error } = await admin()
    .from('memory_items')
    .insert([{ mission_id: missionId, type, content, embedding: emb }])
    .select('id, type, content, created_at');
  if (error) return json({ error: String(error) }, 500);
  return json({ memory_item: (data as unknown[])?.[0] ?? null }, 201);
}

async function patchMission(req: Request, missionId: string, url: URL): Promise<Response> {
  if (!(await authorizeMission(req, missionId, url))) return json({ error: 'Unauthorized.' }, 401);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Body must be valid JSON.' }, 400);
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.status === 'string' && ['active', 'paused', 'completed', 'failed'].includes(body.status)) patch.status = body.status;
  if (body.options && typeof body.options === 'object') {
    const { data: cur } = await admin().from('missions').select('options').eq('id', missionId).maybeSingle();
    patch.options = { ...(((cur as { options?: object } | null)?.options) || {}), ...(body.options as object) };
  }
  const { data, error } = await admin().from('missions').update(patch).eq('id', missionId).select('id, status, options');
  if (error) return json({ error: String(error) }, 500);
  return json({ mission: (data as unknown[])?.[0] ?? null });
}

async function createKey(req: Request, missionId: string, url: URL): Promise<Response> {
  if (!(await authorizeMission(req, missionId, url))) return json({ error: 'Unauthorized.' }, 401);
  const apiKey = genKey();
  const keyHash = await sha256hex(apiKey);
  const keyPrefix = apiKey.slice(0, 16);
  let label = 'rotated';
  try {
    const b = await req.json();
    if (b && typeof b.label === 'string') label = b.label;
  } catch { /* no body is fine */ }
  const { data, error } = await admin()
    .from('api_keys')
    .insert([{ mission_id: missionId, key_prefix: keyPrefix, key_hash: keyHash, label }])
    .select('id, key_prefix, created_at');
  if (error) return json({ error: String(error) }, 500);
  return json({ api_key: apiKey, key_prefix: keyPrefix, key: (data as unknown[])?.[0] ?? null }, 201);
}

async function revokeKey(req: Request, missionId: string, keyId: string, url: URL): Promise<Response> {
  if (!(await authorizeMission(req, missionId, url))) return json({ error: 'Unauthorized.' }, 401);
  const { error } = await admin().from('api_keys').update({ revoked: true }).eq('id', keyId).eq('mission_id', missionId);
  if (error) return json({ error: String(error) }, 500);
  return json({ revoked: true, key_id: keyId });
}

async function listKeys(req: Request, missionId: string, url: URL): Promise<Response> {
  if (!(await authorizeMission(req, missionId, url))) return json({ error: 'Unauthorized.' }, 401);
  const { data } = await admin()
    .from('api_keys')
    .select('id, key_prefix, label, revoked, created_at')
    .eq('mission_id', missionId)
    .order('created_at', { ascending: true });
  return json({ keys: data || [] });
}

async function deleteMission(req: Request, missionId: string, url: URL): Promise<Response> {
  if (!(await authorizeMission(req, missionId, url))) return json({ error: 'Unauthorized.' }, 401);
  const { error } = await admin().from('missions').delete().eq('id', missionId); // FK cascades keys/steps/memory/plan
  if (error) return json({ error: String(error) }, 500);
  return json({ deleted: true, mission_id: missionId });
}

// Sharpen a rough goal into a crisp mission + concrete constraints (Prompt Builder helper).
async function refineGoal(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Body must be valid JSON.' }, 400);
  }
  const rough = typeof body.goal === 'string' ? body.goal.trim() : '';
  if (!rough) return json({ error: 'goal is required.' }, 400);
  try {
    const r = await internalAI().chat.completions.create({
      model: EXTRACT_MODEL,
      messages: [
        { role: 'system', content: 'You sharpen a rough agent task into a crisp mission goal and concrete constraints. Respond with STRICT JSON only.' },
        {
          role: 'user',
          content:
            `ROUGH GOAL: ${rough}\n\nReturn JSON: {"goal":"one clear sentence stating exactly what the agent must accomplish",` +
            '"constraints":["specific must/must-not rules"]}. 3-6 constraints max, each concrete and checkable.',
        },
      ],
      temperature: 0.2,
      max_tokens: 400,
      response_format: { type: 'json_object' },
    });
    const parsed = safeJson(r.choices[0]?.message?.content ?? '');
    return json({
      goal: typeof parsed?.goal === 'string' ? parsed.goal : rough,
      constraints: Array.isArray(parsed?.constraints) ? parsed.constraints.filter((c: unknown) => typeof c === 'string') : [],
    });
  } catch (e) {
    return json({ goal: rough, constraints: [], error: String(e).slice(0, 200) });
  }
}

// All of the signed-in user's missions with rollups.
async function listMissions(req: Request): Promise<Response> {
  const uid = await maybeUserId(req);
  if (!uid) return json({ error: 'Authentication required.' }, 401);
  const { data, error } = await admin().rpc('anchor_user_missions', { p_user_id: uid });
  if (error) return json({ error: String(error) }, 500);
  return json({ missions: data || [] });
}

// All of the user's keys (including revoked) joined with mission context + usage.
async function listUserKeys(req: Request): Promise<Response> {
  const uid = await maybeUserId(req);
  if (!uid) return json({ error: 'Authentication required.' }, 401);
  const { data, error } = await admin().rpc('anchor_user_keys', { p_user_id: uid });
  if (error) return json({ error: String(error) }, 500);
  const keys = ((data as Array<Record<string, unknown>>) || []).map((k) => ({
    id: k.id,
    key_prefix: k.key_prefix,
    label: k.label,
    mission: { id: k.mission_id, name: k.mission_name, goal: k.mission_goal },
    status: k.revoked ? 'revoked' : 'active',
    created_at: k.created_at,
    last_used_at: k.last_used_at,
    request_count: k.request_count,
    usage: { tokens: Number(k.tokens) || 0, cost_usd: Number(k.cost) || 0, loops: Number(k.loops) || 0 },
  }));
  return json({ keys });
}

// Rename/label or revoke a key, scoped to the owner.
async function labelKey(req: Request, keyId: string): Promise<Response> {
  const uid = await maybeUserId(req);
  if (!uid) return json({ error: 'Authentication required.' }, 401);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Body must be valid JSON.' }, 400); }
  const db = admin();
  const { data: krow } = await db.from('api_keys').select('mission_id').eq('id', keyId).maybeSingle();
  if (!krow) return json({ error: 'Key not found.' }, 404);
  const { data: m } = await db.from('missions').select('user_id').eq('id', (krow as { mission_id: string }).mission_id).maybeSingle();
  if ((m as { user_id?: string } | null)?.user_id !== uid) return json({ error: 'Unauthorized.' }, 401);
  const patch: Record<string, unknown> = {};
  if (typeof body.label === 'string') patch.label = body.label.slice(0, 80);
  if (typeof body.revoked === 'boolean') patch.revoked = body.revoked;
  if (!Object.keys(patch).length) return json({ error: 'Nothing to update.' }, 400);
  const { data, error } = await db.from('api_keys').update(patch).eq('id', keyId).select('id, label, revoked');
  if (error) return json({ error: String(error) }, 500);
  return json({ key: (data as unknown[])?.[0] ?? null });
}

// ───────────────────────────── router ─────────────────────────────

export default async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const seg = path.split('/').filter(Boolean); // e.g. ["v1","chat","completions"] or ["missions","<id>"]

  try {
    // proxy
    if (req.method === 'POST' && path === '/v1/chat/completions') return await handleChatCompletions(req);
    if (req.method === 'POST' && path === '/v1/messages') return await handleMessages(req);
    if (req.method === 'GET' && path === '/v1/context') return await handleContext(req);
    if (req.method === 'POST' && path === '/v1/report') return await handleReport(req);
    if (req.method === 'POST' && path === '/v1/check') return await handleCheck(req);

    if (req.method === 'POST' && path === '/refine') return await refineGoal(req);

    // user-scoped key history
    if (path === '/keys' && req.method === 'GET') return await listUserKeys(req);
    if (seg[0] === 'keys' && seg[1] && req.method === 'PATCH') return await labelKey(req, seg[1]);

    // control plane
    if (seg[0] === 'missions') {
      if (req.method === 'POST' && seg.length === 1) return await createMission(req);
      if (req.method === 'GET' && seg.length === 1) return await listMissions(req);
      const missionId = seg[1];
      if (missionId) {
        if (seg[2] === 'steps' && req.method === 'GET') return await getSteps(req, missionId, url);
        if (seg[2] === 'memory' && req.method === 'POST') return await addMemory(req, missionId, url);
        if (seg[2] === 'keys' && req.method === 'GET') return await listKeys(req, missionId, url);
        if (seg[2] === 'keys' && req.method === 'POST') return await createKey(req, missionId, url);
        if (seg[2] === 'keys' && seg[3] && req.method === 'DELETE') return await revokeKey(req, missionId, seg[3], url);
        if (seg.length === 2 && req.method === 'GET') return await getMission(req, missionId, url);
        if (seg.length === 2 && req.method === 'PATCH') return await patchMission(req, missionId, url);
        if (seg.length === 2 && req.method === 'DELETE') return await deleteMission(req, missionId, url);
      }
    }

    if (path === '/' || path === '/health') {
      const urls = baseUrls();
      return json({
        service: 'anchor',
        status: 'ok',
        message: 'Set the mission once. Anchor keeps your agent on it.',
        endpoints: {
          openai_base_url: urls.openai,
          create_mission: `POST ${urls.control}/missions`,
          mission: `GET ${urls.control}/missions/:id`,
        },
      });
    }

    return json({ error: { message: `No route for ${req.method} ${path}`, type: 'not_found' } }, 404);
  } catch (e) {
    return json({ error: { message: 'Anchor internal error: ' + String(e).slice(0, 300), type: 'api_error' } }, 500);
  }
}
