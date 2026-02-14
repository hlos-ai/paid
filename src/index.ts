import { createHash, randomUUID } from 'node:crypto';

export type PaidChannel = 'mcp' | 'skills' | 'bazaar' | 'enterprise';

export interface PaidConfig {
  skuId: string;
  channel?: PaidChannel;
  requireStaampid?: boolean;
  minTrustScore?: number;
  sandbox?: boolean;
  envelope?: boolean;
  apiBaseUrl?: string;
  fetchImpl?: FetchLike;
  adapter?: PaidKernelAdapter;
}

export interface PaidPayment {
  status: 'settled' | 'sandbox';
  quote_id?: string;
  sighash: string;
  request_id?: string;
  verification_url?: string;
  raw?: unknown;
}

export interface PaidReceipt {
  id: string;
  hash?: string;
  verification_url?: string;
  raw?: unknown;
}

export interface PaidContext {
  channel?: PaidChannel;
  request?: {
    url?: string;
  } | null;
  headers?: HeaderBag;
  actorId?: string;
  meta?: Record<string, unknown>;
  request_id?: string;
  correlationId?: string;
  toolCallId?: string | number;
  idempotency_key?: string;
  authority?: {
    staampid?: string | null;
    trustScore?: number | null;
  };
  policy?: {
    allowed_sku_ids?: string[];
    allowedSkuIds?: string[];
    [key: string]: unknown;
  };
  paymentProof?: Record<string, unknown>;
  __hlos?: Record<string, unknown>;
  payment?: PaidPayment;
  receipt?: PaidReceipt;
  paid?: {
    skuId: string;
    channel: PaidChannel;
    sandbox: boolean;
    idempotencyKey: string;
  };
  apiBaseUrl?: string;
}

export interface PaidEnvelope<T> {
  ok: true;
  result: T;
  receipt?: PaidReceipt;
  payment?: PaidPayment;
}

export type PaidHandler<Ctx extends PaidContext, Input, Output> = (
  ctx: Ctx,
  input: Input
) => Promise<Output> | Output;

export interface ChallengeInput {
  skuId: string;
  channel: PaidChannel;
  correlationId: string;
  idempotencyKey: string;
  requireStaampid: boolean;
  minTrustScore?: number;
}

export interface PaymentRequiredChallenge {
  payment_required: unknown;
  quote_id?: string;
  payment_required_header?: string;
  raw?: unknown;
}

export interface SettleInput {
  skuId: string;
  quoteId: string;
  paymentSignature: string;
  idempotencyKey: string;
}

export interface SettleResult {
  receiptId: string;
  receiptHash?: string;
  paymentSigHash: string;
  verificationUrl?: string;
  requestId: string;
  raw?: unknown;
}

export interface SettleRetryHlosPayload {
  quote_id: string;
  payment_signature: string;
  receipt_id: string;
  receipt_hash?: string;
  request_id: string;
}

export interface SettleWithHlosKernelResult {
  settlement: SettleResult;
  __hlos: SettleRetryHlosPayload;
}

export interface ReceiptLookupInput {
  receiptId?: string;
  requestId?: string;
  idempotencyKey: string;
  paymentSignature?: string;
}

export interface ReceiptEnvelope {
  id: string;
  hash?: string;
  verification_url?: string;
  raw?: unknown;
}

export interface PaidKernelAdapter {
  challenge(input: ChallengeInput): Promise<PaymentRequiredChallenge>;
  settle?(input: SettleInput): Promise<SettleResult>;
  receipt?(input: ReceiptLookupInput): Promise<ReceiptEnvelope | null>;
}

interface PaidProof {
  quoteId?: string;
  paymentSignature?: string;
  receiptId?: string;
  receiptHash?: string;
  requestId?: string;
  clientTag?: string;
  toolCallId?: string;
  staampid?: string;
  trustScore?: number;
}

export type HeaderBag =
  | Record<string, string | string[] | undefined>
  | {
      get(name: string): string | null;
    };

type FetchInitLike = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

type FetchHeadersLike = {
  get(name: string): string | null;
};

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers?: FetchHeadersLike | Record<string, string | string[] | undefined>;
  json(): Promise<unknown>;
  text?(): Promise<string>;
}

export type FetchLike = (url: string, init?: FetchInitLike) => Promise<FetchResponseLike>;

