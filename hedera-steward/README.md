# Hedera steward — Fork the First Artist (ETHGlobal Mumbai 2026)

> Original steward script by Utkarsh Tiwari ([@utkarshhs](https://github.com/utkarshhs)); hardened for the demo by the OSO team.
> His original is kept, unchanged, in [`original/steward_utkarsh.py`](original/steward_utkarsh.py).

This is the step that runs **after settlement**. A fan's x402 payment settles to the artist's
steward (compute) account. The steward then:

1. **splits** the amount with integer tinybar math: **96.31% to the artist, 3.69% kept for 0G
   agent compute, 0% to OSO**;
2. **transfers** the artist share to a *distinct* artist account (it refuses to pay itself);
3. **logs** the split as JSON to a Hedera Consensus Service (HCS) topic;
4. **checks** the transfer and the HCS message on the public **mirror node**. It never trusts
   LLM text for transaction IDs. It prints HashScan links and can write a public-safe proof JSON.

**TESTNET ONLY.** A mainnet `HEDERA_NETWORK` is refused. Keys are never printed or written to the proof.

## Modes

| command | what it does |
|---|---|
| `check` | For each role (fan / artist / compute / meter): EVM alias, resolved `0.0.N` account or `NOT FOUND (unfunded)`, and HBAR balance from the mirror. Prints `READY` / `NOT READY`. Always exits 0. |
| `direct` | Deterministic, no LLM. Uses `hiero_sdk_python`: `TransferTransaction` (steward −artist share, artist +artist share), `TopicCreateTransaction` (only if no `--topic-id`), and `TopicMessageSubmitTransaction`. Then checks the mirror. |
| `agent` | Utkarsh's design: `HederaLangchainToolkit` + LangGraph `create_react_agent`. The brain is **0G** by default (`--llm 0g`); `--llm groq` is also available. The agent gets only an **exact tool allowlist**: `transfer_hbar_tool`, `create_topic_tool`, `submit_topic_message_tool`. Then the mirror is checked. |
| `--dry-run` | Works with `direct` and `agent`. Computes the split, validates arguments and accounts, and prints the exact transfer and HCS message it *would* submit. Makes **no chain, mirror or LLM calls**, and accepts mock settled ids (`mock-…`). The proof JSON has `mode: "dry-run"`, `status: "not-submitted"` and `verified: false`. |

Input (choose one):
- `--settled-tx <x402 settlement tx id> --amount-hbar X` is the real flow. The settlement tx is
  checked on the mirror: it must be `SUCCESS` and must have credited the steward account with at
  least X HBAR. X is then split.
  The demo rail runs in **native HBAR** (`payments/.env.hbar.example`: `HEDERA_ASSET=0.0.0`,
  `ASK_PAYEE=steward`), so the fan's x402 payment lands on the steward in HBAR and this is a
  like-for-like split. `scripts/live-e2e.mjs` wires it end to end (see `docs/LIVE-E2E.md`).
  If the rail is switched back to an HTS token (testnet USDC `0.0.429274`, 6 decimals),
  add `--settled-asset 0.0.429274 --settled-amount 1.00`. The steward then checks the token credit,
  and still pays out the HBAR-denominated split given by `--amount-hbar`.
- `--amount-hbar X --demo-amount` is labelled **"DEMO AMOUNT (not a real fan payment)"** in the
  console output, the HCS message, the transfer memo, and the proof JSON.

## Run

```bash
cd hedera-steward
python -m venv .venv && .venv/bin/pip install -r requirements.txt   # or reuse an existing venv
.venv/bin/python steward.py check
.venv/bin/python steward.py direct --amount-hbar 1 --demo-amount --artist-name aniket.oso.eth --json-out proof.json
.venv/bin/python steward.py direct --settled-tx 0.0.1234@1793999000.123456789 --amount-hbar 1 --json-out proof.json
.venv/bin/python steward.py agent  --llm 0g --amount-hbar 1 --demo-amount --topic-id 0.0.XXXX --json-out proof-agent.json
.venv/bin/python steward.py direct --settled-tx mock-x402-1 --amount-hbar 1 --dry-run --json-out dry.json
.venv/bin/python -m pytest -q        # fully offline
```

Exit codes: `0` ok (and always for `check`/`--dry-run`), `2` config/safety refusal, `3` mirror verification failed.
On failure, `--json-out` still writes `{verified: false, status, error}`.

## Configuration

The env file is resolved in this order: `--env-file`, then `$STEWARD_ACCOUNTS_ENV`, then the team vault `accounts.env` (if it exists), then `./.env`.
Process environment variables override the file. Names are in [`.env.example`](.env.example).

- steward operator = **COMPUTE** role: `STEWARD_ACCOUNT_ID` → `FORK_DEMO_COMPUTE_ACCOUNT_ID` → `ACCOUNT_ID`;
  key: `STEWARD_PRIVATE_KEY` → `FORK_DEMO_COMPUTE_PRIVATE_KEY` → `PRIVATE_KEY` (ECDSA hex, `0x` optional)
- artist = **ARTIST** role: `ARTIST_ACCOUNT_ID` → `FORK_DEMO_ARTIST_ACCOUNT_ID`
- If an `*_ACCOUNT_ID` is empty but `*_EVM_ADDRESS` is set, it is resolved with mirror `GET /api/v1/accounts/<evm>`.
  Funding an EVM alias with HBAR auto-creates its `0.0.N` account.
- Split: `STEWARD_ARTIST_BPS` / `STEWARD_COMPUTE_BPS` (default 9631/369; must sum to 10000).
- LLM: `ZEROG_API_KEY` or `ZEROG_API_KEY_FILE` (0G router `https://router-api.0g.ai/v1`, model `0gm-1.0-35b-a3b`,
  sent with `chat_template_kwargs.enable_thinking=false`); Groq: `OPENAI_API_KEY`;
  generic overrides `LLM_BASE_URL`, `LLM_MODEL`. See [`ZEROG-TOOLCALL-TEST.md`](ZEROG-TOOLCALL-TEST.md):
  0G tool calling **works**.

## What was hardened (vs. the original)

1. **Distinct artist.** The original's `__main__` paid `ACCOUNT_ID` to itself. Now artist == steward → refused.
2. **Exact tool allowlist.** The original's substring filter (`"hbar"`/`"topic"`) also admitted
   `delete_topic_tool`, `update_topic_tool`, `approve_hbar_allowance_tool`, `delete_hbar_allowance_tool`, and
   `transfer_hbar_with_allowance_tool`. Now exactly three tools are allowed. A missing tool causes a failure, and any non-allowlisted tool call is rejected.
3. **Integer math.** `compute = total × 369 // 10000` and `artist = total − compute`, in tinybar (1 HBAR = 10⁸ tinybar).
   Decimal parsing refuses more than 8 decimals. `calculate_steward_split()` is still available (now returns exact strings + tinybars).
4. **Mirror-verified results.** The artist must be credited *exactly* the artist share, in a `SUCCESS` CRYPTOTRANSFER
   paid by the steward. The HCS message is found by a unique marker, polled for up to `--timeout` (30 s) to allow for mirror lag.
   Topic ids created by the agent are discovered from the steward's `CONSENSUSSUBMITMESSAGE` records, not from LLM text.
5. **Settlement-aware input.** See above.
6. **0G brain.** 0G is the default, and response ids / `x-request-id` are recorded in the proof `llm` field.

## Safety

- Testnet only. No social posting. Secrets come from the git-ignored env or vault and are never printed. The proof JSON is checked for secret strings before it is written.
- A tool-calling LLM can still choose wrong amounts or recipients. The mirror check catches this after the fact (it cannot undo a transfer).
  Use small amounts, and prefer `direct` for the stage demo.

## hiero_sdk_python 0.2.0 notes (checked by introspection, not guessed)

- `TransferTransaction.add_hbar_transfer(AccountId, int|Hbar)`: an `int` is **tinybar**; zero raises; repeated accounts are summed.
- `Transaction.execute(client)` freezes, signs with the operator, and returns a `TransactionReceipt`.
  `receipt.status` is the raw int enum; compare with `ResponseCode.SUCCESS` (an IntEnum, value 22).
  `receipt.topic_id` and `receipt.topic_sequence_number` are available.
- **`TransactionId.to_string()` does not zero-pad nanos** (`0.0.5@1700000000.5` means nanos=5).
  `to_mirror_tx_id()` reads nanos as an integer and pads them to 9 digits.
- `TopicCreateTransaction(memo=…, admin_key=…)` and `TopicMessageSubmitTransaction(topic_id=TopicId, message=str)` both use constructor kwargs.
- hedera-agent-kit 3.4.2 `transfer_hbar_tool` takes float HBAR `amount` values (with `transaction_memo` and `source_account_id`).
  This is another reason the exact-tinybar mirror check exists.
