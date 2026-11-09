# 💸 Tip the artist on any Ethereum chain

A fan tips an artist of the circle **from their own wallet**, on Ethereum, its layer 2s or BNB Smart Chain.
**96.31%** goes straight to the artist's address, **3.69%** to the AI steward's compute, **0** to Open Source Orchestra.
No contract is deployed, no server is involved, nothing is held in custody: the wallet sends plain ERC-20 `transfer()`
calls (USDC) or plain value transfers (ETH).

Code: `frontend/public/tip.mjs` (UI) · `tip-core.mjs` (pure logic) · `tip-ens.mjs` (ENS reads) · `tip-chains.json`
(checked chain + token table) · `tip-config.json` (**kill switch**) · `tip.html` (standalone `/tip`) · `tip.css`.
Built following https://ethskills.com (ship, addresses, l2s, frontend-ux, qa, crops, wallets) — snapshot in the ʻohana KB.

## Who gets paid (fail closed)
- **Artist** = live read of their own ENS name `<label>.osoartist.eth` on Ethereum mainnet (ENSv2 Universal Resolver
  `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`). Required: text `oso.consent` = `active`; `oso.steward.status` not paused.
  Address, first match wins: the chain's own record (ENSIP-11 coin type `0x80000000 | chainId`) → the "every EVM chain"
  record (ENSIP-19 `0x80000000`) → the ETH record (coin 60) **only if it is a key-held wallet** (no contract code on
  Ethereum or on the target chain; an EIP-7702 delegated EOA counts as key-held). Otherwise: not tippable on that chain.
- Artists without a name/record show **"awaiting the artist's wallet"**. The site never types, guesses or stores an address.
- **Host card `open-source-orchestra`** is paid on `osoartist.eth` itself (`hostPayees` in tip-config) and must equal the pin.
- **Steward** = live address of `osoartist.eth`, which must equal `stewardPin` (`0x2596…c934`, Shaka, confirmed 9 Nov 2026)
  or every tip stops. When artist == steward, one transfer of 100% is sent instead of two.

## Amounts
Integer base units only. `steward = floor(total × 369 / 10000)`, `artist = total − steward` (always sums exactly; same rule
as `payments/src/split.ts` and `cloudflare/src/direct-split.ts`). USDC = 6 decimals; **Binance-Peg USDC on BNB = 18**.
Limits in tip-config (`maxUsdc` 100, `maxEth` 0.05).