export class PaidError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'PaidError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class PaymentRequiredError extends PaidError {
  readonly payment_required: unknown;
  readonly quote_id?: string;
  readonly payment_required_header?: string;
  readonly hlos: {
    skuId: string;
    channel: PaidChannel;
    correlationId: string;
    idempotencyKey: string;
  };

  constructor(params: {
    message: string;
    payment_required: unknown;
    quote_id?: string;
    payment_required_header?: string;
    hlos: {
      skuId: string;
      channel: PaidChannel;
      correlationId: string;
      idempotencyKey: string;
    };
  }) {
    super('PAYMENT_REQUIRED', params.message, 402, params.payment_required);
    this.name = 'PaymentRequiredError';
    this.payment_required = params.payment_required;
    this.quote_id = params.quote_id;
    this.payment_required_header = params.payment_required_header;
    this.hlos = params.hlos;
  }
}

export class ForbiddenError extends PaidError {
  constructor(message: string, details?: unknown) {
    super('FORBIDDEN', message, 403, details);
    this.name = 'ForbiddenError';
  }
}

export class MissingIdempotencyKeyError extends PaidError {
  constructor(message: string) {
    super('MISSING_IDEMPOTENCY_KEY', message, 400);
    this.name = 'MissingIdempotencyKeyError';
  }
}

interface CacheEntry {
  proofHash: string;
  payment: PaidPayment;
  receipt: PaidReceipt;
}

const SETTLEMENT_CACHE_MAX = 10_000;
const settlementCache = new Map<string, CacheEntry>();

function settlementCacheGet(key: string): CacheEntry | undefined {
  const entry = settlementCache.get(key);
  if (entry) {
    // Refresh recency (LRU-ish): delete + re-insert moves key to end of insertion order
    settlementCache.delete(key);
    settlementCache.set(key, entry);
  }
  return entry;
}

function settlementCacheSet(key: string, entry: CacheEntry): void {
  settlementCache.set(key, entry);
  // Evict oldest entry if over capacity
  if (settlementCache.size > SETTLEMENT_CACHE_MAX) {
    const oldest = settlementCache.keys().next().value;
    if (oldest !== undefined) {
      settlementCache.delete(oldest);
    }
  }
}

export function resetPaidIdempotencyCache(): void {
  settlementCache.clear();
}

export function isPaidError(error: unknown): error is PaidError {
  return error instanceof PaidError;
}

export function isPaymentRequiredError(error: unknown): error is PaymentRequiredError {
  return error instanceof PaymentRequiredError;
}

export function isForbiddenError(error: unknown): error is ForbiddenError {
  return error instanceof ForbiddenError;
}

interface HttpErrorResponse {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

export function toHttpErrorResponse(error: PaidError): HttpErrorResponse {
  if (error instanceof PaymentRequiredError) {
    const body: Record<string, unknown> = {
      error: {
        code: 'payment_required',
        message: error.message,
        payment: error.payment_required,
      },
      payment_required: error.payment_required,
      hlos: error.hlos,
    };

    if (error.quote_id) {
      body.quote_id = error.quote_id;
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };

    if (error.payment_required_header) {
      headers['payment-required'] = error.payment_required_header;
    }

    return {
      status: 402,
      body,
      headers,
    };
  }

  return {
    status: error.status,
    body: {
      error: {
        code: error.code.toLowerCase(),
        message: error.message,
        details: error.details,
      },
    },
    headers: {
      'content-type': 'application/json',
    },
  };
}

export interface McpPaymentRequiredPayload {
  code: 'PAYMENT_REQUIRED';
  message: string;
  payment_required: unknown;
  hlos: {
    skuId: string;
    channel: PaidChannel;
    correlationId: string;
  };
}

export interface McpForbiddenPayload {
  code: 'FORBIDDEN';
  message: string;
  hlos: {
    skuId: string;
    channel: PaidChannel;
    correlationId: string;
  };
}

export function toMcpPaymentRequired(error: PaymentRequiredError): McpPaymentRequiredPayload {
  return {
    code: 'PAYMENT_REQUIRED',
    message: error.message,
    payment_required: error.payment_required,
    hlos: {
      skuId: error.hlos.skuId,
      channel: error.hlos.channel,
      correlationId: error.hlos.correlationId,
    },
  };
}

export function toMcpForbidden(
  error: ForbiddenError,
  context: { skuId: string; channel: PaidChannel; correlationId: string }
): McpForbiddenPayload {
  return {
    code: 'FORBIDDEN',
    message: error.message,
    hlos: {
      skuId: context.skuId,
      channel: context.channel,
      correlationId: context.correlationId,
    },
  };
}

export function toMcpToolErrorResult(
  payload: McpPaymentRequiredPayload | McpForbiddenPayload | Record<string, unknown>
): {
  isError: true;
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  const record: Record<string, unknown> =
    typeof payload === 'object' && payload !== null && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : { value: payload };

  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(record) }],
    structuredContent: record,
  };
}

