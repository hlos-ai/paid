/**
 * Demo helper for hackathon/dev flows.
 *
 * This script is intentionally not part of package exports.
 * It performs explicit settlement and prints a retry-ready __hlos payload.
 */

import { settleWithHlosKernel } from '../src/index';

function readArg(name: string, required = true): string | undefined {
  const flag = `--${name}`;
  const index = process.argv.findIndex((value) => value === flag);
  if (index < 0 || !process.argv[index + 1]) {
    if (required) {
      throw new Error(`Missing required flag ${flag}`);
    }
    return undefined;
  }
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const quoteId = readArg('quote_id', false);
  const skuId = readArg('sku_id') as string;
  const paymentSignature = readArg('payment_signature') as string;
  const idempotencyKey = readArg('idempotency_key', false);

  const settled = await settleWithHlosKernel({
    apiBaseUrl: process.env.HLOS_BASE_URL,
    quoteId,
    skuId,
    paymentSignature,
    idempotencyKey,
  });

  process.stdout.write(
    JSON.stringify(
      {
        settlement: settled.settlement,
        __hlos: settled.__hlos,
      },
      null,
      2
    ) + '\n'
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
