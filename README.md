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

## Settlement Model (Important)

`paid()` never calls `/api/v2/x402/settle`.

You must settle externally, then retry with proof in `__hlos`.

Optional helper:
- `settleWithHlosKernel(...)` performs explicit settlement against HLOS.
- It is opt-in and never called automatically by `paid()`.

## Two-Step Happy Path

1. First invocation returns/throws `PAYMENT_REQUIRED`.
2. Settle with your own orchestrator or `settleWithHlosKernel(...)`.
3. Retry the same invocation with `__hlos` proof.

```ts
import { paid, settleWithHlosKernel } from '@hlos/paid';

const secretQuery = paid({ skuId: 'secrets.query.v1', channel: 'mcp' })(async (_ctx, input) => {
  return querySecret(input.key);
});

let quoteId: string | undefined;

try {
  await secretQuery(ctx, { key: 'api_key_1' });
} catch (error: any) {
  quoteId = error?.quote_id; // from PaymentRequiredError
}

const settled = await settleWithHlosKernel({
  apiBaseUrl: process.env.HLOS_BASE_URL,
  skuId: 'secrets.query.v1',
  quoteId,
  paymentSignature: '<signed-payment>',
  idempotencyKey: 'mcp:secrets.query.v1:tool_call_123',
});

await secretQuery(ctx, {
  key: 'api_key_1',
  __hlos: settled.__hlos,
});
```

## `settleWithHlosKernel(...)` Contract

Input:
- `skuId: string` (required)
- `paymentSignature: string` (required)
- `quoteId?: string`
- `challenge?: PaymentRequiredChallenge | Record<string, unknown>` (raw challenge accepted; `quote_id` extracted)
- `idempotencyKey?: string`
- `apiBaseUrl?: string` (defaults to `HLOS_BASE_URL` or `http://localhost:3000`)
- `fetchImpl?: FetchLike`
- `capabilityId?: string`
- `walletId?: string`

Output:
- `settlement: { receiptId, receiptHash?, paymentSigHash, verificationUrl?, requestId, raw? }`
- `__hlos: { quote_id, payment_signature, receipt_id, receipt_hash?, request_id }`

Error semantics (`PaidError`):
- `SETTLEMENT_NETWORK_ERROR` (network/transport failure)
- `SETTLEMENT_BAD_REQUEST` / `SETTLEMENT_UNAUTHORIZED` / `FORBIDDEN`
- `PAYMENT_REQUIRED` (still not payable)
- `SETTLEMENT_CONFLICT` / `RATE_LIMITED`
- `SETTLEMENT_UPSTREAM_ERROR` / `SETTLEMENT_FAILED`

## Reserved `__hlos` Channel

`__hlos` is a request-scoped proof channel:
- HTTP skills: put it in request body JSON as `__hlos`.
- MCP tools: put it in tool args as `__hlos`.

Semantics:
- additive (does not replace auth headers or identity context)
- per-request (not session-wide)

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

- `toHttpErrorResponse(error)` -> HTTP 402 mapping for skills routes
- `toMcpPaymentRequired(error)` -> MCP `PAYMENT_REQUIRED` payload
- `toMcpToolErrorResult(payload)` -> MCP tool error object
- `applyPaidResponseHeaders(headers, ctx)` -> `x-hlos-receipt-id`, `x-hlos-receipt-hash`, `x-hlos-payment-sighash`
- `settleWithHlosKernel(...)` -> explicit settlement helper (never auto-called by `paid()`)

## Examples

- MCP wrapper: `examples/mcp-tool.ts`
- HTTP wrapper: `examples/http-skill.ts`
- Demo settle helper: `examples/settle-cli.ts`

## Docs

- External endpoint dependencies: `DEPENDENCIES.md`
- Stable protocol contract: `PROTOCOL.md`

## Edge Runtimes

On Edge runtimes (Vercel Edge, Cloudflare Workers, Deno Deploy) pass `apiBaseUrl` explicitly — `process.env` is not read when unavailable.

## Local Development

```bash
npm i
npm run test
npm run build
npx publint
```
