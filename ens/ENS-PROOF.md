# ENS mainnet proof — osoartist.eth → shaka.osoartist.eth (LIVE, 7 Nov 2026)

The first artist name of the circle is live on **Ethereum mainnet (ENSv2)**, owned by the artist's own wallet,
issued only after the full trust chain (steward invitation → artist consent → steward approval, see
[docs/TRUST.md](../docs/TRUST.md)), and a real x402 tip on Hedera was paid **by that name**.

| Step | Signer | Tx hash |
|---|---|---|
| fund ops key `0xe70050DF1587aA0E5CBD5735D448E5A9C9392293` (0.00035 ETH) | **Shaka 0x2596…c934** | [`0x4f7fc1e1…`](https://etherscan.io/tx/0x4f7fc1e11224c795b74fb3fb81d6458aca02b652d527013613662d4127d6ed49) |
| **setSubregistry(osoartist.eth → UserRegistry)** | **Shaka 0x2596…c934** | [`0x733afe7b…`](https://etherscan.io/tx/0x733afe7bd89835f80d0a5ede1172815debc431177361716fa60fa88385f086c1) |
| deploy UserRegistry → `0xE9d4002cb12a53b50FAA244Cf801Ced40D7c3b48` | ops | [`0xe5b249ee…`](https://etherscan.io/tx/0xe5b249ee45ade074778a00b53230e375433bb50a34fead2ad012843e1465cdf8) |
| setParent(ETHRegistry, "osoartist") | ops | [`0x79bc7d5d…`](https://etherscan.io/tx/0x79bc7d5d69d82b54ba7c9697af6ac7c814afa29148f5206977b06d699f35a4af) |
| deploy resolver `shaka.osoartist.eth` → `0xdDFf981748Ec5F6D6618D830E90ba964DaA60Fb1` (artist holds all roles) | ops | [`0x520af5a5…`](https://etherscan.io/tx/0x520af5a53381c22f7ff56db11b1847d710eea10363eb31f4eabdd9e0dcaf30ef) |
| register `shaka.osoartist.eth` → owner `0x25965899f4600b3AA5362ee4f34be95E5E62c934` | ops | [`0x1d2156d8…`](https://etherscan.io/tx/0x1d2156d8ae1d8714cf5a1dd9e3efbee72b44bad90db7b469d6b7253d31a65968) |

Trust chain on Arkiv (Rabdi, writer 0x8e9d…00f2, namespace `oso-circle-trust`): invitation
[`0xce30c902…`](https://rabdi.explorer.arkiv.network/tx/0xce30c902951a465c35cf70d6f8c2ea41db2ca16286266422019036ed18c10cae) (block 311905),
consent + approval [`0x89865088…`](https://rabdi.explorer.arkiv.network/tx/0x898650884db2649b53e53394d5a28ed0f082948d4b101e4e79d475c48f832f0e) (block 311928).
Live view: https://artist.opensourceorchestra.org/trust/

Resolution check (`node ens/src/resolve-artist.mjs shaka.osoartist.eth`, Universal Resolver on mainnet):

```json
{
  "name": "shaka.osoartist.eth",
  "network": "testnet",
  "hcsTopic": "0.0.11345907",
  "resolver": "0xdDFf981748Ec5F6D6618D830E90ba964DaA60Fb1",
  "recordId": "1",
  "consent": "active",
  "stewardStatus": null,
  "stewardUrl": null,
  "path": "hedera-evm",
  "coinType": "2147483944",
  "hederaAccountId": null,
  "hederaAlias": "0x25965899f4600b3AA5362ee4f34be95E5E62c934",
  "payTo": "0x25965899f4600b3AA5362ee4f34be95E5E62c934"
}
```

**x402 tip paid by ENS name** (`node scripts/live-e2e.mjs --live --artist-name shaka.osoartist.eth`, Hedera testnet):
fan x402 payment `0.0.9185802@1794009702.803350043` → steward pays 0G meter → **0.9631 HBAR forwarded to Shaka's alias account
[`0.0.11347291`](https://hashscan.io/testnet/account/0.0.11347291)** in
[`0.0.11345897-1794009707-097642660`](https://hashscan.io/testnet/transaction/0.0.11345897-1794009707-097642660) (mirror: SUCCESS)
→ HCS [topic 0.0.11345907 seq 9](https://hashscan.io/testnet/topic/0.0.11345907) with `"artist":"shaka.osoartist.eth"`. Full table: [docs/TX-PROOF.md](../docs/TX-PROOF.md).
The alias account was created by sending it 1 testnet HBAR; only Shaka's key controls it.

Explorer: https://app.ens.domains/shaka.osoartist.eth · fork rehearsal: [proof/fork-test.json](proof/fork-test.json) (43/43).
