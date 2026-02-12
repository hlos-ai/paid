# Changelog

## 0.1.0
- Initial public extraction of `@hlos/paid`.
- Transparent `paid(config)(handler)` wrapper with context enrichment.
- HTTP + MCP error mapping helpers.
- External-settlement model (`paid()` does not auto-settle).
- Optional explicit settlement helper: `settleWithHlosKernel(...)`.
