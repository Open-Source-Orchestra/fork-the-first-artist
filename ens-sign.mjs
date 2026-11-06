// Owner-only signing kit: sends exactly the prepared txs from the parent owner via window.ethereum.
const kit = JSON.parse(document.getElementById('kit').textContent);
const $ = (id) => document.getElementById(id);
let from = null;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const eth = (hex) => (Number(BigInt(hex)) / 1e18).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');

$('summary').textContent = `${kit.parent.name} · owner ${kit.parent.owner} · OSO artist registry ${kit.userRegistry.address} (${kit.userRegistry.deployed ? 'deployed' : 'not deployed yet'}) · read at block ${kit.readAtBlock}, gas ${Number(kit.gasPriceGwei).toFixed(3)} gwei.`;
$('txs').innerHTML = kit.txs.map((t) => `
  <section class="card" aria-labelledby="h-${t.id}">
    <h2 id="h-${t.id}">${t.order}. ${esc(t.title)} ${t.required ? '<strong>(required)</strong>' : t.irreversible ? '<strong>(optional · irreversible)</strong>' : '<em>(optional)</em>'}</h2>
    <p>${esc(t.plain)}</p>
    <p>to <code>${t.to}</code> · value <code>${eth(t.value)} ETH</code> · chain 1 · ~${t.gasEstimate} gas</p>
    <details><summary>calldata</summary><pre style="white-space:pre-wrap;word-break:break-all">${t.data}</pre></details>
    ${t.irreversible ? `<p><label><input type="checkbox" id="ack-${t.id}"> I understand this cannot be undone.</label></p>` : ''}
    <p><button type="button" data-tx="${t.id}" disabled>Send with MetaMask</button> <span id="r-${t.id}" aria-live="polite"></span></p>
  </section>`).join('');

$('connect').addEventListener('click', async () => {
  if (!window.ethereum) return void ($('status').textContent = 'Open this page in a browser with MetaMask.');
  const [a] = await window.ethereum.request({ method: 'eth_requestAccounts' });
  from = a;
  const ok = a.toLowerCase() === kit.parent.owner.toLowerCase();
  $('who').textContent = ok ? `connected as ${a} ✔ (owner of ${kit.parent.name})` : `connected as ${a} — NOT the owner of ${kit.parent.name}; switch account in MetaMask`;
  document.querySelectorAll('button[data-tx]').forEach((b) => (b.disabled = !ok));
});

document.addEventListener('click', async (ev) => {
  const id = ev.target?.dataset?.tx;
  if (!id) return;
  const t = kit.txs.find((x) => x.id === id);
  if (t.irreversible && !$(`ack-${id}`)?.checked) return void ($(`r-${id}`).textContent = 'Tick the box first.');
  try {
    const chain = await window.ethereum.request({ method: 'eth_chainId' });
    if (chain !== '0x1') await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] });
    const hash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from, to: t.to, value: t.value, data: t.data === '0x' ? undefined : t.data }] });
    $(`r-${id}`).innerHTML = `sent: <a href="https://etherscan.io/tx/${hash}" rel="noreferrer">${hash}</a>`;
  } catch (e) {
    $(`r-${id}`).textContent = `not sent: ${e.message ?? e}`;
  }
});
