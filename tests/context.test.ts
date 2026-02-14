import {
  assertDeterministicId,
  buildPaidContextFromHttp,
  buildPaidContextFromMcp,
  MissingIdempotencySourceError,
  normalizeSkuId,
} from '../src/index';

describe('context builders', () => {
  it('HTTP explicit requestId wins over headers', () => {
    const ctx = buildPaidContextFromHttp({
      skuId: 'sku.http.v1',
      requestId: 'req_explicit_1',
      headers: {
        'x-request-id': 'req_header_1',
        'x-correlation-id': 'corr_1',
      },
    });

    expect(ctx.channel).toBe('skills');
    expect(ctx.request_id).toBe('req_explicit_1');
  });

  it('HTTP header fallback order uses x-request-id then x-correlation-id then x-hlos-client-tag', () => {
    const fromRequestId = buildPaidContextFromHttp({
      skuId: 'sku.http.v1',
      headers: {
        'x-request-id': 'req_header_2',
        'x-correlation-id': 'corr_2',
        'x-hlos-client-tag': 'tag_2',
      },
    });
    expect(fromRequestId.request_id).toBe('req_header_2');

    const fromCorrelation = buildPaidContextFromHttp({
      skuId: 'sku.http.v1',
      headers: {
        'x-correlation-id': 'corr_3',
        'x-hlos-client-tag': 'tag_3',
      },
    });
    expect(fromCorrelation.request_id).toBe('corr_3');
  });

  it('HTTP missing deterministic source throws MissingIdempotencySourceError', () => {
    expect(() =>
      buildPaidContextFromHttp({
        skuId: 'sku.http.v1',
      })
    ).toThrow(MissingIdempotencySourceError);
  });

  it('HTTP missing source error message is actionable', () => {
    try {
      buildPaidContextFromHttp({
        skuId: 'sku.http.v1',
      });
      throw new Error('expected error');
    } catch (error) {
      expect(error).toBeInstanceOf(MissingIdempotencySourceError);
      const message = (error as Error).message;
      expect(message).toContain('requestId');
      expect(message).toContain('x-request-id');
      expect(message).toContain('x-correlation-id');
    }
  });

  it('MCP builder uses toolCallId when provided', () => {
    const ctx = buildPaidContextFromMcp({
      skuId: 'sku.mcp.v1',
      toolCallId: 'tool_call_1',
    });

    expect(ctx.channel).toBe('mcp');
    expect(ctx.toolCallId).toBe('tool_call_1');
  });

  it('MCP builder falls back to jsonRpcId when toolCallId is missing', () => {
    const ctx = buildPaidContextFromMcp({
      skuId: 'sku.mcp.v1',
      jsonRpcId: 42,
    });

    expect(ctx.toolCallId).toBe('42');
    expect(ctx.request_id).toBe('42');
  });

  it('MCP missing deterministic source throws MissingIdempotencySourceError', () => {
    expect(() =>
      buildPaidContextFromMcp({
        skuId: 'sku.mcp.v1',
      })
    ).toThrow(MissingIdempotencySourceError);
  });

  it('MCP missing source error message is actionable', () => {
    try {
      buildPaidContextFromMcp({
        skuId: 'sku.mcp.v1',
      });
      throw new Error('expected error');
    } catch (error) {
      expect(error).toBeInstanceOf(MissingIdempotencySourceError);
      const message = (error as Error).message;
      expect(message).toContain('toolCallId');
      expect(message).toContain('jsonRpcId');
    }
  });

  it('normalizeSkuId trims but does not mutate casing/content', () => {
    expect(normalizeSkuId('  Sku.Mixed-Case.v1  ')).toBe('Sku.Mixed-Case.v1');
  });

  it('normalizeSkuId rejects invalid characters', () => {
    expect(() => normalizeSkuId('sku invalid')).toThrow(TypeError);
  });

  it('assertDeterministicId throws MissingIdempotencySourceError for empty values', () => {
    expect(() => assertDeterministicId('  ', 'missing deterministic id')).toThrow(
      MissingIdempotencySourceError
    );
  });
});
