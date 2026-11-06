#!/usr/bin/env python3
"""OSO Hedera steward — Fork the First Artist (ETHGlobal Mumbai 2026).

Original steward script by Utkarsh Tiwari (@utkarshhs); hardened for the demo by the OSO team.
(Original kept verbatim in original/steward_utkarsh.py.)

After an x402 payment settles to the steward (compute) account, the steward:
  1. splits it with integer tinybar math: 96.31% to the artist, 3.69% kept for 0G agent compute,
     0% to OSO;
  2. transfers the artist share to a DISTINCT artist account;
  3. logs the split to a Hedera Consensus Service (HCS) topic;
  4. checks both on the public mirror node. LLM text is never trusted.

Modes:  check | direct (deterministic, no LLM) | agent (HederaLangchainToolkit + LangGraph ReAct)
TESTNET ONLY. Never prints private keys or API keys.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import re
import sys
import time
import uuid
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Callable, Optional

TINYBAR_PER_HBAR = 100_000_000
BPS_TOTAL = 10_000
DEFAULT_ARTIST_BPS = 9631
DEFAULT_COMPUTE_BPS = 369
DEFAULT_MIRROR = "https://testnet.mirrornode.hedera.com"
DEFAULT_ACCOUNTS_ENV = "/workspace/vault/ethglobal-mumbai/fork-first-artist-hedera-demo-20261106/accounts.env"
DEFAULT_ZEROG_KEY_FILE = "/workspace/vault/ethglobal-mumbai/zerog-router-api-key"
ALLOWED_TOOLS = frozenset({"transfer_hbar_tool", "create_topic_tool", "submit_topic_message_tool"})
ROLES = ("fan", "artist", "compute", "meter")
DEMO_LABEL = "DEMO AMOUNT (not a real fan payment)"
HASHSCAN = "https://hashscan.io/testnet"

EXIT_OK, EXIT_CONFIG, EXIT_VERIFY = 0, 2, 3


class StewardError(Exception):
    """Configuration or safety refusal."""


class VerificationError(StewardError):
    """On-chain (mirror node) verification failed."""


# ───────────────────────────── split math ─────────────────────────────

def parse_hbar(value: Any) -> int:
    """Decimal HBAR -> integer tinybar. Refuses >8 decimals and values <= 0."""
    if isinstance(value, bool):
        raise StewardError("amount must be a decimal string")
    # floats (Utkarsh's back-compat calculate_steward_split(10.0)) go through repr → '10.0', never float math
    try:
        d = Decimal(str(value).strip())
    except InvalidOperation as e:
        raise StewardError(f"invalid HBAR amount: {value!r}") from e
    if not d.is_finite():
        raise StewardError(f"invalid HBAR amount: {value!r}")
    if d.as_tuple().exponent < -8:
        raise StewardError(f"HBAR amount {value!r} has more than 8 decimals (1 tinybar = 0.00000001 HBAR)")
    tiny = d * TINYBAR_PER_HBAR
    if tiny != tiny.to_integral_value():
        raise StewardError(f"HBAR amount {value!r} is not a whole number of tinybars")
    tiny_i = int(tiny)
    if tiny_i <= 0:
        raise StewardError("amount must be > 0")
    return tiny_i


def format_hbar(tinybar: int) -> str:
    """963100000 -> '9.631' (exact, no float)."""
    d = Decimal(tinybar) / Decimal(TINYBAR_PER_HBAR)
    s = format(d.quantize(Decimal("0.00000001")), "f").rstrip("0").rstrip(".")
    return s or "0"


def get_bps(env: Optional[dict] = None) -> tuple[int, int]:
    env = os.environ if env is None else env
    try:
        artist = int(env.get("STEWARD_ARTIST_BPS", DEFAULT_ARTIST_BPS))
        compute = int(env.get("STEWARD_COMPUTE_BPS", DEFAULT_COMPUTE_BPS))
    except (TypeError, ValueError) as e:
        raise StewardError("STEWARD_ARTIST_BPS / STEWARD_COMPUTE_BPS must be integers") from e
    if artist < 0 or compute < 0 or artist + compute != BPS_TOTAL:
        raise StewardError(f"split bps must be non-negative and sum to {BPS_TOTAL} (got {artist}+{compute})")
    return artist, compute


def split_tinybar(total_tinybar: int, compute_bps: int = DEFAULT_COMPUTE_BPS) -> tuple[int, int]:
    """Return (artist, compute). The compute share is rounded down, and the artist gets the remainder."""
    if not isinstance(total_tinybar, int) or total_tinybar <= 0:
        raise StewardError("total must be a positive integer tinybar amount")
    compute = total_tinybar * compute_bps // BPS_TOTAL
    artist = total_tinybar - compute
    if artist <= 0:
        raise StewardError("artist share would be zero")
    return artist, compute


def calculate_steward_split(total_hbar: Any, env: Optional[dict] = None) -> dict:
    """Back-compatible with Utkarsh's helper: artist_hbar/compute_hbar (now exact strings) + tinybars."""
    artist_bps, compute_bps = get_bps(env)
    total = parse_hbar(total_hbar)
    artist, compute = split_tinybar(total, compute_bps)
    return {
        "artist_hbar": format_hbar(artist),
        "compute_hbar": format_hbar(compute),
        "total_hbar": format_hbar(total),
        "artist_tinybar": artist,
        "compute_tinybar": compute,
        "total_tinybar": total,
        "artist_bps": artist_bps,
        "compute_bps": compute_bps,
        "oso_cut_tinybar": 0,
    }


# ───────────────────────────── ids & safety ─────────────────────────────

ACCOUNT_RE = re.compile(r"^\d+\.\d+\.\d+$")
EVM_RE = re.compile(r"^(0x)?[0-9a-fA-F]{40}$")
_SDK_TXID = re.compile(r"^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$")
_MIRROR_TXID = re.compile(r"^(\d+\.\d+\.\d+)-(\d+)-(\d+)$")


