# @hlos/paid

Turn any MCP tool or API route into a paid capability in one line of code.

## 5-Minute Quickstart (Hackathon Edition)

Turn any API route into a paid endpoint in one line.

### 1. Install

```bash
npm install @hlos/paid
```

### 2. Set Environment Variables

```bash
export HLOS_BASE_URL=https://sandbox.hlos.ai
```

### 3. Wrap Your Route (Express Example)

```ts
import express from "express";
import {
  buildPaidContextFromHttp,
  isPaidError,
  paid,
  toHttpErrorResponse,
} from "@hlos/paid";

const app = express();
app.use(express.json());

const helloRoute = paid({ skuId: "hello.world.v1", channel: "skills", sandbox: true })(
  async () => {
    return { message: "Hello paid world." };
  }
);

app.post("/api/hello", async (req, res, next) => {
  try {
    const ctx = buildPaidContextFromHttp({
      skuId: "hello.world.v1",
      headers: req.headers,
      requestId: req.header("x-request-id") ?? req.body?.__hlos?.request_id,
      clientTag: req.body?.__hlos?.client_tag,
    });

    ctx.__hlos = req.body?.__hlos;
    ctx.paymentProof = req.body?.__hlos;

    const result = await helloRoute(ctx, req.body ?? {});
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  if (isPaidError(err)) {
    const httpError = toHttpErrorResponse(err);
    return res.status(httpError.status).set(httpError.headers).json(httpError.body);
  }
  next(err);
});

app.listen(3000);
```

### 4. Call It

First call returns `402 PAYMENT_REQUIRED`.

Then:
- Settle externally (or use `settleWithHlosKernel(...)`).
- Retry with `__hlos`.

### That's It

You just monetized an API route.

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

## Runtime Support

- Runtime: Node.js 20+ server runtimes.
- Default build is not Edge-compatible because the package imports Node crypto APIs.
- Set `apiBaseUrl` explicitly when you do not want to rely on `HLOS_BASE_URL`.

### Edge Recipe (Today)

If you run workloads on Edge today, keep payment gating/settlement in a Node service:
1. Edge receives the incoming request/tool call.
2. Edge forwards to a Node service that runs `paid(...)`.
3. Node returns `PAYMENT_REQUIRED` or success with paid metadata.
4. Client/agent settles externally, retries with `__hlos`, and Edge forwards again.

For native Edge package support, use a separate web-targeted entrypoint/fork that replaces Node crypto usage with WebCrypto.

## Context Builders

Use exported builders to centralize deterministic id derivation:

```ts
import { buildPaidContextFromHttp, buildPaidContextFromMcp } from '@hlos/paid';
// Optional subpath import:
// import { buildPaidContextFromHttp, buildPaidContextFromMcp } from '@hlos/paid/context';

const httpCtx = buildPaidContextFromHttp({
  skuId: 'model.inference.text.v1',
  headers: requestHeaders,
});

const mcpCtx = buildPaidContextFromMcp({
  skuId: 'secrets.query.v1',
  toolCallId: toolCall.id,
});
```

Both throw `MissingIdempotencySourceError` if a deterministic source is missing.
For HTTP, `x-correlation-id` is a last-resort fallback. Prefer explicit `requestId` or `x-request-id`.

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

Error semantics (`PaidError`) — canonical HLOS Kernel codes:
- `INVALID_REQUEST` (missing `quoteId`, bad request)
- `UNAUTHORIZED`
- `INSUFFICIENT_BALANCE` (402 — payment still required)
- `RATE_LIMITED`
- `SERVICE_UNAVAILABLE` (network failure, 5xx upstream)
- `INTERNAL_ERROR` (non-5xx unmapped status)

Full list: `PROTOCOL.md` ("Settlement Error Codes").

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
- `buildPaidContextFromHttp(...)` -> deterministic HTTP/skills context builder
- `buildPaidContextFromMcp(...)` -> deterministic MCP context builder
- `settleWithHlosKernel(...)` -> explicit settlement helper (never auto-called by `paid()`)

## Examples

- MCP wrapper: `examples/mcp-tool.ts`
- HTTP wrapper: `examples/http-skill.ts`
- Demo settle helper: `examples/settle-cli.ts`

## Docs

- External endpoint dependencies: `DEPENDENCIES.md`
- Stable protocol contract: `PROTOCOL.md`
- Integration guide and recipes: `INTEGRATION.md`

## Local Development

```bash
npm i
npm run test
npm run build
npx publint
```
