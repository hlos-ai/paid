import {
  applyPaidResponseHeaders,
  isPaidError,
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
  const ctx: PaidContext = {
    channel: 'skills',
    headers: req.headers,
    request_id: req.headers['x-request-id'] ?? (req.body.__hlos?.request_id as string | undefined),
    __hlos: req.body.__hlos,
    paymentProof: req.body.__hlos,
  };

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