def to_mirror_tx_id(tx_id: str) -> str:
    """'0.0.123@1700000000.123456789' -> '0.0.123-1700000000-123456789'.

    The part after the dot is read as an integer count of nanoseconds and padded to 9 digits. This is
    needed because hiero_sdk_python 0.2.0 TransactionId.to_string() does NOT zero-pad nanos
    (nanos=5 is printed as '...@1700000000.5').
    """
    s = str(tx_id).strip()
    m = _SDK_TXID.match(s) or _MIRROR_TXID.match(s)
    if not m:
        raise StewardError(f"unrecognised transaction id: {tx_id!r}")
    acct, secs, nanos = m.groups()
    if int(nanos) >= 1_000_000_000:
        raise StewardError(f"bad nanos in transaction id: {tx_id!r}")
    return f"{acct}-{int(secs)}-{int(nanos):09d}"


def sdk_tx_id_to_mirror(tx) -> str:
    """TransactionId object -> mirror format, using the integer fields directly."""
    return f"{tx.account_id}-{int(tx.valid_start.seconds)}-{int(tx.valid_start.nanos):09d}"


def hashscan_tx(tx_id: str) -> str:
    return f"{HASHSCAN}/transaction/{to_mirror_tx_id(tx_id)}"


def hashscan_topic(topic_id: str) -> str:
    return f"{HASHSCAN}/topic/{topic_id}"


def assert_distinct_artist(steward_account: Optional[str], artist_account: Optional[str]) -> None:
    if not steward_account:
        raise StewardError("steward operator account is not set (unfunded alias? run `check`)")
    if not artist_account:
        raise StewardError("artist account is not set (unfunded alias? run `check`)")
    for name, val in (("steward", steward_account), ("artist", artist_account)):
        if not ACCOUNT_RE.match(val):
            raise StewardError(f"{name} account {val!r} is not a 0.0.N account id")
    if steward_account == artist_account:
        raise StewardError(
            f"REFUSED: artist account equals steward operator account ({artist_account}); "
            "the steward would only pay itself"
        )


def select_tools(all_tools: list) -> list:
    """Keep only the tools whose names are exactly in the allowlist. Fail if any allowlisted tool is missing."""
    by_name = {t.name: t for t in all_tools}
    missing = sorted(ALLOWED_TOOLS - by_name.keys())
    if missing:
        raise StewardError(f"required Hedera tools missing from toolkit: {missing}")
    return [by_name[n] for n in sorted(ALLOWED_TOOLS)]


# ───────────────────────────── mirror node ─────────────────────────────

def http_get_json(url: str, timeout: float = 15.0) -> tuple[int, Any]:
    """Single HTTP seam (tests monkeypatch this). Returns (status, json-or-None)."""
    import requests

    r = requests.get(url, timeout=timeout, headers={"accept": "application/json"})
    try:
        body = r.json()
    except ValueError:
        body = None
    return r.status_code, body


def _sleep(seconds: float) -> None:  # seam for tests
    time.sleep(seconds)


class Mirror:
    def __init__(self, base: str = DEFAULT_MIRROR):
        self.base = base.rstrip("/")

    def get(self, path: str) -> tuple[int, Any]:
        return http_get_json(f"{self.base}{path}")

    def account(self, id_or_evm: str) -> Optional[dict]:
        status, body = self.get(f"/api/v1/accounts/{id_or_evm}")
        if status == 404:
            return None
        if status != 200 or not isinstance(body, dict):
            raise VerificationError(f"mirror account lookup failed for {id_or_evm}: HTTP {status}")
        return body

    def transaction(self, tx_id: str) -> list:
        status, body = self.get(f"/api/v1/transactions/{to_mirror_tx_id(tx_id)}")
        if status == 404:
            return []
        if status != 200 or not isinstance(body, dict):
            raise VerificationError(f"mirror transaction lookup failed: HTTP {status}")
        return body.get("transactions") or []

    def transactions(self, account: str, tx_type: str, since: Optional[str] = None, limit: int = 25) -> list:
        q = f"/api/v1/transactions?account.id={account}&transactiontype={tx_type}&order=desc&limit={limit}"
        if since:
            q += f"&timestamp=gte:{since}"
        status, body = self.get(q)
        if status == 404:
            return []
        if status != 200 or not isinstance(body, dict):
            raise VerificationError(f"mirror transactions query failed: HTTP {status}")
        return body.get("transactions") or []

    def topic_messages(self, topic_id: str, limit: int = 10) -> list:
        status, body = self.get(f"/api/v1/topics/{topic_id}/messages?order=desc&limit={limit}")
        if status == 404:
            return []
        if status != 200 or not isinstance(body, dict):
            raise VerificationError(f"mirror topic query failed: HTTP {status}")
        return body.get("messages") or []


def _poll(fn: Callable[[], Optional[dict]], timeout_s: float, interval_s: float = 3.0) -> Optional[dict]:
    deadline = time.monotonic() + timeout_s
    while True:
        res = fn()
        if res is not None:
            return res
        if time.monotonic() >= deadline:
            return None
        _sleep(interval_s)


def _hbar_delta(tx: dict, account: str) -> int:
    return sum(int(t.get("amount", 0)) for t in tx.get("transfers") or [] if t.get("account") == account)


def _memo(tx: dict) -> str:
    try:
        return base64.b64decode(tx.get("memo_base64") or "").decode("utf-8", "replace")
    except Exception:
        return ""


