export const HEDERA_CHAIN = 'hedera:testnet';
export const HEDERA_CHAINS = Object.freeze(['hedera:testnet', 'hedera:mainnet']);

/**
 * Validate a WalletConnect session and return its numeric Hedera accounts on `chain`.
 * Defaults (testnet, hedera_signMessage) are the artist payout-claim use; the fan-wallet tip asks
 * for `hedera_signTransaction` on the network it pays on.
 */
export function sessionAccounts(session, now = Date.now(), { chain = HEDERA_CHAIN, method = 'hedera_signMessage' } = {}) {
  if (!HEDERA_CHAINS.includes(chain)) throw new Error('Unsupported Hedera chain');
  const namespace = session?.namespaces?.hedera;
  if (typeof session?.topic !== 'string' || !/^[a-f0-9]{64}$/i.test(session.topic)
    || !Number.isSafeInteger(session.expiry) || session.expiry * 1000 <= now
    || !Array.isArray(namespace?.methods) || !namespace.methods.includes(method)
    || !Array.isArray(namespace.accounts) || !namespace.accounts.length || namespace.accounts.length > 50) {
    throw new Error('Invalid Hedera session');
  }
  const pattern = new RegExp(`^${chain}:(0|[1-9][0-9]{0,18})\\.(0|[1-9][0-9]{0,18})\\.([1-9][0-9]{0,18})$`);
  const accounts = namespace.accounts.map((account) => {
    if (typeof account !== 'string' || !pattern.test(account)) {
      throw new Error(`Expected a numeric Hedera ${chain.slice(7)} account`);
    }
    if (account.slice(chain.length + 1).split('.').some((part) => BigInt(part) > 9223372036854775807n)) {
      throw new Error('Account component out of range');
    }
    return account;
  });
  return Object.freeze([...new Set(accounts)]);
}

export function createHederaConnection({ createClient, onChange, now = Date.now, chain = HEDERA_CHAIN, methods = ['hedera_signMessage'], messages = {} }) {
  const scope = { chain, method: methods[0] };
  const say = (key, fallback) => messages[key] ?? fallback;
  let state = Object.freeze({ status: 'disconnected', message: 'No HashPack account connected.', accounts: [], account: null, uri: null });
  let client;
  let initialization;
  let session;
  let pairingTopic;
  let operation = 0;

  function publish(status, message, accounts = [], account = null, uri = null) {
    state = Object.freeze({ status, message, accounts: Object.freeze([...accounts]), account, uri });
    onChange(state);
  }
  async function closeSession(value) {
    if (!value || !client) return;
    await client.disconnect({ topic: value.topic, reason: { code: 6000, message: 'User disconnected' } });
  }
  async function closePairing(topic) {
    if (topic) await client.core.pairing.disconnect({ topic });
  }
  function sessionEnded(event) {
    if (event.topic !== session?.topic) return;
    operation += 1;
    session = null;
    publish('disconnected', 'HashPack session ended. Connect again when ready.');
  }
  function sessionChanged(event) {
    if (event.topic !== session?.topic) return;
    operation += 1;
    publish('changed', 'HashPack session changed. Reconnect before selecting a payout account.');
  }
  async function forget() {
    operation += 1;
    const previous = session;
    const previousPairing = pairingTopic;
    session = null;
    pairingTopic = null;
    publish('disconnected', 'Selection cleared. Check HashPack to remove any remaining wallet connection.');
    await Promise.allSettled([closeSession(previous), closePairing(previousPairing)]);
  }
  async function connect() {
    if (['connecting', 'pairing'].includes(state.status)) return;
    const current = ++operation;
    const previous = session;
    const previousPairing = pairingTopic;
    session = null;
    pairingTopic = null;
    publish('connecting', 'Starting HashPack pairing. No signature or payment is requested.');
    try {
      if (!initialization) initialization = Promise.resolve().then(createClient).then((value) => {
        client = value;
        client.on('session_delete', sessionEnded);
        client.on('session_expire', sessionEnded);
        client.on('session_update', sessionChanged);
        client.on('session_event', sessionChanged);
        return client;
      }).catch((error) => { initialization = null; throw error; });
      await initialization;
      if (current !== operation) return;
      await closeSession(previous);
      await closePairing(previousPairing);
      if (current !== operation) return;
      const { uri, approval } = await client.connect({
        requiredNamespaces: { hedera: {
          chains: [chain], methods: [...methods], events: ['accountsChanged', 'chainChanged'],
        } },
      });
      const match = typeof uri === 'string' && /^wc:([a-f0-9]{64})@2\?/i.exec(uri);
      if (current === operation) {
        if (!match) throw new Error('Missing pairing URI');
        pairingTopic = match[1];
        publish('pairing', say('pairing', 'Scan with HashPack or paste the pairing link into HashPack. Choose a Hedera testnet account.'), [], null, uri);
      } else if (match) {
        try { await closePairing(match[1]); } catch { /* The canceled approval is still discarded below. */ }
      }
      const approved = await approval();
      if (current !== operation) {
        try { await closeSession(approved); } catch { /* Never accept a canceled pairing locally. */ }
        return;
      }
      try {
        const accounts = sessionAccounts(approved, now(), scope);
        session = approved;
        publish('select-account', say('select', 'Paired. Select your payout account; ownership is not yet verified.'), accounts);
      } catch (error) {
        try { await closeSession(approved); } catch { /* Invalid sessions cannot become selected. */ }
        throw error;
      }
    } catch {
      if (current !== operation) return;
      publish('error', say('error', 'Pairing did not complete with a valid Hedera testnet session. Check HashPack and try again.'));
    }
  }
  function selectAccount(account) {
    if (!session || !['select-account', 'connected'].includes(state.status)) return;
    try {
      const accounts = sessionAccounts(session, now(), scope);
      if (!accounts.includes(account)) throw new Error('Account not shared');
      publish('connected', say('connected', 'Testnet payout account selected. Ownership is not yet verified.'), accounts, account);
    } catch {
      publish('changed', 'The selected account or session is no longer available. Reconnect to continue.');
    }
  }
  /**
   * One JSON-RPC call to the wallet on the connected session, for the SELECTED account only
   * (e.g. hedera_signTransaction). Only methods this connection asked for are allowed.
   */
  async function request(method, params) {
    if (state.status !== 'connected' || !session || !state.account) throw new Error('Connect and select an account first');
    if (!methods.includes(method)) throw new Error(`Method ${method} was not requested for this session`);
    const accounts = sessionAccounts(session, now(), { chain, method });
    if (!accounts.includes(state.account)) throw new Error('Account no longer shared');
    return client.request({ topic: session.topic, chainId: chain, request: { method, params } });
  }
  return { connect, forget, selectAccount, request, getState: () => state };
}
