# ENS — pay the artist by name (ENSv2, Ethereum mainnet)

Fans pay **`<artist>.osoartist.eth`** — or *any* ENS name — and the x402 Hedera payment goes to whatever payout the
**artist** wrote into **their own resolver**. No artist id is hard-coded once a name is given; a missing record,
missing consent, paused service, wrong network or pinned-account mismatch **fails closed**.

Status (6–7 Nov 2026, ETHGlobal Mumbai): built and **fork-tested on an anvil fork of Ethereum mainnet (43/43 checks)**.
Nothing has been sent to mainnet. Mainnet issuance needs (1) gas for the OSO ops key and (2) one signature from the
owner of `osoartist.eth`. See [ENS-PROOF.md](ENS-PROOF.md) for what to fill in afterwards.

## What is built

| Piece | File |
|---|---|
| `resolvePayTo(name)` → `{path, payTo, hederaAccountId, hcsTopic, resolver, recordId, …}` via the ENSv2 Universal Resolver | [src/resolve-artist.mjs](src/resolve-artist.mjs) |
| HBAR coin-type 3030 codec (= `@ensdomains/address-encoder` `hbar`, tested against it) | [src/hbar.mjs](src/hbar.mjs) |
| Calldata builders: UserRegistry, per-artist PermissionedResolver, register, Shaka's txs | [src/plan.mjs](src/plan.mjs) |
| Consent (EIP-191) verify; canonical text shared with the web page | [src/consent.mjs](src/consent.mjs), [../frontend/public/consent-message.mjs](../frontend/public/consent-message.mjs) |
| Batch onboarding (plan by default; `--send` on a fork; mainnet only with `--mainnet-yes`) | [scripts/onboard.mjs](scripts/onboard.mjs) |
| Full mainnet-fork test incl. negative paths + gas | [scripts/fork-test.mjs](scripts/fork-test.mjs) → [proof/fork-test.json](proof/fork-test.json) |
| Shaka signing kit (exact `to/value/data/chainId` + MetaMask page `/ens-sign`) | [scripts/build-signing-kit.mjs](scripts/build-signing-kit.mjs) → [signing-kit/kit.md](signing-kit/kit.md) |
| Artist consent page (`/consent`, plain `window.ethereum` `personal_sign`, outputs JSON) | [../frontend/public/consent.html](../frontend/public/consent.html) |
| Garden feed of per-artist ENS state (mainnet runs only) | [../frontend/public/fork/registry.json](../frontend/public/fork/registry.json) |
| x402 loop wiring: `ARTIST_NAME=… node scripts/live-e2e.mjs` resolves payTo from ENS and logs name+path in the HCS message | [../scripts/live-e2e.mjs](../scripts/live-e2e.mjs), [../hedera-steward/steward.py](../hedera-steward/steward.py) `--ens-json` |

```sh
npm --prefix ens install
npm run test:ens                                   # 26 unit tests (mock client, calldata decoding, consent)
node ens/scripts/fork-test.mjs                     # starts anvil --fork-url mainnet, impersonates 0x2596, 43 checks
node ens/src/resolve-artist.mjs demo-artist.osoartist.eth --rpc http://127.0.0.1:8545
ENS_RPC_URL=http://127.0.0.1:8545 ARTIST_NAME=demo-artist.osoartist.eth node scripts/live-e2e.mjs --dev
```

## Payout resolution order (`resolvePayTo`)

1. `addr(3030)` — HBAR `0.0.N` (20 bytes `shard u32 | realm u64 | num u64`) → pay that account.
2. `addr(0x80000128)` — ENSIP-11 EVM address on Hedera testnet (chain 296; mainnet 295 = `0x80000127`) → pay it as a Hedera **alias**.
3. `addr(60)` — the name's ETH address → pay it as a Hedera **alias**.

