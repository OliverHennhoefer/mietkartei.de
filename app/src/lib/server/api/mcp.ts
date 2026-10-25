import type { ApiCaller } from '../api-keys';
import type { Database } from '../db';
import { ApiError, operationByName, operations, permits } from './operations';
import { runOperation } from './request';

// The MCP server (Model Context Protocol, transport "Streamable HTTP"): an assistant such as
// Claude sends JSON-RPC messages to POST /mcp and gets the answer as JSON. It is stateless, with
// no sessions and no server-sent events, because every tool is a single call to an operation;
// that keeps it a plain request handler on both targets. See
// https://modelcontextprotocol.io/specification/2025-06-18/basic/transports.

/** Newest first; a client asking for another version is answered with the newest. */
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

const INSTRUCTIONS =
	'mietkartei manages rentals of private landlords in Germany: properties (Objekte) with units, ' +
	'tenants (Mieter), leases (Mietverträge), the rent account (Mietkonto) of each lease, operating ' +
	'costs (Betriebskosten) with their statements, dunning (Mahnwesen), expenses (Ausgaben), the ' +
	'analysis (Auswertung), deadlines and tasks. Amounts are integer euro cents, dates YYYY-MM-DD. ' +
	'Start with list_properties, list_leases or list_balances and follow ' +
	'the ids. Answer the landlord in German unless asked otherwise.';

type JsonRpcId = string | number | null;

export type JsonRpcResponse =
	| { jsonrpc: '2.0'; id: JsonRpcId; result: unknown }
	| { jsonrpc: '2.0'; id: JsonRpcId; error: { code: number; message: string } };

export const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

function failure(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
	return { jsonrpc: '2.0', id, error: { code, message } };
}

/** The tools the caller's key may use; a read key does not see the writing ones. */
export function listTools(caller: ApiCaller) {
	return operations
		.filter((operation) => permits(caller, operation))
		.map((operation) => ({
			name: operation.name,
			description: operation.description,
			inputSchema: operation.input,
			annotations: {
				readOnlyHint: operation.readOnly,
				destructiveHint: false,
				openWorldHint: false
			}
		}));
}

/** A tool's result: the JSON as text for every client, and as structured content for newer ones. */
function toolResult(data: unknown) {
	return {
		content: [{ type: 'text', text: JSON.stringify(data) }],
		// structuredContent has to be an object.
		structuredContent: Array.isArray(data) ? { items: data } : data
	};
}

/**
 * Answers one JSON-RPC message; undefined for a notification, which gets no answer. Failures of
 * a tool (unknown id, wrong input) are tool results with isError, so the model can read them and
 * try again; only protocol errors are JSON-RPC errors.
 */
export async function handleMessage(
	db: Database,
	caller: ApiCaller,
	message: unknown
): Promise<JsonRpcResponse | undefined> {
	if (!message || typeof message !== 'object' || Array.isArray(message)) {
		return failure(null, INVALID_REQUEST, 'Expected a JSON-RPC message.');
	}
	const { jsonrpc, id, method, params } = message as Record<string, unknown>;
	const isRequest = typeof id === 'string' || typeof id === 'number';
	if (jsonrpc !== '2.0' || typeof method !== 'string') {
		return failure(isRequest ? id : null, INVALID_REQUEST, 'Expected a JSON-RPC 2.0 message.');
	}
	// Notifications (initialized, cancelled) and answers to requests of ours need no answer.
	if (!isRequest) return undefined;
	const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result });
	const args = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;

	switch (method) {
		case 'initialize': {
			const requested = args.protocolVersion;
			const protocolVersion = PROTOCOL_VERSIONS.find((version) => version === requested);
			return ok({
				protocolVersion: protocolVersion ?? PROTOCOL_VERSIONS[0],
				capabilities: { tools: { listChanged: false } },
				serverInfo: { name: 'mietkartei', title: 'mietkartei', version: __APP_VERSION__ },
				instructions: INSTRUCTIONS
			});
		}
		case 'ping':
			return ok({});
		case 'tools/list':
			return ok({ tools: listTools(caller) });
		case 'tools/call': {
			const operation = typeof args.name === 'string' ? operationByName.get(args.name) : undefined;
			if (!operation || !permits(caller, operation)) {
				return failure(id, INVALID_PARAMS, `Unknown tool "${String(args.name)}".`);
			}
			try {
				return ok(toolResult(await runOperation(db, caller, operation, args.arguments)));
			} catch (error) {
				if (!(error instanceof ApiError)) throw error;
				return ok({ content: [{ type: 'text', text: error.message }], isError: true });
			}
		}
		default:
			return failure(id, METHOD_NOT_FOUND, `Method "${method}" is not supported.`);
	}
}