export function applyPaidResponseHeaders(
  target: { set(name: string, value: string): void } | Record<string, string>,
  ctx: PaidContext
): void {
  const setHeader = (name: string, value: string): void => {
    if (typeof (target as { set?: unknown }).set === 'function') {
      (target as { set(name: string, value: string): void }).set(name, value);
      return;
    }
    (target as Record<string, string>)[name] = value;
  };

  if (ctx.receipt?.id) {
    setHeader('x-hlos-receipt-id', ctx.receipt.id);
  }
  if (ctx.receipt?.hash) {
    setHeader('x-hlos-receipt-hash', ctx.receipt.hash);
  }
  if (ctx.payment?.sighash) {
    setHeader('x-hlos-payment-sighash', ctx.payment.sighash);
  }
}

export function paid(config: PaidConfig) {
  if (!config?.skuId) {
    throw new Error('paid(config) requires config.skuId');
  }

  return function wrap<Ctx extends PaidContext, Input, Output>(
    handler: PaidHandler<Ctx, Input, Output>
  ) {
    return async function wrapped(
      ctx: Ctx,
      input: Input
    ): Promise<Output | PaidEnvelope<Output>> {
      const channel = config.channel ?? ctx.channel ?? 'skills';
      const proof = resolveProof(ctx, input);

      enforcePolicy({
        ctx,
        skuId: config.skuId,
      });

      enforceAuthority({
        ctx,
        proof,
        requireStaampid: config.requireStaampid,
        minTrustScore: config.minTrustScore,
      });

      const idempotencyKey = resolveIdempotencyKey({
        channel,
        skuId: config.skuId,
        ctx,
        proof,
      });

      const correlationId =
        ctx.correlationId ??
        ctx.request_id ??
        proof.requestId ??
        proof.clientTag ??
        randomUUID();

      const adapter =
        config.adapter ??
        createHttpKernelAdapter({
          baseUrl: resolveBaseUrl(config.apiBaseUrl ?? ctx.apiBaseUrl, ctx),
          fetchImpl: config.fetchImpl,
        });

      const cacheHit = settlementCacheGet(idempotencyKey);
      let payment: PaidPayment;
      let receipt: PaidReceipt;

      if (config.sandbox) {
        const sandboxProofHash = sha256Hex(`${config.skuId}:${idempotencyKey}:sandbox`);
        if (cacheHit) {
          if (cacheHit.proofHash !== sandboxProofHash) {
            throw new PaidError(
              'IDEMPOTENCY_CONFLICT',
              'Idempotency key was already used with a different payment proof',
              409,
              { idempotency_key: idempotencyKey }
            );
          }
          payment = cacheHit.payment;
          receipt = cacheHit.receipt;
        } else {
          const sandbox = buildSandboxArtifacts(config.skuId, idempotencyKey);
          payment = sandbox.payment;
          receipt = sandbox.receipt;
          settlementCacheSet(idempotencyKey, {
            proofHash: sandboxProofHash,
            payment,
            receipt,
          });
        }
      } else {
        if (!hasSettlementProof(proof)) {
          throw await createPaymentRequiredError({
            adapter,
            skuId: config.skuId,
            channel,
            correlationId,
            idempotencyKey,
            requireStaampid: Boolean(config.requireStaampid),
            minTrustScore: config.minTrustScore,
          });
        }

        const proofHash = sha256Hex(
          [
            proof.paymentSignature,
            proof.quoteId ?? '',
            proof.receiptId ?? '',
            proof.receiptHash ?? '',
            proof.requestId ?? '',
            proof.clientTag ?? '',
          ].join(':')
        );

        if (cacheHit) {
          if (cacheHit.proofHash !== proofHash) {
            throw new PaidError(
              'IDEMPOTENCY_CONFLICT',
              'Idempotency key was already used with a different payment proof',
              409,
              { idempotency_key: idempotencyKey }
            );
          }

          payment = cacheHit.payment;
          receipt = cacheHit.receipt;
        } else {
          receipt = await resolveReceiptFromExternalSettlement({
            adapter,
            proof,
            idempotencyKey,
            paymentSignature: proof.paymentSignature!,
          });

          payment = {
            status: 'settled',
            quote_id: proof.quoteId,
            sighash: sha256Hex(proof.paymentSignature!),
            request_id: proof.requestId ?? proof.clientTag ?? idempotencyKey,
            verification_url: receipt.verification_url,
            raw: {
              settlement: 'external',
              receipt_id: receipt.id,
            },
          };

          settlementCacheSet(idempotencyKey, {
            proofHash,
            payment,
            receipt,
          });
        }
      }

      ctx.payment = payment;
      ctx.receipt = receipt;
      ctx.paid = {
        skuId: config.skuId,
        channel,
        sandbox: Boolean(config.sandbox),
        idempotencyKey,
      };

      const handlerInput = stripReservedInput(input);
      const result = await handler(ctx, handlerInput);

      if (config.envelope) {
        return {
          ok: true,
          result,
          payment,
          receipt,
        };
      }

      return result;
    };
  };
}

