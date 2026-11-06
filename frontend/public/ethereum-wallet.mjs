// Connection state is untrusted wallet-reported data, never proof of ownership.
export function discoverMetaMask(target, onChange) {
  const providers = new Map();
  function announce(event) {
    const { info, provider } = event.detail ?? {};
    if (info?.rdns !== 'io.metamask' || typeof info.uuid !== 'string' || !info.uuid || info.uuid.length > 100) return;
    if (!provider || typeof provider.request !== 'function' || typeof provider.on !== 'function' || typeof provider.removeListener !== 'function') return;
    if (providers.has(info.uuid) || [...providers.values()].includes(provider) || providers.size >= 8) return;
    providers.set(info.uuid, provider);
    onChange([...providers].map(([id, value]) => ({ id, provider: value })));
  }
  target.addEventListener('eip6963:announceProvider', announce);
  target.dispatchEvent(new Event('eip6963:requestProvider'));
  return () => target.removeEventListener('eip6963:announceProvider', announce);
}

export function createEthereumConnection(onChange) {
  let state = Object.freeze({ status: 'disconnected', account: null, chainId: null, message: 'No wallet connected.' });
  let provider = null;
  let operation = 0;
  let walletRevision = 0;

  function publish(status, message, account = null, chainId = null) {
    state = Object.freeze({ status, message, account, chainId });
    onChange(state);
  }
  function detach() {
    if (!provider) return;
    provider.removeListener('accountsChanged', changed);
    provider.removeListener('chainChanged', changed);
    provider.removeListener('disconnect', disconnected);
    provider = null;
  }
  function changed() {
    walletRevision += 1;
    // Initial authorization can emit accountsChanged. Read fresh accounts after it.
    if (state.status !== 'connecting') {
      publish('changed', 'Wallet account or network changed. Reconnect to refresh the selection.');
    }
  }
  function disconnected() {
    operation += 1;
    detach();
    publish('disconnected', 'Wallet disconnected. Connect again when ready.');
  }
  function forget() {
    operation += 1;
    detach();
    publish('disconnected', 'Selection cleared in this page. Website permissions in MetaMask are unchanged.');
  }

  async function connect(nextProvider) {
    if (state.status === 'connecting') return;
    const current = ++operation;
    detach();
    if (!nextProvider || typeof nextProvider.request !== 'function' || typeof nextProvider.on !== 'function' || typeof nextProvider.removeListener !== 'function') {
      publish('error', 'A compatible MetaMask extension was not found.');
      return;
    }
    provider = nextProvider;
    provider.on('accountsChanged', changed);
    provider.on('chainChanged', changed);
    provider.on('disconnect', disconnected);
    publish('connecting', 'Approve account access in MetaMask. No signature or transaction is requested.');
    try {
      await nextProvider.request({ method: 'eth_requestAccounts' });
      if (current !== operation) return;
      const revision = walletRevision;
      const chainId = await nextProvider.request({ method: 'eth_chainId' });
      if (current !== operation) return;
      const accounts = await nextProvider.request({ method: 'eth_accounts' });
      if (current !== operation) return;
      if (revision !== walletRevision) {
        publish('changed', 'Wallet changed during connection. Reconnect to read a consistent selection.');
        return;
      }
      if (!Array.isArray(accounts) || !accounts.length) {
        publish('disconnected', 'No account was shared. Connect again to select an account.');
        return;
      }
      if (typeof accounts[0] !== 'string' || !/^0x[0-9a-f]{40}$/i.test(accounts[0]) || typeof chainId !== 'string' || !/^0x[0-9a-f]{1,64}$/i.test(chainId)) {
        throw new Error('Invalid wallet response');
      }
      const mainnet = BigInt(chainId) === 1n;
      publish(mainnet ? 'connected' : 'wrong-network', mainnet
        ? 'Connected on Ethereum mainnet. Ownership is not yet verified.'
        : 'Select Ethereum mainnet in MetaMask, then reconnect. No network switch has been requested.', accounts[0], chainId);
    } catch (error) {
      if (current !== operation) return;
      detach();
      publish('error', error?.code === 4001 ? 'Connection was declined. You can try again.'
        : error?.code === -32002 ? 'MetaMask already has a request waiting. Open the wallet to finish it, then try again.'
          : 'Unable to read the wallet connection. Check MetaMask and try again.');
    }
  }

  return { connect, forget, getState: () => state };
}
