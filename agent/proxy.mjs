// The run's only way to the model, run in the job as a user of its own: it holds this run's token for Laioutr's gateway,
// and the agent, sandboxed without a network, reaches the model only through it. Laioutr's key and seat stay in the
// gateway. It passes on what the rules allow (`modelRules.ts`, the gateway's own) and nothing else, so no request
// the agent makes can reach a host through the provider, and the credential never enters the agent's sandbox.
//
// For a run the Cockpit gave a Studio key, it carries the agent's MCP calls to Studio the same way: to the gateway's
// `/studio/mcp` with the run's token, where the gateway adds the Studio key, which never reaches the job at all.
//
// Configuration arrives once on standard input: { socket, upstream, token, models, maxOutputTokens, deadline,
// maxCalls, studio, studioUpstream, maxStudioCalls }. It listens on a Unix socket the sandbox is given.
import fs from 'node:fs';
import http from 'node:http';
import { Readable } from 'node:stream';

import { ALLOWED_PATHS, ALLOWED_QUERIES, betasOf, maxTokensOf, PASSED_HEADER, refusalOf } from './modelRules.ts';
import {
  isJsonType,
  isMcpMessage,
  STUDIO_ANSWER_HEADERS,
  STUDIO_MAX_BODY_BYTES,
  STUDIO_PATH,
  STUDIO_REQUEST_HEADERS,
} from './studioRules.ts';

/** The most a request body may be: far above any conversation Claude Code sends. */
const MAX_BODY_BYTES = 32 * 1024 * 1024;

/** The headers of the provider's answer passed back; its own credentials and cookies stay here. */
const ANSWER_HEADERS = [
  'content-type',
  'request-id',
  'retry-after',
  'anthropic-ratelimit-unified-status',
  'anthropic-ratelimit-unified-reset',
];

const error = (response, status, type, message) => {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ type: 'error', error: { type, message } }));
};

const bodyOf = (request) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('too large'));
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });

const mcpError = (response, status, message, headers = {}) => {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message } }));
};

/** A message to Studio within its bound; null as soon as it is larger, so a body without end is never read whole. */
const studioBodyOf = (request) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    request.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > STUDIO_MAX_BODY_BYTES) {
        done = true;
        resolve(null);
      } else chunks.push(chunk);
    });
    request.on('end', () => {
      if (!done) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', reject);
  });

/** Refuses a message over the bound and drops the connection once the refusal is out, reading no more of it. */
const refuseTooLarge = (request, response) => {
  response.on('finish', () => request.destroy());
  mcpError(response, 413, 'The message is too large.', { connection: 'close' });
};

/** The headers a call to Studio carries: the transport's own, and the run's token, which the sandbox never holds. */
export const studioHeadersOf = (incoming, config) => {
  const headers = {};
  for (const name of STUDIO_REQUEST_HEADERS) if (typeof incoming[name] === 'string') headers[name] = incoming[name];
  headers.authorization = `Bearer ${config.token}`;
  return headers;
};

/** One MCP message of the agent, passed to the gateway's Studio route and its answer passed back, JSON or a stream. */
const passToStudio = async (request, response, config, fetch) => {
  if (Number(request.headers['content-length']) > STUDIO_MAX_BODY_BYTES) {
    refuseTooLarge(request, response);
    return;
  }
  if (!isJsonType(request.headers['content-type'])) {
    mcpError(response, 415, 'A message is JSON.');
    return;
  }
  const text = await studioBodyOf(request);
  if (text === null) {
    refuseTooLarge(request, response);
    return;
  }
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    mcpError(response, 400, 'The message could not be read.');
    return;
  }
  if (!isMcpMessage(message)) {
    mcpError(response, 400, 'Not a message of the transport.');
    return;
  }
  let upstream;
  try {
    // A redirect is never followed: the run's token would go with it.
    upstream = await fetch(config.studioUpstream, {
      method: 'POST',
      headers: studioHeadersOf(request.headers, config),
      body: JSON.stringify(message),
      redirect: 'manual',
    });
  } catch {
    mcpError(response, 500, 'Studio could not be reached.');
    return;
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    await upstream.body?.cancel();
    mcpError(response, 500, 'Studio answered with a redirect.');
    return;
  }
  // A 401 would send Claude Code looking for a sign-in it cannot make; the run is refused, and nothing is to sign in to.
  if (upstream.status === 401) {
    await upstream.body?.cancel();
    mcpError(response, 403, 'Studio refused this task.');
    return;
  }
  const headers = {};
  for (const name of STUDIO_ANSWER_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers[name] = value;
  }
  response.writeHead(upstream.status, headers);
  if (!upstream.body) {
    response.end();
    return;
  }
  const stream = Readable.fromWeb(upstream.body);
  stream.on('error', () => response.destroy());
  response.on('close', () => stream.destroy());
  stream.pipe(response);
};