def verify_artist_transfer(mirror: Mirror, *, artist: str, steward: str, artist_tinybar: int,
                           since: Optional[str], expected_tx_id: Optional[str] = None,
                           marker: Optional[str] = None, timeout_s: float = 30.0) -> dict:
    """Find a SUCCESS CRYPTOTRANSFER, paid by the steward, that credits the artist exactly artist_tinybar."""
    want_id = to_mirror_tx_id(expected_tx_id) if expected_tx_id else None
    rejects: list[str] = []

    def attempt():
        rejects.clear()
        for tx in mirror.transactions(artist, "CRYPTOTRANSFER", since=since):
            tid = tx.get("transaction_id", "")
            if want_id and tid != want_id:
                continue
            why = []
            if tx.get("result") != "SUCCESS":
                why.append(f"result={tx.get('result')}")
            if not tid.startswith(steward + "-"):
                why.append("payer is not the steward")
            if _hbar_delta(tx, artist) != artist_tinybar:
                why.append(f"artist credit {_hbar_delta(tx, artist)} != {artist_tinybar}")
            if _hbar_delta(tx, steward) > -artist_tinybar:
                why.append("steward was not debited the artist amount")
            if why:
                rejects.append(f"{tid}: {', '.join(why)}")
                continue
            memo = _memo(tx)
            return {
                "transaction_id": tid,
                "consensus_timestamp": tx.get("consensus_timestamp"),
                "artist_credit_tinybar": artist_tinybar,
                "steward_debit_tinybar": -_hbar_delta(tx, steward),
                "memo": memo,
                "memo_has_marker": bool(marker and marker in memo),
                "hashscan": hashscan_tx(tid),
            }
        return None

    found = _poll(attempt, timeout_s)
    if not found:
        detail = "; ".join(rejects) if rejects else "no matching transfer on the mirror node"
        raise VerificationError(f"artist transfer NOT verified ({detail})")
    return found


def verify_topic_message(mirror: Mirror, *, topic_id: Optional[str], steward: str, marker: str,
                         since: Optional[str], timeout_s: float = 30.0) -> dict:
    """Find our HCS message by its marker. If topic_id is unknown (agent created it), discover it from
    the steward's CONSENSUSSUBMITMESSAGE transactions on the mirror (not from LLM text)."""

    def candidate_topics() -> list[str]:
        if topic_id:
            return [topic_id]
        txs = mirror.transactions(steward, "CONSENSUSSUBMITMESSAGE", since=since)
        seen = []
        for tx in txs:
            ent = tx.get("entity_id")
            if tx.get("result") == "SUCCESS" and ent and ent not in seen:
                seen.append(ent)
        return seen

    def attempt():
        for tid in candidate_topics():
            for msg in mirror.topic_messages(tid):
                try:
                    text = base64.b64decode(msg.get("message") or "").decode("utf-8", "replace")
                except Exception:
                    continue
                if marker in text and msg.get("payer_account_id") in (steward, None):
                    init = ((msg.get("chunk_info") or {}).get("initial_transaction_id") or {})
                    sub_tx = None
                    if init.get("account_id") and init.get("transaction_valid_start"):
                        secs, _, nanos = str(init["transaction_valid_start"]).partition(".")
                        sub_tx = to_mirror_tx_id(f"{init['account_id']}@{secs}.{nanos or '0'}")
                    return {
                        "topic_id": tid,
                        "sequence_number": msg.get("sequence_number"),
                        "consensus_timestamp": msg.get("consensus_timestamp"),
                        "transaction_id": sub_tx,
                        "message": text,
                        "hashscan_topic": hashscan_topic(tid),
                        "hashscan_tx": hashscan_tx(sub_tx) if sub_tx else None,
                    }
        return None

    found = _poll(attempt, timeout_s)
    if not found:
        raise VerificationError(f"HCS message with marker {marker!r} NOT found on the mirror node")
    return found


def parse_token_amount(value: Any, decimals: int) -> int:
    d = Decimal(str(value).strip())
    if d.as_tuple().exponent < -decimals:
        raise StewardError(f"amount {value!r} has more than {decimals} decimals")
    units = int(d * (10 ** decimals))
    if units <= 0:
        raise StewardError("amount must be > 0")
    return units


def verify_settlement(mirror: Mirror, *, settled_tx: str, steward: str, min_amount: int,
                      asset: str = "hbar", timeout_s: float = 30.0) -> dict:
    """Check that the x402 settlement tx SUCCEEDED and credited the steward at least min_amount.
    asset='hbar' → min_amount in tinybar; asset='0.0.T' (HTS token, e.g. testnet USDC) → base units."""
    want = to_mirror_tx_id(settled_tx)

    def attempt():
        txs = [t for t in mirror.transaction(settled_tx) if t.get("transaction_id") == want]
        return txs[0] if txs else None

    tx = _poll(attempt, timeout_s)
    if not tx:
        raise VerificationError(f"settlement tx {want} not found on mirror node")
    if tx.get("result") != "SUCCESS":
        raise VerificationError(f"settlement tx {want} result={tx.get('result')}")
    if asset.lower() == "hbar":
        credit = _hbar_delta(tx, steward)
    else:
        credit = sum(int(t.get("amount", 0)) for t in tx.get("token_transfers") or []
                     if t.get("account") == steward and t.get("token_id") == asset)
    if credit < min_amount:
        raise VerificationError(f"settlement tx {want} credited steward {credit} < required {min_amount} ({asset})")
    return {"transaction_id": want, "asset": asset, "steward_credit": credit,
            "consensus_timestamp": tx.get("consensus_timestamp"), "hashscan": hashscan_tx(want)}


def mirror_now_minus(seconds: float = 5.0) -> str:
    t = time.time() - seconds
    return f"{int(t)}.{int((t % 1) * 1e9):09d}"


# ───────────────────────────── config ─────────────────────────────

def load_env_file(path: Optional[str]) -> dict:
    if not path or not Path(path).is_file():
        return {}
    from dotenv import dotenv_values

    return {k: (v or "") for k, v in dotenv_values(path).items()}


