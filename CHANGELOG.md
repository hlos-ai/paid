# Changelog

## 0.2.0
- Added explicit settlement helper contract: `settleWithHlosKernel(...)`.
- Helper now returns retry-ready `__hlos` payload plus structured settlement metadata.
- Added deterministic idempotency fallback for helper when `idempotencyKey` is omitted.
- Added typed settlement error code mapping (`RATE_LIMITED`, `SETTLEMENT_NETWORK_ERROR`, etc.).
- Expanded tests for no-auto-settle behavior and settlement error/idempotency semantics.
- Added `PROTOCOL.md` and improved README two-step integration guidance.
- Added exported context builders for deterministic HTTP/MCP id derivation:
  `buildPaidContextFromHttp(...)`, `buildPaidContextFromMcp(...)`.

## 0.1.0
- Initial public extraction of `@hlos/paid`.
- Transparent `paid(config)(handler)` wrapper with context enrichment.
- HTTP + MCP error mapping helpers.
- External-settlement model (`paid()` does not auto-settle).
