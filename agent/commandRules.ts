/*
 * Which shell command a work may run without a person, in one place: the job's gate answers Claude Code's prompts by it,
 * and the gateway answers a Managed Agents session's confirmations by it. Plain, erasable TypeScript with no imports, so
 * Node runs it in the job as it is. The Cockpit's `isAllowableCommand` (ai-agent-developer, const/notes.ts) mirrors
 * `ALLOWABLE_COMMAND`: only such a command is offered to a person.
 */

/** The commands every work may run alone. */
const ALWAYS_ALLOWED = /^(node|npm test|cat|ls|git (status|diff))\b/;
/** A second command, a pipe, a redirect or a substitution: never run without a person, never offered to one. */
const CHAINED = /[;&|<>`$\n\r]/;
/** A command a person may be asked to allow. */
export const ALLOWABLE_COMMAND = /^[A-Za-z0-9][A-Za-z0-9 ._:/@=+,-]{0,189}$/;

/**
 * Whether one command may run: alone, and either one every work may run or one the work's rules name as Claude Code reads
 * them — `Bash(cmd)` that command exactly, `Bash(prefix:*)` the prefix alone or followed by arguments.
 */
export const commandAllowed = (command: string, rules: readonly string[]): boolean => {
  const cmd = command.trim();
  if (!cmd || CHAINED.test(cmd)) return false;
  if (ALWAYS_ALLOWED.test(cmd)) return true;
  return rules.some((rule) => {
    const named = /^Bash\((.+)\)$/.exec(rule)?.[1];
    if (!named) return false;
    if (!named.endsWith(':*')) return cmd === named;
    const prefix = named.slice(0, -2);
    return cmd === prefix || cmd.startsWith(`${prefix} `);
  });
};

/** What the agent is told of a refused command: asked of a person, or to be run differently. */
export const refusalOf = (command: string): string =>
  ALLOWABLE_COMMAND.test(command.trim()) ?
    "Outside the project's rules. A person is asked to allow this exact command; do not ask about it yourself and do " +
    'not run it another way. Finish everything else first, run the tests if you can, then stop: the task continues once ' +
    'they answer.'
  : 'Refused: run each command on its own, never chained, piped, redirected, substituted or with a here-document. ' +
    'Write files with your Write and Edit tools. Commands such as `npm test`, `node <file>`, `cat`, `ls` and ' +
    '`git status` or `git diff` run when given alone. This one is not asked of anyone; try again in that form.';
