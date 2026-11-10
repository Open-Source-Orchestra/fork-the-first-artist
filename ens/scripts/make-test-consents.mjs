#!/usr/bin/env node
// TEST FIXTURES ONLY: synthetic artists with throwaway keys, signed with the canonical consent text.
//   node ens/scripts/make-test-consents.mjs <outdir> [n=3]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { buildConsentMessage } from '../src/consent.mjs';

const [dir, n = '3'] = process.argv.slice(2);
if (!dir) throw new Error('usage: make-test-consents.mjs <outdir> [n]');
mkdirSync(dir, { recursive: true });
for (let i = 1; i <= Number(n); i++) {
  const acct = privateKeyToAccount(generatePrivateKey());
  const fields = { label: `fixture-artist-${i}`, ethAddress: acct.address, hederaPayout: i === 1 ? '0.0.11345896' : 'alias', timestamp: new Date().toISOString(), chainId: 1 };
  const message = buildConsentMessage(fields);
  writeFileSync(join(dir, `${fields.label}.json`), JSON.stringify({ ...fields, message, signature: await acct.signMessage({ message }) }, null, 2));
}
console.log(`${n} synthetic consents in ${dir}`);
