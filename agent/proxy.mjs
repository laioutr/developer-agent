// The run's only way to the model, run in the job as a user of its own: it holds this run's token for Laioutr's gateway,
// and the agent, sandboxed without a network, reaches the model only through it. Laioutr's key and seat stay in the
// gateway. It passes on what the rules allow (`modelRules.ts`, the gateway's own) and nothing else, so no request
// the agent makes can reach a host through the provider, and the credential never enters the agent's sandbox.
//
// Configuration arrives once on standard input: { socket, upstream, token, models, maxOutputTokens, deadline,
// maxCalls }. It listens on a Unix socket the sandbox is given.
import fs from "node:fs";
import http from "node:http";
import { Readable } from "node:stream";

import { ALLOWED_PATHS, ALLOWED_QUERIES, betasOf, maxTokensOf, PASSED_HEADER, refusalOf } from "./modelRules.ts";

/** The most a request body may be: far above any conversation Claude Code sends. */
const MAX_BODY_BYTES = 32 * 1024 * 1024;

/** The headers of the provider's answer passed back; its own credentials and cookies stay here. */
const ANSWER_HEADERS = ["content-type", "request-id", "retry-after", "anthropic-ratelimit-unified-status", "anthropic-ratelimit-unified-reset"];

const error = (response, status, type, message) => {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify({ type: "error", error: { type, message } }));
};

const bodyOf = (request) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("too large"));
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });

/** The headers a passed request carries: those the rules let through, the credential, and the betas that remain. */
export const upstreamHeadersOf = (incoming, config) => {
  const headers = {};
  for (const [name, value] of Object.entries(incoming)) if (PASSED_HEADER.test(name) && typeof value === "string") headers[name] = value;
  headers.authorization = `Bearer ${config.token}`;
  const betas = betasOf(incoming["anthropic-beta"]);
  if (betas.length) headers["anthropic-beta"] = betas.join(",");
  return headers;
};

export function createProxy(config, { fetch = globalThis.fetch, now = () => Date.now() } = {}) {
  const deadline = Date.parse(config.deadline);
  let calls = 0;
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://proxy");
      if (request.method !== "POST" || !ALLOWED_PATHS.has(url.pathname) || !ALLOWED_QUERIES.has(url.search))
        {
        error(response, 404, "not_found_error", "Not available to this task.");
        return;
      }
      if (!Number.isFinite(deadline) || now() > deadline) {
        error(response, 403, "permission_error", "The task’s time is up.");
        return;
      }
      if (config.maxCalls && ++calls > config.maxCalls) {
        error(response, 403, "permission_error", "The task has made all the calls it may.");
        return;
      }
      let body;
      try {
        body = JSON.parse(await bodyOf(request));
      } catch {
        error(response, 400, "invalid_request_error", "The request could not be read.");
        return;
      }
      const refusal = refusalOf(body, config.models);
      if (refusal) {
        error(response, refusal.status, refusal.type, refusal.message);
        return;
      }
      if (url.pathname === "/v1/messages") body.max_tokens = maxTokensOf(body.max_tokens, config.maxOutputTokens);
      const upstream = await fetch(`${config.upstream}${url.pathname}${url.search}`, {
        method: "POST",
        headers: upstreamHeadersOf(request.headers, config),
        body: JSON.stringify(body),
      });
      const headers = {};
      for (const name of ANSWER_HEADERS) {
        const value = upstream.headers.get(name);
        if (value) headers[name] = value;
      }
      response.writeHead(upstream.status, headers);
      if (!upstream.body) {
        response.end();
        return;
      }
      // An answer cut short upstream ends this one; the proxy goes on serving the run's next call.
      const stream = Readable.fromWeb(upstream.body);
      stream.on("error", () => response.destroy());
      response.on("close", () => stream.destroy());
      stream.pipe(response);
    } catch {
      error(response, 502, "api_error", "The model could not be reached.");
    }
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = JSON.parse(fs.readFileSync(0, "utf8"));
  if (!/^https:\/\//.test(config.upstream)) throw new Error("The model's address must be https.");
  fs.rmSync(config.socket, { force: true });
  createProxy(config).listen(config.socket, () => {
    // The sandbox's group connects; nobody else may.
    fs.chmodSync(config.socket, 0o660);
    console.log("The model proxy is ready.");
  });
}
