// @hiero-ledger/sdk's browser build calls `window.crypto.subtle` (sha384.browser.js);
// workerd has `crypto` on globalThis but no `window`. Probe: HCS submit SUCCESS in workerd with this shim.
const g = globalThis as unknown as { window?: unknown };
if (typeof g.window === 'undefined') g.window = globalThis;
export {};