def merged_env(env_file: Optional[str]) -> dict:
    env = load_env_file(env_file)
    for k, v in os.environ.items():  # explicit process env wins over the file
        if v != "":
            env[k] = v
    return env


def _first(env: dict, *names: str) -> str:
    for n in names:
        v = (env.get(n) or "").strip()
        if v:
            return v
    return ""


def network_name(env: dict) -> str:
    raw = _first(env, "HEDERA_NETWORK") or "testnet"
    name = raw.split(":")[-1].strip().lower()
    if name != "testnet":
        raise StewardError(f"REFUSED: network {raw!r} — this steward is TESTNET ONLY")
    return name


def resolve_account(mirror: Mirror, account_id: str, evm: str) -> tuple[Optional[str], Optional[dict]]:
    """Return (account id, mirror account record) using the explicit id, or the EVM alias looked up on the mirror."""
    if account_id:
        return account_id, None
    if evm and EVM_RE.match(evm):
        evm = evm if evm.lower().startswith("0x") else "0x" + evm
        rec = mirror.account(evm)
        if rec and rec.get("account"):
            return rec["account"], rec
    return None, None


@dataclass
class StewardConfig:
    network: str
    mirror_url: str
    steward_account: Optional[str]
    artist_account: Optional[str]
    steward_private_key: str = field(repr=False, default="")
    steward_evm: Optional[str] = None
    artist_evm: Optional[str] = None

    def public(self) -> dict:
        return {"network": self.network, "mirror": self.mirror_url,
                "steward_account": self.steward_account, "artist_account": self.artist_account}


def load_config(env: dict, mirror: Optional[Mirror] = None, resolve: bool = True) -> StewardConfig:
    """resolve=False (dry-run) never touches the mirror: unresolved EVM aliases stay None."""
    net = network_name(env)
    mirror_url = _first(env, "HEDERA_MIRROR_NODE") or DEFAULT_MIRROR
    mirror = mirror or Mirror(mirror_url)
    s_id = _first(env, "STEWARD_ACCOUNT_ID", "FORK_DEMO_COMPUTE_ACCOUNT_ID", "ACCOUNT_ID")
    s_evm = _first(env, "STEWARD_EVM_ADDRESS", "FORK_DEMO_COMPUTE_EVM_ADDRESS")
    a_id = _first(env, "ARTIST_ACCOUNT_ID", "FORK_DEMO_ARTIST_ACCOUNT_ID")
    a_evm = _first(env, "ARTIST_EVM_ADDRESS", "FORK_DEMO_ARTIST_EVM_ADDRESS")
    if resolve:
        steward, _ = resolve_account(mirror, s_id, s_evm)
        artist, _ = resolve_account(mirror, a_id, a_evm)
    else:
        steward, artist = s_id or None, a_id or None
    key = _first(env, "STEWARD_PRIVATE_KEY", "FORK_DEMO_COMPUTE_PRIVATE_KEY", "PRIVATE_KEY")
    cfg = StewardConfig(net, mirror_url, steward, artist, key)
    cfg.steward_evm, cfg.artist_evm = s_evm or None, a_evm or None
    return cfg


def dry_run(cfg: StewardConfig, *, mode: str, artist_name: str, total_tinybar: int, settled_tx: Optional[str],
            demo: bool, topic_id: Optional[str], llm: str = "0g", env: Optional[dict] = None) -> dict:
    """Compute + validate + show what WOULD be submitted. No chain, mirror, or LLM calls."""
    env = os.environ if env is None else env
    if not settled_tx and not demo:
        raise StewardError("need --settled-tx (real payment) or --demo-amount (clearly labelled demo)")
    if settled_tx and demo:
        raise StewardError("--settled-tx and --demo-amount are mutually exclusive")
    warnings = []
    steward = cfg.steward_account or f"<unresolved alias {cfg.steward_evm or '?'}>"
    artist = cfg.artist_account or f"<unresolved alias {cfg.artist_evm or '?'}>"
    if cfg.steward_account and cfg.artist_account:
        assert_distinct_artist(cfg.steward_account, cfg.artist_account)
    else:
        if cfg.steward_evm and cfg.artist_evm and cfg.steward_evm.lower() == cfg.artist_evm.lower():
            raise StewardError("REFUSED: artist alias equals steward alias")
        if not (cfg.steward_account or cfg.steward_evm) or not (cfg.artist_account or cfg.artist_evm):
            raise StewardError("steward/artist account or EVM alias missing from env")
        warnings.append("account ids not resolved (dry-run does not query the mirror; aliases may be unfunded)")
    if not cfg.steward_private_key:
        warnings.append("steward private key not set (live run would fail)")
    try:
        settled_norm = to_mirror_tx_id(settled_tx) if settled_tx else None
    except StewardError:
        settled_norm = settled_tx  # mock ids (e.g. 'mock-…') accepted in dry-run only
        warnings.append(f"settled tx {settled_tx!r} is not a Hedera tx id (mock accepted in dry-run only)")
    split = calculate_steward_split(format_hbar(total_tinybar), env)
    marker = "oso-dryrun-" + uuid.uuid4().hex[:8]
    message = build_hcs_message(marker=marker, artist_name=artist_name, artist_account=artist, split=split,
                                settled_tx=settled_norm, demo=demo)
    llm_info = None
    if mode == "agent":
        s = llm_settings(llm, env)
        llm_info = {"provider": s["provider"], "model": s["model"], "base_url": s["base_url"],
                    "response_id": None, "api_key_present": bool(s["api_key"])}
    return {
        "mode": "dry-run", "would_run_mode": mode, "status": "not-submitted", "verified": False,
        "network": cfg.network, "label": DEMO_LABEL if demo else "settled fan payment",
        "settled_tx": settled_norm, "amount_tinybar": split["total_tinybar"], "split": split,
        "artist_name": artist_name, "artist_account": artist, "steward_account": steward,
        "would_submit": {
            "transfer": {"from": steward, "to": artist, "tinybar": split["artist_tinybar"],
                         "hbar": split["artist_hbar"], "memo": tx_memo(marker, demo)},
            "hcs": {"topic_id": topic_id or "<new topic, memo OSO-Steward-Log>", "message": message},
        },
        "transfer_tx_id": None, "hcs_topic_id": topic_id, "hcs_tx_id": None, "hcs_sequence": None,
        "hashscan": None, "llm": llm_info, "warnings": warnings,
    }


