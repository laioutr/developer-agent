// Minimal MCP stdio server: one tool that answers Claude Code's permission prompts and one ask_person tool.
// Every request is written to agent-requests.jsonl with the gate's decision, so the Cockpit asks a person for each
// command it refused.
import fs from "node:fs";
import readline from "node:readline";
const log = (o) => fs.appendFileSync(`${process.env.RUNNER_TEMP || "/tmp"  }/agent-requests.jsonl`, `${JSON.stringify(o)  }\n`);
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
        { name: "ask_person", description: "Ask the person a question; the run ends and continues with the answer", inputSchema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] } },
      ],
    };
  if (m.method === "tools/call") {
    if (m.params.name === "permission") {
      const { tool_name, input } = m.params.arguments;
      const cmd = input && input.command ? String(input.command) : "";
      // A command the rules let run alone: one of these, with no second command, pipe, redirect or substitution after it.
      const allow = tool_name !== "Bash" || (/^(node|npm test|cat|ls|git (status|diff))\b/.test(cmd) && !/[;&|<>`$\n\r]/.test(cmd));
      log({ tool: m.params.name, args: m.params.arguments, denied: !allow });
      const answer = allow ?
          { behavior: "allow", updatedInput: input }
        : {
            behavior: "deny",
            message:
              "Outside the project's rules. A person is asked to allow this exact command now; do not ask about it yourself " +
              "and do not run it another way. Run every command alone, never chained with another. Finish what you can " +
              "without it, then stop: the task continues once they answer.",
          };
      return { content: [{ type: "text", text: JSON.stringify(answer) }] };
    }
    log({ tool: m.params.name, args: m.params.arguments });
    return { content: [{ type: "text", text: "Recorded. The run ends now; the answer starts the next run." }] };
  }
  return m.id === undefined ? null : {};
};

rl.on("line", (line) => {
  const m = JSON.parse(line);
  const result = answerOf(m);
  if (result !== null) send({ jsonrpc: "2.0", id: m.id, result });
});
