import {
  TokenTally,
  TokenTallyError,
  AuthenticationError,
  RateLimitError,
  ValidationError,
} from '../src/index';

const OK_RESPONSE = { success: true, record_id: 'rec_123', cost_usd: 0.0042 };

function mockFetch(status: number, body: unknown) {
  const fn = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

function lastPayload(fn: jest.Mock): Record<string, unknown> {
  const [, init] = fn.mock.calls[fn.mock.calls.length - 1];
  return JSON.parse(init.body);
}

describe('TokenTally', () => {
  const tt = new TokenTally({ apiKey: 'tt_test_key' });

  it('rejects API keys without the tt_ prefix', () => {
    expect(() => new TokenTally({ apiKey: 'sk_wrong' })).toThrow("Invalid API key. Must start with 'tt_'");
  });

  describe('track', () => {
    it('posts usage with the same field names as the Python/Ruby SDKs', async () => {
      const fn = mockFetch(200, OK_RESPONSE);

      const response = await tt.track({
        tokens_in: 100,
        tokens_out: 200,
        model: 'claude-sonnet-5',
        runtime_ms: 1234,
        stop_reason: 'end_turn',
        metadata: { feature: 'chat' },
      });

      expect(response).toEqual(OK_RESPONSE);

      const [url, init] = fn.mock.calls[0];
      expect(url).toBe('https://api.tokentally.cloud/api/usage');
      expect(init.method).toBe('POST');
      expect(init.headers['X-API-Key']).toBe('tt_test_key');

      const payload = lastPayload(fn);
      expect(payload).toMatchObject({
        tokens_in: 100,
        tokens_out: 200,
        model: 'claude-sonnet-5',
        provider: 'anthropic',
        runtime_ms: 1234,
        stop_reason: 'end_turn',
        metadata: { feature: 'chat' },
      });
      expect(typeof payload.timestamp).toBe('string');
    });

    it('maps error statuses to the same error classes as the other SDKs', async () => {
      mockFetch(401, { error: 'nope' });
      await expect(tt.track({ tokens_in: 1, tokens_out: 1, model: 'm' })).rejects.toBeInstanceOf(AuthenticationError);

      mockFetch(429, { error: 'Rate limit exceeded' });
      await expect(tt.track({ tokens_in: 1, tokens_out: 1, model: 'm' })).rejects.toBeInstanceOf(RateLimitError);

      mockFetch(400, { error: 'bad payload' });
      await expect(tt.track({ tokens_in: 1, tokens_out: 1, model: 'm' })).rejects.toBeInstanceOf(ValidationError);

      mockFetch(500, {});
      await expect(tt.track({ tokens_in: 1, tokens_out: 1, model: 'm' })).rejects.toBeInstanceOf(TokenTallyError);
    });
  });

  describe('trackUsage', () => {
    it('sends after the scope exits, with timing', async () => {
      const fn = mockFetch(200, OK_RESPONSE);

      const result = await tt.trackUsage({ model: 'claude-sonnet-5', metadata: { feature: 'x' } }, async (ctx) => {
        ctx.setUsage({ tokens_in: 10, tokens_out: 20, stop_reason: 'end_turn' });
        return 'done';
      });

      expect(result).toBe('done');
      expect(fn).toHaveBeenCalledTimes(1);
      const payload = lastPayload(fn);
      expect(payload).toMatchObject({
        tokens_in: 10,
        tokens_out: 20,
        model: 'claude-sonnet-5',
        provider: 'anthropic',
        stop_reason: 'end_turn',
        metadata: { feature: 'x' },
      });
      expect(typeof payload.runtime_ms).toBe('number');
    });

    it('skips sending when setUsage was never called', async () => {
      const fn = mockFetch(200, OK_RESPONSE);
      await tt.trackUsage({ model: 'm' }, async () => 'nothing');
      expect(fn).not.toHaveBeenCalled();
    });

    it('still sends with error_message when fn throws after setUsage', async () => {
      const fn = mockFetch(200, OK_RESPONSE);

      await expect(
        tt.trackUsage({ model: 'm' }, async (ctx) => {
          ctx.setUsage({ tokens_in: 1, tokens_out: 2 });
          throw new Error('provider exploded');
        })
      ).rejects.toThrow('provider exploded');

      expect(fn).toHaveBeenCalledTimes(1);
      expect(lastPayload(fn)).toMatchObject({ error_message: 'provider exploded' });
    });
  });

  describe('withTracking', () => {
    it('extracts usage from the result like the Ruby SDK', async () => {
      const fn = mockFetch(200, OK_RESPONSE);

      const result = await tt.withTracking({ model: 'claude-sonnet-5' }, async () => ({
        usage: { input_tokens: 5, output_tokens: 7 },
        stop_reason: 'end_turn',
      }));

      expect(result.usage.input_tokens).toBe(5);
      expect(lastPayload(fn)).toMatchObject({
        tokens_in: 5,
        tokens_out: 7,
        model: 'claude-sonnet-5',
        stop_reason: 'end_turn',
      });
    });

    it('records nothing when the result has no usage', async () => {
      const fn = mockFetch(200, OK_RESPONSE);
      await tt.withTracking({ model: 'm' }, async () => ({}));
      expect(fn).not.toHaveBeenCalled();
    });
  });
});
