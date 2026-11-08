#!/usr/bin/env node
// Regenerates frontend/test/fixtures/wallet-legs.json: REAL @hiero-ledger/sdk TransactionBody bytes
// (one good leg per asset + tampered variants) so the browser-side decoder is tested against the SDK.
// Throwaway accounts/keys only. Usage: node cloudflare/scripts/gen-wallet-fixtures.mjs
import { writeFile } from 'node:fs/promises';
import * as sdk from '@hiero-ledger/sdk';

const FAN = '0.0.11345895', ARTIST = '0.0.11347291', STEWARD = '0.0.11345897', FEE = '0.0.9185802', USDC = '0.0.429274';
const at = sdk.Timestamp.fromDate(new Date('2026-11-08T18:00:00Z'));
function body(build, payer = FEE) {
  const tx = new sdk.TransferTransaction();
  build(tx);
  tx.setTransactionId(sdk.TransactionId.withValidStart(sdk.AccountId.fromString(payer), at)).setNodeAccountIds([sdk.AccountId.fromString('0.0.3')]).setTransactionValidDuration(120).freeze();
  return Buffer.from(tx.signableNodeBodyBytesList[0].signableTransactionBodyBytes).toString('base64');
}
const hbar = (from, to, n) => (tx) => tx.addHbarTransfer(from, sdk.Hbar.fromTinybars(`-${n}`)).addHbarTransfer(to, sdk.Hbar.fromTinybars(`${n}`));
const tok = (from, to, n) => (tx) => tx.addTokenTransfer(USDC, from, sdk.Long.fromString(`-${n}`)).addTokenTransfer(USDC, to, sdk.Long.fromString(`${n}`));
const out = {
  accounts: { fan: FAN, artist: ARTIST, steward: STEWARD, feePayer: FEE, usdc: USDC },
  good: {
    hbarArtist: body(hbar(FAN, ARTIST, 96310000)),
    hbarSteward: body(hbar(FAN, STEWARD, 3690000)),
    usdcArtist: body(tok(FAN, ARTIST, 963100)),
  },
  bad: {
    extraRecipient: body((tx) => tx.addHbarTransfer(FAN, sdk.Hbar.fromTinybars('-96310001')).addHbarTransfer(ARTIST, sdk.Hbar.fromTinybars('96310000')).addHbarTransfer('0.0.666', sdk.Hbar.fromTinybars('1'))),
    otherPayee: body(hbar(FAN, '0.0.666', 96310000)),
    fanPaysFees: body(hbar(FAN, ARTIST, 96310000), FAN),
    withMemo: body((tx) => { hbar(FAN, ARTIST, 96310000)(tx); tx.setTransactionMemo('hi'); }),
    wrongAmount: body(hbar(FAN, ARTIST, 96310001)),
    approval: body((tx) => tx.addApprovedHbarTransfer(FAN, sdk.Hbar.fromTinybars('-96310000')).addHbarTransfer(ARTIST, sdk.Hbar.fromTinybars('96310000'))),
  },
};
await writeFile(new URL('../../frontend/test/fixtures/wallet-legs.json', import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
console.log('wrote frontend/test/fixtures/wallet-legs.json');
