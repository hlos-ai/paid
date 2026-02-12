# Dependency Contract

`@hlos/paid` is intentionally thin. It relies on public HTTP contracts and caller-provided proof.

## Endpoints

### `GET /api/v2/catalog/skus`
- Used by callers/orchestrators to discover SKU metadata and pricing before invocation.
- Wrapper does not require this call in-process.

### `POST /api/v2/x402/challenge`
- Used by default HTTP adapter when payment proof is missing.
- Expected result: `402` with x402-compatible challenge in body and `payment-required` header.

### `POST /api/v2/x402/settle`
- **Not called by `paid()`**.
- Settlement is external to this library.
- Caller/orchestrator should settle first, then retry invocation with proof in `__hlos`.

### `GET /api/v2/x402/receipt`
- Optional receipt hydration by default adapter when `receipt_id` or `request_id` is provided.
- If unavailable, wrapper still proceeds with receipt stub metadata from proof.

## Expected Payload Fragments

### Challenge response
- `error.code = payment_required`
- `error.payment = {...x402 payment_required...}`
- optional `quote_id`
- optional `payment-required` header

### Settlement proof (provided by caller via `__hlos`)
- `payment_signature` (required for paid path)
- one stable anchor: `receipt_id`, `request_id`, or `client_tag`
- optional: `quote_id`, `receipt_hash`

### Receipt envelope (optional hydration)
- `receipt.receipt_id` (or `receipt.id`)
- `receipt.content_hash` (optional)
- `receipt.verification_url` (optional)

## STAAMPID / Passport Headers

The wrapper reads these when present:
- `x-staampid`
- `x-staampid-trust`

Use config guards for policy gates:
- `requireStaampid`
- `minTrustScore`

## Environment Variables

- `HLOS_BASE_URL` (optional)
  - default: `http://localhost:3000`
  - used by the default HTTP adapter when `apiBaseUrl` is not set.

## Not Included (Intentionally)

- Wallet key management
- On-chain payment execution
- Revshare/payout engines
- Kernel internals (`wallet`, `receipt-builder`, policy engine internals)
- Any HLOS private module imports
