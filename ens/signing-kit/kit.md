# Shaka signing kit — osoartist.eth (ENSv2, Ethereum mainnet)

Generated 2026-11-06T22:43:21.342Z from mainnet block 26358871 (gas 0.052608515 gwei). Sign from **0x25965899f4600b3AA5362ee4f34be95E5E62c934** in MetaMask, chain **Ethereum mainnet (1)**. Page: `/ens-sign` (frontend/public/ens-sign.html).

Your balance: 0.00047740097134096 ETH · needed for fund + activation: ~0.0003623924617934 ETH → enough.

## 1. Send 0.00035 ETH to the OSO ops key (gas for 5 artists)

A normal ETH transfer from your wallet to the OSO registrar/ops key 0xe70050DF1587aA0E5CBD5735D448E5A9C9392293. It pays the gas to create the OSO artist registry and 5 artist names + their own resolvers. Skip this if a teammate funds the ops key instead.

| field | value |
|---|---|
| from | `0x25965899f4600b3AA5362ee4f34be95E5E62c934` |
| to | `0xe70050DF1587aA0E5CBD5735D448E5A9C9392293` |
| value | `0x13e52b9abe000` (0.00035 ETH) |
| chainId | 1 |
| gas (fork-measured) | 21000 |

```
0x
```

## 2. Activate osoartist.eth: point its subnames at the OSO artist registry — **REQUIRED**

Calls ETHRegistry.setSubregistry on YOUR name osoartist.eth so that <artist>.osoartist.eth is looked up in the OSO UserRegistry 0xE9d4002cb12a53b50FAA244Cf801Ced40D7c3b48. Each artist's name in that registry is owned by the artist's own wallet; neither OSO nor you can take it back, change its resolver or its payout (fork-tested). You can later re-point osoartist.eth (that is the one power you keep) unless you also sign the optional lock.

| field | value |
|---|---|
| from | `0x25965899f4600b3AA5362ee4f34be95E5E62c934` |
| to | `0xf60aba43E1f7F3DAB1186Ff03B561401C9Df85E2` |
| value | `0x0` (0 ETH) |
| chainId | 1 |
| gas (fork-measured) | 57520 |

```
0x341ec559298a2e5a2bb87f2f8f31df9991f0e4d57cd09ad956f9d118bbb5470900000000000000000000000000000000e9d4002cb12a53b50faa244cf801ced40d7c3b48
```

## 3. OPTIONAL · IRREVERSIBLE: give up re-pointing osoartist.eth forever

Revokes your own SET_SUBREGISTRY role (and its admin) on osoartist.eth. After this nobody — not you, not OSO — can swap the artist registry out from under the artists. You keep ownership, renewal and resolver of osoartist.eth. Do NOT sign tonight unless you are sure; it cannot be undone.

| field | value |
|---|---|
| from | `0x25965899f4600b3AA5362ee4f34be95E5E62c934` |
| to | `0xf60aba43E1f7F3DAB1186Ff03B561401C9Df85E2` |
| value | `0x0` (0 ETH) |
| chainId | 1 |
| gas (fork-measured) | 79750 |

```
0xdfa70d8b298a2e5a2bb87f2f8f31df9991f0e4d57cd09ad956f9d118bbb5470900000000000000000000000000000000001000000000000000000000000000000010000000000000000000000000000025965899f4600b3aa5362ee4f34be95e5e62c934
```

## Sent by agents (not you)

- ops 0xe70050DF1587aA0E5CBD5735D448E5A9C9392293: VerifiableFactory.deployProxy(UserRegistryImpl) → 0xE9d4002cb12a53b50FAA244Cf801Ced40D7c3b48; setParent(ETHRegistry,"osoartist")
- ops, per artist: deployProxy(PermissionedResolverImpl, initialize(grants=artist ALL roles, records…)) + UserRegistry.register(label, owner=artist)
- script: `node ens/scripts/onboard.mjs --consents <dir> --rpc <mainnet> --send --mainnet-yes "<your yes>"`
