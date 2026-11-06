import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describe, parseChunk, WORKER, PROOF } from '../public/pay.mjs';

test('pay page talks only to the oso-tip-loop Worker and links the recorded proof', () => {
  assert.equal(WORKER, 'https://oso-tip-loop.shakaverse.workers.dev');
  assert.match(PROOF, /docs\/TX-PROOF\.md$/);
});

test('NDJSON chunks are split into whole events; partial lines wait; junk is skipped, never invented', () => {
  const a = parseChunk('{"step":"start"}\n{"step":"ask-4');
  assert.deepEqual(a.events, [{ step: 'start' }]);
  assert.equal(a.rest, '{"step":"ask-4');
  const b = parseChunk(`${a.rest}02","status":402}\nnot json\n{"no":"step"}\n`);
  assert.deepEqual(b.events, [{ step: 'ask-402', status: 402 }]);
  assert.equal(b.rest, '');
});

test('each real step renders with HashScan links; non-HashScan links are dropped', () => {
  const settled = describe({ step: 'ask-settled', txId: '0.0.9185802@1794007315.772507168', hashscan: 'https://hashscan.io/testnet/transaction/0.0.9185802-1794007315-772507168', from: '0.0.11345895', to: '0.0.11345897', amountHbar: '0.1' });
  assert.match(settled.title, /Fan → steward settled · 0\.1 HBAR/);
  assert.equal(settled.links[0].href, 'https://hashscan.io/testnet/transaction/0.0.9185802-1794007315-772507168');
  const evil = describe({ step: 'forwarded', txId: 'x', hashscan: 'javascript:alert(1)', amountHbar: '0.09631', from: 'a', to: 'b', status: 'SUCCESS' });
  assert.deepEqual(evil.links, []);
  const hcs = describe({ step: 'hcs-logged', txId: '0.0.11345897@1794007323.537716317', hashscan: 'https://hashscan.io/testnet/transaction/0.0.11345897-1794007323-537716317', topic: '0.0.11345907', topicHashscan: 'https://hashscan.io/testnet/topic/0.0.11345907', sequence: '6', status: 'SUCCESS' });
  assert.equal(hcs.links.length, 2);
  assert.match(hcs.title, /sequence 6/);
});

test('an error step is shown as an error with what really moved', () => {
  const d = describe({ step: 'error', failedStep: 'forward', message: 'steward forward failed', moneyMoved: 'fan -> steward settled (0.0.1@1.2)' });
  assert.equal(d.error, true);
  assert.match(d.detail, /Money moved so far: fan -> steward settled/);
  assert.match(d.detail, /Nothing was simulated/);
  assert.equal(describe({ step: 'unknown' }), null);
});
