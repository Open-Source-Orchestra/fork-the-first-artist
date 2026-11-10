import { buildQuery, publicQueryOptions, parsePublicQuery, validateProofConfig } from './arkiv-query.mjs';

const button = document.querySelector('#read-arkiv');
const status = document.querySelector('#read-status');
const details = document.querySelector('#entity-details');
let config;

try {
  const response = await fetch('/arkiv-proof.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('configuration unavailable');
  config = validateProofConfig(await response.json());
  document.querySelector('#query-text').textContent = buildQuery(config);
  for (const [id, tx] of [['#issue-link', config.issueTx], ['#revoke-link', config.revokeTx]]) {
    document.querySelector(id).href = `https://rabdi.explorer.arkiv.network/tx/${tx}`;
  }
  button.disabled = false;
  status.textContent = 'Ready. Select the button for one live public-metadata read.';
} catch {
  status.textContent = 'The public proof configuration could not be loaded. Use the transaction links or CLI instead.';
}

button.addEventListener('click', async () => {
  if (!config) return;
  button.disabled = true;
  details.hidden = true;
  status.textContent = 'Reading current public metadata from Rabdi…';
  try {
    const response = await fetch(config.rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'arkiv_query', params: [buildQuery(config), publicQueryOptions(config)] }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('RPC unavailable');
    const result = parsePublicQuery(await response.json(), config);
    document.querySelector('#query-block').textContent = String(result.blockNumber);
    document.querySelector('#entity-count').textContent = String(result.count);
    document.querySelector('#entity-key').textContent = result.key;
    document.querySelector('#created-block').textContent = String(result.createdAt);
    document.querySelector('#expires-block').textContent = String(result.expiresAt);
    document.querySelector('#readonly').textContent = result.readonly ? 'true' : 'false';
    details.hidden = false;
    status.textContent = 'Current readonly synthetic invitation entity confirmed. Encrypted operational state remains visible only to the trusted CLI.';
  } catch {
    status.textContent = 'The public RPC is unavailable, rate-limited, or returned an unexpected entity. Retry later or use the transaction links and trusted CLI; no cached success is substituted.';
  } finally {
    button.disabled = !config;
  }
});
