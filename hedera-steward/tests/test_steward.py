"""Offline tests for steward.py — mirror node, toolkit, and LLM are all mocked."""
import base64
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import steward as st  # noqa: E402

STEWARD, ARTIST, OTHER = "0.0.5001", "0.0.5002", "0.0.6666"
FAKE_KEY = "0x" + "ab" * 32
ARTIST_EVM = "0x611123ad22bb242f05d1f23d58753c48e0825e46"
COMPUTE_EVM = "0x3ed964927a6aa93367b6a7ff8922dd6960ed5434"


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(st, "_sleep", lambda s: None)


def fake_http(routes):
    """routes: list of (substring, status, body); first match wins; unmatched → 404."""
    calls = []

    def _get(url, timeout=15.0):
        calls.append(url)
        for sub, status, body in routes:
            if sub in url:
                return status, body
        return 404, {"_status": {"messages": [{"message": "Not found"}]}}

    _get.calls = calls
    return _get


def transfer_tx(tid, artist_amt, steward_amt, result="SUCCESS", memo="OSO steward oso-x"):
    return {"transaction_id": tid, "result": result, "name": "CRYPTOTRANSFER",
            "consensus_timestamp": "1793998800.000000001",
            "memo_base64": base64.b64encode(memo.encode()).decode(),
            "transfers": [{"account": ARTIST, "amount": artist_amt},
                          {"account": STEWARD, "amount": steward_amt},
                          {"account": "0.0.3", "amount": 100}]}


# ── split math ──

def test_split_10_hbar():
    s = st.calculate_steward_split("10")
    assert (s["artist_tinybar"], s["compute_tinybar"]) == (963_100_000, 36_900_000)
    assert (s["artist_hbar"], s["compute_hbar"]) == ("9.631", "0.369")
    assert s["artist_tinybar"] + s["compute_tinybar"] == s["total_tinybar"] == 1_000_000_000


def test_split_backcompat_float_and_odd_amounts():
    assert st.calculate_steward_split(10.0)["artist_tinybar"] == 963_100_000
    for amt in ("0.00000001", "0.00000271", "1.23456789", "7", "123456.7"):
        s = st.calculate_steward_split(amt)
        assert s["artist_tinybar"] + s["compute_tinybar"] == st.parse_hbar(amt)
        assert s["compute_tinybar"] == st.parse_hbar(amt) * 369 // 10000
    assert st.split_tinybar(1) == (1, 0)
    assert st.split_tinybar(271) == (271 - 9, 9)  # 271*369//10000 = 9


def test_rejects_too_many_decimals_and_bad_values():
    for bad in ("1.000000001", "0", "-1", "abc", "NaN", True):
        with pytest.raises(st.StewardError):
            st.parse_hbar(bad)


def test_bps_env_override_must_sum():
    s = st.calculate_steward_split("10", env={"STEWARD_ARTIST_BPS": "9000", "STEWARD_COMPUTE_BPS": "1000"})
    assert s["compute_tinybar"] == 100_000_000
    with pytest.raises(st.StewardError):
        st.get_bps({"STEWARD_ARTIST_BPS": "9631", "STEWARD_COMPUTE_BPS": "370"})
    with pytest.raises(st.StewardError):
        st.get_bps({"STEWARD_ARTIST_BPS": "x"})


def test_format_hbar():
    assert st.format_hbar(1) == "0.00000001"
    assert st.format_hbar(100_000_000) == "1"


# ── safety ──

def test_self_transfer_refused():
    with pytest.raises(st.StewardError, match="REFUSED"):
        st.assert_distinct_artist(STEWARD, STEWARD)
    with pytest.raises(st.StewardError):
        st.assert_distinct_artist(STEWARD, None)
    with pytest.raises(st.StewardError):
        st.assert_distinct_artist(None, ARTIST)
    with pytest.raises(st.StewardError):
        st.assert_distinct_artist(STEWARD, ARTIST_EVM)
    st.assert_distinct_artist(STEWARD, ARTIST)


def test_process_refuses_self_before_any_network(monkeypatch):
    monkeypatch.setattr(st, "http_get_json", lambda *a, **k: pytest.fail("network touched"))
    cfg = st.StewardConfig("testnet", st.DEFAULT_MIRROR, STEWARD, STEWARD, FAKE_KEY)
    with pytest.raises(st.StewardError, match="REFUSED"):
        st.process_artist_payment(cfg, mode="direct", artist_name="a", total_tinybar=10**9,
                                  settled_tx=None, demo=True, topic_id=None, env={})


