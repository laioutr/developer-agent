// Hands a pre-release's outcome to the Cockpit, with this run's token: published, or the step that failed. Nothing of the
// build's output is sent: the Cockpit asks the registry itself whether the version is there.
//   node release.mjs <gateway> <published|failed> <step>
import { gzipSync } from 'node:zlib';

const STEPS = new Set(['install', 'checks', 'build', 'package', 'publish', 'register', 'none']);

const [gateway, outcome, step] = process.argv.slice(2);
if (!['published', 'failed'].includes(outcome) || !STEPS.has(step)) throw new Error('Name the outcome and the step.');

const line = `${JSON.stringify({ kind: 'release', outcome, step })}\n`;
const empty = gzipSync(Buffer.alloc(0)).toString('base64');
const response = await fetch(`${gateway}/result`, {
  method: 'POST',
  headers: { authorization: `Bearer ${process.env.RUN_TOKEN}`, 'content-type': 'application/json' },
  body: JSON.stringify({ patch: empty, events: gzipSync(line).toString('base64'), requests: empty }),
});
console.log(response.ok ? "The pre-release's outcome was handed to the Cockpit." : `The Cockpit answered ${response.status}.`);
process.exit(response.ok ? 0 : 1);
