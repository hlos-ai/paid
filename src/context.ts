import type { PaidContext } from './index';

export type PaidContextSource = 'http' | 'mcp' | 'skill';
const SKU_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export interface BuildPaidContextFromHttpInput {
  skuId: string;
  requestId?: string;
  headers?: Record<string, string | undefined>;
  actorId?: string;
  correlationId?: string;
  clientTag?: string;
  hlosClientTagHeader?: string;
  meta?: Record<string, unknown>;
}

export interface BuildPaidContextFromMcpInput {
  skuId: string;
  toolCallId?: string;
  jsonRpcId?: string | number;
  actorId?: string;
  correlationId?: string;
  clientTag?: string;
  meta?: Record<string, unknown>;
}

export class MissingIdempotencySourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingIdempotencySourceError';
  }
}

export function normalizeSkuId(skuId: string): string {
  const normalized = normalizeString(skuId);
  if (!normalized) {
    throw new TypeError('skuId must be a non-empty string');
  }
  if (!SKU_ID_PATTERN.test(normalized)) {
    throw new TypeError(
      'skuId contains invalid characters. Allowed: letters, numbers, dot (.), underscore (_), hyphen (-), colon (:).'
    );
  }
  return normalized;
}

export function assertDeterministicId(
  value: string | number | undefined | null,
  message: string
): string {
  const normalized =
    typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : undefined;

  if (!normalized) {
    throw new MissingIdempotencySourceError(message);
  }

  return normalized;
}

export function buildPaidContextFromHttp(input: BuildPaidContextFromHttpInput): PaidContext {
  const skuId = normalizeSkuId(input.skuId);
  const clientTagHeader = normalizeHeaderName(input.hlosClientTagHeader ?? 'x-hlos-client-tag');

  const requestIdCandidate = firstString(
    input.requestId,
    readHeader(input.headers, 'x-request-id'),
    readHeader(input.headers, 'x-correlation-id'),
    readHeader(input.headers, clientTagHeader)
  );

  const requestId = assertDeterministicId(
    requestIdCandidate,
    `Unable to derive deterministic request id for sku "${skuId}". Pass requestId or one of headers: x-request-id, x-correlation-id, ${clientTagHeader}.`
  );

  const clientTag = firstString(input.clientTag, readHeader(input.headers, clientTagHeader));
  const correlationId = firstString(
    input.correlationId,
    readHeader(input.headers, 'x-correlation-id'),
    requestId
  );
  const proof: Record<string, unknown> = {
    request_id: requestId,
  };
  if (clientTag) {
    proof.client_tag = clientTag;
  }

  const ctx: PaidContext = {
    channel: 'skills',
    headers: input.headers,
    request_id: requestId,
    correlationId,
    __hlos: proof,
    paymentProof: proof,
  };

  if (input.actorId) {
    ctx.actorId = normalizeString(input.actorId);
  }
  if (input.meta) {
    ctx.meta = { ...input.meta };
  }

  return ctx;
}

export function buildPaidContextFromMcp(input: BuildPaidContextFromMcpInput): PaidContext {
  const skuId = normalizeSkuId(input.skuId);
  const jsonRpcId = input.jsonRpcId !== undefined && input.jsonRpcId !== null ? String(input.jsonRpcId) : undefined;

  const toolCallId = assertDeterministicId(
    firstString(input.toolCallId, jsonRpcId),
    `Unable to derive deterministic MCP tool call id for sku "${skuId}". Pass toolCallId or jsonRpcId.`
  );

  const proof: Record<string, unknown> = {
    tool_call_id: toolCallId,
  };
  if (jsonRpcId) {
    proof.request_id = jsonRpcId;
  }
  const clientTag = normalizeString(input.clientTag);
  if (clientTag) {
    proof.client_tag = clientTag;
  }
  const correlationId = firstString(input.correlationId, jsonRpcId, toolCallId);

  const ctx: PaidContext = {
    channel: 'mcp',
    toolCallId: toolCallId,
    request_id: jsonRpcId,
    correlationId,
    __hlos: proof,
    paymentProof: proof,
  };

  if (input.actorId) {
    ctx.actorId = normalizeString(input.actorId);
  }
  if (input.meta) {
    ctx.meta = { ...input.meta };
  }

  return ctx;
}

function readHeader(
  headers: Record<string, string | undefined> | undefined,
  name: string
): string | undefined {
  if (!headers) {
    return undefined;
  }

  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return normalizeString(value);
    }
  }

  return undefined;
}

function normalizeHeaderName(name: string): string {
  const normalized = normalizeString(name);
  if (!normalized) {
    throw new TypeError('hlosClientTagHeader must be a non-empty string');
  }
  return normalized.toLowerCase();
}

function normalizeString(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function firstString(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}
