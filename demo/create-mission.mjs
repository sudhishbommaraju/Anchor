// Create an Anchor mission and print the key + ready-to-paste env exports.
// Usage:
//   node demo/create-mission.mjs "your goal here" "constraint 1" "constraint 2" ...
// Optional: ANCHOR_API_BASE=https://<appkey>.functions.insforge.app/anchor
const API_BASE = process.env.ANCHOR_API_BASE || 'https://2ecpc69u.functions.insforge.app/anchor';

const [, , goal, ...constraints] = process.argv;
if (!goal) {
  console.error('usage: node demo/create-mission.mjs "<goal>" ["constraint" ...]');
  process.exit(1);
}

const r = await fetch(`${API_BASE}/missions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ goal, constraints }),
});
const j = await r.json();
if (!j.mission_id) {
  console.error('Failed:', JSON.stringify(j, null, 2));
  process.exit(1);
}

console.log('\nMission created:', j.mission_id);
console.log('API key (shown once):', j.api_key);
console.log('\n# OpenAI-compatible (Cursor, OpenAI SDK, any OpenAI client)');
console.log(`export OPENAI_BASE_URL="${j.base_url}"`);
console.log(`export OPENAI_API_KEY="${j.api_key}"`);
console.log('\n# Anthropic-compatible (Claude Code, Anthropic SDK)');
console.log(`export ANTHROPIC_BASE_URL="${j.anthropic_base_url}"`);
console.log(`export ANTHROPIC_AUTH_TOKEN="${j.api_key}"`);
console.log(`\n# Watch the run:`);
console.log(`${API_BASE}/missions/${j.mission_id}?key=${j.api_key}`);
