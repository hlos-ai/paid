import {
  ForbiddenError,
  MissingIdempotencyKeyError,
  PaymentRequiredError,
  applyPaidResponseHeaders,
  createHttpKernelAdapter,
  isPaymentRequiredError,
  paid,
  resetPaidIdempotencyCache,
  toHttpErrorResponse,
  toMcpPaymentRequired,
  toMcpToolErrorResult,
  type FetchLike,
  type FetchResponseLike,
  type PaidKernelAdapter,
} from '../src/index';

function response(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): FetchResponseLike {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string): string | null {
        return normalized[name.toLowerCase()] ?? null;
      },
    },
    async json() {
      return body;
    },
  };
}

describe('paid()', () => {
  beforeEach(() => {
    resetPaidIdempotencyCache();
  });

  it('returns payment_required for unpaid invocation and maps HTTP/MCP payloads', async () => {
    const fetchImpl: FetchLike = vi.fn(async (url: string) => {
      if (url.includes('/api/v2/x402/challenge')) {
        return response(
          402,
          {
            error: {
              code: 'payment_required',
              payment: {
                x402Version: 1,
                accepts: [{ asset: 'USDC', amount: '1000' }],
              },
            },
            quote_id: 'quote_unpaid_1',
          },
          {
            'payment-required': 'encoded-header-value',
          }
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const wrapped = paid({
      skuId: 'model.inference.text.v1',
      channel: 'skills',
      fetchImpl,
      apiBaseUrl: 'http://hlos.test',
    })(async () => ({ ok: true }));

    let thrown: unknown;
    try {
      await wrapped(
        {
          request_id: 'req_unpaid_1',
        },
        { text: 'hello' }
      );
    } catch (error) {
      thrown = error;
    }

    expect(isPaymentRequiredError(thrown)).toBe(true);
    const paymentRequired = thrown as PaymentRequiredError;

    const http = toHttpErrorResponse(paymentRequired);
    expect(http.status).toBe(402);
    expect(http.body.quote_id).toBe('quote_unpaid_1');
    expect(http.headers['payment-required']).toBe('encoded-header-value');

    const mcpPayload = toMcpPaymentRequired(paymentRequired);
    expect(mcpPayload.code).toBe('PAYMENT_REQUIRED');
    expect(mcpPayload.payment_required).toBeDefined();

    const toolError = toMcpToolErrorResult(mcpPayload as unknown as Record<string, unknown>);
    expect(toolError.isError).toBe(true);
    expect(toolError.structuredContent.code).toBe('PAYMENT_REQUIRED');
  });

  it('uses external settlement proof, enriches ctx, and does not call /x402/settle', async () => {
    const fetchImpl: FetchLike = vi.fn(async (url: string) => {
      if (url.includes('/api/v2/x402/receipt')) {
        return response(200, {
          success: true,
          receipt: {
            receipt_id: 'brec_h_paid_1',
            content_hash: 'abc123hash',
          },
        });
      }

      if (url.includes('/api/v2/x402/challenge')) {
        throw new Error('challenge should not be called for paid invocation');
      }

      if (url.includes('/api/v2/x402/settle')) {
        throw new Error('settle should never be called by paid()');
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const wrapped = paid({
      skuId: 'model.inference.text.v1',
      channel: 'skills',
      fetchImpl,
      apiBaseUrl: 'http://hlos.test',
    })(async (ctx, input: { text: string }) => {
      expect((input as any).__hlos).toBeUndefined();
      return {
        translated: input.text.toUpperCase(),
        paidSku: ctx.paid?.skuId,
      };
    });

    const ctx: Record<string, unknown> = {
      request_id: 'req_paid_1',
    };

    const result = await wrapped(ctx as any, {
      text: 'hello',
      __hlos: {
        quote_id: 'quote_paid_1',
        receipt_id: 'brec_h_paid_1',
        payment_signature: 'payment_signature_paid_1',
        request_id: 'req_paid_1',
      },
    });

    expect(result).toEqual({
      translated: 'HELLO',
      paidSku: 'model.inference.text.v1',
    });

    expect((ctx as any).payment).toBeDefined();
    expect((ctx as any).receipt?.id).toBe('brec_h_paid_1');
    expect((ctx as any).paid).toEqual({
      skuId: 'model.inference.text.v1',
      channel: 'skills',
      sandbox: false,
      idempotencyKey: 'skills:model.inference.text.v1:req_paid_1',
    });

    const headers: Record<string, string> = {};
    applyPaidResponseHeaders(headers, ctx as any);
    expect(headers['x-hlos-receipt-id']).toBe('brec_h_paid_1');
    expect(headers['x-hlos-receipt-hash']).toBe('abc123hash');
    expect(headers['x-hlos-payment-sighash']).toBeDefined();

    const calledUrls = (fetchImpl as any).mock.calls.map((call: unknown[]) => `${call[0]}`);
    expect(calledUrls.some((url: string) => url.includes('/api/v2/x402/settle'))).toBe(false);
  });

  it('returns envelope when envelope mode is enabled', async () => {
    const wrapped = paid({
      skuId: 'model.inference.text.v1',
      channel: 'skills',
      sandbox: true,
      envelope: true,
      adapter: {
        challenge: vi.fn(),
      },
    })(async (_ctx, input: { text: string }) => input.text);

    const result = await wrapped(
      {
        request_id: 'req_envelope_1',
      },
      { text: 'hello' }
    );

    expect(result).toMatchObject({
      ok: true,
      result: 'hello',
    });
    expect((result as any).payment.status).toBe('sandbox');
  });

  it('fails with forbidden when STAAMPID authority requirements are not met', async () => {
    const wrapped = paid({
      skuId: 'secrets.query.v1',
      channel: 'mcp',
      requireStaampid: true,
      minTrustScore: 700,
      adapter: {
        challenge: vi.fn(),
      },
    })(async () => ({ ok: true }));

    await expect(
      wrapped(
        {
          toolCallId: 'tool_call_1',
        },
        {
          __hlos: {
            payment_signature: 'proof_1',
            receipt_id: 'receipt_1',
          },
        }
      )
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('uses idempotency cache so repeated retries do not re-fetch receipt', async () => {
    const adapter: PaidKernelAdapter = {
      challenge: vi.fn(),
      receipt: vi.fn(async () => ({
        id: 'brec_h_idem_1',
        hash: 'idemhash',
      })),
      settle: vi.fn(),
    };

    const wrapped = paid({
      skuId: 'model.inference.text.v1',
      channel: 'skills',
      adapter,
    })(async (_ctx, input: { text: string }) => input.text);

    const ctx = {
      request_id: 'req_idempotent_1',
    };

    const input = {
      text: 'hello',
      __hlos: {
        receipt_id: 'brec_h_idem_1',
        payment_signature: 'payment_signature_idem_1',
        request_id: 'req_idempotent_1',
      },
    };

    await wrapped(ctx, input as any);
    await wrapped(ctx, input as any);

    expect((adapter.receipt as any).mock.calls.length).toBe(1);
    expect((adapter.settle as any).mock.calls.length).toBe(0);
  });

  it('supports sandbox mode without challenge or receipt lookup', async () => {
    const adapter: PaidKernelAdapter = {
      challenge: vi.fn(),
      receipt: vi.fn(),
      settle: vi.fn(),
    };

    const wrapped = paid({
      skuId: 'model.inference.text.v1',
      channel: 'skills',
      sandbox: true,
      adapter,
    })(async (_ctx, input: { text: string }) => input.text);

    const ctx: Record<string, unknown> = {
      request_id: 'req_sandbox_1',
    };

    const result = await wrapped(ctx as any, { text: 'sandbox' });
    expect(result).toBe('sandbox');
    expect((ctx as any).payment.status).toBe('sandbox');
    expect((ctx as any).receipt.id.startsWith('sandbox_')).toBe(true);

    expect((adapter.challenge as any).mock.calls.length).toBe(0);
    expect((adapter.receipt as any).mock.calls.length).toBe(0);
    expect((adapter.settle as any).mock.calls.length).toBe(0);
  });

  it('requires stable skills idempotency key source', async () => {
    const wrapped = paid({
      skuId: 'model.inference.text.v1',
      channel: 'skills',
      adapter: {
        challenge: vi.fn(),
      },
    })(async () => ({ ok: true }));

    await expect(wrapped({}, { text: 'missing request id' } as any)).rejects.toBeInstanceOf(
      MissingIdempotencyKeyError
    );
  });

  it('default adapter settle method is explicit and never used by paid()', async () => {
    const adapter = createHttpKernelAdapter({
      baseUrl: 'http://hlos.test',
      fetchImpl: vi.fn(async () => {
        throw new Error('fetch should not be called in this test');
      }),
    });

    await expect(
      adapter.settle?.({
        skuId: 'sku.v1',
        quoteId: 'quote_1',
        paymentSignature: 'sig_1',
        idempotencyKey: 'skills:sku.v1:req_1',
      })
    ).rejects.toMatchObject({ code: 'EXTERNAL_SETTLEMENT_REQUIRED' });
  });
});