/** The headers a passed request carries: those the rules let through, the credential, and the betas that remain. */
export const upstreamHeadersOf = (incoming, config) => {
  const headers = {};
  for (const [name, value] of Object.entries(incoming)) if (PASSED_HEADER.test(name) && typeof value === 'string') headers[name] = value;
  headers.authorization = `Bearer ${config.token}`;
  const betas = betasOf(incoming['anthropic-beta']);
  if (betas.length) headers['anthropic-beta'] = betas.join(',');
  return headers;
};

export function createProxy(config, { fetch = globalThis.fetch, now = () => Date.now() } = {}) {
  const deadline = Date.parse(config.deadline);
  let calls = 0;
  let studioCalls = 0;
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://proxy');
      // Studio is reachable only for a run the gateway said has its bridge; for every other run the route does not exist.
      if (config.studio === true && url.pathname === STUDIO_PATH && !url.search) {
        if (request.method === 'GET' || request.method === 'DELETE') {
          mcpError(response, 405, 'Only POST.', { allow: 'POST' });
          return;
        }
        if (request.method !== 'POST') {
          mcpError(response, 404, 'Not available to this task.');
          return;
        }
        if (!Number.isFinite(deadline) || now() > deadline) {
          mcpError(response, 403, 'The task’s time is up.');
          return;
        }
        if (config.maxStudioCalls && ++studioCalls > config.maxStudioCalls) {
          mcpError(response, 403, 'The task has made all the calls to Studio it may.');
          return;
        }
        await passToStudio(request, response, config, fetch);
        return;
      }
      if (request.method !== 'POST' || !ALLOWED_PATHS.has(url.pathname) || !ALLOWED_QUERIES.has(url.search)) {
        error(response, 404, 'not_found_error', 'Not available to this task.');
        return;
      }
      if (!Number.isFinite(deadline) || now() > deadline) {
        error(response, 403, 'permission_error', 'The task’s time is up.');
        return;
      }
      if (config.maxCalls && ++calls > config.maxCalls) {
        error(response, 403, 'permission_error', 'The task has made all the calls it may.');
        return;
      }
      let body;
      try {
        body = JSON.parse(await bodyOf(request));
      } catch {
        error(response, 400, 'invalid_request_error', 'The request could not be read.');
        return;
      }
      const refusal = refusalOf(body, config.models);
      if (refusal) {
        error(response, refusal.status, refusal.type, refusal.message);
        return;
      }
      if (url.pathname === '/v1/messages') body.max_tokens = maxTokensOf(body.max_tokens, config.maxOutputTokens);
      const upstream = await fetch(`${config.upstream}${url.pathname}${url.search}`, {
        method: 'POST',
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
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    } catch {
      error(response, 502, 'api_error', 'The model could not be reached.');
    }
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (!/^https:\/\//.test(config.upstream)) throw new Error("The model's address must be https.");
  if (config.studio === true && !/^https:\/\/[^/]+\/studio\/mcp$/.test(config.studioUpstream ?? ''))
    throw new Error("Studio's address must be the gateway's https route.");
  fs.rmSync(config.socket, { force: true });
  createProxy(config).listen(config.socket, () => {
    // The sandbox's group connects; nobody else may.
    fs.chmodSync(config.socket, 0o660);
    console.log('The model proxy is ready.');
  });
}
