// Hands the run's patch and the agent's records to the Cockpit, with this run's token. The records are the agent's own
// files: each is opened without following a link or waiting on a pipe, and taken only as a regular file of bounded size,
// so the agent cannot point one at a file of the job. A record that fails that fails the hand-over, so the Cockpit never
// takes a run's result for an empty one. Nothing stays: the workflow deletes them once sent.
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const [gateway, patchFile, outDir] = process.argv.slice(2);
/** Far above any patch or record a run makes. */
const MAX_BYTES = 32 * 1024 * 1024;

/** A record the agent may not have written is empty; one that is not a regular file, or too large, fails the hand-over. */
const read = (file) => {
  let fd;
  try {
    // Never through a link, never waiting on a pipe the agent left.
    // eslint-disable-next-line no-bitwise -- open(2) takes its flags or'ed together.
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  } catch (error) {
    if (error.code === "ENOENT") return Buffer.alloc(0);
    throw new Error(`${path.basename(file)} cannot be read: ${error.code}`);
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error(`${path.basename(file)} is not a file.`);
    if (stat.size > MAX_BYTES) throw new Error(`${path.basename(file)} is larger than a run may hand in.`);
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
};
const body = {
  patch: gzipSync(read(patchFile)).toString("base64"),
  events: gzipSync(read(path.join(outDir, "agent-events.jsonl"))).toString("base64"),
  requests: gzipSync(read(path.join(outDir, "agent-requests.jsonl"))).toString("base64"),
};
const response = await fetch(`${gateway}/result`, {
  method: "POST",
  headers: { authorization: `Bearer ${process.env.RUN_TOKEN}`, "content-type": "application/json" },
  body: JSON.stringify(body),
});
console.log(response.ok ? "The change was handed to the Cockpit." : `The Cockpit answered ${response.status}.`);
process.exit(response.ok ? 0 : 1);
