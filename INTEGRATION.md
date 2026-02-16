# Integration Guide

This guide is for teams embedding `@hlos/paid` into API routes, skills, and MCP servers.

## Mental Model

1. `paid(config)(handler)` protects an invocation boundary.
2. Unpaid call returns/throws `PAYMENT_REQUIRED` semantics.
3. Settlement happens outside `paid()`.
4. Retry the same invocation with server-issued `__hlos` proof.

`paid()` never calls `/api/v2/x402/settle` automatically.

## Runtime Support

- Default runtime target: Node.js 20+ server runtimes.
- Default build is not Edge-compatible because it imports Node crypto APIs.
- If you run Edge workloads, put paid gating + settlement orchestration behind a Node service and forward requests there.

## Context Builders

Prefer exported helpers over ad-hoc context derivation:

- `buildPaidContextFromHttp(...)`
- `buildPaidContextFromMcp(...)`
- Optional subpath import: `@hlos/paid/context`

They throw `MissingIdempotencySourceError` when deterministic id inputs are missing.

## Idempotency Rules (Critical)

`paid()` needs deterministic idempotency keys:

- MCP default: `mcp:${skuId}:${toolCallId}`
- Skills/HTTP default: `skills:${skuId}:${requestId|clientTag}`

Rules:

1. Never use placeholders (for example `tool_call_unknown`).
2. Never use random IDs for retries.
3. Never use a constant fallback for missing IDs.
4. Fail closed when deterministic ID inputs are missing.
5. Treat `x-correlation-id` as last-resort fallback only; prefer explicit request IDs.

A reused idempotency key with different proof material raises `IDEMPOTENCY_CONFLICT`.

## Trust Model

- Treat `__hlos` as request-scoped proof material, not session state.
- Prefer proof values produced by your own orchestrator/settlement flow.
- Keep auth/identity controls separate; `__hlos` is additive and does not replace auth.

## Server Integration Recipes

### HTTP Route (Express/Next style)

```ts
import {
  applyPaidResponseHeaders,
  buildPaidContextFromHttp,
  isPaidError,
  MissingIdempotencySourceError,
  paid,
  toHttpErrorResponse,
  type PaidContext,
} from '@hlos/paid';

const translateText = paid({ skuId: 'model.inference.text.v1', channel: 'skills' })(
  async (_ctx: PaidContext, input: { text: string }) => {
    return { translated: input.text.toUpperCase() };
  }
);

export async function postSkillRoute(req: {
  headers: Record<string, string>;
  body: { text: string; __hlos?: Record<string, unknown> };
}) {
  let ctx: PaidContext;
  try {
    ctx = buildPaidContextFromHttp({
      skuId: 'model.inference.text.v1',
      headers: req.headers,
      requestId: req.headers['x-request-id'] ?? (req.body.__hlos?.request_id as string | undefined),
      clientTag:
        typeof req.body.__hlos?.client_tag === 'string' ? req.body.__hlos.client_tag : undefined,
    });
  } catch (error) {
    if (error instanceof MissingIdempotencySourceError) {
      return {
        status: 400,
        headers: { 'content-type': 'application/json' },
        body: {
          error: {
            code: 'missing_idempotency_key',
            message: error.message,
          },
        },
      };
    }
    throw error;
  }
  ctx.__hlos = req.body.__hlos;
  ctx.paymentProof = req.body.__hlos;

  try {
    const result = await translateText(ctx, req.body);
    const headers: Record<string, string> = {};
    applyPaidResponseHeaders(headers, ctx);
    return { status: 200, headers, body: result };
  } catch (error) {
    if (isPaidError(error)) {
      const formatted = toHttpErrorResponse(error);
      return { status: formatted.status, headers: formatted.headers, body: formatted.body };
    }
    throw error;
  }
}
```

### MCP Tool Handler

