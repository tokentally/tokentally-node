# TokenTally TypeScript SDK

The official TypeScript SDK for [TokenTally](https://tokentally.cloud) — an AI usage analytics platform that tracks your API usage and costs across Claude, OpenAI, and other AI providers, with real-time dashboards and usage insights.

Sign up and get your API key at **[tokentally.cloud](https://tokentally.cloud)** (Settings → API Keys).

Written in TypeScript with full type definitions; works from Node.js 18+ (JavaScript or TypeScript).

## Installation

```bash
npm install tokentally-node
```

## Quick Start

```typescript
import { TokenTally } from 'tokentally-node';

// Initialize the client
const tt = new TokenTally({ apiKey: 'tt_your_api_key' });

// Track usage manually — same field names as the Python and Ruby SDKs
const response = await tt.track({
  tokens_in: 150,
  tokens_out: 300,
  model: 'claude-3-sonnet-20240229',
  provider: 'anthropic',
  metadata: {
    feature: 'chat',
    user_id: 'user123',
  },
});

console.log(`Recorded! Cost: $${response.cost_usd.toFixed(6)}`);
```

## Scoped Tracking with Automatic Timing

The equivalent of the Python SDK's context manager — timing is measured for
you, and the record is sent when the scope exits (including on errors, with
the error message attached):

```typescript
import { TokenTally } from 'tokentally-node';
import Anthropic from '@anthropic-ai/sdk';

const tt = new TokenTally({ apiKey: 'tt_your_api_key' });
const anthropic = new Anthropic();

const message = await tt.trackUsage(
  { model: 'claude-3-sonnet-20240229', metadata: { feature: 'summarization' } },
  async (ctx) => {
    const response = await anthropic.messages.create({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 1000,
      messages: [{ role: 'user', content: 'Summarize...' }],
    });

    ctx.setUsage({
      tokens_in: response.usage.input_tokens,
      tokens_out: response.usage.output_tokens,
      stop_reason: response.stop_reason,
    });

    return response;
  }
);
```

## Automatic Token Extraction

The equivalent of the Ruby SDK's `with_tracking` — if the result exposes
`usage.input_tokens` / `usage.output_tokens` (as Anthropic and OpenAI
responses do), it is recorded automatically:

```typescript
const message = await tt.withTracking(
  { model: 'claude-3-sonnet-20240229', metadata: { feature: 'chat' } },
  () =>
    anthropic.messages.create({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 1000,
      messages: [{ role: 'user', content: 'Hello!' }],
    })
);
```

## Configuration

```typescript
const tt = new TokenTally({
  apiKey: 'tt_your_api_key',
  baseUrl: 'https://api.tokentally.cloud', // Optional custom URL
  timeout: 30000, // Request timeout in ms
});
```

## Error Handling

```typescript
import {
  TokenTally,
  RateLimitError,
  AuthenticationError,
  ValidationError,
  TokenTallyError,
} from 'tokentally-node';

try {
  await tt.track({ tokens_in: 100, tokens_out: 200, model: 'claude-3-sonnet' });
} catch (error) {
  if (error instanceof RateLimitError) {
    console.log('Rate limit exceeded. Upgrade for unlimited.');
  } else if (error instanceof AuthenticationError) {
    console.log('Invalid API key.');
  } else if (error instanceof ValidationError) {
    console.log(`Invalid payload: ${error.message}`);
  } else if (error instanceof TokenTallyError) {
    console.log(`Error: ${error.message}`);
  }
}
```

## Migrating from 0.1.x

- `trackUsage(data)` is now `track(data)` — same payload, renamed to match the
  Python SDK.
- `trackUsage(options, fn)` is the new scoped-tracking helper (Python's
  `track_usage` context manager).
- `withTracking(model, provider, metadata, fn)` is now
  `withTracking({ model, provider, metadata }, fn)`.

## Links

- Website & dashboard: [tokentally.cloud](https://tokentally.cloud)
- Python SDK: [tokentally/tokentally-python](https://github.com/tokentally/tokentally-python)
- Ruby SDK: [tokentally/tokentally-ruby](https://github.com/tokentally/tokentally-ruby)

## License

MIT License
