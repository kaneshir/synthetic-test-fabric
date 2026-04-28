import { randomUUID } from 'crypto';
import { BehaviorEventRecorder } from './recorder';
import { classifyOutcome } from './outcomes';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ApiExecutorOptions {
  baseUrl: string;
  /** Path to lisa.db — behavior events are written here. */
  dbPath: string;
  simulationId: string;
  agentId: string;
  executionId?: string;
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Override the entity ID written to the behavior event. Defaults to agentId. */
  entityId?: string;
  /** Override the tick counter written to the behavior event. Defaults to internal counter. */
  tick?: number;
}

export interface ApiResponse<T = unknown> {
  status: number;
  ok: boolean;
  body: T;
  durationMs: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ---------------------------------------------------------------------------
// ApiExecutor
// ---------------------------------------------------------------------------

/**
 * Headless HTTP executor for simulation agents that don't need a browser.
 *
 * Wraps fetch() with:
 * - Session management (Bearer token auto-attached after login)
 * - Behavior event recording to lisa.db on every request
 * - Typed responses and ApiError on 4xx/5xx
 *
 * Usage in a SimulationAdapter:
 *
 *   const api = new ApiExecutor({
 *     baseUrl: 'http://localhost:3000',
 *     dbPath: path.join(iterRoot, '.lisa_memory', 'lisa.db'),
 *     simulationId,
 *     agentId: 'seeker-001',
 *   });
 *   await api.login('/auth/login', { email, password });
 *   const jobs = await api.get('/api/jobs');
 *   api.flush();
 */
export class ApiExecutor {
  private readonly baseUrl: string;
  private readonly dbPath: string;
  private readonly simulationId: string;
  private readonly agentId: string;
  private readonly executionId: string;
  private sessionHeaders: Record<string, string> = {};
  private _tick = 0;

  constructor(options: ApiExecutorOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.dbPath = options.dbPath;
    this.simulationId = options.simulationId;
    this.agentId = options.agentId;
    this.executionId = options.executionId ?? randomUUID();
  }

  // ---------------------------------------------------------------------------
  // Session management
  // ---------------------------------------------------------------------------

  /** Advance the internal tick counter — call once per simulation tick. */
  setTick(tick: number): void {
    this._tick = tick;
  }

  /** Attach a Bearer token to all subsequent requests. */
  setToken(token: string): void {
    this.sessionHeaders['Authorization'] = `Bearer ${token}`;
  }

  /** Set an arbitrary session header on all subsequent requests. */
  setHeader(key: string, value: string): void {
    this.sessionHeaders[key] = value;
  }

  /**
   * POST credentials to a login endpoint and extract the auth token from the
   * response body (`token` or `access_token` field).
   * Throws ApiError if the login fails.
   */
  async login(
    path: string,
    credentials: { email: string; password: string },
  ): Promise<void> {
    const res = await this.request<{ token?: string; access_token?: string }>({
      method: 'POST',
      path,
      body: credentials,
      entityId: 'auth',
    });
    const token = res.body?.token ?? res.body?.access_token;
    if (token) this.setToken(token);
  }

  // ---------------------------------------------------------------------------
  // Convenience methods
  // ---------------------------------------------------------------------------

  async get<T = unknown>(path: string, opts?: Partial<ApiRequestOptions>): Promise<ApiResponse<T>> {
    return this.request<T>({ ...opts, method: 'GET', path });
  }

  async post<T = unknown>(
    path: string,
    body?: unknown,
    opts?: Partial<ApiRequestOptions>,
  ): Promise<ApiResponse<T>> {
    return this.request<T>({ ...opts, method: 'POST', path, body });
  }

  async put<T = unknown>(
    path: string,
    body?: unknown,
    opts?: Partial<ApiRequestOptions>,
  ): Promise<ApiResponse<T>> {
    return this.request<T>({ ...opts, method: 'PUT', path, body });
  }

  async patch<T = unknown>(
    path: string,
    body?: unknown,
    opts?: Partial<ApiRequestOptions>,
  ): Promise<ApiResponse<T>> {
    return this.request<T>({ ...opts, method: 'PATCH', path, body });
  }

