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
  /** The MCP configuration holding the gate, and Studio's server where the run has its bridge. */
  mcp: string;
  maxTurns: number;
  /** The tools the agent may use without the gate: the run's rules, the person tools, commands allowed once. */
  allowed: readonly string[];
  /** A design task, with a Studio bridge: it changes Studio alone, so no tool that writes a file or runs a command is offered. */
  design?: boolean;
}

/**
 * The built-in tools a design task never gets, whatever its rules say: it changes Studio alone, and reads no file either,
 * so nothing of the repository can be carried into a page.
 */
export const DESIGN_DISALLOWED: readonly string[] = [
  'Bash',
  'BashOutput',
  'KillShell',
  'Edit',
  'MultiEdit',
  'Write',
  'NotebookEdit',
  'NotebookRead',
  'Read',
  'Glob',
  'Grep',
  'LS',
  'Task',
  'SlashCommand',
  'Skill',
];

/**
 * The MCP servers a task gets: the gate always, and for a run with a Studio bridge the Cockpit's Studio server, reached
 * over HTTP through the proxy's route at `studioUrl`. Neither carries a credential: the proxy and the gateway add them.
 */
export const mcpConfigOf = (run: { gate: string; studioUrl: string | null }) => ({
  mcpServers: {
    // With a Studio bridge the task is a design task, whose gate refuses every prompt.
    gate: { command: 'node', args: run.studioUrl ? [run.gate, '--design'] : [run.gate] },
    ...(run.studioUrl ? { studio: { type: 'http', url: run.studioUrl } } : {}),
  },
});

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
  ...(run.design ? DESIGN_DISALLOWED : []),
];