export interface HttpKernelAdapterConfig {
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

export interface SettleWithHlosKernelInput {
  skuId: string;
  quoteId?: string;
  challenge?: PaymentRequiredChallenge | Record<string, unknown>;
  paymentSignature: string;
  idempotencyKey?: string;
  apiBaseUrl?: string;
  fetchImpl?: FetchLike;
  capabilityId?: string;
  walletId?: string;
}

export async function settleWithHlosKernel(
  input: SettleWithHlosKernelInput
): Promise<SettleWithHlosKernelResult> {
  const fetchImpl = resolveFetch(input.fetchImpl);
  const baseUrl = normalizeBaseUrl(input.apiBaseUrl ?? envOrUndefined('HLOS_BASE_URL') ?? 'http://localhost:3000');
  const quoteId = resolveSettleQuoteId(input.quoteId, input.challenge);

  if (!quoteId) {
    throw new PaidError(
      'SETTLEMENT_MISSING_QUOTE_ID',
      'quoteId is required. Pass quoteId directly or provide a challenge containing quote_id.',
      400,
      {
        sku_id: input.skuId,
      }
    );
  }

  const requestId =
    input.idempotencyKey ?? deriveSettleIdempotencyKey(input.skuId, quoteId, input.paymentSignature);

  let response: FetchResponseLike;
  try {
    response = await fetchImpl(`${baseUrl}/api/v2/x402/settle`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'payment-signature': input.paymentSignature,
      },
      body: JSON.stringify({
        quote_id: quoteId,
        sku_id: input.skuId,
        request_id: requestId,
        capability_id: input.capabilityId,
        wallet_id: input.walletId,
      }),
    });
  } catch (error) {
    throw new PaidError(
      'SETTLEMENT_NETWORK_ERROR',
      'Failed to reach HLOS settlement endpoint',
      502,
      {
        sku_id: input.skuId,
        quote_id: quoteId,
        request_id: requestId,
        cause: serializeUnknownError(error),
      }
    );
  }

  const body = await safeResponseBody(response);
  if (!response.ok) {
    const errorEnvelope = readRecord(readUnknown(readRecord(body), 'error'));
    const code = mapSettlementErrorCode(response.status, readString(errorEnvelope, 'code'));
    const message =
      readString(errorEnvelope, 'message') ?? defaultSettlementErrorMessage(response.status);

    throw new PaidError(code, message, response.status, {
      sku_id: input.skuId,
      quote_id: quoteId,
      request_id: requestId,
      response: body,
    });
  }

  const receiptId =
    readString(readRecord(body), 'receipt_id') ??
    getHeader(response.headers, 'x-hlos-receipt-id') ??
    `receipt_${sha256Hex(`${requestId}:${input.paymentSignature}`).slice(0, 16)}`;

  const receiptHash =
    readString(readRecord(body), 'receipt_hash') ??
    readString(readRecord(readUnknown(readRecord(body), 'receipt')), 'content_hash') ??
    undefined;

  const verificationUrl = readString(readRecord(body), 'verification_url') ?? undefined;

  const settlement: SettleResult = {
    receiptId,
    receiptHash,
    paymentSigHash: sha256Hex(input.paymentSignature),
    verificationUrl,
    requestId,
    raw: body,
  };

  return {
    settlement,
    __hlos: {
      quote_id: quoteId,
      payment_signature: input.paymentSignature,
      receipt_id: settlement.receiptId,
      ...(settlement.receiptHash ? { receipt_hash: settlement.receiptHash } : {}),
      request_id: settlement.requestId,
    },
  };
}

