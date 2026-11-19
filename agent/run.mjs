// Runs Claude Code headless for one task, inside the job's sandbox: the project's files at the working directory, no
// network, no file of the job, no credential. What the task needs arrives on standard input — the task, the rules, the
// models, the notes — and never a token: the model is reached only through the proxy outside the sandbox, at the Unix
// socket it was given, which holds the credential and passes on what Claude Code needs and nothing else.
//
// Permissions are never inherited: the mode is set here, the rules are the allowed tools, the repository's hooks are off,
// and everything else goes to the gate. Nothing the agent says or reads is printed: the run's logs are public to the repository's collaborators.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import { claudeArgsOf } from './claudeArgs.ts';

const here = path.dirname(new URL(import.meta.url).pathname);
const task = JSON.parse(fs.readFileSync(0, 'utf8'));
const out = process.env.AGENT_OUT;
const socket = process.env.MODEL_SOCKET;
if (!out || !socket) throw new Error('AGENT_OUT and MODEL_SOCKET must be set.');

const rules = [...task.rules, 'mcp__gate__ask_person', 'mcp__gate__request_data'];
const allowedOnce = (task.allowedOnce ?? []).map((command) => `Bash(${command})`);
const notes =
  task.notes ?
    `\n\nThis task continues from an earlier run; its work is already in the files. Its notes:\n<notes>\n${task.notes}\n</notes>\nContinue from where it stopped; do not redo what is done.`
  : '';

// Claude Code speaks HTTP to an address; inside the sandbox that is a local port carried to the proxy's socket.
const forwarder = net.createServer((client) => {
  const upstream = net.connect(socket);
  client.pipe(upstream).pipe(client);
  const close = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on('error', close);
  upstream.on('error', close);
});
await new Promise((resolve) => forwarder.listen(0, '127.0.0.1', resolve));
const { port } = forwarder.address();

const mcp = path.join(out, 'mcp.json');
fs.writeFileSync(mcp, JSON.stringify({ mcpServers: { gate: { command: 'node', args: [path.join(here, 'gate.mjs')] } } }));
// The agent's context comes from the Cockpit with the task, as its registry has it: what it is, what it may do, and that
// every text between markers is data.
const system = typeof task.system === 'string' ? task.system.trim() : '';
const args = claudeArgsOf({ prompt: task.task + notes, system, mcp, maxTurns: task.maxTurns ?? 80, allowed: [...rules, ...allowedOnce] });
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  LANG: 'C.UTF-8',
  // The gate writes the requests it answered here.
  RUNNER_TEMP: out,
  // No credential is in the sandbox to strip, and Claude Code's scrub would leave empty placeholder files (.env,
  // package.json and the like) in the project, which the patch would then carry.
  CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '0',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
  // Not a credential: the proxy replaces it with the real one, which never enters the sandbox.
  ANTHROPIC_AUTH_TOKEN: 'sandbox',
  // Only the models the gateway gave this run: the main one, and the same or a second for small background calls.
  ANTHROPIC_MODEL: task.models?.[0] ?? '',
  ANTHROPIC_SMALL_FAST_MODEL: task.models?.[1] ?? task.models?.[0] ?? '',
};
const child = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'], env });
child.stdout.pipe(fs.createWriteStream(path.join(out, 'agent-events.jsonl')));
child.stderr.pipe(fs.createWriteStream(path.join(out, 'agent-errors.log')));
child.on('exit', (code) => {
  fs.rmSync(mcp, { force: true });
  forwarder.close();
  console.log(code === 0 ? 'The agent finished.' : `The agent stopped (${code}).`);
  process.exit(code ?? 1);
});