  async delete<T = unknown>(path: string, opts?: Partial<ApiRequestOptions>): Promise<ApiResponse<T>> {
    return this.request<T>({ ...opts, method: 'DELETE', path });
  }

  // ---------------------------------------------------------------------------
  // Core request
  // ---------------------------------------------------------------------------

  async request<T = unknown>(opts: ApiRequestOptions): Promise<ApiResponse<T>> {
    const method = opts.method ?? 'GET';
    const url = `${this.baseUrl}${opts.path}`;
    const start = Date.now();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...this.sessionHeaders,
      ...opts.headers,
    };

    let status = 0;
    let body: T = undefined as unknown as T;
    let fetchError: unknown;

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: opts.body != null ? JSON.stringify(opts.body) : undefined,
      });
      status = res.status;
      const ct = res.headers.get('content-type') ?? '';
      body = ct.includes('application/json')
        ? (await res.json()) as T
        : (await res.text()) as unknown as T;
      if (!res.ok) fetchError = { status };
    } catch (err) {
      fetchError = err;
    }

    const durationMs = Date.now() - start;
    const outcome = classifyOutcome(fetchError);

    this.recordEvent({
      action: `${method} ${opts.path}`,
      entityId: opts.entityId ?? this.agentId,
      tick: opts.tick ?? this._tick,
      execution_state: fetchError ? 'failed' : 'completed',
      outcome,
      outcome_detail: fetchError ? String(fetchError) : null,
      screen_path: pathToScreen(opts.path),
    });

    if (fetchError && status >= 400) {
      throw new ApiError(`${method} ${opts.path} → ${status}`, status, body);
    }
    if (fetchError && status === 0) {
      throw new ApiError(`${method} ${opts.path} → network error`, 0, null);
    }
    if (fetchError) {
      // parse error on a 2xx/3xx response (e.g. malformed JSON body)
      throw new ApiError(`${method} ${opts.path} → parse error`, status, null);
    }

    return { status, ok: true, body, durationMs };
  }

  /** Flush buffered behavior events to disk. Call after a simulation tick completes. */
  flush(): void {
    try {
      BehaviorEventRecorder.getInstance(this.dbPath, 'simulation').flush();
    } catch {
      // Recorder may not be initialized in stub/test scenarios — non-fatal.
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private recordEvent(args: {
    action: string;
    entityId: string;
    tick: number;
    execution_state: 'completed' | 'failed';
    outcome: ReturnType<typeof classifyOutcome>;
    outcome_detail: string | null;
    screen_path: string | null;
  }): void {
    try {
      const recorder = BehaviorEventRecorder.getInstance(this.dbPath, 'simulation');
      recorder.record({
        execution_id: this.executionId,
        simulation_id: this.simulationId,
        agent_id: this.agentId,
        entity_id: args.entityId,
        persona_definition_id: null,
        tick: args.tick,
        sim_time: new Date().toISOString(),
        action: args.action,
        reasoning: null,
        event_source: 'agent',
        event_kind: 'action',
        execution_state: args.execution_state,
        outcome: args.outcome,
        outcome_detail: args.outcome_detail,
        screen_path: args.screen_path,
        entity_refs: null,
      });
    } catch {
      // Non-fatal — recording failure must never break the HTTP flow.
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive a stable screen_path string from an API path.
 * Used as the behavior event screen_path so ANALYZE can extract coverage.
 *
 *   /api/v1/jobs/abc123   → api_jobs
 *   /auth/login           → auth_login
 *   /v2/users/me/profile  → users_me_profile
 */
export function pathToScreen(apiPath: string): string {
  return apiPath
    .replace(/^\//, '')
    .replace(/\/v\d+\//, '/')
    .replace(/\/[0-9a-f-]{20,}/gi, '')  // strip UUID / opaque ID segments
    .replace(/\/\d+/g, '')              // strip numeric ID segments
    .replace(/^\/|\/$/g, '')
    .replace(/\//g, '_')
    || 'root';
}