export function createHttpKernelAdapter(config: HttpKernelAdapterConfig = {}): PaidKernelAdapter {
  const fetchImpl = resolveFetch(config.fetchImpl);
  const baseUrl = normalizeBaseUrl(config.baseUrl ?? envOrUndefined('HLOS_BASE_URL') ?? 'http://localhost:3000');

  return {
    async challenge(input: ChallengeInput): Promise<PaymentRequiredChallenge> {
      const response = await fetchImpl(`${baseUrl}/api/v2/x402/challenge`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sku_id: input.skuId,
          staampid: {
            required: input.requireStaampid,
            min_trust_score: input.minTrustScore ?? 300,
            envelope_required: false,
          },
        }),
      });

      const body = await safeResponseBody(response);
      if (response.status !== 402) {
        throw new PaidError(
          'PAYMENT_CHALLENGE_FAILED',
          'Failed to obtain payment challenge',
          502,
          body
        );
      }

      const paymentRequired =
        readUnknown(readRecord(readUnknown(readRecord(body), 'error')), 'payment') ??
        readUnknown(readRecord(body), 'payment_required') ??
        {};

      return {
        payment_required: paymentRequired,
        quote_id: readString(readRecord(body), 'quote_id'),
        payment_required_header: getHeader(response.headers, 'payment-required'),
        raw: body,
      };
    },

    async settle(_input: SettleInput): Promise<SettleResult> {
      throw new PaidError(
        'EXTERNAL_SETTLEMENT_REQUIRED',
        'paid() does not call /api/v2/x402/settle. Settle externally and pass proof via __hlos.',
        400
      );
    },

    async receipt(input: ReceiptLookupInput): Promise<ReceiptEnvelope | null> {
      if (!input.receiptId && !input.requestId) {
        return null;
      }

      const url = new URL('/api/v2/x402/receipt', baseUrl);
      if (input.receiptId) {
        url.searchParams.set('receipt_id', input.receiptId);
      } else if (input.requestId) {
        url.searchParams.set('request_id', input.requestId);
      }

      const response = await fetchImpl(url.toString(), {
        method: 'GET',
      });

      if (!response.ok) {
        return null;
      }

      const body = await safeResponseBody(response);
      const receiptRecord = readRecord(readUnknown(readRecord(body), 'receipt'));
      const id =
        readString(receiptRecord, 'receipt_id') ??
        readString(receiptRecord, 'id') ??
        input.receiptId ??
        undefined;

      if (!id) {
        return null;
      }

      const hash =
        readString(receiptRecord, 'content_hash') ??
        readString(receiptRecord, 'contentHash') ??
        undefined;

      const verificationUrl =
        readString(receiptRecord, 'verification_url') ??
        readString(readRecord(body), 'verification_url') ??
        undefined;

      return {
        id,
        hash,
        verification_url: verificationUrl,
        raw: receiptRecord,
      };
    },
  };
}

async function createPaymentRequiredError(params: {
  adapter: PaidKernelAdapter;
  skuId: string;
  channel: PaidChannel;
  correlationId: string;
  idempotencyKey: string;
  requireStaampid: boolean;
  minTrustScore?: number;
}): Promise<PaymentRequiredError> {
  const challenge = await params.adapter.challenge({
    skuId: params.skuId,
    channel: params.channel,
    correlationId: params.correlationId,
    idempotencyKey: params.idempotencyKey,
    requireStaampid: params.requireStaampid,
    minTrustScore: params.minTrustScore,
  });

  return new PaymentRequiredError({
    message: 'Payment is required before this invocation can execute',
    payment_required: challenge.payment_required ?? {},
    quote_id: challenge.quote_id,
    payment_required_header: challenge.payment_required_header,
    hlos: {
      skuId: params.skuId,
      channel: params.channel,
      correlationId: params.correlationId,
      idempotencyKey: params.idempotencyKey,
    },
  });
}

