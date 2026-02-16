/**
 * Conformance tests: @hlos/paid ↔ @hlos-ai/schemas + @hlos/mcp-sdk
 *
 * These tests use the ecosystem packages as devDependencies to verify
 * that @hlos/paid's runtime behavior aligns with canonical contracts.
 * The runtime package stays zero-dep; these tests run only in CI/dev.
 */
import { createHash } from 'node:crypto';
import {
  GOLDEN_FIXTURES,
  RECEIPT_HASH_GOLDEN_FIXTURE,
  KernelErrorCodeSchema,
  SignedReceiptV0LooseSchema,
  CrossingSettledReceiptSchema,
  SURFACES,
  SETTLEMENT_AUTHORITY,
  RECEIPT_TYPE_URI,
  RECEIPT_VERSION,
  isSignedReceiptV0,
  isCrossingSettledReceipt,
  jcsCanonicalize,
} from '@hlos-ai/schemas';
import { V2_HEADERS } from '@hlos/mcp-sdk/v2/headers';
import { generateV2IdempotencyKey } from '@hlos/mcp-sdk/v2/binding';
import {
  HLOS_SURFACE,
  CANONICAL_KERNEL_ERROR_CODES,
  PAID_ERROR_CODE_MAP,
  CONTRACTS_VERSION,
  settleWithHlosKernel,
  createHttpKernelAdapter,
  type FetchLike,
  type FetchResponseLike,
} from '../src/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function response(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): FetchResponseLike {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
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