def run_check(env: dict, mirror: Optional[Mirror] = None, out=print) -> dict:
    try:
        net = network_name(env)
    except StewardError as e:
        out(f"NOT READY: {e}")
        return {"ready": False, "roles": {}}
    mirror = mirror or Mirror(_first(env, "HEDERA_MIRROR_NODE") or DEFAULT_MIRROR)
    out(f"network={net} mirror={mirror.base}")
    roles: dict = {}
    for role in ROLES:
        up = role.upper()
        evm = _first(env, f"FORK_DEMO_{up}_EVM_ADDRESS")
        acct_env = _first(env, f"FORK_DEMO_{up}_ACCOUNT_ID")
        if role == "compute":
            acct_env = _first(env, "STEWARD_ACCOUNT_ID") or acct_env
        if role == "artist":
            acct_env = _first(env, "ARTIST_ACCOUNT_ID") or acct_env
        info = {"evm_address": evm or None, "account_id": None, "balance_tinybar": None,
                "has_private_key": bool(_first(env, f"FORK_DEMO_{up}_PRIVATE_KEY"))}
        try:
            rec = mirror.account(acct_env or (evm if evm.lower().startswith("0x") else "0x" + evm)) \
                if (acct_env or evm) else None
        except VerificationError as e:
            rec, info["error"] = None, str(e)
        if rec and rec.get("account"):
            info["account_id"] = rec["account"]
            info["balance_tinybar"] = int(((rec.get("balance") or {}).get("balance")) or 0)
        roles[role] = info
        acct = info["account_id"] or "NOT FOUND (unfunded)"
        bal = f"{format_hbar(info['balance_tinybar'])} HBAR" if info["balance_tinybar"] is not None else "-"
        out(f"  {role:8s} evm={evm or '-'} account={acct} balance={bal}")
    problems = []
    for need in ("artist", "compute"):
        if not roles[need]["account_id"]:
            problems.append(f"{need} account not found")
    if roles["compute"]["account_id"] and not (
            roles["compute"]["has_private_key"] or _first(env, "STEWARD_PRIVATE_KEY", "PRIVATE_KEY")):
        problems.append("no steward private key")
    if roles["compute"]["account_id"] and roles["compute"]["account_id"] == roles["artist"]["account_id"]:
        problems.append("artist == steward")
    if roles["compute"]["account_id"] and (roles["compute"]["balance_tinybar"] or 0) < TINYBAR_PER_HBAR // 10:
        problems.append("steward balance < 0.1 HBAR (fees + payout)")
    ready = not problems
    out("READY" if ready else f"NOT READY: {'; '.join(problems)}")
    return {"ready": ready, "roles": roles, "problems": problems}


# ───────────────────────────── LLM (0G default) ─────────────────────────────

def llm_settings(provider: str, env: dict) -> dict:
    provider = (provider or "0g").lower()
    if provider in ("0g", "zerog"):
        key = _first(env, "ZEROG_API_KEY")
        if not key:
            kf = _first(env, "ZEROG_API_KEY_FILE") or DEFAULT_ZEROG_KEY_FILE
            if Path(kf).is_file():
                key = Path(kf).read_text().strip()
        return {"provider": "0g", "base_url": _first(env, "LLM_BASE_URL") or "https://router-api.0g.ai/v1",
                "model": _first(env, "LLM_MODEL") or "0gm-1.0-35b-a3b", "api_key": key,
                # 0gm-1.0-35b-a3b is a thinking model: without this it burns max_tokens and returns empty
                "extra_body": {"chat_template_kwargs": {"enable_thinking": False}}}
    if provider == "groq":
        return {"provider": "groq", "base_url": _first(env, "LLM_BASE_URL") or "https://api.groq.com/openai/v1",
                "model": _first(env, "LLM_MODEL") or "openai/gpt-oss-20b",
                "api_key": _first(env, "OPENAI_API_KEY"), "extra_body": None}
    raise StewardError(f"unknown --llm {provider!r} (use 0g or groq)")


def build_llm(settings: dict):
    from langchain_openai import ChatOpenAI
    from pydantic import SecretStr

    if not settings["api_key"]:
        raise StewardError(f"no API key for LLM provider {settings['provider']}")
    kw = dict(model=settings["model"], base_url=settings["base_url"], api_key=SecretStr(settings["api_key"]),
              temperature=0, max_tokens=1024, include_response_headers=True)
    if settings.get("extra_body"):
        kw["extra_body"] = settings["extra_body"]
    return ChatOpenAI(**kw)


def llm_proof(settings: dict, messages: list) -> dict:
    ids, req_ids, providers = [], [], []
    for m in messages:
        md = getattr(m, "response_metadata", None) or {}
        if md.get("id"):
            ids.append(md["id"])
        hdr = {str(k).lower(): v for k, v in (md.get("headers") or {}).items()}
        if hdr.get("x-request-id"):
            req_ids.append(hdr["x-request-id"])
        if hdr.get("x-provider") and hdr["x-provider"] not in providers:
            providers.append(hdr["x-provider"])
    return {"provider": settings["provider"], "model": settings["model"], "base_url": settings["base_url"],
            "response_id": ids[-1] if ids else None, "response_ids": ids, "x_request_ids": req_ids,
            "upstream_providers": providers}


