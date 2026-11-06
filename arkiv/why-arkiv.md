# Why Arkiv

The migrated steward state is stored in wallet-authenticated entities and queried through shared RPC infrastructure. Operators can retrieve encrypted state without provisioning an SQL server, and outsiders can inspect writer attribution, entity metadata, and transaction inclusion independently. Chosen expiry maps to bounded demo storage; application invitation deadlines remain separately enforced.

Replacing Arkiv with PostgreSQL would remove this public transaction/entity provenance and shared read interface unless we built another publication layer. PostgreSQL would provide more familiar relational constraints and transactions, easier private indexing, and no onchain fees or expiry management. This migration trades those conveniences for the owner's selected Arkiv integration; it is not a claim that Arkiv is universally better.

Encryption intentionally limits composability: anyone can read the ciphertext, but only the operator can interpret private claims. This feature does not make artists the owners of server entities or publish profiles without consent. An independently readable public artist directory would be a later feature requiring publication choices.

Kept off Arkiv: raw invitation tokens, wallet signatures, signing/encryption keys, unfinished frontend drafts, and actual artist media. No PostgreSQL fallback remains. The frontend draft remains transient browser memory, as before.