## State transitions (ethskills/ship)
| Transition | Caller | Why they pay gas | If nobody calls |
|---|---|---|---|
| `USDC.transfer(artist, 96.31%)` / value transfer | the fan's wallet | they want to tip | nothing happens |
| `USDC.transfer(steward, 3.69%)` | the fan's wallet | completes the tip | the artist share already landed; the page offers "continue" (only the missing leg is ever sent) |
There is no contract of ours and no admin key. Safety of sending (after the 9 Nov QA review):
- a stored tip is only *intent*: before every transfer — fresh or continued — the page re-fetches the switchboard,
  re-reads ENS from **two RPCs that must agree**, re-checks pins, limits, chain, account and the token contract,
  rebuilds the plan and continues only if it equals the stored legs (tampered notes can't redirect money);
- every transaction carries `chainId`; the wallet nonce is stored before each prompt; a leg is re-sent only if the
  nonce provably did not move (wallet errors other than "declined" become `unknown`, never auto-resent); sped-up
  ERC-20 transfers are found again via their `Transfer` log; one browser tab at a time (Web Locks);
- 🎻 whole-orchestra tips use one EIP-5792 `wallet_sendCalls` atomic batch when the wallet reports `atomic`
  support (ERC-20 only), otherwise one transfer at a time.

## Kill switch
`/tip-config.json` on gh-pages: `"enabled": false` stops every tip; `"mainnet": false` leaves only testnets;
`"disabledChains": [56, …]` hides chains. If the file can't be read, tips are off. The page re-fetches it (cache-busted) before every review and every transfer — also when an old tip is continued — but GitHub Pages' CDN can serve the old file for up to ~10 minutes, so a switch-off takes effect within ~10 min.

## Chains (verified onchain 2026-11-09T10:05:45Z)
| Chain | chainId | Family | USDC address | dec | Issuer | ETH tip | Explorer |
|---|---|---|---|---|---|---|---|
| Ethereum | 1 | Ethereum L1 | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | 6 | Circle | yes | https://etherscan.io |
| Base | 8453 | L2 · Base Stack | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 | Circle | yes | https://basescan.org |
| OP Mainnet | 10 | L2 · OP Stack · Superchain | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` | 6 | Circle | yes | https://optimistic.etherscan.io |
| Arbitrum One | 42161 | L2 · Arbitrum | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | 6 | Circle | yes | https://arbiscan.io |
| World Chain | 480 | L2 · OP Stack · Superchain | `0x79A02482A880bCe3F13E09da970dC34dB4cD24D1` | 6 | Circle | yes | https://worldscan.org |
| Unichain | 130 | L2 · OP Stack · Superchain | `0x078D782b760474a361dDA0AF3839290b0EF57AD6` | 6 | Circle | yes | https://uniscan.xyz |
| Ink | 57073 | L2 · OP Stack · Superchain | `0x2D270e6886d130D724215A266106e6832161EAEd` | 6 | Circle | yes | https://explorer.inkonchain.com |
| Celo | 42220 | L2 · OP Stack | `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` | 6 | Circle | no | https://celoscan.io |
| Linea | 59144 | L2 · zk rollup | `0x176211869cA2b568f2A7D4EE941E073a821EE1ff` | 6 | Circle | yes | https://lineascan.build |
| ZKsync Era | 324 | L2 · zk rollup | `0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4` | 6 | Circle | yes | https://explorer.zksync.io |
| Polygon PoS | 137 | Polygon PoS chain | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | 6 | Circle | no | https://polygonscan.com |
| BNB Smart Chain | 56 | BNB Chain L1 | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` | 18 | Binance (Binance-Peg USDC, not issued by Circle) | no | https://bscscan.com |
| Scroll | 534352 | L2 · zk rollup | — (no Circle-issued USDC → ETH only) | — | — | yes | https://scrollscan.com |
| Soneium | 1868 | L2 · OP Stack · Superchain | — (no Circle-issued USDC → ETH only) | — | — | yes | https://soneium.blockscout.com |
| Zora | 7777777 | L2 · OP Stack · Superchain | — (no Circle-issued USDC → ETH only) | — | — | yes | https://explorer.zora.energy |
| Mode | 34443 | L2 · OP Stack · Superchain | — (no Circle-issued USDC → ETH only) | — | — | yes | https://explorer.mode.network |
| Ethereum Sepolia | 11155111 | testnet | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | 6 | Circle | yes | https://sepolia.etherscan.io |
| Base Sepolia | 84532 | testnet | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | 6 | Circle | yes | https://sepolia.basescan.org |
| OP Sepolia | 11155420 | testnet | `0x5fd84259d66Cd46123540766Be93DFE6D43130D7` | 6 | Circle | yes | https://sepolia-optimism.etherscan.io |
| Arbitrum Sepolia | 421614 | testnet | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` | 6 | Circle | yes | https://sepolia.arbiscan.io |
| World Chain Sepolia | 4801 | testnet | `0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88` | 6 | Circle | yes | https://sepolia.worldscan.org |
| Unichain Sepolia | 1301 | testnet | `0x31d0220469e10c4E71834a79b1f276d740d3768F` | 6 | Circle | yes | https://sepolia.uniscan.xyz |
| Ink Sepolia | 763373 | testnet | `0xFabab97dCE620294D2B0b0e46C68964e326300Ac` | 6 | Circle | yes | https://explorer-sepolia.inkonchain.com |
| Celo Sepolia | 11142220 | testnet | `0x01C5C0122039549AD1493B8220cABEdD739BC44E` | 6 | Circle | no | https://celo-sepolia.blockscout.com |
| Linea Sepolia | 59141 | testnet | `0xFEce4462D57bD51A6A552365A011b95f0E16d9B7` | 6 | Circle | yes | https://sepolia.lineascan.build |
| ZKsync Sepolia | 300 | testnet | `0xAe045DE5638162fa134807Cb558E15A3F5A7F853` | 6 | Circle | yes | https://sepolia.explorer.zksync.io |
| Polygon Amoy | 80002 | testnet | `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582` | 6 | Circle | no | https://amoy.polygonscan.com |

Left out: Blast (public RPC dead/403), Polygon zkEVM (shut down 2026-07-03), Robinhood Chain (USDG; tx filtering), **Lisk** (chain closed 2 Nov 2026 per lisk.com; last block 30+ min old on 9 Nov), **Taiko** (June 2026 chain-verification/bridge breach — doubt → out). The page also refuses any chain whose latest block (read through the fan's wallet) is older than 10 minutes.
ETH-only chains have no Circle-issued USDC (only bridged variants) — no token address is involved there.
Re-verify: `python3 frontend/scripts/verify-tip-chains.py` — checks code, symbol, decimals, totalSupply, eth_chainId, block age.

## Tempo (added 9 Nov 2026, phase 3)
Tempo Mainnet (chain 4217, https://rpc.tempo.xyz, Stripe × Paradigm) is an EVM **L1** for stablecoin payments with **no gas token**:
a plain `transfer` on a TIP-20 pays its fee in that same token (fee-token precedence rule 3), so the page requires
tip + max fee (+20%) in the stablecoin. Token: **OUSD** `0x20c0000000000000000000006a37da5c996874be` (Open Standard;
docs tempo.xyz/developers/docs/guide/ousd; onchain: OpenUSD / OUSD / 6 decimals / supply ≈ 622M; code = TIP-20 precompile `0xef`).
`eth_getBalance` returns a placeholder, so no native-balance check there. TIP-20 receive policies (T6) may refuse a transfer
→ it reverts, nothing moves. **Real testnet proof (Moderato 42431, real page code, throwaway testnet key):**
1 leg 1.5 OUSD → shaka `0x12536a8e019cd6dec3740b3744061406ed86cfc260bd6be0d5a1c838b413de7c` (artist +1.500000, fee 0.000319 OUSD);
2 legs (fork-only stand-in steward) `0x0cddb068…bc854` + `0x0a7a9c27…cb9a4` = 1.444650 + 0.055350 exactly.

## Tests
- `node --test frontend/test/tip-core.test.mjs` — amounts, split (30k exhaustive + random), calldata vs viem, ENSIP-11, payout
  rules, receipts, ledger, chain table.
- `node --test --test-concurrency=1 frontend/browser/tip.browser.test.mjs` — **anvil forks of the real chains** (Ethereum for
  ENS, Base, BNB, OP, Arbitrum) + an EIP-6963 test wallet: the exact `?who=` circle URL, Base USDC single transfer, BNB 18-dp
  two transfers, OP native ETH, Arbitrum add-chain + reject leg 2 → continue sends only leg 2, wrong decimals / kill switch /
  mainnet off / no wallet / config failure all fail closed, axe WCAG at 1280 and 390 px.

## CROPS review
- **Chosen default:** the fan's own wallet sends plain transfers to addresses read from the artist's own ENS name; static site, no backend.
- **C** — Risk: GitHub Pages can take the page down; the USDC issuer (Circle; Binance on BNB) can freeze an address; L2 sequencers can delay. Mitigation: no backend, no contract; ETH option has no issuer. Escape: send to `<name>.osoartist.eth` from any wallet; self-host the static build (`node frontend/scripts/build-static.mjs`).
- **O/F** — Code is GPL-3.0 on GitHub (repo LICENSE); every address is in `tip-chains.json` with its source; the live build is the gh-pages commit of a pushed branch.
- **P** — Both transfers are public onchain forever (fan address, amount, time). ENS reads go to public RPCs (publicnode, drpc, 1rpc) and reveal the visitor's IP + which names were read (never the wallet address). Balance/gas checks go through the fan's own wallet RPC. No analytics, no cookies; the ledger stays in the browser.
- **S** — No custody; no approvals (plain `transfer`, never `approve`); amounts capped; the steward pin + kill switch fail closed. The ENS owner of an artist name controls where that artist is paid (by design). Walkaway test: if OSO disappears, tips still work by sending to the ENS name directly.
- **Trust assumption (unverified, QA L13):** `osoartist.eth` is owned by Shaka's key `0x2596…c934`, which is also the steward pin and his artist payout. Whether the `.eth`-level owner can replace the osoartist.eth subregistry/resolver (and so re-point `<label>.osoartist.eth`) was not verified — treat Shaka's key as the root of trust for every artist name.
- **Accepted compromises:** public RPCs for ENS reads (configurable in tip-config); stablecoin issuer freeze risk (disclosed on the page).
