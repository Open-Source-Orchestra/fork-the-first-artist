# Live end-to-end run (HBAR x402 → 0G steward → on-chain split)

One command drives the whole money loop and writes the public proof:

```bash
node scripts/live-e2e.mjs --live        # or: npm run e2e:live   /   scripts/live-e2e.sh --live
```

| # | Step | Code | What is proven |
|---|---|---|---|
| 1 | Payments rail on Hedera testnet, **native HBAR** (`HEDERA_ASSET=0.0.0`, 8 decimals), `ASK_PAYEE=steward` | `payments/` | 402 challenge in tinybars, facilitator-settled transfer |
| 2 | Artist steward agent, brain = **0G** `0gm-1.0-35b-a3b` via the x402 meter (steward pays 0.01 HBAR per call) | `agent/` | meter tx ↔ 0G request id |
| 3 | **Autonomous fan agent**: `POST /ask` → 402 → sign HBAR `TransferTransaction` → retry with `X-PAYMENT` | `agent/scripts/demo.ts` | fan → steward 1 HBAR settlement tx |
| 4 | **Post-settlement steward split** by Utkarsh Tiwari (@utkarshhs): verifies the settlement on the mirror node, forwards **96.31%** to the artist, keeps **3.69%** for 0G compute, logs the split to **HCS** | `hedera-steward/steward.py direct` | transfer tx + HCS message, both re-read from the mirror |
| 5 | Proof: tx ids, HashScan links, 0G request ids | → `docs/TX-PROOF.md` + `docs/TX-PROOF.json` | secrets are refused in the output |

Nothing secret is printed or written: keys come from the accounts file / key file and are
passed to child processes through their environment only, and the runner aborts if any
key value appears in the proof files. Testnet only.

## 0. Prerequisites (once)

```bash
npm run install:all                                   # @x402/hedera, @hiero-ledger/sdk are optionalDependencies
python3 -m venv hedera-steward/.venv && hedera-steward/.venv/bin/pip install -r hedera-steward/requirements.txt
# (on the demo box the venv already exists at /workspace/utkarsh-hedera/.venv; or set STEWARD_PYTHON)
```

Inputs the runner reads (never committed):

| Input | Default | Notes |
|---|---|---|
| accounts file | `$STEWARD_ACCOUNTS_ENV`, else `/workspace/vault/ethglobal-mumbai/fork-first-artist-hedera-demo-20261106/accounts.env` | `FORK_DEMO_{FAN,ARTIST,COMPUTE,METER}_{EVM_ADDRESS,PRIVATE_KEY,ACCOUNT_ID}`; empty `ACCOUNT_ID` is resolved from the EVM alias on the mirror node |
| 0G key | `$ZEROG_API_KEY`, else file `$ZEROG_API_KEY_FILE` (default `/workspace/vault/ethglobal-mumbai/zerog-router-api-key`) | used by the meter (and by `--steward agent`) |
| `PRICE_ASK` / `PRICE_METER` | `1` / `0.01` HBAR | |
| `HCS_TOPIC_ID` | unset → steward creates a topic `OSO-Steward-Log` | reuse it on later runs |
| `--steward agent` | `direct` | LLM Hedera Agent Kit steward on 0G instead of the deterministic SDK path |

## 1. Fund the four demo accounts

Send testnet HBAR to the four **EVM aliases** (any HashPack / portal faucet / teammate
transfer). The first transfer auto-creates each `0.0.N` account.

| Role | Needs | Why |
|---|---|---|
| fan | ≥ 1.2 HBAR | pays the 1 HBAR ask (the facilitator sponsors the fee) |
| compute (steward) | ≥ 0.5 HBAR | pays 0.01 HBAR per 0G meter call, the forward-transfer fee, HCS topic + message fees |
| artist | any (≥ 0.01) | must exist as an account to be credited |
| meter | any (≥ 0.01) | must exist; receives meter payments |

Check readiness (prints `READY` / `NOT READY`, never secrets):

```bash
npm run steward:check
```

## 2. Run live

```bash
node scripts/live-e2e.mjs --live
git add docs/TX-PROOF.md docs/TX-PROOF.json && git commit -m "docs: live testnet tx proof"
```

The runner refuses to start if any account is unfunded, if two roles share an account, if
the fan/steward balance is too low, or if there is no 0G key. It fails loudly if no real 0G
request id is recorded, or if the steward split is not verified on the mirror node.

Per-run logs (payments, agent, fan, steward) and the raw `proof.json` are in
`.tmp/live-e2e/<timestamp>/` (gitignored).

## 3. Rehearse without funds

```bash
node scripts/live-e2e.mjs --dev              # mock settlement, mock 0G, steward --dry-run; fully offline
node scripts/live-e2e.mjs --dev --real-0g    # mock settlement, REAL 0G inference through the meter
```

Dev proof goes to `.tmp/live-e2e/TX-PROOF.dev.md` and is labelled **DEV RUN — nothing here
is on-chain**, so a rehearsal can never overwrite the real `docs/TX-PROOF.md`.

## Step-by-step equivalent (for debugging)

```bash
# payments (HBAR rail)
cd payments && cp .env.hbar.example .env   # fill HEDERA_*_ACCOUNT_ID, UPSTREAM_API_KEY, PAYMENTS_MODE=live
npm start
# steward agent (other shell)
cd agent && PAYMENTS_MODE=live HEDERA_ASSET=0.0.0 HEDERA_ASSET_DECIMALS=8 PAYER_MAX_PER_PAYMENT=0.05 \
  METER_PRICE_PER_CALL_USD=0.01 BUDGET_PER_REQUEST_USD=0.05 HEDERA_AGENT_ACCOUNT_ID=<compute> \
  HEDERA_AGENT_PRIVATE_KEY=<compute key> npm start
# fan (third shell)
cd agent && PAYMENTS_MODE=live HEDERA_ASSET=0.0.0 HEDERA_FAN_ACCOUNT_ID=<fan> HEDERA_FAN_PRIVATE_KEY=<fan key> \
  node scripts/demo.ts "Who are you?"
# split the settled payment (tx id from the demo output / ledger)
$PY hedera-steward/steward.py direct --settled-tx <ask tx id> --amount-hbar 1 --artist-name aniket.oso.eth --json-out proof.json
```

## Honest notes

- One x402 `exact` payment is one transfer to one `payTo`. With `ASK_PAYEE=steward` the
  96.31 / 3.69 split becomes **real** only when step 4's forward transfer is confirmed on
  the mirror node — that is what `docs/TX-PROOF.md` shows. With `ASK_PAYEE=artist` the
  split stays a preview (`splitVerified: false`).
- The steward account is the artist's own steward agent wallet, never an OSO account; OSO
  takes 0%.
- 0G tool calling works with `chat_template_kwargs.enable_thinking=false`
  (`hedera-steward/ZEROG-TOOLCALL-TEST.md`), so `--steward agent` can run the Hedera Agent
  Kit on 0G; `direct` stays the default because a 35B model's tool arguments are still
  only trusted after mirror verification.
- `teeVerified` is reported as returned by 0G (`x_0g_trace.tee_verified`); it is not
  claimed when 0G does not return it.
