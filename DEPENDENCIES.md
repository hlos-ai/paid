# Dependency Contract

`@hlos/paid` is intentionally thin. It relies on public HTTP contracts plus caller-provided proof.

## Endpoints

### `POST /api/v2/x402/challenge`
- Used by default HTTP adapter when payment proof is missing.
- Expected result: `402` with x402-compatible challenge in body and optional `payment-required` header.

### `POST /api/v2/x402/settle`
- **Not called by `paid()`**.
- Settlement remains external by default.
- Optional helper `settleWithHlosKernel(...)` can call this endpoint explicitly.

### `GET /api/v2/x402/receipt`
- Optional receipt hydration by default adapter when `receipt_id` or `request_id` is provided.
- If unavailable, wrapper proceeds with proof-derived receipt metadata.

### `GET /api/v2/catalog/skus`
- Discovery/pricing endpoint used by orchestrators outside this wrapper.

## Challenge/Proof Expectations

Challenge response fragments:
- `error.code = payment_required`
- `error.payment = {...x402 payment_required...}`
- optional `quote_id`

Retry proof (`__hlos`) fragments:
- `payment_signature` (required paid path)
- one stable anchor: `receipt_id`, `request_id`, or `client_tag`
- optional `quote_id`, `receipt_hash`

## Idempotency Expectations

For `paid()`:
- MCP default: `mcp:${skuId}:${toolCallId}`
- Skills default: `skills:${skuId}:${requestId|clientTag}`

For `settleWithHlosKernel(...)`:
- accepts `idempotencyKey`
- derives deterministic fallback if omitted

## Environment Variables

- `HLOS_BASE_URL` (optional)
  - default: `http://localhost:3000`
  - used by default adapter/helper when `apiBaseUrl` is not set.

## Not Included (Intentionally)

- Wallet key management
- On-chain payment execution
- Revshare/payout engines
- Kernel internals (`wallet`, `receipt-builder`, policy engine internals)
- Any HLOS private module imports