def test_allowlist_exact():
    names = ["transfer_hbar_tool", "create_topic_tool", "submit_topic_message_tool", "delete_topic_tool",
             "update_topic_tool", "approve_hbar_allowance_tool", "delete_hbar_allowance_tool",
             "transfer_hbar_with_allowance_tool", "delete_account_tool", "create_account_tool"]
    tools = [SimpleNamespace(name=n) for n in names]
    got = sorted(t.name for t in st.select_tools(tools))
    assert got == sorted(st.ALLOWED_TOOLS)
    with pytest.raises(st.StewardError, match="missing"):
        st.select_tools([SimpleNamespace(name="transfer_hbar_tool"), SimpleNamespace(name="delete_topic_tool")])


def test_testnet_only():
    assert st.network_name({"HEDERA_NETWORK": "hedera:testnet"}) == "testnet"
    with pytest.raises(st.StewardError):
        st.network_name({"HEDERA_NETWORK": "hedera:mainnet"})


# ── tx ids ──

def test_tx_id_conversion():
    assert st.to_mirror_tx_id("0.0.123@1700000000.123456789") == "0.0.123-1700000000-123456789"
    assert st.to_mirror_tx_id("0.0.123-1700000000-123456789") == "0.0.123-1700000000-123456789"
    # hiero_sdk_python 0.2.0 prints nanos unpadded
    assert st.to_mirror_tx_id("0.0.123@1700000000.5") == "0.0.123-1700000000-000000005"
    with pytest.raises(st.StewardError):
        st.to_mirror_tx_id("garbage")
    assert st.hashscan_tx("0.0.1@2.3") == "https://hashscan.io/testnet/transaction/0.0.1-2-000000003"
    sdk = SimpleNamespace(account_id="0.0.9", valid_start=SimpleNamespace(seconds=17, nanos=42))
    assert st.sdk_tx_id_to_mirror(sdk) == "0.0.9-17-000000042"


# ── mirror verification ──

def _verify(monkeypatch, txs, **kw):
    monkeypatch.setattr(st, "http_get_json", fake_http([("transactiontype=CRYPTOTRANSFER", 200, {"transactions": txs})]))
    return st.verify_artist_transfer(st.Mirror(), artist=ARTIST, steward=STEWARD, artist_tinybar=963_100_000,
                                     since="1.0", timeout_s=0, **kw)


def test_transfer_verification_pass(monkeypatch):
    tid = f"{STEWARD}-1793998790-000000001"
    r = _verify(monkeypatch, [transfer_tx(tid, 963_100_000, -963_100_100)], marker="oso-x")
    assert r["transaction_id"] == tid and r["memo_has_marker"]
    assert r["hashscan"].endswith(tid)


def test_transfer_verification_wrong_amount(monkeypatch):
    with pytest.raises(st.VerificationError, match="artist credit"):
        _verify(monkeypatch, [transfer_tx(f"{STEWARD}-1-000000001", 963_000_000, -963_000_100)])


def test_transfer_verification_wrong_sender(monkeypatch):
    with pytest.raises(st.VerificationError, match="payer"):
        _verify(monkeypatch, [transfer_tx(f"{OTHER}-1-000000001", 963_100_000, 0)])


def test_transfer_verification_failed_result(monkeypatch):
    with pytest.raises(st.VerificationError, match="result"):
        _verify(monkeypatch, [transfer_tx(f"{STEWARD}-1-000000001", 963_100_000, -963_100_100, result="INSUFFICIENT_PAYER_BALANCE")])


def test_transfer_verification_not_found(monkeypatch):
    with pytest.raises(st.VerificationError, match="no matching"):
        _verify(monkeypatch, [])


def test_transfer_verification_expected_id(monkeypatch):
    good = transfer_tx(f"{STEWARD}-5-000000005", 963_100_000, -963_100_100)
    with pytest.raises(st.VerificationError):
        _verify(monkeypatch, [good], expected_tx_id=f"{STEWARD}@6.6")
    assert _verify(monkeypatch, [good], expected_tx_id=f"{STEWARD}@5.5")["transaction_id"] == good["transaction_id"]


