#!/usr/bin/env node
/**
 * ONE real fan-wallet tip on Hedera TESTNET through the exact Worker code path (prepareTip -> wallet
 * signs -> settleTip), with an in-memory Durable Object. The "wallet" here is a script that holds the
 * dedicated testnet demo-fan key and returns what HashPack's hedera_signTransaction returns (a
 * SignatureMap over the TransactionBody) — a headless stand-in for the browser wallet, said honestly.
 *
 *   FAN_ACCOUNT_ID=0.0.11345895 FAN_PRIVATE_KEY=… STEWARD_PRIVATE_KEY=… \
 *     node cloudflare/scripts/testnet-wallet-tip.ts [artist=shaka] [amount=0.1] [HBAR|USDC] [--recovery]
 *
 * --recovery: the fan signs ONLY the artist leg first (=> state "partial"), the script waits until the
 * steward leg's transaction has expired unsigned, prepares again with the SAME id (only the steward leg
 * is rebuilt), signs it and settles — the real-network version of the recovery unit tests.
 *
 * Refuses anything but testnet. Keys are read from the environment and never printed.
 */
import * as sdk from '@hiero-ledger/sdk';
import { prepareTip, settleTip } from '../src/wallet-tip.ts';
import { walletSignatureMap } from '../src/wallet-tx.ts';
import { TipGate, walletDeps, type TipEnv } from '../src/tip-worker.ts';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const recovery = process.argv.includes('--recovery');
const [artist = 'shaka', amount = '0.1', currency = 'HBAR'] = args;
const fan = process.env.FAN_ACCOUNT_ID ?? '0.0.11345895';
if (!process.env.FAN_PRIVATE_KEY) throw new Error('FAN_PRIVATE_KEY missing');
const fanKey = sdk.PrivateKey.fromStringECDSA(process.env.FAN_PRIVATE_KEY);

function memoryGateNs() {
  const objs = new Map<string, TipGate>();
  return {
    idFromName: (n: string) => n,
    get: (id: unknown) => {
      const k = String(id);
      if (!objs.has(k)) {
        const st = new Map<string, unknown>();
        objs.set(k, new TipGate({ storage: { get: async <T>(key: string) => structuredClone(st.get(key)) as T | undefined, put: async (e: Record<string, unknown>) => { for (const [kk, v] of Object.entries(e)) st.set(kk, structuredClone(v)); } } }));
      }
      const o = objs.get(k)!;
      return { fetch: (u: string, init?: RequestInit) => o.fetch(new Request(u, init)) };
    },
  };
}

const env = {
  TIP_GATE: memoryGateNs(),
  FAN_ACCOUNT_ID: '0.0.11345895',
  STEWARD_ACCOUNT_ID: '0.0.11345897',
  METER_ACCOUNT_ID: '0.0.11345898',
  ARTIST_ACCOUNT_ID: '0.0.11345896',
  HCS_TOPIC_ID: '0.0.11345907',
  STEWARD_PRIVATE_KEY: process.env.STEWARD_PRIVATE_KEY,
  FACILITATOR_URL: process.env.FACILITATOR_URL ?? 'https://x402.org/facilitator',
  // MAINNET_ENABLED deliberately absent
} as unknown as TipEnv;
const deps = walletDeps(env, env.TIP_GATE);
const id = `tip_testnet_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const log = (label: string, v: unknown) => console.log(label, JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x), 2));

const prep = await prepareTip(deps, JSON.stringify({ id, network: 'testnet', currency, amount, artist, fan }));
log('prepared', { id, artist: prep.record.artist, legs: prep.record.legs.map((l) => ({ leg: l.leg, payTo: l.payTo, amount: l.amount, txId: l.txId, feePayer: l.feePayer })) });
const signatures: Record<string, string> = {};
for (const l of prep.record.legs) if (l.bodyBytes && (!recovery || l.leg === 'artist')) signatures[l.leg] = await walletSignatureMap(fanKey as never, l.bodyBytes, 'ecdsa');
let res = await settleTip(deps, JSON.stringify({ id, signatures }));
if (recovery) {
  log('partial', { state: res.state, results: res.results, recovery: (res as { recovery?: string }).recovery });
  const wait = Math.max(0, Date.parse(prep.record.legs[1]!.validUntil) + 31_000 - Date.now());
  console.log(`waiting ${Math.round(wait / 1000)}s until the unsigned steward tx can no longer land…`);
  await new Promise((r) => setTimeout(r, wait));
  const again = await prepareTip(deps, JSON.stringify({ id, network: 'testnet', currency, amount, artist, fan }));
  log('re-prepared', { reused: again.reused, legs: again.record.legs.map((l) => ({ leg: l.leg, status: l.status, txId: l.txId, needsSignature: Boolean(l.bodyBytes) })) });
  for (const k of Object.keys(signatures)) delete signatures[k];
  for (const l of again.record.legs) if (l.bodyBytes) signatures[l.leg] = await walletSignatureMap(fanKey as never, l.bodyBytes, 'ecdsa');
  res = await settleTip(deps, JSON.stringify({ id, signatures }));
}
log('settled', { state: res.state, results: res.results, legs: res.record.legs.map((l) => ({ leg: l.leg, status: l.status, settledTx: l.settledTx, hashscan: l.hashscan, error: l.error })), hcs: res.record.hcs });
// idempotency on the live network: settling again must not move money
const again = await settleTip(deps, JSON.stringify({ id, signatures }));
log('settle-again', { state: again.state, results: again.results });
