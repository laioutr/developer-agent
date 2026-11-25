/*
 * What the agent's calls to the Cockpit's Studio MCP server may carry, in one place: the job's proxy applies it on the
 * way to the gateway, and the gateway on the way to the Cockpit, which alone decides what the run's Studio key may do.
 * Plain, erasable TypeScript with no imports, so Node runs it in the job as it is.
 */

/** The one route of the bridge, on the proxy's socket and at the gateway alike. */
export const STUDIO_PATH = '/studio/mcp';

/** The most one message may be: far above any tool call Studio takes, and checked before anything is passed on. */
export const STUDIO_MAX_BODY_BYTES = 1024 * 1024;

/**
 * The headers of the MCP transport a request keeps. Every other one — a credential the caller set first — is dropped,
 * and the key is added where it is held.
 */
export const STUDIO_REQUEST_HEADERS: readonly string[] = ['content-type', 'accept', 'mcp-session-id', 'mcp-protocol-version'];

/** The headers of Studio's answer passed back; its cookies and anything else stay behind. */
export const STUDIO_ANSWER_HEADERS: readonly string[] = ['content-type', 'mcp-session-id', 'mcp-protocol-version'];

/** Whether a request says it sends JSON, as every message of the transport does. */
export const isJsonType = (contentType: string | undefined | null): boolean => /^application\/json\s*(;|$)/i.test(contentType ?? '');

/** A JSON-RPC message of the transport, or a batch of them; anything else is not passed on. */
export const isMcpMessage = (value: unknown): boolean => !!value && typeof value === 'object';
