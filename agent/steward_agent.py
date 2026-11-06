import asyncio
import os
from dotenv import load_dotenv

from hiero_sdk_python import Client, Network, AccountId, PrivateKey
from hedera_agent_kit.langchain.toolkit import HederaLangchainToolkit
from hedera_agent_kit.shared.configuration import Configuration, Context, AgentMode
from hedera_agent_kit.plugins import (
    core_account_plugin,
    core_consensus_plugin,
)
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

load_dotenv()

def calculate_steward_split(total_hbar: float) -> dict:
    """Splits payment: 96.31% to artist, 3.69% to agent compute (0% OSO cut)."""
    compute_cut = round(total_hbar * 0.0369, 4)
    artist_cut = round(total_hbar - compute_cut, 4)
    return {"artist_hbar": artist_cut, "compute_hbar": compute_cut}

async def process_artist_payment(artist_name: str, artist_hedera_id: str, total_hbar: float):
    client = Client(Network(network="testnet"))
    account_id = AccountId.from_string(os.getenv("ACCOUNT_ID"))
    raw_key = os.getenv("PRIVATE_KEY").removeprefix("0x")
    private_key = PrivateKey.from_string_ecdsa(raw_key)
    client.set_operator(account_id, private_key)

    configuration = Configuration(
        context=Context(
            mode=AgentMode.AUTONOMOUS,
            account_id=str(account_id),
        ),
        plugins=[
            core_account_plugin,
            core_consensus_plugin,
        ],
    )

    hedera_toolkit = HederaLangchainToolkit(client=client, configuration=configuration)
    all_tools = hedera_toolkit.get_tools()

    tools = [
        t for t in all_tools
        if "hbar" in t.name.lower() or "topic" in t.name.lower()
    ]

    llm = ChatOpenAI(
        model="openai/gpt-oss-20b",
        base_url="https://api.groq.com/openai/v1",
        api_key=os.getenv("OPENAI_API_KEY"),
    )

    agent = create_react_agent(llm, tools)

    split = calculate_steward_split(total_hbar)

    prompt = (
        f"You are the AI Steward Agent for {artist_name}. "
        f"A fan just paid {total_hbar} HBAR via the payment rail. "
        f"1. Transfer {split['artist_hbar']} HBAR (96.31%) directly to the artist account {artist_hedera_id} "
        f"(keeping {split['compute_hbar']} HBAR / 3.69% in the steward account for compute). "
        f"2. Submit a consensus message to topic {os.getenv('TOPIC_ID', 'a new topic with memo OSO-Steward-Log')} "
        f"recording: 'Paid {split['artist_hbar']} HBAR to {artist_name} ({artist_hedera_id}); 3.69% ({split['compute_hbar']} HBAR) retained for 0G agent compute.' "
        f"3. Return the transaction IDs."
    )

    response = await agent.ainvoke({"messages": [{"role": "user", "content": prompt}]})
    return response["messages"][-1].content

if __name__ == "__main__":
    print(asyncio.run(process_artist_payment("aniket.oso.eth", os.getenv("ACCOUNT_ID"), 10.0)))