async function resolveReceiptFromExternalSettlement(params: {
  adapter: PaidKernelAdapter;
  proof: PaidProof;
  idempotencyKey: string;
  paymentSignature: string;
}): Promise<PaidReceipt> {
  const lookup =
    params.adapter.receipt && (params.proof.receiptId || params.proof.requestId || params.proof.clientTag)
      ? await params.adapter.receipt({
          receiptId: params.proof.receiptId,
          requestId: params.proof.requestId ?? params.proof.clientTag,
          idempotencyKey: params.idempotencyKey,
          paymentSignature: params.paymentSignature,
        })
      : null;

  const id =
    firstString(params.proof.receiptId, lookup?.id) ??
    `external_${sha256Hex(`${params.idempotencyKey}:${params.paymentSignature}`).slice(0, 24)}`;

  return {
    id,
    hash: firstString(params.proof.receiptHash, lookup?.hash),
    verification_url: lookup?.verification_url,
    raw: lookup?.raw ?? {
      settlement: 'external',
    },
  };
}

function hasSettlementProof(proof: PaidProof): boolean {
  return Boolean(
    proof.paymentSignature &&
      (proof.receiptId || proof.receiptHash || proof.requestId || proof.clientTag)
  );
}

function resolveBaseUrl(configBaseUrl: string | undefined, ctx: PaidContext): string {
  const fromContextRequest = ctx.request?.url ? new URL(ctx.request.url).origin : undefined;
  return normalizeBaseUrl(configBaseUrl ?? fromContextRequest ?? envOrUndefined('HLOS_BASE_URL') ?? 'http://localhost:3000');
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/$/, '');
}

function envOrUndefined(name: string): string | undefined {
  if (typeof process !== 'undefined' && typeof process.env === 'object') {
    return process.env[name] ?? undefined;
  }
  return undefined;
}

function resolveSettleQuoteId(
  directQuoteId: string | undefined,
  challenge: PaymentRequiredChallenge | Record<string, unknown> | undefined
): string | undefined {
  if (!challenge) {
    return directQuoteId;
  }

  const challengeRecord = readRecord(challenge);
  const challengeRaw = readRecord(readUnknown(challengeRecord, 'raw'));

  return firstString(
    directQuoteId,
    readString(challengeRecord, 'quote_id'),
    readString(challengeRaw, 'quote_id'),
    readString(readRecord(readUnknown(challengeRecord, 'hlos')), 'quote_id'),
    readString(readRecord(readUnknown(challengeRecord, 'error')), 'quote_id')
  );
}

function deriveSettleIdempotencyKey(
  skuId: string,
  quoteId: string,
  paymentSignature: string
): string {
  return `settle:${skuId}:${sha256Hex(`${quoteId}:${paymentSignature}`).slice(0, 24)}`;
}

function mapSettlementErrorCode(status: number, upstreamCode: string | undefined): string {
  const normalized = normalizeErrorCode(upstreamCode);
  if (normalized) {
    return normalized;
  }

  switch (status) {
    case 400:
      return 'SETTLEMENT_BAD_REQUEST';
    case 401:
      return 'SETTLEMENT_UNAUTHORIZED';
    case 402:
      return 'PAYMENT_REQUIRED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'SETTLEMENT_NOT_FOUND';
    case 409:
      return 'SETTLEMENT_CONFLICT';
    case 429:
      return 'RATE_LIMITED';
    default:
      return status >= 500 ? 'SETTLEMENT_UPSTREAM_ERROR' : 'SETTLEMENT_FAILED';
  }
}

function defaultSettlementErrorMessage(status: number): string {
  switch (status) {
    case 400:
      return 'Settlement request is invalid';
    case 401:
      return 'Settlement request is unauthorized';
    case 402:
      return 'Payment is still required to settle this quote';
    case 403:
      return 'Settlement is forbidden';
    case 404:
      return 'Settlement quote was not found';
    case 409:
      return 'Settlement conflict';
    case 429:
      return 'Settlement rate limited';
    default:
      return status >= 500 ? 'Settlement upstream error' : 'Payment settlement failed';
  }
}

function normalizeErrorCode(value: string | undefined): string | undefined {
  if (!value || value.trim().length === 0) {
    return undefined;
  }

  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();

  return normalized.length > 0 ? normalized : undefined;
}

function serializeUnknownError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  if (typeof error === 'string') {
    return {
      message: error,
    };
  }

  return {
    value: error,
  };
}