/** SHA-256 → base64url (matching @hlos-ai/schemas encoding). */
function sha256Base64url(input: string): string {
  const digest = createHash('sha256').update(input).digest();
  return digest
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ===========================================================================
// 1. SURFACE HEADER CONFORMANCE
// ===========================================================================

describe('v2 header conformance', () => {
  it('HLOS_SURFACE is a canonical Surface value from @hlos-ai/schemas', () => {
    expect(SURFACES).toContain(HLOS_SURFACE);
  });

  it('HLOS_SURFACE matches the x402 surface identifier', () => {
    expect(HLOS_SURFACE).toBe('x402');
  });

  it('v2 header names match @hlos/mcp-sdk V2_HEADERS constants', () => {
    // The headers we send must match the SDK's canonical constants
    expect(V2_HEADERS.SURFACE).toBe('X-HLOS-Surface');
    expect(V2_HEADERS.IDEMPOTENCY_KEY).toBe('X-HLOS-Idempotency-Key');
    expect(V2_HEADERS.CORRELATION_ID).toBe('X-HLOS-Correlation-ID');
  });

  it('settleWithHlosKernel sends all required v2 headers', async () => {
    let capturedHeaders: Record<string, string> | undefined;

    const fetchImpl: FetchLike = vi.fn(async (_url: string, init) => {
      capturedHeaders = init?.headers;
      return response(200, {
        success: true,
        receipt_id: 'rcpt_01HZCONFORMANCE000000000000',
      });
    });

    await settleWithHlosKernel({
      apiBaseUrl: 'http://hlos.test',
      fetchImpl,
      skuId: 'test.conform.v1',
      quoteId: 'quote_conform_1',
      paymentSignature: 'sig_conform_1',
      idempotencyKey: 'idem_conform_1',
    });

    expect(capturedHeaders).toBeDefined();
    // Case-insensitive check — we send lowercase, SDK defines Title-Case
    expect(capturedHeaders!['x-hlos-surface']).toBe('x402');
    expect(capturedHeaders!['x-hlos-idempotency-key']).toBe('idem_conform_1');
    expect(capturedHeaders!['x-hlos-correlation-id']).toBe('idem_conform_1');
    expect(capturedHeaders!['content-type']).toBe('application/json');
  });

  it('challenge adapter sends v2 headers', async () => {
    let capturedHeaders: Record<string, string> | undefined;

    const fetchImpl: FetchLike = vi.fn(async (_url: string, init) => {
      capturedHeaders = init?.headers;
      return response(402, {
        error: { code: 'payment_required', payment: {} },
        quote_id: 'quote_challenge_1',
      });
    });

    const adapter = createHttpKernelAdapter({
      baseUrl: 'http://hlos.test',
      fetchImpl,
    });

    await adapter.challenge({
      skuId: 'test.conform.v1',
      channel: 'skills',
      correlationId: 'corr_challenge_1',
      idempotencyKey: 'idem_challenge_1',
      requireStaampid: false,
    });

    expect(capturedHeaders!['x-hlos-surface']).toBe('x402');
    expect(capturedHeaders!['x-hlos-correlation-id']).toBe('corr_challenge_1');
    expect(capturedHeaders!['x-hlos-idempotency-key']).toBe('idem_challenge_1');
  });

  it('correlation ID is stable across settle call (not regenerated)', async () => {
    const capturedCorrelationIds: string[] = [];

    const fetchImpl: FetchLike = vi.fn(async (_url: string, init) => {
      capturedCorrelationIds.push(init?.headers?.['x-hlos-correlation-id'] ?? '');
      return response(200, {
        success: true,
        receipt_id: 'rcpt_stable_corr',
      });
    });

    // Call twice with same explicit idempotency key
    await settleWithHlosKernel({
      apiBaseUrl: 'http://hlos.test',
      fetchImpl,
      skuId: 'test.stable.v1',
      quoteId: 'quote_stable_1',
      paymentSignature: 'sig_stable_1',
      idempotencyKey: 'stable_key_1',
    });
    await settleWithHlosKernel({
      apiBaseUrl: 'http://hlos.test',
      fetchImpl,
      skuId: 'test.stable.v1',
      quoteId: 'quote_stable_1',
      paymentSignature: 'sig_stable_1',
      idempotencyKey: 'stable_key_1',
    });

    // Same idempotency key → same correlation ID on both calls
    expect(capturedCorrelationIds[0]).toBe('stable_key_1');
    expect(capturedCorrelationIds[0]).toBe(capturedCorrelationIds[1]);
  });

  it('headers are not duplicated across adapter methods', async () => {
    const headerSets: Record<string, string>[] = [];

    const fetchImpl: FetchLike = vi.fn(async (_url: string, init) => {
      headerSets.push({ ...init?.headers });
      // Return 402 for challenge, 200 for receipt
      if (headerSets.length === 1) {
        return response(402, {
          error: { code: 'payment_required', payment: {} },
          quote_id: 'q1',
        });
      }
      return response(200, {
        receipt: { receipt_id: 'rcpt_dup_test', content_hash: 'h' },
      });
    });

    const adapter = createHttpKernelAdapter({
      baseUrl: 'http://hlos.test',
      fetchImpl,
    });

    await adapter.challenge({
      skuId: 'test.v1',
      channel: 'skills',
      correlationId: 'corr_1',
      idempotencyKey: 'idem_1',
      requireStaampid: false,
    });

    await adapter.receipt!({
      receiptId: 'rcpt_dup_test',
      idempotencyKey: 'idem_2',
    });

    // Each call has exactly one surface header, not accumulated
    expect(headerSets[0]['x-hlos-surface']).toBe('x402');
    expect(headerSets[1]['x-hlos-surface']).toBe('x402');
    // Correlation IDs are independent per call
    expect(headerSets[0]['x-hlos-correlation-id']).toBe('corr_1');
    expect(headerSets[1]['x-hlos-correlation-id']).toBe('idem_2');
  });

  it('receipt lookup sends v2 surface header', async () => {
    let capturedHeaders: Record<string, string> | undefined;

    const fetchImpl: FetchLike = vi.fn(async (_url: string, init) => {
      capturedHeaders = init?.headers;
      return response(200, {
        receipt: { receipt_id: 'rcpt_test', content_hash: 'hash' },
      });
    });

    const adapter = createHttpKernelAdapter({
      baseUrl: 'http://hlos.test',
      fetchImpl,
    });

    await adapter.receipt!({
      receiptId: 'rcpt_test',
      idempotencyKey: 'idem_receipt_1',
    });

    expect(capturedHeaders!['x-hlos-surface']).toBe('x402');
    expect(capturedHeaders!['x-hlos-correlation-id']).toBe('idem_receipt_1');
  });
});

// ===========================================================================
// 2. ERROR CODE CONFORMANCE
// ===========================================================================

describe('error code conformance', () => {
  it('CANONICAL_KERNEL_ERROR_CODES matches KernelErrorCodeSchema from @hlos-ai/schemas', () => {
    const schemaValues = KernelErrorCodeSchema._def.values as string[];

    // Every canonical code in schemas must be in our set
    for (const code of schemaValues) {
      expect(CANONICAL_KERNEL_ERROR_CODES.has(code)).toBe(true);
    }

    // Our set must not contain codes absent from schemas
    for (const code of CANONICAL_KERNEL_ERROR_CODES) {
      expect(schemaValues).toContain(code);
    }

    // Exact count match
    expect(CANONICAL_KERNEL_ERROR_CODES.size).toBe(schemaValues.length);
  });

  it('PAID_ERROR_CODE_MAP values are all canonical KernelErrorCode', () => {
    for (const [paidCode, canonicalCode] of Object.entries(PAID_ERROR_CODE_MAP)) {
      expect(CANONICAL_KERNEL_ERROR_CODES.has(canonicalCode)).toBe(true);
    }
  });

  it('settlement HTTP status fallbacks all produce canonical error codes', async () => {
    const statusCodes = [400, 401, 402, 403, 404, 409, 429, 500, 502, 503];

    for (const status of statusCodes) {
      const fetchImpl: FetchLike = vi.fn(async () =>
        response(status, { error: { message: 'test' } }),
      );

      try {
        await settleWithHlosKernel({
          apiBaseUrl: 'http://hlos.test',
          fetchImpl,
          skuId: 'test.conform.v1',
          quoteId: 'quote_err_test',
          paymentSignature: 'sig_err_test',
        });
      } catch (err: any) {
        expect(
          CANONICAL_KERNEL_ERROR_CODES.has(err.code),
        ).toBe(true);
      }
    }
  });

  it('non-canonical upstream code falls back deterministically by HTTP status', async () => {
    // If the kernel returns an unknown error code, we must not leak it.
    // Instead we map by HTTP status to a canonical code.
    const fetchImpl: FetchLike = vi.fn(async () =>
      response(418, { error: { code: 'TEAPOT_OVERFLOW', message: 'I am a teapot' } }),
    );

    try {
      await settleWithHlosKernel({
        apiBaseUrl: 'http://hlos.test',
        fetchImpl,
        skuId: 'test.conform.v1',
        quoteId: 'quote_unknown_code',
        paymentSignature: 'sig_unknown_code',
      });
    } catch (err: any) {
      // 418 < 500 → INTERNAL_ERROR (deterministic fallback for non-mapped client errors)
      expect(err.code).toBe('INTERNAL_ERROR');
      expect(CANONICAL_KERNEL_ERROR_CODES.has(err.code)).toBe(true);
      // Original error preserved in details for logging
      expect(err.details.response).toMatchObject({
        error: { code: 'TEAPOT_OVERFLOW' },
      });
    }
  });

  it('5xx with non-canonical code falls back to SERVICE_UNAVAILABLE', async () => {
    const fetchImpl: FetchLike = vi.fn(async () =>
      response(503, { error: { code: 'CUSTOM_OVERLOAD', message: 'overloaded' } }),
    );

    try {
      await settleWithHlosKernel({
        apiBaseUrl: 'http://hlos.test',
        fetchImpl,
        skuId: 'test.conform.v1',
        quoteId: 'quote_5xx',
        paymentSignature: 'sig_5xx',
      });
    } catch (err: any) {
      expect(err.code).toBe('SERVICE_UNAVAILABLE');
    }
  });

  it('upstream canonical error codes pass through unchanged', async () => {
    // Simulate the kernel returning a canonical error code
    const canonicalCodes = [
      'IDEMPOTENCY_CONFLICT',
      'CROSSING_ALREADY_SETTLED',
      'INSUFFICIENT_BALANCE',
      'SPEND_CAP_EXCEEDED',
    ];

    for (const code of canonicalCodes) {
      const fetchImpl: FetchLike = vi.fn(async () =>
        response(409, { error: { code, message: 'test' } }),
      );

      try {
        await settleWithHlosKernel({
          apiBaseUrl: 'http://hlos.test',
          fetchImpl,
          skuId: 'test.conform.v1',
          quoteId: 'quote_passthrough',
          paymentSignature: 'sig_passthrough',
        });
      } catch (err: any) {
        expect(err.code).toBe(code);
      }
    }
  });
});

// ===========================================================================
// 3. RECEIPT SHAPE CONFORMANCE (SignedReceiptV0)
// ===========================================================================

describe('receipt shape conformance', () => {
  it('golden receipt fixture validates against SignedReceiptV0LooseSchema', () => {
    const { receipt } = RECEIPT_HASH_GOLDEN_FIXTURE;
    const result = SignedReceiptV0LooseSchema.safeParse(receipt);
    expect(result.success).toBe(true);
  });

  it('golden receipt fixture passes isSignedReceiptV0 type guard', () => {
    expect(isSignedReceiptV0(RECEIPT_HASH_GOLDEN_FIXTURE.receipt)).toBe(true);
  });

  it('golden crossing settled receipt validates against CrossingSettledReceiptSchema', () => {
    const result = CrossingSettledReceiptSchema.safeParse(
      GOLDEN_FIXTURES.crossingSettledReceipt,
    );
    expect(result.success).toBe(true);
  });

  it('golden crossing settled receipt passes type guard', () => {
    expect(isCrossingSettledReceipt(GOLDEN_FIXTURES.crossingSettledReceipt)).toBe(true);
  });

  it('settlement_authority is always "hlos.ai"', () => {
    expect(SETTLEMENT_AUTHORITY).toBe('hlos.ai');
    expect(GOLDEN_FIXTURES.crossingSettledReceipt.settlement_authority).toBe(
      SETTLEMENT_AUTHORITY,
    );
  });

  it('receipt type URI and version match canonical constants', () => {
    expect(RECEIPT_TYPE_URI).toBe('https://hlos.ai/schema/SignedReceiptV0');
    expect(RECEIPT_VERSION).toBe(0);
    expect(RECEIPT_HASH_GOLDEN_FIXTURE.receipt['@type']).toBe(RECEIPT_TYPE_URI);
    expect(RECEIPT_HASH_GOLDEN_FIXTURE.receipt.version).toBe(RECEIPT_VERSION);
  });

  it('CONTRACTS_VERSION references the schemas version used in conformance', () => {
    expect(CONTRACTS_VERSION).toBe('paid.v1.schemas-0.4.2');
    // If @hlos-ai/schemas is upgraded, this test will fail until CONTRACTS_VERSION
    // is bumped — intentional drift detection.
  });

  it('PaidReceipt fields map to SignedReceiptV0 fields', () => {
    // Document the mapping between @hlos/paid's PaidReceipt and canonical SignedReceiptV0:
    //   PaidReceipt.id       → SignedReceiptV0.receipt_id
    //   PaidReceipt.hash     → receipt_hash (computed over entire SignedReceiptV0 via JCS+SHA-256)
    //                          NOT content_hash (which is only over .content)
    //   PaidReceipt.raw      → full SignedReceiptV0 envelope (when available)
    //
    // This test asserts the golden fixture's structure is consistent with this mapping.
    const { receipt } = RECEIPT_HASH_GOLDEN_FIXTURE;
    expect(typeof receipt.receipt_id).toBe('string');
    expect(typeof receipt.content_hash).toBe('string');
    expect(receipt.content_hash.length).toBe(43); // base64url SHA-256
    expect(receipt.signature.length).toBe(86); // base64url Ed25519
  });
});

// ===========================================================================
// 4. CROSSING HASH CONFORMANCE (Golden Fixtures)
// ===========================================================================

describe('crossing hash conformance', () => {
  it('JCS canonicalization matches @hlos-ai/schemas for crossing hash input', () => {
    const input = GOLDEN_FIXTURES.crossingHashInput;
    const jcs = jcsCanonicalize(input);

    // Compute SHA-256 → base64url
    const hash = sha256Base64url(jcs);

    // Must match the golden expected value
    expect(hash).toBe(
      GOLDEN_FIXTURES.expectedCrossingHash_base64url_sha256_jcs_v0,
    );
  });

  it('receipt hash via node:crypto matches golden expected hash', () => {
    // computeReceiptHash from @hlos-ai/schemas requires @noble/hashes peer dep.
    // We prove equivalence using node:crypto (which @hlos/paid uses at runtime).
    const { receipt, expectedReceiptHash } = RECEIPT_HASH_GOLDEN_FIXTURE;
    const jcs = jcsCanonicalize(receipt);
    const hash = sha256Base64url(jcs);
    expect(hash).toBe(expectedReceiptHash);
  });

  it('JCS canonicalization of receipt matches golden expected JCS', () => {
    const { receipt, expectedJcs } = RECEIPT_HASH_GOLDEN_FIXTURE;
    const jcs = jcsCanonicalize(receipt);
    expect(jcs).toBe(expectedJcs);
  });

  it('our sha256Base64url matches computeReceiptHash for golden fixture', () => {
    // Verify @hlos/paid can reproduce the canonical hash using only node:crypto
    const { receipt, expectedReceiptHash } = RECEIPT_HASH_GOLDEN_FIXTURE;
    const jcs = jcsCanonicalize(receipt);
    const hash = sha256Base64url(jcs);
    expect(hash).toBe(expectedReceiptHash);
  });

  it('JCS produces identical hash regardless of key order or whitespace', () => {
    // This is the core invariant: JCS canonicalization eliminates key-order
    // and whitespace differences. If this fails, our hash would drift.
    const fixture = GOLDEN_FIXTURES.crossingHashInput;

    // Rebuild with keys in reverse order and extra whitespace in JSON
    const reversed = JSON.parse(
      JSON.stringify({
        attested_receipt_id: fixture.attested_receipt_id,
        snapshot: {
          credential_source: fixture.snapshot.credential_source,
          funding_source: fixture.snapshot.funding_source,
          attribution_org_id: fixture.snapshot.attribution_org_id,
          access_grant_id: fixture.snapshot.access_grant_id,
          access_window_id: fixture.snapshot.access_window_id,
          event_id: fixture.snapshot.event_id,
          passportId: fixture.snapshot.passportId,
          capabilityId: fixture.snapshot.capabilityId,
          crossingId: fixture.snapshot.crossingId,
        },
        v: fixture.v,
      }),
    );

    const hashOriginal = sha256Base64url(jcsCanonicalize(fixture));
    const hashReversed = sha256Base64url(jcsCanonicalize(reversed));

    expect(hashOriginal).toBe(hashReversed);
    expect(hashOriginal).toBe(
      GOLDEN_FIXTURES.expectedCrossingHash_base64url_sha256_jcs_v0,
    );
  });
});

// ===========================================================================
// 5. IDEMPOTENCY KEY CONFORMANCE
// ===========================================================================

describe('idempotency key conformance', () => {
  it('SDK generateV2IdempotencyKey produces deterministic keys', () => {
    const body = { quote_id: 'q1', sku_id: 's1' };
    const key1 = generateV2IdempotencyKey('POST', '/api/v2/x402/settle', body);
    const key2 = generateV2IdempotencyKey('POST', '/api/v2/x402/settle', body);
    expect(key1).toBe(key2);
  });

  it('SDK idempotency keys have expected format', () => {
    const key = generateV2IdempotencyKey('POST', '/api/v2/x402/settle', { quote_id: 'q1' });
    expect(key).toMatch(/^idem_v2_[0-9a-f]+$/);
  });

  it('@hlos/paid settle idempotency key is deterministic for same inputs', async () => {
    const settlements: string[] = [];

    const fetchImpl: FetchLike = vi.fn(async (_url: string, init) => {
      const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      settlements.push(body.request_id as string);
      return response(200, {
        success: true,
        receipt_id: 'rcpt_idem_conform_1',
      });
    });

    // Call twice with same inputs (no explicit idempotencyKey → derived)
    await settleWithHlosKernel({
      apiBaseUrl: 'http://hlos.test',
      fetchImpl,
      skuId: 'sku.idem.v1',
      quoteId: 'quote_idem_1',
      paymentSignature: 'sig_idem_1',
    });
    await settleWithHlosKernel({
      apiBaseUrl: 'http://hlos.test',
      fetchImpl,
      skuId: 'sku.idem.v1',
      quoteId: 'quote_idem_1',
      paymentSignature: 'sig_idem_1',
    });

    // Both calls must produce the same derived idempotency key
    expect(settlements[0]).toBe(settlements[1]);
    expect(settlements[0]).toMatch(/^settle:sku\.idem\.v1:/);
  });

  it('@hlos/paid settle idempotency key differs for different inputs', async () => {
    const settlements: string[] = [];

    const fetchImpl: FetchLike = vi.fn(async (_url: string, init) => {
      const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      settlements.push(body.request_id as string);
      return response(200, { success: true, receipt_id: 'rcpt_idem_differ' });
    });

    await settleWithHlosKernel({
      apiBaseUrl: 'http://hlos.test',
      fetchImpl,
      skuId: 'sku.idem.v1',
      quoteId: 'quote_a',
      paymentSignature: 'sig_a',
    });
    await settleWithHlosKernel({
      apiBaseUrl: 'http://hlos.test',
      fetchImpl,
      skuId: 'sku.idem.v1',
      quoteId: 'quote_b',
      paymentSignature: 'sig_b',
    });

    expect(settlements[0]).not.toBe(settlements[1]);
  });

  it('documents divergence: @hlos/paid uses settle: prefix, SDK uses idem_v2_ prefix', () => {
    // This test documents the known format divergence between:
    // - @hlos/paid: "settle:{skuId}:{sha256(quoteId:sig)[0..24]}"
    // - @hlos/mcp-sdk: "idem_v2_{sha256(method+path+body)}"
    //
    // Both are deterministic. The kernel accepts both formats.
    // Phase 5/6 roadmap: optionally adopt SDK format when @hlos/mcp-sdk
    // is added as a peer dependency.
    const sdkKey = generateV2IdempotencyKey(
      'POST',
      '/api/v2/x402/settle',
      { quote_id: 'q1', sku_id: 's1' },
    );
    expect(sdkKey).toMatch(/^idem_v2_/);
    // @hlos/paid's format is documented in PROTOCOL.md
    // settle:{skuId}:{sha256(quoteId:paymentSignature)[0..24]}
  });

  it('@hlos/paid settle key has stable prefix and never claims SDK format', async () => {
    const settlements: string[] = [];

    const fetchImpl: FetchLike = vi.fn(async (_url: string, init) => {
      const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      settlements.push(body.request_id as string);
      return response(200, { success: true, receipt_id: 'rcpt_prefix_test' });
    });

    await settleWithHlosKernel({
      apiBaseUrl: 'http://hlos.test',
      fetchImpl,
      skuId: 'sku.prefix.v1',
      quoteId: 'quote_prefix_1',
      paymentSignature: 'sig_prefix_1',
    });

    const key = settlements[0];
    // Must have the stable "settle:" prefix so it can evolve without ambiguity
    expect(key).toMatch(/^settle:/);
    // Must NOT claim to be SDK v2 format (prevents accidental interchangeability)
    expect(key).not.toMatch(/^idem_v2_/);
    // Must contain the SKU ID for scoping
    expect(key).toContain('sku.prefix.v1');
  });

  it('X-HLOS-Idempotency-Key header uses the derived key, never random', async () => {
    let capturedIdempotencyKey: string | undefined;

    const fetchImpl: FetchLike = vi.fn(async (_url: string, init) => {
      capturedIdempotencyKey = init?.headers?.['x-hlos-idempotency-key'];
      return response(200, { success: true, receipt_id: 'rcpt_idem_header' });
    });

    await settleWithHlosKernel({
      apiBaseUrl: 'http://hlos.test',
      fetchImpl,
      skuId: 'sku.idem.v1',
      quoteId: 'quote_idem_hdr',
      paymentSignature: 'sig_idem_hdr',
    });

    // Header must be present and deterministic (not a random UUID)
    expect(capturedIdempotencyKey).toBeDefined();
    expect(capturedIdempotencyKey).toMatch(/^settle:sku\.idem\.v1:/);
    expect(capturedIdempotencyKey).not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