# ───────────────────────────── message building ─────────────────────────────

def build_hcs_message(*, marker: str, artist_name: str, artist_account: str, split: dict,
                      settled_tx: Optional[str], demo: bool) -> str:
    msg = {
        "oso": "fork-the-first-artist/steward/v1",
        "marker": marker,
        "label": DEMO_LABEL if demo else "settled fan payment",
        "settled_tx": _norm_or_raw(settled_tx),
        "artist": artist_name, "artist_account": artist_account,
        "total_tinybar": split["total_tinybar"], "artist_tinybar": split["artist_tinybar"],
        "compute_tinybar": split["compute_tinybar"], "oso_cut_tinybar": 0,
        "bps": {"artist": split["artist_bps"], "compute": split["compute_bps"]},
        "note": f"Paid {split['artist_hbar']} HBAR to {artist_name}; {split['compute_hbar']} HBAR "
                f"({split['compute_bps'] / 100:.2f}%) retained for 0G agent compute; 0% OSO.",
    }
    text = json.dumps(msg, separators=(",", ":"))
    if len(text.encode()) > 1024:
        raise StewardError("HCS message exceeds 1024 bytes")
    return text


def _norm_or_raw(tx_id: Optional[str]) -> Optional[str]:
    if not tx_id:
        return None
    try:
        return to_mirror_tx_id(tx_id)
    except StewardError:
        return str(tx_id)[:120]  # dry-run mock ids only; live runs verify the id on the mirror first


def tx_memo(marker: str, demo: bool) -> str:
    return (f"OSO steward {marker}" + (" DEMO" if demo else ""))[:100]


# ───────────────────────────── execution modes ─────────────────────────────

def _client(cfg: StewardConfig):
    from hiero_sdk_python import AccountId, Client, Network, PrivateKey

    if not cfg.steward_private_key:
        raise StewardError("steward private key not set")
    client = Client(Network(network="testnet"))
    raw = cfg.steward_private_key.strip()
    raw = raw[2:] if raw.lower().startswith("0x") else raw
    key = PrivateKey.from_string_ecdsa(raw)
    client.set_operator(AccountId.from_string(cfg.steward_account), key)
    return client, key


def execute_direct(cfg: StewardConfig, *, split: dict, message: str, memo: str,
                   topic_id: Optional[str]) -> dict:
    """Deterministic path: hiero_sdk_python TransferTransaction + (TopicCreate) + TopicMessageSubmit."""
    from hiero_sdk_python import (AccountId, TopicCreateTransaction, TopicId,
                                  TopicMessageSubmitTransaction, TransferTransaction)
    from hiero_sdk_python.response_code import ResponseCode

    client, key = _client(cfg)
    out: dict = {}
    try:
        tx = (TransferTransaction()
              .add_hbar_transfer(AccountId.from_string(cfg.steward_account), -split["artist_tinybar"])
              .add_hbar_transfer(AccountId.from_string(cfg.artist_account), split["artist_tinybar"])
              .set_transaction_memo(memo))
        rcpt = tx.execute(client)
        if rcpt.status != ResponseCode.SUCCESS:
            raise VerificationError(f"transfer receipt status {ResponseCode(rcpt.status).name}")
        out["transfer_tx_id"] = sdk_tx_id_to_mirror(tx.transaction_id)

        if not topic_id:
            ct = TopicCreateTransaction(memo="OSO-Steward-Log", admin_key=key.public_key())
            crc = ct.execute(client)
            if crc.status != ResponseCode.SUCCESS or not crc.topic_id:
                raise VerificationError("topic create failed")
            topic_id = str(crc.topic_id)
            out["topic_create_tx_id"] = sdk_tx_id_to_mirror(ct.transaction_id)
        st = TopicMessageSubmitTransaction(topic_id=TopicId.from_string(topic_id), message=message)
        src = st.execute(client)
        if src.status != ResponseCode.SUCCESS:
            raise VerificationError("topic message submit failed")
        out.update(topic_id=topic_id, hcs_tx_id=sdk_tx_id_to_mirror(st.transaction_id),
                   hcs_sequence_receipt=int(src.topic_sequence_number or 0))
    finally:
        try:
            client.close()
        except Exception:
            pass
    return out


def agent_prompt(*, artist_name: str, artist_account: str, steward_account: str, split: dict,
                 message: str, memo: str, topic_id: Optional[str], demo: bool) -> str:
    topic_step = (f"2. Call submit_topic_message_tool with topic_id {topic_id} and message EXACTLY:\n{message}"
                  if topic_id else
                  "2. Call create_topic_tool with topic_memo 'OSO-Steward-Log', then call submit_topic_message_tool "
                  f"on the new topic with message EXACTLY:\n{message}")
    return (
        f"You are the AI Steward Agent for {artist_name}. "
        + (f"This is a {DEMO_LABEL}. " if demo else "A fan payment has settled to the steward account. ")
        + f"Total {split['total_hbar']} HBAR. Do exactly these steps and nothing else:\n"
        f"1. Call transfer_hbar_tool ONCE with source_account_id {steward_account}, "
        f"transfers [{{'account_id': '{artist_account}', 'amount': {split['artist_hbar']}}}] "
        f"and transaction_memo '{memo}'. This is 96.31% for the artist; keep the other "
        f"{split['compute_hbar']} HBAR (3.69%) in the steward account for 0G compute. Never send to any other account.\n"
        f"{topic_step}\n3. Reply with a one-line summary."
    )


