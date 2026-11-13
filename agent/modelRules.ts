/*
 * What a run may ask of the model, in one place: the gateway applies these rules to every call it passes on with
 * Laioutr's key, and the job's model proxy to every call it passes on with the seat's or the run's token. Plain,
 * erasable TypeScript with no imports, so Node runs it in the job as it is.
 */

/** Only what Claude Code needs of the provider's API is passed on. */
export const ALLOWED_PATHS: ReadonlySet<string> = new Set(['/v1/messages', '/v1/messages/count_tokens']);

/** The one query Claude Code adds to its calls; any other is refused. */
export const ALLOWED_QUERIES: ReadonlySet<string> = new Set(['', '?beta=true']);

/**
 * The headers a request keeps: the provider's own, and those that name the client to it. Every other one — the caller's
 * own credential first — is dropped.
 */
export const PASSED_HEADER = /^(content-type|anthropic-version|accept|user-agent|x-app|x-stainless-[a-z0-9-]+)$/;

/**
 * Betas that change what a call costs or reach services beyond the model — a larger context window, server tools, files
 * kept at the provider, MCP servers, skills — are dropped; every other beta Claude Code sends passes.
 */
export const PRICED_BETA = /context-1m|web-search|web-fetch|code-execution|computer-use|mcp-client|files-api|skills/i;

/** Content a request may carry itself; one the provider would fetch from an address or a stored file is refused. */
const OWN_SOURCES: ReadonlySet<string> = new Set(['base64', 'text', 'content']);

export type Refusal = { status: 400 | 403; type: 'invalid_request_error' | 'permission_error'; message: string };

const invalid = (message: string): Refusal => ({ status: 400, type: 'invalid_request_error', message });
const forbidden = (message: string): Refusal => ({ status: 403, type: 'permission_error', message });

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** The first block, at any depth, whose content the provider would fetch itself; null when there is none. */
const fetchedContentIn = (value: unknown, depth = 0): string | null => {
  if (depth > 64) return 'too deep';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = fetchedContentIn(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isObject(value)) return null;
  if (value.type === 'container_upload') return 'container_upload';
  const source = value.source;
  if (isObject(source) && !(typeof source.type === 'string' && OWN_SOURCES.has(source.type))) return String(source.type);
  for (const nested of Object.values(value)) {
    const found = fetchedContentIn(nested, depth + 1);
    if (found) return found;
  }
  return null;
};

/**
 * Why a request is not passed on, or null. A model the run was not given; a tool the provider runs itself (`type` other
 * than `custom`); MCP servers or a container; content the provider would fetch from an address or a stored file. Each of
 * these would let what the run sends reach a host through the provider.
 */
export function refusalOf(body: unknown, models: readonly string[]): Refusal | null {
  if (!isObject(body)) return invalid('The request is not an object.');
  if (typeof body.model !== 'string' || !models.includes(body.model)) return forbidden('This model is not available to this task.');
  const tools = Array.isArray(body.tools) ? (body.tools as unknown[]) : [];
  if (tools.some((tool) => isObject(tool) && typeof tool.type === 'string' && tool.type !== 'custom'))
    return invalid('Server tools are not available to this task.');
  if (body.mcp_servers !== undefined || body.container !== undefined) return invalid('Server tools are not available to this task.');
  if (fetchedContentIn([body.system, body.messages])) return invalid('Content fetched by the provider is not available to this task.');
  return null;
}

/** The betas a request keeps: the priced ones and empty entries dropped. */
export const betasOf = (header: string | null | undefined): string[] =>
  String(header ?? '')
    .split(',')
    .map((beta) => beta.trim())
    .filter((beta) => beta && !PRICED_BETA.test(beta));

/** The most output a call may ask, cut to the run's most. */
export const maxTokensOf = (asked: unknown, most: number): number =>
  Math.min(typeof asked === 'number' && asked > 0 ? asked : most, most);
