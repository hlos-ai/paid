import {
  isForbiddenError,
  isPaidError,
  isPaymentRequiredError,
  paid,
  toMcpForbidden,
  toMcpPaymentRequired,
  toMcpToolErrorResult,
  type PaidContext,
} from '../src/index';

const SKU_ID = 'secrets.query.v1';

async function querySecret(key: string): Promise<string> {
  return `value-for:${key}`;
}

export const secretQuery = paid({ skuId: SKU_ID, channel: 'mcp' })(
  async (_ctx: PaidContext, input: { key: string }) => {
    return querySecret(input.key);
  }
);

export async function handleSecretQueryMcp(args: { key: string; __hlos?: Record<string, unknown> }) {
  const ctx: PaidContext = {
    channel: 'mcp',
    toolCallId: String(args.__hlos?.tool_call_id ?? 'tool_call_unknown'),
    request_id: typeof args.__hlos?.request_id === 'string' ? args.__hlos.request_id : undefined,
    __hlos: args.__hlos,
    paymentProof: args.__hlos,
  };

  try {
    return await secretQuery(ctx, args as { key: string });
  } catch (error) {
    if (isPaymentRequiredError(error)) {
      return toMcpToolErrorResult(toMcpPaymentRequired(error));
    }

    if (isForbiddenError(error)) {
      return toMcpToolErrorResult(
        toMcpForbidden(error, {
          skuId: SKU_ID,
          channel: 'mcp',
          correlationId: ctx.correlationId ?? ctx.request_id ?? 'unknown',
        })
      );
    }

    if (isPaidError(error)) {
      return toMcpToolErrorResult({ code: error.code, message: error.message });
    }

    throw error;
  }
}