async def execute_agent(cfg: StewardConfig, *, settings: dict, prompt: str) -> tuple[dict, list]:
    from hedera_agent_kit.langchain.toolkit import HederaLangchainToolkit
    from hedera_agent_kit.plugins import core_account_plugin, core_consensus_plugin
    from hedera_agent_kit.shared.configuration import AgentMode, Configuration, Context
    from langgraph.prebuilt import create_react_agent

    client, _ = _client(cfg)
    configuration = Configuration(context=Context(mode=AgentMode.AUTONOMOUS, account_id=cfg.steward_account),
                                  plugins=[core_account_plugin, core_consensus_plugin])
    tools = select_tools(HederaLangchainToolkit(client=client, configuration=configuration).get_tools())
    agent = create_react_agent(build_llm(settings), tools)
    response = await agent.ainvoke({"messages": [{"role": "user", "content": prompt}]},
                                   config={"recursion_limit": 12})
    msgs = response["messages"]
    calls = [tc.get("name") for m in msgs for tc in (getattr(m, "tool_calls", None) or [])]
    bad = [c for c in calls if c not in ALLOWED_TOOLS]
    if bad:
        raise StewardError(f"agent attempted non-allowlisted tools: {bad}")
    if calls.count("transfer_hbar_tool") > 1:
        raise StewardError("agent called transfer_hbar_tool more than once — check the mirror node manually")
    return {"tool_calls": calls, "final_text_UNTRUSTED": str(msgs[-1].content)[:500]}, msgs


def process_artist_payment(cfg: StewardConfig, *, mode: str, artist_name: str, total_tinybar: int,
                           settled_tx: Optional[str], demo: bool, topic_id: Optional[str],
                           llm: str = "0g", env: Optional[dict] = None,
                           settled_asset: str = "hbar", settled_min: Optional[int] = None,
                           mirror: Optional[Mirror] = None, timeout_s: float = 30.0) -> dict:
    env = os.environ if env is None else env
    assert_distinct_artist(cfg.steward_account, cfg.artist_account)
    if not settled_tx and not demo:
        raise StewardError("need --settled-tx (real payment) or --demo-amount (clearly labelled demo)")
    if settled_tx and demo:
        raise StewardError("--settled-tx and --demo-amount are mutually exclusive")
    mirror = mirror or Mirror(cfg.mirror_url)
    _, compute_bps = get_bps(env)
    artist_t, compute_t = split_tinybar(total_tinybar, compute_bps)
    split = calculate_steward_split(format_hbar(total_tinybar), env)
    assert split["artist_tinybar"] == artist_t and split["compute_tinybar"] == compute_t

    settlement = None
    if settled_tx:
        settlement = verify_settlement(mirror, settled_tx=settled_tx, steward=cfg.steward_account,
                                       min_amount=settled_min if settled_min is not None else total_tinybar,
                                       asset=settled_asset, timeout_s=timeout_s)

    marker = "oso-" + uuid.uuid4().hex[:12]
    message = build_hcs_message(marker=marker, artist_name=artist_name, artist_account=cfg.artist_account,
                                split=split, settled_tx=settled_tx, demo=demo)
    memo = tx_memo(marker, demo)
    since = mirror_now_minus(10)

    llm_info, agent_info, direct_info = None, None, {}
    if mode == "direct":
        direct_info = execute_direct(cfg, split=split, message=message, memo=memo, topic_id=topic_id)
    elif mode == "agent":
        settings = llm_settings(llm, env)
        prompt = agent_prompt(artist_name=artist_name, artist_account=cfg.artist_account,
                              steward_account=cfg.steward_account, split=split, message=message,
                              memo=memo, topic_id=topic_id, demo=demo)
        agent_info, msgs = asyncio.run(execute_agent(cfg, settings=settings, prompt=prompt))
        llm_info = llm_proof(settings, msgs)
    else:
        raise StewardError(f"unknown mode {mode!r}")

    transfer = verify_artist_transfer(mirror, artist=cfg.artist_account, steward=cfg.steward_account,
                                      artist_tinybar=artist_t, since=since,
                                      expected_tx_id=direct_info.get("transfer_tx_id"), marker=marker,
                                      timeout_s=timeout_s)
    hcs = verify_topic_message(mirror, topic_id=direct_info.get("topic_id") or topic_id,
                               steward=cfg.steward_account, marker=marker, since=since, timeout_s=timeout_s)
    return build_proof(mode=mode, cfg=cfg, settled_tx=settled_tx, demo=demo, split=split, marker=marker,
                       settlement=settlement, transfer=transfer, hcs=hcs, llm=llm_info, agent=agent_info,
                       artist_name=artist_name)


def build_proof(*, mode, cfg, settled_tx, demo, split, marker, settlement, transfer, hcs, llm, agent,
                artist_name) -> dict:
    return {
        "mode": mode, "network": cfg.network, "verified": True,
        "label": DEMO_LABEL if demo else "settled fan payment",
        "settled_tx": to_mirror_tx_id(settled_tx) if settled_tx else None,
        "settlement": settlement, "amount_tinybar": split["total_tinybar"], "split": split,
        "artist_name": artist_name, "artist_account": cfg.artist_account,
        "steward_account": cfg.steward_account, "marker": marker,
        "transfer_tx_id": transfer["transaction_id"], "transfer": transfer,
        "hcs_topic_id": hcs["topic_id"], "hcs_tx_id": hcs["transaction_id"],
        "hcs_sequence": hcs["sequence_number"],
        "hashscan": {"transfer": transfer["hashscan"], "topic": hcs["hashscan_topic"], "hcs_tx": hcs["hashscan_tx"],
                     "settlement": settlement["hashscan"] if settlement else None},
        "llm": llm, "agent": agent,
        "verified_by": "Hedera mirror node (LLM output is not trusted)",
    }


def assert_public_safe(proof: dict, secrets: list[str]) -> None:
    blob = json.dumps(proof)
    for s in secrets:
        s = (s or "").strip()
        for v in {s, s[2:] if s.lower().startswith("0x") else s}:
            if v and len(v) >= 16 and v in blob:
                raise StewardError("REFUSED: proof JSON would contain a secret")


