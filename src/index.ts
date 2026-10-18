/**
 * TokenTally TypeScript SDK
 * Track AI API usage with ease
 */

export interface UsageData {
  tokens_in: number;
  tokens_out: number;
  model: string;
  provider?: string;
  runtime_ms?: number;
  stop_reason?: string;
  error_message?: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
}

export interface UsageResponse {
  success: boolean;
  record_id: string;
  cost_usd: number;
}

export interface TokenTallyOptions {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

export interface TrackingOptions {
  model: string;
  provider?: string;
  metadata?: Record<string, unknown>;
}

export class TokenTallyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenTallyError';
  }
}

export class RateLimitError extends TokenTallyError {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class AuthenticationError extends TokenTallyError {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class ValidationError extends TokenTallyError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Shape of AI provider responses that withTracking can extract usage from. */
export interface TrackableResult {
  usage?: { input_tokens: number; output_tokens: number };
  stop_reason?: string | null;
}

/**
 * TokenTally client for tracking AI API usage.
 *
 * @example
 * ```typescript
 * import { TokenTally } from 'tokentally-node';
 *
 * const tt = new TokenTally({ apiKey: 'tt_your_api_key' });
 *
 * // Track usage manually
 * const response = await tt.track({
 *   tokens_in: 100,
 *   tokens_out: 200,
 *   model: 'claude-3-sonnet-20240229',
 *   metadata: { feature: 'chat' },
 * });
 *
 * console.log(`Cost: $${response.cost_usd}`);
 * ```
 */
export class TokenTally {
  static readonly DEFAULT_BASE_URL = 'https://api.tokentally.cloud';

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(options: TokenTallyOptions) {
    if (!options.apiKey || !options.apiKey.startsWith('tt_')) {
      throw new Error("Invalid API key. Must start with 'tt_'");
    }

    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || TokenTally.DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeout = options.timeout || 30000;
  }

  /**
   * Record usage data.
   *
   * Mirrors `track()` in the Python SDK and `track_usage()` in the Ruby SDK.
   *
   * @param data - Usage data with the same field names as the other SDKs
   *   (tokens_in, tokens_out, model, provider, runtime_ms, stop_reason,
   *   error_message, metadata).
   * @returns UsageResponse with record ID and calculated cost.
   * @throws RateLimitError if rate limit is exceeded.
   * @throws AuthenticationError if the API key is invalid.
   * @throws ValidationError if the payload is rejected.
   * @throws TokenTallyError for other errors.
   */
  async track(data: UsageData): Promise<UsageResponse> {
    const payload: UsageData = {
      ...data,
      provider: data.provider || 'anthropic',
      metadata: data.metadata || {},
      timestamp: data.timestamp || new Date().toISOString(),
    };

    return this.sendUsage(payload);
  }

  /**
   * Scoped tracking with automatic timing — the equivalent of the Python
   * SDK's `track_usage()` context manager.
   *
   * Runs `fn`, timing it; call `ctx.setUsage(...)` inside with the token
   * counts from your provider response. The record is sent when the scope
   * exits (even if `fn` throws after `setUsage`, with the error message
   * attached), and is skipped if `setUsage` was never called.
   *
   * @example
   * ```typescript
   * const message = await tt.trackUsage(
   *   { model: 'claude-3-sonnet-20240229', metadata: { feature: 'summarization' } },
   *   async (ctx) => {
   *     const response = await anthropic.messages.create(...);
   *     ctx.setUsage({
   *       tokens_in: response.usage.input_tokens,
   *       tokens_out: response.usage.output_tokens,
   *       stop_reason: response.stop_reason,
   *     });
   *     return response;
   *   }
   * );
   * ```
   */
  async trackUsage<T>(
    options: TrackingOptions,
    fn: (ctx: UsageContext) => Promise<T>
  ): Promise<T> {
    const ctx = new UsageContext(this, options.model, options.provider || 'anthropic', options.metadata || {});

    const startTime = Date.now();

    try {
      return await fn(ctx);
    } catch (e) {
      ctx.error_message = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      ctx.runtime_ms = Date.now() - startTime;

      // Only send if usage was set
      if (ctx.tokens_in !== null && ctx.tokens_out !== null) {
        await ctx.send();
      }
    }
  }

