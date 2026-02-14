import {
  applyPaidResponseHeaders,
  buildPaidContextFromHttp,
  isPaidError,
  MissingIdempotencySourceError,
  paid,
  toHttpErrorResponse,
  type PaidContext,
} from '../src/index';

async function translate(text: string): Promise<string> {
  return text.toUpperCase();
}

const translateText = paid({ skuId: 'model.inference.text.v1', channel: 'skills' })(
  async (_ctx: PaidContext, input: { text: string }) => {
    return { translated: await translate(input.text) };
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

    return {
      status: 200,
      headers,
      body: result,
    };
  } catch (error) {
    if (isPaidError(error)) {
      const formatted = toHttpErrorResponse(error);
      return {
        status: formatted.status,
        headers: formatted.headers,
        body: formatted.body,
      };
    }

    throw error;
  }
}
