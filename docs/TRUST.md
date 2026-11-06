# The circle's chain of trust — who may bring an artist in

Nobody claims a name in the circle alone, and nobody is paid in an artist's name without them.

```
root steward  = owner of osoartist.eth (today: Shaka, 0x2596…c934)      frontend/public/fork/stewards.json
  └─ steward grant   root signs "I trust this person to invite and approve"   (/admin → 03 grow the circle)
      └─ invitation  a steward signs "I invite <artist> to claim <label>.osoartist.eth"   (/admin → 01)
          └─ consent  the ARTIST signs with their own wallet, quoting the invitation id    (/consent?invite=…)
              └─ approval  a steward checks it and signs, quoting the consent hash         (/admin → 02)
                  └─ issuance  ens/scripts/onboard.mjs re-verifies every link, then the ops key
                               issues <label>.osoartist.eth OWNED BY THE ARTIST'S WALLET
```

* Every link is a free EIP-191 signature (no gas, no funds). Message text is built by one module,
  `frontend/public/trust-message.mjs`, used by the browser pages and by the issuer (`ens/src/trust.mjs`).
* Invitation links carry no secret. A leaked link is harmless: it still needs the artist's own signature
  and a steward's approval. A steward may also bind the invitation to the artist's known wallet.
* Invitations expire (1–30 days). The approval binds the exact consent (hash), payout and wallet, so a
  changed payout after approval is refused.
* `onboard.mjs` refuses any consent without a valid invitation **and** approval from a trusted steward;
  only local anvil rehearsals with synthetic fixtures may pass `--rehearsal-no-trust`.

## How it grows
Today Shaka is the single point of trust. The root can grant stewards now (signed grants in
`stewards.json`, verified by every page and by the issuer). Next steps, in order:
1. record grants, invitations and approvals as Arkiv entities (the claims package already models
   encrypted invitations with issue/revoke) so the history is queryable and revocable;
2. two-of-N steward approvals for new artists;
3. steward roles held on the ENS name itself (ENSv2 role-based registries), so the circle's trust
   lives on-chain and outlives any one key.

Tests: `npm run test:ens` (trust chain incl. refusals), `npm run test:frontend:browser`
(`browser/trust.browser.test.mjs`: invite → consent → approve through the real pages, accepted by the issuer).

## On Arkiv — the trust ledger (Shaka's "option 1", 7 Nov 2026)
The ʻohana's Arkiv writer `0x8e9d4dEc12bc9Da62daB72304659ef1eE6B200f2` (Rabdi testnet) **stores** every
signed link; the signatures remain the authority. Records are public, read-only `oso.trust.v1` entities
(namespace `oso-circle-trust`; attributes kind/id/label/steward + the signed payload as bytes), so anyone
can re-verify them from Arkiv alone. **`/trust`** queries Arkiv's public RPC and re-verifies every
signature in the browser against `stewards.json`.

```sh
node --env-file=claims/.env claims/scripts/record-trust.mjs approved-<label>.json   # or an invite link, or a grant
```
The script verifies the whole chain first (same checks as the issuer), skips anything already recorded,
writes all new links in one Arkiv batch and appends `frontend/public/fork/trust-log.json`.

**Rehearsal proof (synthetic artist, throwaway root key, namespace `oso-circle-trust-rehearsal`):**
invite + consent + approval written in one batch, tx
[`0x8cb40cd2…eab33`](https://rabdi.explorer.arkiv.network/tx/0x8cb40cd205b262a17bd08fbe14ef438b1131c8fa6457c274c0bc1619540eab33)
(block 310322, status success); a re-run skipped all three; `/trust` reads them live and shows the
consent verified to the artist's wallet and the invite/approval as "valid signature, not a trusted steward".