```ts
import {
  buildPaidContextFromMcp,
  isForbiddenError,
  isPaidError,
  isPaymentRequiredError,
  MissingIdempotencySourceError,
  paid,
  toMcpForbidden,
  toMcpPaymentRequired,
  toMcpToolErrorResult,
  type PaidContext,
} from '@hlos/paid';

const SKU_ID = 'secrets.query.v1';
const secretQuery = paid({ skuId: SKU_ID, channel: 'mcp' })(
  async (_ctx: PaidContext, input: { key: string }) => `value-for:${input.key}`
);

export async function handleSecretQueryMcp(args: { key: string; __hlos?: Record<string, unknown> }) {
  let ctx: PaidContext;
  try {
    ctx = buildPaidContextFromMcp({
      skuId: SKU_ID,
      toolCallId:
        typeof args.__hlos?.tool_call_id === 'string' ? args.__hlos.tool_call_id : undefined,
    });
  } catch (error) {
    if (error instanceof MissingIdempotencySourceError) {
      return toMcpToolErrorResult({
        code: 'MISSING_IDEMPOTENCY_KEY',
        message: error.message,
      });
    }
    throw error;
  }
  ctx.request_id =
    typeof args.__hlos?.request_id === 'string' ? args.__hlos.request_id : ctx.request_id;
  ctx.__hlos = args.__hlos;
  ctx.paymentProof = args.__hlos;

  try {
    return await secretQuery(ctx, args as { key: string });
  } catch (error) {
    if (isPaymentRequiredError(error)) return toMcpToolErrorResult(toMcpPaymentRequired(error));
    if (isForbiddenError(error)) {
      return toMcpToolErrorResult(
        toMcpForbidden(error, {
          skuId: SKU_ID,
          channel: 'mcp',
          correlationId: ctx.correlationId ?? ctx.request_id ?? 'unknown',
        })
      );
    }
    if (isPaidError(error)) return toMcpToolErrorResult({ code: error.code, message: error.message });
    throw error;
  }
}
```

### Skills.sh Style Handler

Use the same HTTP recipe above. The key requirement is a deterministic `request_id` on every call/retry.

## Settlement/Orchestrator Recipes

### CLI Settle (dev/hackathon)

Use `examples/settle-cli.ts` to convert a quote + payment signature into retry-ready `__hlos`.

### Service-to-Service Settle Pattern

1. Capability call returns `PAYMENT_REQUIRED` with quote.
2. Orchestrator performs settlement (`settleWithHlosKernel(...)` or your own endpoint client).
3. Orchestrator retries original capability call with returned `__hlos`.
4. Capability executes and returns paid response.

### Resume-the-Agent Pattern

1. Agent pauses on `PAYMENT_REQUIRED`.
2. Background worker settles and stores retry payload.
3. Worker replays the same tool call with deterministic `tool_call_id`/`request_id` and `__hlos`.
4. Agent resumes with paid result.

## Gotchas

1. Missing `toolCallId` in MCP should fail closed, not fallback.
2. `paid()` does not settle; settlement is explicit and external.
3. Idempotency collisions are usually integration bugs; inspect `IDEMPOTENCY_CONFLICT` details.
4. Settlement cache is in-memory per process; do not treat it as global distributed state.
5. For full settlement error coverage, use `PROTOCOL.md` as canonical.

## Hosted Adapter Alignment

- Treat `@hlos/paid` as the economic protocol adapter (`PAYMENT_REQUIRED` + proof channel + idempotency semantics).
- Keep runtime execution concerns in your MCP/runtime SDK layer.
- Centralize context/idempotency derivation in one shared helper to avoid drift across surfaces.

## Reference Docs

- `README.md` for quick start.
- `PROTOCOL.md` for stable protocol contracts and full error code list.
- `DEPENDENCIES.md` for upstream endpoint expectations.
- `examples/http-skill.ts`, `examples/mcp-tool.ts`, `examples/settle-cli.ts` for concrete usage.
