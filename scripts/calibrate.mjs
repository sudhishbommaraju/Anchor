// Threshold calibration probe: measures real text-embedding-3-small cosine
// similarities so loop/drift defaults aren't guessed. Reads OPENROUTER_API_KEY
// from .env.local. Run: node scripts/calibrate.mjs
import fs from 'node:fs';

const key = fs
  .readFileSync('.env.local', 'utf8')
  .split('\n')
  .find((l) => l.startsWith('OPENROUTER_API_KEY='))
  .split('=')
  .slice(1)
  .join('=')
  .trim();

async function emb(input) {
  const r = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'openai/text-embedding-3-small', input }),
  });
  const j = await r.json();
  if (!j.data) {
    console.error('embed error:', JSON.stringify(j));
    process.exit(1);
  }
  return j.data.map((d) => d.embedding);
}
const cos = (a, b) => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb));
};

const goal =
  'Build a command-line todo app in Python with add, list, and done commands and JSON file persistence\nUse only the Python standard library\nPersist tasks to todos.json';

const texts = [
  goal, // 0
  'user: In one short sentence: what is the first step to build this app?', // 1 on-topic
  'user: Write the add_task function that appends a task to todos.json', // 2 on-topic
  "user: How do I implement the 'done' command to mark a task complete?", // 3 on-topic
  'user: Now add a list command that prints all tasks with their status', // 4 on-topic
  'user: What is the weather in Paris today?', // 5 OFF topic
  'user: Tell me a joke about cats.', // 6 OFF topic
  'user: Write the add_task function that appends a task to todos.json', // 7 EXACT repeat of 2 (loop)
  'user: Please write the function that adds a new task and saves it to the json file', // 8 paraphrase of 2 (soft loop)
  'assistant: Here is the add_task function implementation in Python.', // 9
];

const e = await emb(texts);
console.log('\n=== cosine(message, GOAL)  [drift = LOW] ===');
const label = [
  '', 'on: first step?', 'on: write add_task', 'on: done command', 'on: list command',
  'OFF: weather paris', 'OFF: cat joke', 'repeat add_task', 'paraphrase add_task', 'assistant reply',
];
for (let i = 1; i < texts.length; i++) console.log(cos(e[0], e[i]).toFixed(3).padStart(6), label[i]);

console.log('\n=== cosine(message, message)  [loop = HIGH] ===');
console.log(cos(e[2], e[7]).toFixed(3), 'exact repeat (2 vs 7)');
console.log(cos(e[2], e[8]).toFixed(3), 'paraphrase (2 vs 8)');
console.log(cos(e[2], e[3]).toFixed(3), 'different on-topic steps (2 vs 3)');
console.log(cos(e[2], e[4]).toFixed(3), 'different on-topic steps (2 vs 4)');
console.log(cos(e[5], e[6]).toFixed(3), 'two off-topic (5 vs 6)');
