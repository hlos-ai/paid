import { settleWithHlosKernel } from '../src/index';

function readArg(name: string): string {
  const flag = `--${name}`;
  const index = process.argv.findIndex((value) => value === flag);
  if (index < 0 || !process.argv[index + 1]) {
    throw new Error(`Missing required flag ${flag}`);
  }
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const quoteId = readArg('quote_id');
  const skuId = readArg('sku_id');
  const paymentSignature = readArg('payment_signature');
  const idempotencyKey = readArg('idempotency_key');

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
        receipt_id: settled.receiptId,
        receipt_hash: settled.receiptHash,
        payment_sighash: settled.paymentSigHash,
        verification_url: settled.verificationUrl,
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