function resolveFetch(fetchImpl?: FetchLike): FetchLike {
  if (fetchImpl) return fetchImpl;

  const candidate = (globalThis as { fetch?: unknown }).fetch;
  if (typeof candidate !== 'function') {
    throw new Error('No fetch implementation available. Pass config.fetchImpl.');
  }

  return candidate as FetchLike;
}

function resolveProof<Input>(ctx: PaidContext, input: Input): PaidProof {
  const inputHlos = readReservedHlos(input);
  const contextHlos = isRecord(ctx.__hlos) ? ctx.__hlos : undefined;
  const contextProof = isRecord(ctx.paymentProof) ? ctx.paymentProof : undefined;

  const paymentSignature =
    firstString(
      readString(contextProof, 'payment_signature'),
      readString(contextProof, 'paymentSignature'),
      readString(contextHlos, 'payment_signature'),
      readString(inputHlos, 'payment_signature'),
      readString(inputHlos, 'paymentSignature'),
      getHeader(ctx.headers, 'payment-signature'),
      getHeader(ctx.headers, 'x-hlos-payment-signature')
    ) ??
    undefined;

  const quoteId =
    firstString(
      readString(contextProof, 'quote_id'),
      readString(contextProof, 'quoteId'),
      readString(contextHlos, 'quote_id'),
      readString(inputHlos, 'quote_id'),
      readString(inputHlos, 'quoteId')
    ) ??
    undefined;

  const receiptId =
    firstString(
      readString(contextProof, 'receipt_id'),
      readString(contextProof, 'receiptId'),
      readString(contextHlos, 'receipt_id'),
      readString(inputHlos, 'receipt_id'),
      readString(inputHlos, 'receiptId'),
      getHeader(ctx.headers, 'x-hlos-receipt-id')
    ) ??
    undefined;

  const receiptHash =
    firstString(
      readString(contextProof, 'receipt_hash'),
      readString(contextProof, 'receiptHash'),
      readString(contextHlos, 'receipt_hash'),
      readString(inputHlos, 'receipt_hash'),
      readString(inputHlos, 'receiptHash'),
      getHeader(ctx.headers, 'x-hlos-receipt-hash')
    ) ??
    undefined;

  const requestId =
    firstString(
      ctx.request_id,
      readString(contextProof, 'request_id'),
      readString(contextProof, 'requestId'),
      readString(contextHlos, 'request_id'),
      readString(inputHlos, 'request_id'),
      readString(inputHlos, 'requestId'),
      getHeader(ctx.headers, 'x-request-id'),
      getHeader(ctx.headers, 'x-hlos-request-id')
    ) ??
    undefined;

  const clientTag =
    firstString(
      readString(contextProof, 'client_tag'),
      readString(contextProof, 'clientTag'),
      readString(contextHlos, 'client_tag'),
      readString(inputHlos, 'client_tag'),
      readString(inputHlos, 'clientTag')
    ) ??
    undefined;

  const toolCallId =
    firstString(
      readString(contextProof, 'tool_call_id'),
      readString(contextProof, 'toolCallId'),
      readString(contextHlos, 'tool_call_id'),
      readString(inputHlos, 'tool_call_id')
    ) ??
    undefined;

  const staampid =
    firstString(
      ctx.authority?.staampid ?? undefined,
      readString(contextProof, 'staampid'),
      readString(contextHlos, 'staampid'),
      readString(inputHlos, 'staampid'),
      getHeader(ctx.headers, 'x-staampid')
    ) ??
    undefined;

  const trustScore =
    firstNumber(
      ctx.authority?.trustScore ?? undefined,
      readNumber(contextProof, 'trust_score'),
      readNumber(contextProof, 'trustScore'),
      readNumber(contextHlos, 'trust_score'),
      readNumber(inputHlos, 'trust_score'),
      parseInteger(getHeader(ctx.headers, 'x-staampid-trust'))
    ) ??
    undefined;

  return {
    quoteId,
    paymentSignature,
    receiptId,
    receiptHash,
    requestId,
    clientTag,
    toolCallId,
    staampid,
    trustScore,
  };
}

