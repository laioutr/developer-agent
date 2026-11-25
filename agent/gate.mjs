// Minimal MCP stdio server: one tool that answers Claude Code's permission prompts, and the tools that reach a person
// (`personTools.ts`). Every request is written to agent-requests.jsonl with the gate's decision, so the Cockpit asks a
// person for each command it refused and each question or read of data the agent asked for.
import fs from "node:fs";
import readline from "node:readline";

import { commandAllowed, refusalOf } from "./commandRules.ts";
import { PERSON_TOOLS, recordedOf } from "./personTools.ts";
const log = (o) => fs.appendFileSync(`${process.env.RUNNER_TEMP || "/tmp"  }/agent-requests.jsonl`, `${JSON.stringify(o)  }\n`);
// A design task changes Studio alone: every prompt for a tool its rules did not name is refused, not only commands.
const design = process.argv.includes("--design");
const rl = readline.createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(`${JSON.stringify(m)  }\n`);
/** The gate's answer to one message of Claude Code, or null for a notification, which gets none. */
const answerOf = (m) => {
  if (m.method === "initialize")
    return { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "gate", version: "0.0.1" } };
  if (m.method === "tools/list")
    return {
      tools: [
        { name: "permission", description: "Answers permission prompts", inputSchema: { type: "object", properties: { tool_name: { type: "string" }, input: { type: "object" }, tool_use_id: { type: "string" } } } },
        ...PERSON_TOOLS,
      ],
    };
  if (m.method === "tools/call") {
    if (m.params.name === "permission") {
      const { tool_name, input } = m.params.arguments;
      const cmd = input && input.command ? String(input.command) : "";
      // Claude Code applies the run's own rules before asking; the gate answers by the commands every work may run.
      const allow = !design && (tool_name !== "Bash" || commandAllowed(cmd, []));
      log({ tool: m.params.name, args: m.params.arguments, denied: !allow });
      const refusal = design ? "A design task uses the studio tools alone." : refusalOf(cmd);
      const answer = allow ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: refusal };
      return { content: [{ type: "text", text: JSON.stringify(answer) }] };
    }
    const recorded = recordedOf(m.params.name);
    if (recorded === null) return { content: [{ type: "text", text: "No such tool." }], isError: true };
    log({ tool: m.params.name, args: m.params.arguments });
    return { content: [{ type: "text", text: recorded }] };
  }
  return m.id === undefined ? null : {};
};

rl.on("line", (line) => {
  const m = JSON.parse(line);
  const result = answerOf(m);
  if (result !== null) send({ jsonrpc: "2.0", id: m.id, result });
});
