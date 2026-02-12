# Protocol Surface

This file defines the stable invocation contract for `@hlos/paid`.

## 1) Payment-Required Signaling

### HTTP skills
When unpaid, `paid()` throws `PaymentRequiredError`; map it with `toHttpErrorResponse(error)`.

Expected response shape:
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

`__hlos` is a reserved proof channel supported in both HTTP body payloads and MCP args.

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

## 3) Idempotency Guarantees

If `ctx.idempotency_key` is present, it is used as-is.

Otherwise defaults:
- MCP: `mcp:${skuId}:${toolCallId}`
- Skills: `skills:${skuId}:${requestId|clientTag}`

A reused idempotency key with different proof material throws `IDEMPOTENCY_CONFLICT`.

## 4) Settlement Behavior

- `paid()` never calls `/api/v2/x402/settle`.
- `paid()` requires proof on paid path:
  - `payment_signature` plus one anchor: `receipt_id` or `request_id` or `client_tag`.
- Optional receipt hydration may call `GET /api/v2/x402/receipt`.

Explicit helper (opt-in):
- `settleWithHlosKernel(...)` calls `POST /api/v2/x402/settle`.
- This helper is never called automatically by `paid()`.

## 5) Stable Headers for Paid Success

Use `applyPaidResponseHeaders(headers, ctx)` to emit:
- `x-hlos-receipt-id`
- `x-hlos-receipt-hash`
- `x-hlos-payment-sighash`

## 6) Stability Statement

The following are intended stable primitives for integrators:
- `paid(config)(handler)` wrapper semantics
- `PaymentRequiredError` signaling
- `__hlos` reserved proof channel
- idempotency key defaults
- response helper APIs (`toHttpErrorResponse`, MCP helpers, header helpers)

Internal implementation details may evolve as long as these surface contracts remain compatible.