function resolveIdempotencyKey(params: {
  channel: PaidChannel;
  skuId: string;
  ctx: PaidContext;
  proof: PaidProof;
}): string {
  if (params.ctx.idempotency_key) {
    return params.ctx.idempotency_key;
  }

  if (params.channel === 'mcp') {
    const toolCallId =
      params.ctx.toolCallId ??
      params.proof.toolCallId ??
      params.ctx.correlationId ??
      params.ctx.request_id ??
      params.proof.requestId;

    if (toolCallId === undefined || toolCallId === null || `${toolCallId}`.trim() === '') {
      throw new MissingIdempotencyKeyError(
        'MCP invocations require toolCallId (or equivalent) to derive idempotency key'
      );
    }

    return `mcp:${params.skuId}:${String(toolCallId)}`;
  }

  const stableRequestId = params.ctx.request_id ?? params.proof.requestId ?? params.proof.clientTag;

  if (!stableRequestId) {
    throw new MissingIdempotencyKeyError(
      'Skills invocations require ctx.request_id or __hlos.client_tag'
    );
  }

  return `skills:${params.skuId}:${stableRequestId}`;
}

function enforcePolicy(params: { ctx: PaidContext; skuId: string }): void {
  const allowed = toStringArray(
    params.ctx.policy?.allowed_sku_ids ?? params.ctx.policy?.allowedSkuIds
  );

  if (allowed.length > 0 && !allowed.includes(params.skuId)) {
    throw new ForbiddenError('SKU is not allowed by invocation policy', {
      sku_id: params.skuId,
    });
  }
}

function enforceAuthority(params: {
  ctx: PaidContext;
  proof: PaidProof;
  requireStaampid?: boolean;
  minTrustScore?: number;
}): void {
  if (params.requireStaampid) {
    const staampid = params.proof.staampid ?? params.ctx.authority?.staampid ?? undefined;
    if (!staampid) {
      throw new ForbiddenError('STAAMPID passport is required for this SKU');
    }
  }

  if (typeof params.minTrustScore === 'number') {
    const trustScore = params.proof.trustScore ?? params.ctx.authority?.trustScore ?? undefined;
    if (typeof trustScore !== 'number' || trustScore < params.minTrustScore) {
      throw new ForbiddenError('Trust score is below required threshold', {
        min_trust_score: params.minTrustScore,
        trust_score: trustScore ?? null,
      });
    }
  }
}

function buildSandboxArtifacts(skuId: string, idempotencyKey: string): {
  payment: PaidPayment;
  receipt: PaidReceipt;
} {
  const digest = sha256Hex(`${skuId}:${idempotencyKey}:sandbox`);

  return {
    payment: {
      status: 'sandbox',
      sighash: digest,
      request_id: idempotencyKey,
      raw: {
        sandbox: true,
      },
    },
    receipt: {
      id: `sandbox_${digest.slice(0, 24)}`,
      hash: digest,
      verification_url: undefined,
      raw: {
        sandbox: true,
      },
    },
  };
}

function stripReservedInput<Input>(input: Input): Input {
  if (!isRecord(input)) {
    return input;
  }

  if (!Object.prototype.hasOwnProperty.call(input, '__hlos')) {
    return input;
  }

  const clone = { ...input } as Record<string, unknown>;
  delete clone.__hlos;
  return clone as Input;
}

function readReservedHlos<Input>(input: Input): Record<string, unknown> | undefined {
  if (!isRecord(input)) {
    return undefined;
  }

  const value = input.__hlos;
  return isRecord(value) ? value : undefined;
}

async function safeResponseBody(response: FetchResponseLike): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    try {
      if (typeof response.text === 'function') {
        return await response.text();
      }
    } catch {
      return undefined;
    }

    return undefined;
  }
}

function getHeader(headers: HeaderBag | undefined, name: string): string | undefined {
  if (!headers) return undefined;

  if (typeof (headers as { get?: unknown }).get === 'function') {
    const value = (headers as { get(name: string): string | null }).get(name);
    return value ?? undefined;
  }

  const lookup = name.toLowerCase();
  for (const [key, value] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
    if (key.toLowerCase() !== lookup) continue;
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  }

  return undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function readUnknown(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!record) return undefined;
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readNumber(record: Record<string, unknown> | undefined, key: string): number | undefined {
  if (!record) return undefined;
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = parseInteger(value);
    return parsed ?? undefined;
  }
  return undefined;
}

function parseInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

function firstString(...values: Array<string | undefined | null>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function firstNumber(...values: Array<number | undefined | null>): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export * from './context';
