# Developer agent — the job

Called from each project's repository by its caller file, `.github/workflows/laioutr-developer.yml`, which the
repository template carries. Everything here and everything a run prints is public to that repository's
collaborators; no secret is stored in GitHub.

1. The run exchanges GitHub's OIDC token at the Cockpit's gateway. The Cockpit checks it is this workflow at an
   approved version, in the run it started, with its one-time nonce, and hands over for this run alone: the task, a read
   token for the project's repository, and the model access — the gateway's token in the credits mode;
   Laioutr's own repositories may use Laioutr's subscription.
2. The agent works in a sandbox (bubblewrap): a user of its own, no network, its own `/proc` and `/tmp`, none of the job's
   files, no credential. The run's token for the gateway — Laioutr's key and seat never leave the gateway — stays with
   `agent/proxy.mjs`, run outside the sandbox as another user, which passes on only `/v1/messages` and `count_tokens`
   with the rules of `agent/modelRules.ts` (the gateway's own: the run's models, no server tools or MCP servers, the
   output and the time it was given). Afterwards every process of the agent is killed, and the patch is built from the
   job's own git directory over the agent's files, so nothing the agent wrote runs.
3. `agent/run.mjs` runs Claude Code headless with the rules as allowed tools; anything else goes to `agent/gate.mjs`,
   which denies it as waiting for a person and writes each refused command to the work's requests; the Cockpit asks a
   person to allow it, and an allowed command reaches the next work as a rule. `ask_person` ends the run; the answer
   starts the next one. The exchange step prints the names of what the run received, never a value, and where the model
   is reached, so the log shows that no model credential reaches the job.
4. `agent/report.mjs` sends the patch and the events to the Cockpit, which checks the patch, commits it to
   `agent/<task>` through the App and opens a draft pull request. Nothing is pushed from the run and nothing is kept
   as an artifact.

A new version is tagged (`v1` moves) and its sha approved at the gateway (`AGENT_WORKFLOW_SHAS`) before runs may use it.
`v1` is a lightweight tag: GitHub names an annotated tag's own object in the run's `job_workflow_sha`, not the commit,
so the gateway would refuse it.