# ───────────────────────────── CLI ─────────────────────────────

def _write_json(path: Optional[str], data: dict) -> None:
    if path:
        Path(path).write_text(json.dumps(data, indent=2) + "\n")
        print(f"proof written to {path}")


def main(argv: Optional[list[str]] = None) -> int:
    p = argparse.ArgumentParser(description="OSO Hedera steward (testnet)")
    p.add_argument("command", choices=["check", "direct", "agent"])
    p.add_argument("--env-file", default=None, help="default: $STEWARD_ACCOUNTS_ENV, the vault accounts.env, else ./.env")
    p.add_argument("--llm", default="0g", choices=["0g", "groq"])
    p.add_argument("--settled-tx")
    p.add_argument("--amount-hbar")
    p.add_argument("--demo-amount", action="store_true")
    p.add_argument("--settled-asset", default="hbar", help="'hbar' or HTS token id the settlement paid in")
    p.add_argument("--settled-amount", help="settled token amount (decimal) when --settled-asset is a token")
    p.add_argument("--settled-decimals", type=int, default=None)
    p.add_argument("--artist-name", default="aniket.oso.eth")
    p.add_argument("--topic-id", default=None)
    p.add_argument("--json-out", default=None)
    p.add_argument("--dry-run", action="store_true", help="validate + print what would be submitted; no network")
    p.add_argument("--timeout", type=float, default=30.0, help="mirror polling seconds")
    a = p.parse_args(argv)

    env_file = (a.env_file or os.environ.get("STEWARD_ACCOUNTS_ENV")
                or (DEFAULT_ACCOUNTS_ENV if Path(DEFAULT_ACCOUNTS_ENV).is_file() else ".env"))
    env = merged_env(env_file)
    fail_base = {"mode": "dry-run" if a.dry_run else a.command, "verified": False, "network": "testnet",
                 "settled_tx": a.settled_tx}
    try:
        if a.command == "check":
            run_check(env)
            return EXIT_OK
        if not a.amount_hbar:
            raise StewardError("--amount-hbar is required")
        total = parse_hbar(a.amount_hbar)
        if a.demo_amount:
            print(f"*** {DEMO_LABEL}: {format_hbar(total)} HBAR ***")
        if a.dry_run:
            cfg = load_config(env, resolve=False)
            proof = dry_run(cfg, mode=a.command, artist_name=a.artist_name, total_tinybar=total,
                            settled_tx=a.settled_tx, demo=a.demo_amount, topic_id=a.topic_id, llm=a.llm, env=env)
            assert_public_safe(proof, _secrets(env, cfg))
            w = proof["would_submit"]
            print(f"DRY RUN ({a.command}) — nothing submitted")
            print(f"  transfer {w['transfer']['hbar']} HBAR ({w['transfer']['tinybar']} tinybar) "
                  f"{w['transfer']['from']} -> {w['transfer']['to']} memo={w['transfer']['memo']!r}")
            print(f"  compute retained {proof['split']['compute_hbar']} HBAR ({proof['split']['compute_tinybar']} tinybar)")
            print(f"  HCS topic {w['hcs']['topic_id']} message {w['hcs']['message']}")
            for warn in proof["warnings"]:
                print(f"  warning: {warn}")
            _write_json(a.json_out, proof)
            return EXIT_OK
        cfg = load_config(env)
        settled_min = None
        if a.settled_tx and a.settled_asset.lower() != "hbar":
            if not a.settled_amount:
                raise StewardError("--settled-amount is required with a token --settled-asset")
            dec = a.settled_decimals if a.settled_decimals is not None else int(_first(env, "HEDERA_ASSET_DECIMALS") or 6)
            settled_min = parse_token_amount(a.settled_amount, dec)
            print(f"note: settlement paid in token {a.settled_asset}; payout of {format_hbar(total)} HBAR "
                  "is the steward's HBAR-denominated split")
        proof = process_artist_payment(cfg, mode=a.command, artist_name=a.artist_name, total_tinybar=total,
                                       settled_tx=a.settled_tx, demo=a.demo_amount, topic_id=a.topic_id,
                                       llm=a.llm, env=env, settled_asset=a.settled_asset,
                                       settled_min=settled_min, timeout_s=a.timeout)
        proof["status"] = "verified"
        assert_public_safe(proof, _secrets(env, cfg))
        print(f"VERIFIED transfer {proof['transfer_tx_id']}  {proof['hashscan']['transfer']}")
        print(f"VERIFIED HCS topic {proof['hcs_topic_id']} seq {proof['hcs_sequence']}  {proof['hashscan']['topic']}")
        if proof["llm"]:
            print(f"LLM {proof['llm']['provider']}/{proof['llm']['model']} response_id={proof['llm']['response_id']}")
        _write_json(a.json_out, proof)
        return EXIT_OK
    except VerificationError as e:
        print(f"VERIFICATION FAILED: {e}", file=sys.stderr)
        _write_json(a.json_out, {**fail_base, "status": "verification-failed", "error": _scrub(str(e), env)})
        return EXIT_VERIFY
    except StewardError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        _write_json(a.json_out, {**fail_base, "status": "error", "error": _scrub(str(e), env)})
        return EXIT_CONFIG


def _secrets(env: dict, cfg: Optional[StewardConfig] = None) -> list[str]:
    out = [v for k, v in env.items() if k.endswith(("PRIVATE_KEY", "API_KEY")) and v]
    if cfg and cfg.steward_private_key:
        out.append(cfg.steward_private_key)
    return out


def _scrub(text: str, env: dict) -> str:
    for s in _secrets(env):
        for v in {s, s[2:] if s.lower().startswith("0x") else s}:
            if v and len(v) >= 16:
                text = text.replace(v, "<redacted>")
    return text


if __name__ == "__main__":
    sys.exit(main())