def test_mirror_polls_until_lag_clears(monkeypatch):
    tid = f"{STEWARD}-7-000000007"
    seq = iter([[], [], [transfer_tx(tid, 963_100_000, -963_100_100)]])
    monkeypatch.setattr(st, "http_get_json", lambda url, timeout=15.0: (200, {"transactions": next(seq)}))
    r = st.verify_artist_transfer(st.Mirror(), artist=ARTIST, steward=STEWARD, artist_tinybar=963_100_000,
                                  since=None, timeout_s=60)
    assert r["transaction_id"] == tid


def _msg(text, seq=3, payer=STEWARD):
    return {"topic_id": "0.0.7777", "sequence_number": seq, "consensus_timestamp": "9.1", "payer_account_id": payer,
            "message": base64.b64encode(text.encode()).decode(),
            "chunk_info": {"initial_transaction_id": {"account_id": STEWARD, "transaction_valid_start": "1793998791.000000002"}}}


def test_topic_message_verification(monkeypatch):
    monkeypatch.setattr(st, "http_get_json", fake_http([("/topics/0.0.7777/messages", 200, {"messages": [_msg('{"marker":"oso-abc"}')]})]))
    r = st.verify_topic_message(st.Mirror(), topic_id="0.0.7777", steward=STEWARD, marker="oso-abc", since=None, timeout_s=0)
    assert r["sequence_number"] == 3 and r["transaction_id"] == f"{STEWARD}-1793998791-000000002"
    assert r["hashscan_topic"] == "https://hashscan.io/testnet/topic/0.0.7777"
    with pytest.raises(st.VerificationError):
        st.verify_topic_message(st.Mirror(), topic_id="0.0.7777", steward=STEWARD, marker="oso-zzz", since=None, timeout_s=0)


def test_topic_discovered_from_mirror_not_llm(monkeypatch):
    monkeypatch.setattr(st, "http_get_json", fake_http([
        ("transactiontype=CONSENSUSSUBMITMESSAGE", 200, {"transactions": [{"result": "SUCCESS", "entity_id": "0.0.7777"}]}),
        ("/topics/0.0.7777/messages", 200, {"messages": [_msg("x oso-abc y")]}),
    ]))
    r = st.verify_topic_message(st.Mirror(), topic_id=None, steward=STEWARD, marker="oso-abc", since="1.0", timeout_s=0)
    assert r["topic_id"] == "0.0.7777"


# ── settlement ──

def _settle(monkeypatch, tx, **kw):
    monkeypatch.setattr(st, "http_get_json", fake_http([("/api/v1/transactions/0.0.8001-1700000000-000000123", 200, {"transactions": [tx]})]))
    return st.verify_settlement(st.Mirror(), settled_tx="0.0.8001@1700000000.000000123", steward=STEWARD, timeout_s=0, **kw)


def _settle_tx(result="SUCCESS", hbar=1_000_000_000, token=None):
    tx = {"transaction_id": "0.0.8001-1700000000-000000123", "result": result,
          "transfers": [{"account": STEWARD, "amount": hbar}, {"account": "0.0.8001", "amount": -hbar}]}
    if token:
        tx["token_transfers"] = [{"token_id": "0.0.429274", "account": STEWARD, "amount": token}]
    return tx


def test_settlement_pass(monkeypatch):
    r = _settle(monkeypatch, _settle_tx(), min_amount=1_000_000_000)
    assert r["steward_credit"] == 1_000_000_000 and r["transaction_id"] == "0.0.8001-1700000000-000000123"


def test_settlement_too_small(monkeypatch):
    with pytest.raises(st.VerificationError, match="credited steward"):
        _settle(monkeypatch, _settle_tx(hbar=5), min_amount=1_000_000_000)


def test_settlement_failed_or_missing(monkeypatch):
    with pytest.raises(st.VerificationError, match="result"):
        _settle(monkeypatch, _settle_tx(result="INVALID_SIGNATURE"), min_amount=1)
    monkeypatch.setattr(st, "http_get_json", fake_http([]))
    with pytest.raises(st.VerificationError, match="not found"):
        st.verify_settlement(st.Mirror(), settled_tx="0.0.1@1.1", steward=STEWARD, min_amount=1, timeout_s=0)


