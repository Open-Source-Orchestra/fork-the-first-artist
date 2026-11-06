// One gentle EIP-1193 connect for the trust pages: reuse an existing connection, never stack prompts,
// and explain MetaMask's "request already pending" (-32002) instead of failing.
let inflight = null;
export async function connectWallet() {
  if (!window.ethereum) throw new Error('No browser wallet found. Open this page in MetaMask (or any EIP-1193 wallet).');
  const existing = await window.ethereum.request({ method: 'eth_accounts' }).catch(() => []);
  if (existing?.[0]) return existing[0];
  inflight ??= window.ethereum.request({ method: 'eth_requestAccounts' }).finally(() => { inflight = null; });
  try {
    const [a] = await inflight;
    if (!a) throw new Error('No account was shared.');
    return a;
  } catch (e) {
    if (e?.code === -32002 || /already pending/i.test(e?.message ?? '')) {
      throw new Error('MetaMask already has a connection request waiting. Click the MetaMask icon in your browser toolbar (or open the MetaMask app) and approve it, then press Connect again.');
    }
    if (e?.code === 4001) throw new Error('You declined the connection in your wallet.');
    throw e;
  }
}
