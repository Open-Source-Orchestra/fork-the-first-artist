# Entity schema: oso.claims.v1

Owner and creator: the dedicated **server Rabdi wallet**, not the artist's ENS wallet. Every application read filters both. Namespace isolates environments. All records use the same named SDK schema:

| Attribute | Type | Indexed | Contents |
|---|---|---|---|
| namespace | str | yes | Environment identifier |
| kind | str | yes | invite, claim, audit |
| id | str | yes | Random logical record UUID |
| sealed | bytes | no | Versioned AES-256-GCM envelope |

The SDK adds the `arkiv.schema` tag. Entities are created with `readonly: true`; the writer can still delete them. Mutation replaces an entity through an atomic create/create/delete batch. Two state entities with the same logical ID fail closed rather than selecting an arbitrary winner.

An envelope is version byte 1, a 12-byte random nonce, a 16-byte authentication tag, and encrypted JSON. Additional authenticated data binds schema, chain 7794095, lowercase writer address, namespace, kind, and logical ID. Decrypted JSON is capped at 16 KiB. The encryption key is separate from the signer and is never stored on Arkiv. Future key rotation needs an explicit migration; changing the local key alone breaks reads.

Encrypted invite fields: version, kind, id, state, artist, issuedBy, createdAt, expiresAt (milliseconds), tokenHash; revokedAt after revocation. The raw bearer token is never persisted. Logical expiry defaults to 24 hours and is bounded to 1–72 hours.

Reserved claim shape: version, kind, id, inviteId, ensOwner, hederaAccount, hederaNetwork, verifiedAt, activationState, frozen. No production path currently creates a claim. Test fixtures do not establish signature verification. Frozen metadata records time, actor, and reason without changing identity fields.

Encrypted audit fields: action, actor, time, optional reason, recordKind and recordId. A state change and event share a transaction. They are not immutable HCS receipts: the wallet owner can delete them and entities expire.

Entities retain for 30 days by default, configurable 4–180 days; live test fixtures use four days. Arkiv measures expiry in blocks, so calendar duration is approximate. Missing or expired claim state must deny service. Renewal is not automated and is required before long-lived deployment. Expiry/deletion does not erase transaction history or copies held by others.

References: [create flags](https://docs.arkiv.network/writing/create/), [atomic batches](https://docs.arkiv.network/writing/batches/), [changes and deletions](https://docs.arkiv.network/writing/change/), [expiry](https://docs.arkiv.network/writing/expiration/).
