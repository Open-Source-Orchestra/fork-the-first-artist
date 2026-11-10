import { createEthereumConnection, discoverMetaMask } from './ethereum-wallet.mjs';

const selector = document.querySelector('#ethereum-provider');
const connectButton = document.querySelector('#connect-ethereum');
const forgetButton = document.querySelector('#forget-ethereum');
const status = document.querySelector('#ethereum-status');
const details = document.querySelector('#ethereum-details');
const address = document.querySelector('#ethereum-address');
const network = document.querySelector('#ethereum-network');
let entries = [];
let stopDiscovery;

function render(state) {
  status.textContent = state.message;
  const busy = state.status === 'connecting';
  selector.disabled = busy || entries.length < 2;
  connectButton.disabled = busy || entries.length === 0;
  forgetButton.disabled = state.status === 'disconnected';
  details.hidden = !state.account;
  address.textContent = state.account ?? '';
  network.textContent = state.chainId ? (BigInt(state.chainId) === 1n ? 'Ethereum mainnet' : `Chain ${state.chainId}`) : '';
}
const connection = createEthereumConnection(render);

function startDiscovery() {
  stopDiscovery?.();
  entries = [];
  selector.replaceChildren(new Option('No extension detected', ''));
  render(connection.getState());
  status.textContent = 'No MetaMask extension detected yet. Install or unlock MetaMask, then reload this page.';
  stopDiscovery = discoverMetaMask(window, (found) => {
    const previous = selector.value;
    entries = found;
    selector.replaceChildren(...entries.map((entry, index) => new Option(`MetaMask ${entries.length > 1 ? index + 1 : ''}`.trim(), entry.id)));
    if (entries.some((entry) => entry.id === previous)) selector.value = previous;
    render(connection.getState());
  });
}

connectButton.addEventListener('click', () => {
  const entry = entries.find((candidate) => candidate.id === selector.value);
  if (entry) void connection.connect(entry.provider);
});
forgetButton.addEventListener('click', () => connection.forget());
selector.addEventListener('change', () => connection.forget());
window.addEventListener('pagehide', () => { stopDiscovery?.(); connection.forget(); });
window.addEventListener('pageshow', (event) => { if (event.persisted) startDiscovery(); });
startDiscovery();