def test_settlement_token_usdc(monkeypatch):
    r = _settle(monkeypatch, _settle_tx(hbar=0, token=1_000_000), min_amount=st.parse_token_amount("1", 6), asset="0.0.429274")
    assert r["steward_credit"] == 1_000_000
    with pytest.raises(st.VerificationError):
        _settle(monkeypatch, _settle_tx(hbar=0, token=10), min_amount=1_000_000, asset="0.0.429274")


# ── env mapping & check ──

def _accounts_env(tmp_path, **ids):
    lines = ["HEDERA_NETWORK=hedera:testnet", "HEDERA_MIRROR_NODE=https://testnet.mirrornode.hedera.com"]
    evms = {"FAN": "0xf18cd41213b55fb952c21345bb09e389d3f7338c", "ARTIST": ARTIST_EVM,
            "COMPUTE": COMPUTE_EVM, "METER": "0x41d788aa488b6259a06b47b7d49dced90655f921"}
    for role, evm in evms.items():
        lines += [f"FORK_DEMO_{role}_EVM_ADDRESS={evm}", f"FORK_DEMO_{role}_PUBLIC_KEY=pub{role}",
                  f"FORK_DEMO_{role}_PRIVATE_KEY=0x{role.lower()}{'cd' * 28}", f"FORK_DEMO_{role}_ACCOUNT_ID={ids.get(role, '')}"]
    p = tmp_path / "accounts.env"
    p.write_text("\n".join(lines) + "\n")
    return p


def test_env_mapping_with_evm_alias_resolution(tmp_path, monkeypatch):
    for k in list(__import__("os").environ):
        if k.startswith(("FORK_DEMO_", "STEWARD_", "ARTIST_")) or k in ("ACCOUNT_ID", "PRIVATE_KEY", "HEDERA_NETWORK"):
            monkeypatch.delenv(k, raising=False)
    env = st.merged_env(str(_accounts_env(tmp_path, ARTIST="0.0.5002")))
    monkeypatch.setattr(st, "http_get_json", fake_http([(f"/accounts/{COMPUTE_EVM}", 200, {"account": STEWARD, "balance": {"balance": 5}})]))
    cfg = st.load_config(env)
    assert cfg.steward_account == STEWARD and cfg.artist_account == ARTIST
    assert cfg.steward_private_key.startswith("0xcompute")
    assert "compute" not in repr(cfg)  # key hidden from repr


def test_env_overrides_and_utkarsh_names(monkeypatch):
    monkeypatch.setattr(st, "http_get_json", lambda *a, **k: pytest.fail("no lookup needed"))
    cfg = st.load_config({"ACCOUNT_ID": "0.0.11", "PRIVATE_KEY": "k1", "ARTIST_ACCOUNT_ID": "0.0.12"})
    assert (cfg.steward_account, cfg.artist_account, cfg.steward_private_key) == ("0.0.11", "0.0.12", "k1")
    cfg = st.load_config({"STEWARD_ACCOUNT_ID": "0.0.21", "FORK_DEMO_COMPUTE_ACCOUNT_ID": "0.0.99",
                          "STEWARD_PRIVATE_KEY": "k2", "FORK_DEMO_ARTIST_ACCOUNT_ID": "0.0.22"})
    assert (cfg.steward_account, cfg.artist_account, cfg.steward_private_key) == ("0.0.21", "0.0.22", "k2")


def test_check_all_unfunded(tmp_path, monkeypatch):
    monkeypatch.setattr(st, "http_get_json", fake_http([]))
    env = st.load_env_file(str(_accounts_env(tmp_path)))
    lines = []
    res = st.run_check(env, out=lines.append)
    assert not res["ready"]
    assert sum("NOT FOUND (unfunded)" in ln for ln in lines) == 4
    assert lines[-1].startswith("NOT READY")
    assert not any("cdcd" in ln for ln in lines)  # no private key material printed


def test_check_ready(tmp_path, monkeypatch):
    monkeypatch.setattr(st, "http_get_json", fake_http([
        (f"/accounts/{COMPUTE_EVM}", 200, {"account": STEWARD, "balance": {"balance": 5 * 10**8}}),
        (f"/accounts/{ARTIST_EVM}", 200, {"account": ARTIST, "balance": {"balance": 0}}),
    ]))
    lines = []
    res = st.run_check(st.load_env_file(str(_accounts_env(tmp_path))), out=lines.append)
    assert res["ready"] and lines[-1] == "READY"


