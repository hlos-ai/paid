# Protocol Surface

This file defines the stable invocation contract for `@hlos/paid`.

## 1) Payment-Required Signaling

### HTTP skills
When unpaid, `paid()` throws `PaymentRequiredError`; map it with `toHttpErrorResponse(error)`.

Expected HTTP response shape:
- status: `402`
- body:
  - `error.code = payment_required`
  - `error.message`
  - `error.payment` (x402 payload)
  - `payment_required` (same x402 payload)
  - `hlos = { skuId, channel, correlationId, idempotencyKey }`
  - `quote_id` (optional)
- headers:
  - `payment-required` (optional passthrough)

### MCP tools
When unpaid, map to:

```json
{
  "code": "PAYMENT_REQUIRED",
  "message": "...",
  "payment_required": { "...": "..." },
  "hlos": {
    "skuId": "...",
    "channel": "mcp",
    "correlationId": "..."
  }
}
```

Use `toMcpPaymentRequired(error)` + `toMcpToolErrorResult(payload)`.

## 2) Reserved `__hlos` Fields

`__hlos` is a request-scoped proof channel supported in both HTTP body payloads and MCP args.

Supported fields:
- `quote_id?: string`
- `payment_signature?: string`
- `receipt_id?: string`
- `receipt_hash?: string`
- `request_id?: string`
- `client_tag?: string`
- `tool_call_id?: string`
- `staampid?: string`
- `trust_score?: number`

Semantics:
- additive (does not replace existing auth/identity headers)
- per-request (not session-wide)

## 3) Idempotency Guarantees

For `paid(config)(handler)`:
- if `ctx.idempotency_key` exists, use it
- otherwise defaults:
  - MCP: `mcp:${skuId}:${toolCallId}`
  - Skills: `skills:${skuId}:${requestId|clientTag}`

A reused idempotency key with different proof material throws `IDEMPOTENCY_CONFLICT`.

For `settleWithHlosKernel(...)`:
- accepts optional `idempotencyKey`
- if omitted, derives deterministic key:
  - `settle:${skuId}:${sha256(quoteId:paymentSignature)[0..24]}`

## 4) Settlement Behavior

- `paid()` never calls `/api/v2/x402/settle`.
- `paid()` paid-path proof requirements:
  - `payment_signature` plus one anchor: `receipt_id` or `request_id` or `client_tag`
- Optional receipt hydration may call `GET /api/v2/x402/receipt`.

Explicit helper (opt-in):
- `settleWithHlosKernel(...)` calls `POST /api/v2/x402/settle`.
- It returns both settlement details and retry-ready `__hlos`.
- It is never invoked automatically by `paid()`.

## 5) `settleWithHlosKernel(...)` Output Contract

```json
{
  "settlement": {
    "receiptId": "...",
    "receiptHash": "...optional...",
    "paymentSigHash": "...",
    "verificationUrl": "...optional...",
    "requestId": "...",
    "raw": "..."
  },
  "__hlos": {
    "quote_id": "...",
    "payment_signature": "...",
    "receipt_id": "...",
    "receipt_hash": "...optional...",
    "request_id": "..."
  }
}
```

## 6) Settlement Error Codes

`settleWithHlosKernel(...)` throws `PaidError` with stable code families:
- `SETTLEMENT_NETWORK_ERROR`
- `SETTLEMENT_BAD_REQUEST`
- `SETTLEMENT_UNAUTHORIZED`
- `FORBIDDEN`
- `PAYMENT_REQUIRED`
- `SETTLEMENT_NOT_FOUND`
- `SETTLEMENT_CONFLICT`
- `RATE_LIMITED`
- `SETTLEMENT_UPSTREAM_ERROR`
- `SETTLEMENT_FAILED`

## 7) Stable Headers for Paid Success

Use `applyPaidResponseHeaders(headers, ctx)` to emit:
- `x-hlos-receipt-id`
- `x-hlos-receipt-hash`
- `x-hlos-payment-sighash`

## 8) Stability Statement

The following are intended stable primitives for integrators:
- `paid(config)(handler)` wrapper semantics
- `PaymentRequiredError` signaling
- `__hlos` reserved proof channel
- idempotency key defaults
- explicit helper contract (`settleWithHlosKernel`)
- response helper APIs (`toHttpErrorResponse`, MCP helpers, header helpers)

Internal implementation details may evolve as long as these contracts remain compatible.