  /**
   * Track usage with automatic timing and token extraction — the equivalent
   * of the Ruby SDK's `with_tracking`.
   *
   * The result of `fn` must expose `usage.input_tokens` / `usage.output_tokens`
   * (as Anthropic and OpenAI responses do); if it doesn't, nothing is recorded.
   *
   * @example
   * ```typescript
   * const message = await tt.withTracking(
   *   { model: 'claude-3-sonnet-20240229', metadata: { feature: 'chat' } },
   *   () => anthropic.messages.create(...)
   * );
   * ```
   */
  async withTracking<T extends TrackableResult>(
    options: TrackingOptions,
    fn: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();

    const result = await fn();
    const runtime_ms = Date.now() - startTime;

    if (result.usage) {
      await this.track({
        tokens_in: result.usage.input_tokens,
        tokens_out: result.usage.output_tokens,
        model: options.model,
        provider: options.provider || 'anthropic',
        runtime_ms,
        stop_reason: result.stop_reason ?? undefined,
        metadata: options.metadata || {},
      });
    }

    return result;
  }

  /** Send usage data to the API. */
  private async sendUsage(payload: UsageData): Promise<UsageResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/api/usage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
          'User-Agent': 'tokentally-node/0.2.0',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (response.status === 401) {
        throw new AuthenticationError('Invalid API key');
      }

      if (response.status === 429) {
        const errorData = (await response.json().catch(() => ({}))) as { error?: string };
        throw new RateLimitError(errorData.error || 'Rate limit exceeded');
      }

      if (response.status === 400) {
        const errorData = (await response.json().catch(() => ({}))) as { error?: string };
        throw new ValidationError(errorData.error || 'Validation error');
      }

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as { error?: string };
        throw new TokenTallyError(errorData.error || `HTTP ${response.status}`);
      }

      return (await response.json()) as UsageResponse;
    } catch (error) {
      if (error instanceof TokenTallyError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new TokenTallyError('Request timeout');
      }

      throw new TokenTallyError(`Request failed: ${error}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** @internal — used by UsageContext */
  _sendUsage(payload: UsageData): Promise<UsageResponse> {
    return this.sendUsage(payload);
  }
}

/**
 * Context for tracking usage within a `trackUsage()` scope.
 * Field names mirror the Python SDK's UsageContext.
 */
export class UsageContext {
  readonly model: string;
  readonly provider: string;
  readonly metadata: Record<string, unknown>;

  tokens_in: number | null = null;
  tokens_out: number | null = null;
  stop_reason: string | null = null;
  error_message: string | null = null;
  runtime_ms: number | null = null;

  private readonly client: TokenTally;
  private _response: UsageResponse | null = null;

  constructor(
    client: TokenTally,
    model: string,
    provider: string,
    metadata: Record<string, unknown>
  ) {
    this.client = client;
    this.model = model;
    this.provider = provider;
    this.metadata = metadata;
  }

  /** Set usage data from the provider's API response. */
  setUsage(usage: { tokens_in: number; tokens_out: number; stop_reason?: string | null }): void {
    this.tokens_in = usage.tokens_in;
    this.tokens_out = usage.tokens_out;
    this.stop_reason = usage.stop_reason ?? null;
  }

  /** The usage response, available after the scope exits. */
  get response(): UsageResponse | null {
    return this._response;
  }

  /** @internal */
  async send(): Promise<void> {
    if (this.tokens_in === null || this.tokens_out === null) {
      return;
    }

    this._response = await this.client._sendUsage({
      tokens_in: this.tokens_in,
      tokens_out: this.tokens_out,
      model: this.model,
      provider: this.provider,
      runtime_ms: this.runtime_ms ?? undefined,
      stop_reason: this.stop_reason ?? undefined,
      error_message: this.error_message ?? undefined,
      metadata: this.metadata,
      timestamp: new Date().toISOString(),
    });
  }
}

export default TokenTally;