def test_check_cli_exit_zero(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(st, "http_get_json", fake_http([]))
    assert st.main(["check", "--env-file", str(_accounts_env(tmp_path))]) == 0
    assert "NOT READY" in capsys.readouterr().out


# ── LLM settings ──

def test_llm_settings_0g_and_groq(tmp_path):
    kf = tmp_path / "k"
    kf.write_text("sk-zerog-secret\n")
    s = st.llm_settings("0g", {"ZEROG_API_KEY_FILE": str(kf)})
    assert s["base_url"] == "https://router-api.0g.ai/v1" and s["model"] == "0gm-1.0-35b-a3b"
    assert s["api_key"] == "sk-zerog-secret"
    assert s["extra_body"] == {"chat_template_kwargs": {"enable_thinking": False}}
    g = st.llm_settings("groq", {"OPENAI_API_KEY": "g"})
    assert g["base_url"] == "https://api.groq.com/openai/v1" and g["model"] == "openai/gpt-oss-20b"
    o = st.llm_settings("groq", {"LLM_BASE_URL": "http://x", "LLM_MODEL": "m"})
    assert (o["base_url"], o["model"]) == ("http://x", "m")


def test_llm_proof_captures_ids():
    msgs = [SimpleNamespace(response_metadata={"id": "chatcmpl-1", "headers": {"X-Request-Id": "r1", "x-provider": "0xP"}}),
            SimpleNamespace(response_metadata={}),
            SimpleNamespace(response_metadata={"id": "chatcmpl-2"})]
    p = st.llm_proof({"provider": "0g", "model": "m", "base_url": "b", "api_key": "SECRET"}, msgs)
    assert p["response_id"] == "chatcmpl-2" and p["x_request_ids"] == ["r1"] and p["upstream_providers"] == ["0xP"]
    assert "SECRET" not in json.dumps(p)


# ── end-to-end (mocked) ──

def _e2e_mirror(monkeypatch, artist_amt=963_100_000):
    state = {}

    def _get(url, timeout=15.0):
        if "transactiontype=CRYPTOTRANSFER" in url:
            m = state.get("marker", "")
            return 200, {"transactions": [transfer_tx(f"{STEWARD}-1793998790-000000001", artist_amt, -artist_amt - 100,
                                                      memo=f"OSO steward {m} DEMO")]}
        if "/topics/0.0.7777/messages" in url:
            return 200, {"messages": [_msg(state.get("message", ""))]}
        return 404, None

    monkeypatch.setattr(st, "http_get_json", _get)
    return state


def test_direct_mode_end_to_end_mocked(monkeypatch, tmp_path):
    state = _e2e_mirror(monkeypatch)

    def fake_direct(cfg, *, split, message, memo, topic_id):
        state["message"], state["marker"] = message, json.loads(message)["marker"]
        assert split["artist_tinybar"] == 963_100_000 and "DEMO" in memo
        assert json.loads(message)["label"] == st.DEMO_LABEL
        return {"transfer_tx_id": f"{STEWARD}-1793998790-000000001", "topic_id": "0.0.7777"}

    monkeypatch.setattr(st, "execute_direct", fake_direct)
    cfg = st.StewardConfig("testnet", st.DEFAULT_MIRROR, STEWARD, ARTIST, FAKE_KEY)
    proof = st.process_artist_payment(cfg, mode="direct", artist_name="demo-artist.oso.eth", total_tinybar=10**9,
                                      settled_tx=None, demo=True, topic_id=None, env={}, timeout_s=0)
    assert proof["verified"] and proof["hcs_topic_id"] == "0.0.7777" and proof["hcs_sequence"] == 3
    assert proof["label"] == st.DEMO_LABEL
    blob = json.dumps(proof)
    assert FAKE_KEY not in blob and FAKE_KEY[2:] not in blob
    st.assert_public_safe(proof, [FAKE_KEY])
    with pytest.raises(st.StewardError):
        st.assert_public_safe({**proof, "oops": FAKE_KEY[2:]}, [FAKE_KEY])


def test_agent_mode_untrusted_llm_text_does_not_count(monkeypatch):
    state = _e2e_mirror(monkeypatch, artist_amt=900_000_000)  # agent sent the wrong amount

    async def fake_agent(cfg, *, settings, prompt):
        assert "transfer_hbar_tool" in prompt and ARTIST in prompt
        state["message"] = "nothing"
        msgs = [SimpleNamespace(response_metadata={"id": "chatcmpl-z"}, content="Done! tx 0.0.1@1.1 SUCCESS")]
        return {"tool_calls": ["transfer_hbar_tool"], "final_text_UNTRUSTED": msgs[-1].content}, msgs

    monkeypatch.setattr(st, "execute_agent", fake_agent)
    cfg = st.StewardConfig("testnet", st.DEFAULT_MIRROR, STEWARD, ARTIST, FAKE_KEY)
    with pytest.raises(st.VerificationError):
        st.process_artist_payment(cfg, mode="agent", artist_name="a", total_tinybar=10**9, settled_tx=None,
                                  demo=True, topic_id="0.0.7777", llm="groq", env={"OPENAI_API_KEY": "x"}, timeout_s=0)


def test_requires_settled_or_demo():
    cfg = st.StewardConfig("testnet", st.DEFAULT_MIRROR, STEWARD, ARTIST, FAKE_KEY)
    with pytest.raises(st.StewardError, match="demo-amount"):
        st.process_artist_payment(cfg, mode="direct", artist_name="a", total_tinybar=10**9,
                                  settled_tx=None, demo=False, topic_id=None, env={})


def test_hcs_message_size_and_label():
    split = st.calculate_steward_split("10")
    m = json.loads(st.build_hcs_message(marker="oso-1", artist_name="demo-artist.oso.eth", artist_account=ARTIST,
                                        split=split, settled_tx="0.0.1@2.3", demo=False))
    assert m["settled_tx"] == "0.0.1-2-000000003" and m["artist_tinybar"] == 963_100_000 and m["oso_cut_tinybar"] == 0


# ── dry-run (no network at all) ──

def test_dry_run_no_network_mock_settled(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(st, "http_get_json", lambda *a, **k: pytest.fail("network touched in dry-run"))
    monkeypatch.setattr(st, "execute_direct", lambda *a, **k: pytest.fail("chain touched in dry-run"))
    monkeypatch.setattr(st, "build_llm", lambda *a, **k: pytest.fail("LLM touched in dry-run"))
    envf = _accounts_env(tmp_path)
    out = tmp_path / "proof.json"
    for cmd in ("direct", "agent"):
        rc = st.main([cmd, "--env-file", str(envf), "--settled-tx", "mock-x402-123", "--amount-hbar", "1",
                      "--artist-name", "demo-artist.oso.eth", "--json-out", str(out), "--dry-run"])
        assert rc == 0
        proof = json.loads(out.read_text())
        assert proof["mode"] == "dry-run" and proof["status"] == "not-submitted" and proof["verified"] is False
        assert proof["would_run_mode"] == cmd
        assert proof["would_submit"]["transfer"]["tinybar"] == 96_310_000
        assert proof["split"]["compute_tinybar"] == 3_690_000
        assert proof["settled_tx"] == "mock-x402-123"
        assert "cdcd" not in out.read_text()  # no private-key material
    printed = capsys.readouterr().out
    assert "DRY RUN" in printed and "cdcd" not in printed


def test_dry_run_refuses_same_alias(tmp_path):
    cfg = st.StewardConfig("testnet", st.DEFAULT_MIRROR, None, None, "", steward_evm=ARTIST_EVM, artist_evm=ARTIST_EVM)
    with pytest.raises(st.StewardError, match="REFUSED"):
        st.dry_run(cfg, mode="direct", artist_name="a", total_tinybar=10**8, settled_tx="mock-1", demo=False,
                   topic_id=None, env={})


def test_json_out_on_failure_has_verified_false(tmp_path, monkeypatch):
    monkeypatch.setattr(st, "http_get_json", fake_http([]))  # aliases unresolved → refusal
    out = tmp_path / "fail.json"
    monkeypatch.setenv("STEWARD_ACCOUNTS_ENV", str(_accounts_env(tmp_path)))
    rc = st.main(["direct", "--settled-tx", "0.0.1@2.3", "--amount-hbar", "1", "--json-out", str(out)])
    assert rc == st.EXIT_CONFIG
    data = json.loads(out.read_text())
    assert data["verified"] is False and data["status"] == "error" and "cdcd" not in out.read_text()
