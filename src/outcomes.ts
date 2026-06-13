/**
 * BEHAVIOR_OUTCOMES — single source of truth for all valid outcome strings.
 *
 * Enforced at three layers:
 *   1. TypeScript type (compile-time)
 *   2. classifyOutcome() return type (runtime → ensures callers never pass a raw string)
 *   3. SQLite CHECK constraint in behavior_events DDL
 *
 * Do not add values here without also updating the CHECK constraint in schema.ts.
 */
export const BEHAVIOR_OUTCOMES = {
  SUCCESS:       'success',
  SKIPPED:       'skipped',
  BLOCKED:       'blocked',
  TIMEOUT:       'timeout',
  CANCELLED:     'cancelled',
  LLM_FALLBACK:  'llm_fallback',
  ERROR_400:     'error_400',
  ERROR_401:     'error_401',
  ERROR_403:     'error_403',
  ERROR_404:     'error_404',
  ERROR_409:     'error_409',
  ERROR_422:     'error_422',
  ERROR_429:     'error_429',
  ERROR_500:     'error_500',
  ERROR_503:     'error_503',
  ERROR_UNKNOWN: 'error_unknown',
} as const;

export type BehaviorOutcome = (typeof BEHAVIOR_OUTCOMES)[keyof typeof BEHAVIOR_OUTCOMES];

/**
 * Classify an HTTP status code or error type into a BehaviorOutcome.
 * Pass the result directly to the recorder — never pass raw strings.
 */
export function classifyOutcome(error: unknown): BehaviorOutcome {
  if (!error) return BEHAVIOR_OUTCOMES.SUCCESS;

  const status = (error as any)?.response?.status ?? (error as any)?.status ?? (error as any)?.statusCode;

  if (typeof status === 'number') {
    switch (status) {
      case 400: return BEHAVIOR_OUTCOMES.ERROR_400;
      case 401: return BEHAVIOR_OUTCOMES.ERROR_401;
      case 403: return BEHAVIOR_OUTCOMES.ERROR_403;
      case 404: return BEHAVIOR_OUTCOMES.ERROR_404;
      case 409: return BEHAVIOR_OUTCOMES.ERROR_409;
      case 422: return BEHAVIOR_OUTCOMES.ERROR_422;
      case 429: return BEHAVIOR_OUTCOMES.ERROR_429;
      case 500: return BEHAVIOR_OUTCOMES.ERROR_500;
      case 503: return BEHAVIOR_OUTCOMES.ERROR_503;
      default:
        if (status >= 400) return BEHAVIOR_OUTCOMES.ERROR_UNKNOWN;
    }
  }

  const message = String((error as any)?.message ?? '').toLowerCase();
  if (message.includes('timeout') || message.includes('timed out')) return BEHAVIOR_OUTCOMES.TIMEOUT;
  if (message.includes('cancel')) return BEHAVIOR_OUTCOMES.CANCELLED;
  if (message.includes('blocked')) return BEHAVIOR_OUTCOMES.BLOCKED;

  return BEHAVIOR_OUTCOMES.ERROR_UNKNOWN;
}

/**
 * Classify an MCP JSON-RPC response envelope into a BehaviorOutcome.
 *
 * MCP carries tool rejections as a JSON-RPC `error` object (or a `result` with
 * `isError: true`) — frequently **over HTTP 200**. Classifying on HTTP status
 * would mis-bucket these, so target-testing must classify on the JSON-RPC layer.
 * Codes mirror a production server's HTTP-status → JSON-RPC mapping
 * (401→-32001, 403→-32003, 404→-32004, 429→-32029, 400→-32602).
 *
 * Maps onto the existing BEHAVIOR_OUTCOMES set — no schema migration required.
 */
export function classifyMcpOutcome(envelope: {
  error?: { code?: number } | null;
  result?: { isError?: boolean } | null;
}): BehaviorOutcome {
  const code = envelope.error?.code;
  if (typeof code === 'number') {
    switch (code) {
      case -32001: return BEHAVIOR_OUTCOMES.ERROR_401; // unauthorized / audience / session-expired
      case -32003: return BEHAVIOR_OUTCOMES.ERROR_403; // forbidden / scope / AAL step-up
      case -32004: return BEHAVIOR_OUTCOMES.ERROR_404; // not found / unknown tool
      case -32601: return BEHAVIOR_OUTCOMES.ERROR_404; // method not found
      case -32029: return BEHAVIOR_OUTCOMES.ERROR_429; // rate limited
      case -32602: return BEHAVIOR_OUTCOMES.ERROR_400; // invalid params (maps from HTTP 400)
      case -32600: return BEHAVIOR_OUTCOMES.ERROR_400; // invalid request
      case -32700: return BEHAVIOR_OUTCOMES.ERROR_400; // parse error
      case -32000: return BEHAVIOR_OUTCOMES.ERROR_500; // server/internal error
      default: return BEHAVIOR_OUTCOMES.ERROR_UNKNOWN;
    }
  }
  // A `result` flagged isError is a tool-level failure with no protocol code.
  if (envelope.result?.isError) return BEHAVIOR_OUTCOMES.ERROR_UNKNOWN;
  return BEHAVIOR_OUTCOMES.SUCCESS;
}
