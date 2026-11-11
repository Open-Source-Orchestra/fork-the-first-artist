#!/usr/bin/env python3
# Re-verify every chain + USDC address offered by the 💸 multichain tip (frontend/public/tip-chains.json):
# eth_chainId matches, latest block fresh, token code present, symbol/name/decimals/totalSupply. Read-only, public RPCs.
#   python3 frontend/scripts/verify-tip-chains.py   → prints one JSON line per chain + writes verify-result.json in the CWD
import json, sys, time, urllib.request
# chainId -> (key, label, rpc, usdc address or None, source)
CHAINS = [
 (1,'ethereum','Ethereum','https://ethereum-rpc.publicnode.com','0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48','circle'),
 (8453,'base','Base','https://mainnet.base.org','0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913','circle'),
 (10,'optimism','OP Mainnet','https://mainnet.optimism.io','0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85','circle'),
 (42161,'arbitrum','Arbitrum One','https://arb1.arbitrum.io/rpc','0xaf88d065e77c8cC2239327C5EDb3A432268e5831','circle'),
 (480,'worldchain','World Chain','https://worldchain-mainnet.g.alchemy.com/public','0x79A02482A880bCe3F13E09da970dC34dB4cD24D1','circle'),
 (130,'unichain','Unichain','https://mainnet.unichain.org','0x078D782b760474a361dDA0AF3839290b0EF57AD6','circle'),
 (59144,'linea','Linea','https://rpc.linea.build','0x176211869cA2b568f2A7D4EE941E073a821EE1ff','circle'),
 (324,'zksync','ZKsync Era','https://mainnet.era.zksync.io','0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4','circle'),
 (42220,'celo','Celo','https://forno.celo.org','0xcebA9300f2b948710d2653dD7B07f33A8B32118C','circle'),
 (57073,'ink','Ink','https://rpc-gel.inkonchain.com','0x2D270e6886d130D724215A266106e6832161EAEd','circle'),
 (137,'polygon','Polygon PoS','https://polygon-bor-rpc.publicnode.com','0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359','circle'),
 (56,'bnb','BNB Smart Chain','https://bsc-dataseed1.bnbchain.org','0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d','binance-peg (bscscan label)'),
 (4217,'tempo','Tempo','https://rpc.tempo.xyz','0x20c0000000000000000000006a37da5c996874be','tempo docs: tempo.xyz/developers/docs/guide/ousd'),
 (534352,'scroll','Scroll','https://rpc.scroll.io',None,''),
 (1868,'soneium','Soneium','https://rpc.soneium.org',None,''),
 (7777777,'zora','Zora','https://rpc.zora.energy',None,''),
 (34443,'mode','Mode','https://mainnet.mode.network',None,''),
 # testnets
 (11155111,'sepolia','Ethereum Sepolia','https://ethereum-sepolia-rpc.publicnode.com','0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238','circle'),
 (84532,'base-sepolia','Base Sepolia','https://sepolia.base.org','0x036CbD53842c5426634e7929541eC2318f3dCF7e','circle'),
 (11155420,'op-sepolia','OP Sepolia','https://sepolia.optimism.io','0x5fd84259d66Cd46123540766Be93DFE6D43130D7','circle'),
 (421614,'arbitrum-sepolia','Arbitrum Sepolia','https://sepolia-rollup.arbitrum.io/rpc','0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d','circle'),
 (4801,'worldchain-sepolia','World Chain Sepolia','https://worldchain-sepolia.g.alchemy.com/public','0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88','circle'),
 (1301,'unichain-sepolia','Unichain Sepolia','https://sepolia.unichain.org','0x31d0220469e10c4E71834a79b1f276d740d3768F','circle'),
 (59141,'linea-sepolia','Linea Sepolia','https://rpc.sepolia.linea.build','0xFEce4462D57bD51A6A552365A011b95f0E16d9B7','circle'),
 (300,'zksync-sepolia','ZKsync Sepolia','https://sepolia.era.zksync.dev','0xAe045DE5638162fa134807Cb558E15A3F5A7F853','circle'),
 (11142220,'celo-sepolia','Celo Sepolia','https://forno.celo-sepolia.celo-testnet.org','0x01C5C0122039549AD1493B8220cABEdD739BC44E','circle'),
 (763373,'ink-sepolia','Ink Sepolia','https://rpc-gel-sepolia.inkonchain.com','0xFabab97dCE620294D2B0b0e46C68964e326300Ac','circle'),
 (80002,'polygon-amoy','Polygon Amoy','https://polygon-amoy-bor-rpc.publicnode.com','0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582','circle'),
 (42431,'tempo-moderato','Tempo Moderato','https://rpc.moderato.tempo.xyz','0x20c0000000000000000000006a37da5c996874be','tempo docs (testnet OUSD, same address)'),
 (97,'bnb-testnet','BNB Smart Chain Testnet','https://data-seed-prebsc-1-s1.bnbchain.org:8545',None,''),
]
def rpc(url, method, params):
    req = urllib.request.Request(url, data=json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':params}).encode(), headers={'content-type':'application/json','user-agent':'oso-verify/1'})
    with urllib.request.urlopen(req, timeout=20) as r: j = json.load(r)
    if 'error' in j: raise Exception(j['error'])
    return j['result']
def call(url, to, data): return rpc(url,'eth_call',[{'to':to,'data':data},'latest'])
def dstr(h):
    b = bytes.fromhex(h[2:])
    if len(b) == 32: return b.rstrip(b'\0').decode(errors='replace')
    off = int.from_bytes(b[:32],'big'); ln = int.from_bytes(b[off:off+32],'big'); return b[off+32:off+32+ln].decode(errors='replace')
out = []
for cid,key,label,url,usdc,src in CHAINS:
    r = {'chainId':cid,'key':key,'label':label,'rpc':url,'usdc':usdc,'source':src}
    try:
        r['rpcChainId'] = int(rpc(url,'eth_chainId',[]),16)
        blk = rpc(url,'eth_getBlockByNumber',['latest',False]); r['block']=int(blk['number'],16); r['blockAgeS']=int(time.time())-int(blk['timestamp'],16)
        if usdc:
            code = rpc(url,'eth_getCode',[usdc,'latest']); r['codeBytes']=(len(code)-2)//2
            r['symbol']=dstr(call(url,usdc,'0x95d89b41')); r['name']=dstr(call(url,usdc,'0x06fdde03'))
            r['decimals']=int(call(url,usdc,'0x313ce567'),16); r['totalSupply']=int(call(url,usdc,'0x18160ddd'),16)
            r['totalSupplyHuman']=r['totalSupply']/10**r['decimals']
        r['ok'] = r['rpcChainId']==cid and r['blockAgeS']<300 and (not usdc or (r['codeBytes']>0 and r['totalSupply']>0 and r['symbol'] in ('USDC','USDC.e','OUSD')))
    except Exception as e:
        r['error']=str(e)[:200]; r['ok']=False
    out.append(r); print(json.dumps({k:r.get(k) for k in ('chainId','label','rpcChainId','blockAgeS','symbol','name','decimals','totalSupplyHuman','codeBytes','ok','error')}), flush=True)
json.dump({'checkedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'results':out}, open('verify-result.json','w'), indent=1)
