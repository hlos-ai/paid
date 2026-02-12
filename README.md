# @hlos/paid

Minimal invocation-time monetization wrapper for agent-native commerce.

```ts
import { paid } from '@hlos/paid';

// One line monetization.
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

## External Settlement Model

`paid()` does **not** settle x402 payments itself.

Runtime flow:
1. Invocation without settlement proof -> throws `PaymentRequiredError`.
2. Caller settles externally (outside this wrapper).
3. Caller retries invocation with proof in reserved `__hlos`.
4. Wrapper enriches `ctx` and executes handler.

This keeps payment orchestration explicit and avoids coupling the wrapper to wallet/kernel internals.

## Reserved `__hlos` Input

Use the same reserved field for HTTP bodies and MCP tool args:

```json
{
  "text": "hello",
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

## Error Mapping Helpers

- `toHttpErrorResponse(error)` -> HTTP 402 body/headers for skills routes
- `toMcpPaymentRequired(error)` -> MCP `PAYMENT_REQUIRED` payload
- `toMcpToolErrorResult(payload)` -> MCP tool error object
- `applyPaidResponseHeaders(headers, ctx)` ->
  - `x-hlos-receipt-id`
  - `x-hlos-receipt-hash`
  - `x-hlos-payment-sighash`

## Examples

- MCP usage: `/Users/misawa/paid/examples/mcp-tool.ts`
- HTTP usage: `/Users/misawa/paid/examples/http-skill.ts`

## Local Development

```bash
npm run typecheck
npm test
npm run build
```
