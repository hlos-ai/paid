# Changelog

## 0.2.0
- Added explicit settlement helper contract: `settleWithHlosKernel(...)`.
- Helper now returns retry-ready `__hlos` payload plus structured settlement metadata.
- Added deterministic idempotency fallback for helper when `idempotencyKey` is omitted.
- Added typed settlement error code mapping using canonical HLOS Kernel codes
  (`INVALID_REQUEST`, `SERVICE_UNAVAILABLE`, `RATE_LIMITED`, etc.).
- Aligned all outgoing HTTP requests with HLOS v2 header contract
  (`X-HLOS-Surface`, `X-HLOS-Idempotency-Key`, `X-HLOS-Correlation-ID`).
- Added `CANONICAL_KERNEL_ERROR_CODES`, `PAID_ERROR_CODE_MAP`, `HLOS_SURFACE`,
  and `CONTRACTS_VERSION` exports for ecosystem conformance.
- Added `@hlos-ai/schemas` and `@hlos/mcp-sdk` as devDependencies for conformance
  testing (runtime remains zero-dep).
- Added conformance test suite (`tests/conformance.test.ts`) validating error codes,
  v2 headers, receipt shapes, crossing hashes, and idempotency key formats against
  canonical schemas.
- Added CI workflows (`.github/workflows/ci.yml`, `.github/workflows/conformance.yml`).
- Expanded tests for no-auto-settle behavior and settlement error/idempotency semantics.
- Added `PROTOCOL.md` and improved README two-step integration guidance.
- Added exported context builders for deterministic HTTP/MCP id derivation:
  `buildPaidContextFromHttp(...)`, `buildPaidContextFromMcp(...)`.

## 0.1.0
- Initial public extraction of `@hlos/paid`.
- Transparent `paid(config)(handler)` wrapper with context enrichment.
- HTTP + MCP error mapping helpers.
- External-settlement model (`paid()` does not auto-settle).
