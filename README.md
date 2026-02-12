# @hlos/paid

Turn any MCP tool or API route into a paid capability in one line of code.

```ts
import { paid } from '@hlos/paid';

export const myTool = paid({ skuId: 'my.tool.v1' })(handler);
```

## Core API

```ts
paid(config)(handler)
```

Config:
- `skuId` (required)
- `channel?: 'mcp' | 'skills' | 'bazaar' | 'enterprise'`
- `requireStaampid?: boolean`
- `minTrustScore?: number`
- `sandbox?: boolean`
- `envelope?: boolean`

Context enrichment (wrapper mutates existing `ctx`):
- `ctx.payment`
- `ctx.receipt`
- `ctx.paid = { skuId, channel, sandbox, idempotencyKey }`

Idempotency defaults:
- MCP: `mcp:${skuId}:${toolCallId}`
- Skills: `skills:${skuId}:${requestId|clientTag}`

## Settlement Model

`paid()` does **not** call `/api/v2/x402/settle`.

You have two explicit options:
- Settle externally in your orchestrator and retry invocation with proof in `__hlos`.
- Use the explicit helper `settleWithHlosKernel(...)` (opt-in), then retry invocation with proof.

## Happy Path (Two-Step)

1. First call -> `PAYMENT_REQUIRED`

```ts
try {
  await myPaidTool(ctx, { key: 'foo' });
} catch (error) {
  // PaymentRequiredError: includes challenge payload + quote_id
}
```

2. Settle externally (or via explicit helper)

```ts
import { settleWithHlosKernel } from '@hlos/paid';

const settled = await settleWithHlosKernel({
  apiBaseUrl: process.env.HLOS_BASE_URL,
  skuId: 'my.tool.v1',
  quoteId: 'quote_123',
  paymentSignature: 'signed-payment',
  idempotencyKey: 'mcp:my.tool.v1:tool_call_123',
});
```

3. Retry with `__hlos` proof

```ts
await myPaidTool(ctx, {
  key: 'foo',
  __hlos: {
    quote_id: 'quote_123',
    payment_signature: 'signed-payment',
    receipt_id: settled.receiptId,
    request_id: 'tool_call_123',
  },
});
```

## Reserved `__hlos` Channel

Use the same reserved field for HTTP bodies and MCP tool args:

```json
{
  "__hlos": {
    "quote_id": "quote_...",
    "payment_signature": "signed_header_or_token",
    "receipt_id": "brec_h_...",
    "receipt_hash": "...optional...",
    "request_id": "stable-request-id",
    "client_tag": "fallback-stable-id",
    "tool_call_id": "mcp-tool-call-id"
  }
}
```

## Helpers

- `toHttpErrorResponse(error)` -> HTTP 402 body/headers for skills routes
- `toMcpPaymentRequired(error)` -> MCP `PAYMENT_REQUIRED` payload
- `toMcpToolErrorResult(payload)` -> MCP tool error object
- `applyPaidResponseHeaders(headers, ctx)` -> `x-hlos-receipt-id`, `x-hlos-receipt-hash`, `x-hlos-payment-sighash`
- `settleWithHlosKernel(...)` -> explicit helper for `/api/v2/x402/settle` (never auto-called by `paid()`)

## Examples

- MCP wrapper: `examples/mcp-tool.ts`
- HTTP wrapper: `examples/http-skill.ts`
- Settle script: `examples/settle-cli.ts`

## Docs

- External contracts: `DEPENDENCIES.md`
- Stable protocol surface: `PROTOCOL.md`

## Local Development

```bash
npm run typecheck
npm test
npm run build
```
