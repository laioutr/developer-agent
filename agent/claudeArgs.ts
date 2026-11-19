/*
 * The command line Claude Code runs a task with, in one place. Plain, erasable TypeScript with no imports, so Node runs it
 * in the job as it is.
 */

/**
 * Settings laid over whatever the checked-out repository carries: its hooks never run. Claude Code ignores the
 * permissions of a workspace nobody trusted in print mode, but still runs its hooks, and the repository is the client's
 * to write — a hook there would run a command on every tool use without the gate.
 */
export const RUN_SETTINGS = JSON.stringify({ disableAllHooks: true });

export interface ClaudeRun {
  /** The task and any notes of an earlier run, as one prompt. */
  prompt: string;
  /** The agent's context from the Cockpit; empty for none. */
  system: string;
  /** The MCP configuration holding the gate. */
  mcp: string;
  maxTurns: number;
  /** The tools the agent may use without the gate: the run's rules, the person tools, commands allowed once. */
  allowed: readonly string[];
}

export const claudeArgsOf = (run: ClaudeRun): string[] => [
  '-p',
  run.prompt,
  ...(run.system ? ['--append-system-prompt', run.system] : []),
  '--output-format',
  'stream-json',
  '--verbose',
  '--max-turns',
  String(run.maxTurns),
  '--permission-mode',
  'default',
  '--settings',
  RUN_SETTINGS,
  '--mcp-config',
  run.mcp,
  '--strict-mcp-config',
  '--permission-prompt-tool',
  'mcp__gate__permission',
  '--allowedTools',
  ...run.allowed,
  '--disallowedTools',
  'WebFetch',
  'WebSearch',
];
