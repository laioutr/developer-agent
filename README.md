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
   output and the time it was given). For a run the gateway says has a Studio bridge (`studio: true` at the exchange) it
   also passes the agent's MCP messages to the gateway's `/studio/mcp` with the run's token (`agent/studioRules.ts`:
   POST only, JSON within 1 MB, the transport's headers alone, no redirect followed, within the run's time); Claude Code
   reaches it as the HTTP MCP server `studio` at the sandbox's own forwarder, and the run's Studio key never reaches the
   job. Afterwards every process of the agent is killed, and the patch is built from the job's own git directory over
   the agent's files, so nothing the agent wrote runs.
3. `agent/run.mjs` runs Claude Code headless with the agent's context as its system prompt — sent by the Cockpit with
   the task, from its kind in the Cockpit's registry — and the rules as allowed tools, with every hook of the checked-out
   repository turned off (`agent/claudeArgs.ts`: in print mode Claude Code ignores an untrusted workspace's permissions
   but still runs its hooks, and the repository is the client's to write); anything else goes to `agent/gate.mjs`,
   which denies it as waiting for a person and writes each refused command to the work's requests; the Cockpit asks a
   person to allow it, and an allowed command reaches the next work as a rule. `ask_person` ends the run; the answer
   starts the next one. The exchange step prints the names of what the run received, never a value, and where the model
   is reached, so the log shows that no model credential reaches the job.
4. `agent/report.mjs` sends the patch and the events to the Cockpit, which checks the patch, commits it to
   `agent/<task>` through the App and opens a draft pull request. Nothing is pushed from the run and nothing is kept
   as an artifact.

5. **A pre-release** is a work of its own, which the Cockpit starts after it committed a checked change. The exchange
   answers the commit, the project's package, its `-agent.` version, where to register it and a publish key for that one
   package at that version and a read-only key; both are written to files only the job's user reads, never to the
   environment. A user of its own, in a folder under `/srv`, installs the commit with the read key alone and no script
   or pnpmfile, then — the read key gone, in a network of its own with loopback alone (`unshare --net`) — rebuilds, runs
   `dev:prepare`, `lint`, `test` and `test:types` where the project has them, sets the version and packs the package; its processes are killed until none is left,
   the tarball is checked to be that package at that version, published with `--tag agent` (never `latest`), and
   registered on the `testing` channel at the Cockpit. `agent/release.mjs` hands the outcome — published, or the step it
   stopped at — to the gateway; the Cockpit asks the registry itself whether the version is there.

A new version is tagged (`v1` moves) and its sha approved at the gateway (`AGENT_WORKFLOW_SHAS`) before runs may use it.
`v1` is a lightweight tag: GitHub names an annotated tag's own object in the run's `job_workflow_sha`, not the commit,
so the gateway would refuse it.
