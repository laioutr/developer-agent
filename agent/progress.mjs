// Sends what the agent did so far to the Cockpit while it works, every few seconds, with this run's token, so a person
// watching the task sees its steps before it ends. The events file is the agent's own: it is opened without following a
// link or waiting on a pipe, read only as a regular file, and only whole new lines of the agent's turns and its result go.
// Nothing is printed: a run's log is readable by the repository's collaborators. It stops when the job kills it.
import fs from "node:fs";

const [gateway, eventsFile] = process.argv.slice(2);
const EVERY_MS = 15_000;
/** As the gateway takes them: lines per post, characters per line, and bytes per post well under its body limit. */
const LINES_PER_POST = 200;
const LINE_CHARS = 20_000;
const BYTES_PER_POST = 384 * 1024;
/** The most read at once; the rest waits for the next round. */
const CHUNK_BYTES = 2 * 1024 * 1024;
/** Only the agent's turns and its result: what the Cockpit shows. */
const SHOWN = new Set(["assistant", "result"]);

let offset = 0;
let pending = "";
let sent = 0;
let queued = [];

const newText = () => {
  let fd;
  try {
    // eslint-disable-next-line no-bitwise -- open(2) takes its flags or'ed together.
    fd = fs.openSync(eventsFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  } catch {
    return "";
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size <= offset) return "";
    const buffer = Buffer.alloc(Math.min(stat.size - offset, CHUNK_BYTES));
    const read = fs.readSync(fd, buffer, 0, buffer.length, offset);
    offset += read;
    return buffer.subarray(0, read).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
};

const shown = (line) => {
  if (line.length > LINE_CHARS) return false;
  try {
    return SHOWN.has(JSON.parse(line).type);
  } catch {
    return false;
  }
};

const round = async () => {
  const text = pending + newText();
  const lines = text.split("\n");
  pending = lines.pop() ?? "";
  queued.push(...lines.filter(shown));
  while (queued.length) {
    const batch = [];
    let bytes = 0;
    for (const line of queued) {
      bytes += Buffer.byteLength(line) + 4;
      if (batch.length >= LINES_PER_POST || (batch.length > 0 && bytes > BYTES_PER_POST)) break;
      batch.push(line);
    }
    const response = await fetch(`${gateway}/progress`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RUN_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ from: sent, lines: batch }),
    }).catch(() => null);
    if (!response?.ok) return;
    const answer = await response.json().catch(() => null);
    if (typeof answer?.sent !== "number" || answer.sent !== sent + batch.length) return;
    sent = answer.sent;
    queued = queued.slice(batch.length);
  }
};

for (;;) {
  await new Promise((resolve) => setTimeout(resolve, EVERY_MS));
  await round().catch(() => undefined);
}
