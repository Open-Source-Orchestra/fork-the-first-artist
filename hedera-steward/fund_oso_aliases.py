"""Utkarsh: run this with the SAME .env your steward script uses (ACCOUNT_ID, PRIVATE_KEY).
It sends testnet HBAR to the 4 OSO demo EVM aliases, which auto-creates their accounts.
Testnet only. Total = 16 HBAR.   pip install hiero-sdk-python python-dotenv ; python fund_oso_aliases.py
"""
import os
from dotenv import load_dotenv
from hiero_sdk_python import Client, Network, AccountId, PrivateKey, Hbar, TransferTransaction

load_dotenv()
ALIASES = {
    "fan":     ("0xf18cd41213b55fb952c21345bb09e389d3f7338c", 8),
    "artist":  ("0x611123ad22bb242f05d1f23d58753c48e0825e46", 2),
    "compute": ("0x3ed964927a6aa93367b6a7ff8922dd6960ed5434", 4),
    "meter":   ("0x41d788aa488b6259a06b47b7d49dced90655f921", 2),
}
client = Client(Network(network="testnet"))
op = AccountId.from_string(os.environ["ACCOUNT_ID"])
client.set_operator(op, PrivateKey.from_string_ecdsa(os.environ["PRIVATE_KEY"].removeprefix("0x")))
for role, (evm, hbar) in ALIASES.items():
    to = AccountId.from_evm_address(evm, 0, 0)
    tx = (TransferTransaction()
          .add_hbar_transfer(op, Hbar(-hbar).to_tinybars())
          .add_hbar_transfer(to, Hbar(hbar).to_tinybars()))
    receipt = tx.execute(client)
    print(role, evm, hbar, "HBAR ->", getattr(receipt, "status", receipt))
print("done — tell Shaka/sysadmin")