Paying an alias auto-creates a *hollow* Hedera account that only that Ethereum key can finalize and spend — OSO never
holds custody. (The live loop asks the mirror for the alias's `0.0.N`; a never-funded alias must receive any HBAR once
first, e.g. `hedera-steward/fund_oso_aliases.py`, so the steward's forward can be verified.) Any ENS name works,
not only `*.osoartist.eth` — the OSO subname is optional identity, not a requirement to get paid.

Fail-closed gates: text `oso.consent` must be `active` (the artist's own opt-in, written at issuance from their signed
consent; they can flip it); `oso.steward.status` ∈ {paused, frozen, disputed, revoked, suspended} stops OSO-hosted
payments (the one field the steward agent may write — it pauses OSO's service, never the artist's records);
`hedera.network` must match; optional `claimCheck` hook (e.g. Arkiv claim state) and `ARTIST_EXPECT` pin.

## Design (mainnet addresses, contracts-v2 @ `4f47cbcc`)

| Contract | Address |
|---|---|
| ETHRegistry (PermissionedRegistry for `.eth`) | `0xf60aba43e1f7f3dab1186ff03b561401c9df85e2` |
| VerifiableFactory | `0x77510ba162dfea3d8989e3f0928a691b345730d2` |
| UserRegistryImpl | `0xfaa23592aca10a6d8875b18ea86954e8eb6d8d72` |
| PermissionedResolverImpl | `0x565b0f456a04ac9b48758190e90030623cff57c5` |
| UniversalResolver (proxy) | `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` |
| **OSO UserRegistry for osoartist.eth** (deterministic, not deployed yet) | `0xE9d4002cb12a53b50FAA244Cf801Ced40D7c3b48` |
| OSO ops/registrar key (agent, gas payer) | `0xe70050DF1587aA0E5CBD5735D448E5A9C9392293` |
| Steward agent EVM key (status setter only) | `0x3ED964927a6aA93367B6A7fF8922dd6960ed5434` |
| `osoartist.eth` owner (Shaka, MetaMask only) | `0x25965899f4600b3AA5362ee4f34be95E5E62c934` |

Flow (ops key sends everything except the one parent-owner signature):

1. **ops** `VerifiableFactory.deployProxy(UserRegistryImpl, salt, initialize(grants))` — root grants:
   ops = `REGISTRAR | RENEW | SET_PARENT`; Shaka = `REGISTRAR_ADMIN | RENEW_ADMIN | SET_PARENT_ADMIN | SET_URI(+admin)`.
   **Nobody** gets `UPGRADE`/`UPGRADE_ADMIN` or any un-emancipating role → `isEmancipated() == true`, implementation frozen.
2. **ops** `UserRegistry.setParent(ETHRegistry, "osoartist")` (canonical-name pointer only).
3. Per artist, after verifying their EIP-191 consent: **ops** `deployProxy(PermissionedResolverImpl, salt(name), initialize(grants, calls))`.
   `grants` = artist: every resolver role + admin (incl. `UPGRADE` of their own resolver). `calls` (role checks are skipped while
   initializing) write `addr(60)`, `addr(3030)` or `addr(0x80000128)`, texts `hedera.network`, `hedera.hcs.topic`, `url`,
   `oso.consent=active`, `oso.consent.hash`, then `grantSetterRoles(setText(name,"oso.steward.status"), steward)`.
   `grantSetterRoles` checks the *caller's* admin even during init and the caller is the factory, so the factory receives
   `SET_TEXT_ADMIN` in `grants` and the **last call revokes it**. Fork-verified final state: artist = all roles, steward =
   `SET_TEXT` on resource `keccak("oso.steward.status")` only, factory = 0, ops = 0. One resolver **per artist** because EAC roles
   are per resolver instance, not per name.
4. **ops** `UserRegistry.register(label, owner = artist, 0, resolver, tokenRoles, expiry = parent expiry)`; token roles
   = `SET_RESOLVER`, `SET_SUBREGISTRY`, `RENEW`, `UNREGISTER` (+ each admin) and `CAN_TRANSFER_ADMIN`. In PermissionedRegistry
   token **admin** roles can only be assigned at registration — this is the moment the artist gets full control.
5. **Shaka** `ETHRegistry.setSubregistry(osoartist.eth, UserRegistry)` — the activation. Safe in either order; before it,
   names simply do not resolve.

Artists sign **only** the free consent message. Gas measured on the fork: registry 309k once, **820k per artist**,
Shaka 57.5k. At 0.054–0.059 gwei: 3 artists ≈ 0.00016 ETH, 5 artists ≈ 0.00026 ETH (Shaka's wallet holds 0.000477 ETH).

## Sovereignty analysis (honest)

Fork-tested **cannot** (all revert with `EACUnauthorizedAccountRoles` / `LabelAlreadyRegistered` / `EACCannotGrantRoles`):
the OSO ops key, the steward agent and Shaka cannot set an artist's `addr(3030)` payout or any non-delegated text;
neither ops nor Shaka can `unregister`, `setResolver`, `setSubregistry` or re-`register` a live artist name, nor grant
themselves `UPGRADE` on the UserRegistry. The artist **can** change their own payout.

What remains (residual risk, stated plainly):

1. **The parent pointer.** Shaka holds token roles on `osoartist.eth` in the ETHRegistry: `SET_SUBREGISTRY`,
   `SET_RESOLVER` (+ both admins) and `CAN_TRANSFER_ADMIN` (read on-chain: `0x1110…01100000`). With `SET_SUBREGISTRY` he can
   point `osoartist.eth` at a different registry, which would orphan every artist subname at once (it cannot edit them —
   it can make the tree unreachable). Whoever holds `osoartist.eth` (e.g. after a transfer) inherits this. Mitigation:
   the optional, **irreversible** kit tx 3 revokes his own `SET_SUBREGISTRY(+admin)`; fork test shows even he can then no
   longer re-point it and artist names keep resolving. Not recommended to sign tonight without thought.
2. **Parent expiry.** `osoartist.eth` expires **2027-11-06**; artist names are registered with the same expiry. If the parent
   lapses, the whole subtree stops resolving and the `.eth` name could be re-registered by someone else. Anyone can pay the
   ETHRegistrar renewal; artists hold `RENEW` on their own subname; the ops key holds root `RENEW` (extend only). A renewal
   policy (who pays, how far ahead) is still **undecided**.
3. **Registrar powers.** The ops key can create *new* names (not overwrite live ones) and extend expiries. If an artist's
   name expires, the registrar could issue that label to someone else. Shaka (as `REGISTRAR_ADMIN`) can revoke the ops key.
4. **ENS DAO layer.** Per contracts-v2 `roles.md` (read at block 26277207, "pre-handoff" stage) the ENS deployer and DAO still
   hold registry-wide admin roles on the ETHRegistry (SET_PARENT, SET_URI, CAN_NAME, REGISTRAR_ADMIN, …); none of them is
   `UNREGISTER`/`SET_SUBREGISTRY` at root. We rely on ENS governance like every `.eth` holder does.
5. **Steward delegation.** The steward key can set `oso.steward.status` (e.g. `paused`) — by design this pauses OSO-hosted
   payments; it cannot move money. The artist can revoke it (they hold `SET_TEXT_ADMIN`).
6. **Demo keys.** `demo-artist` is a synthetic fixture owned by an agent-generated key (the same synthetic Hedera demo
   artist ECDSA key, so `addr(60)` = its Hedera alias). Real artists use their own wallets; OSO never holds their keys.
7. Consent supports EOAs (EIP-191 `ecrecover`); smart-contract wallets (EIP-1271) are not yet supported.

## Verify on the ENS explorer (after mainnet)

https://explorer.ens.domains/ → search `osoartist.eth` (subregistry = `0xE9d4…3b48`) and `<label>.osoartist.eth`
(owner = the artist, resolver = their own proxy, records `addr 3030`, texts). Or from code:
`node ens/src/resolve-artist.mjs <name>` (mainnet RPC by default).

## ENS feedback (for the ENS team)

- **ENSv2 docs lag the deployment.** The docs' deployments page still listed only Sepolia while mainnet had been live since
  27 Oct 2026; we found mainnet addresses only in `contracts-v2/contracts/deployments/mainnet/addresses.md`. A canonical,
  versioned address page (and `roles.md` linked from the docs) would save builders hours.
- **`grantSetterRoles` during `initialize()`** checks `msg.sender` admin rights, and inside `VerifiableFactory.deployProxy` the
  sender is the factory — so you cannot delegate a single-key setter in the same tx as deployment unless you grant the
  factory a temporary admin role and revoke it in the last `calls` entry (what we do). A first-class `setterGrants` parameter
  in `initialize` would make "deploy a resolver with one delegated record" a clean one-shot.
- **Explaining emancipation for UserRegistry** (`UPGRADE` counts as un-emancipating there) is subtle and important for
  sub-name issuers; a worked "issuer cannot revoke" recipe in the docs would help.
- **Non-EVM coin types**: viem returns raw bytes for `addr(name, 3030)`; documenting the `hbar` 20-byte layout next to
  ENSIP-9 examples would help Hedera builders.
- What worked great: the Universal Resolver made ENSv2 names resolve in stock viem `getEnsAddress` with zero custom code,
  and the EAC errors (`EACUnauthorizedAccountRoles(resource, roles, account)`) made the negative tests self-explaining.

AI assistance: built with Claude (Taurus sysadmin agent) during ETHGlobal Mumbai, 6–7 Nov 2026; earlier README by Codex.
See [prize strategy](../docs/PRIZE-STRATEGY.md).
