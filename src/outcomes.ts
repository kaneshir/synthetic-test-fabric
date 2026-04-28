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
