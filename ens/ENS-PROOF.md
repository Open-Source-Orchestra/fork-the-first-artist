# ENS mainnet proof — osoartist.eth (fill in after mainnet)

> **Status: NOT YET ON MAINNET.** Everything below the line is a template. The fork rehearsal is
> [proof/fork-test.json](proof/fork-test.json) (anvil fork of Ethereum mainnet, 43/43 checks, nothing broadcast).

| Step | Signer | Tx hash | Etherscan |
|---|---|---|---|
| fund ops key `0xe70050DF1587aA0E5CBD5735D448E5A9C9392293` | Shaka / teammate | `TODO` | |
| deploy UserRegistry → `0xE9d4002cb12a53b50FAA244Cf801Ced40D7c3b48` | ops | `TODO` | |
| setParent(ETHRegistry, "osoartist") | ops | `TODO` | |
| deploy resolver `<label>.osoartist.eth` → `TODO` | ops | `TODO` | |
| register `<label>.osoartist.eth` → owner `TODO` | ops | `TODO` | |
| **setSubregistry(osoartist.eth → UserRegistry)** | **Shaka 0x2596…c934** | `TODO` | |

Resolution check (paste output of `node ens/src/resolve-artist.mjs <name>`):

```json
TODO
```

Explorer: https://explorer.ens.domains/ → `<label>.osoartist.eth` (owner = artist wallet, resolver = artist proxy).

x402 run with the ENS name: `ARTIST_NAME=<label>.osoartist.eth STEWARD_PYTHON=… HCS_TOPIC_ID=0.0.11345907 node scripts/live-e2e.mjs --live`
→ docs/TX-PROOF.md "Artist resolved by ENS name" section + HCS message field `ens`.
