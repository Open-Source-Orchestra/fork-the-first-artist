# 0G router — OpenAI tool-calling test (6 Nov 2026, ~20:59 UTC)

Question: can the 0G Compute router (OpenAI-compatible) drive the LangChain/LangGraph
ReAct steward agent, i.e. does it return OpenAI-style `tool_calls`?

**Answer: YES** — with thinking disabled.

- Base URL: `https://router-api.0g.ai/v1`
- Model: `0gm-1.0-35b-a3b`
- Required request field: `"chat_template_kwargs": {"enable_thinking": false}`.
  `0gm-1.0-35b-a3b` is a thinking model; without this flag it spends the whole
  `max_tokens` budget on reasoning and returns `finish_reason=length` with empty content.
  `steward.py` always sends it (`ChatOpenAI(extra_body=...)`).
- Key: read from `ZEROG_API_KEY` or the file named by `ZEROG_API_KEY_FILE`. The key is not
  in this repo and was not printed.

Two real calls in total, both with a harmless dummy tool `add(a: int, b: int)` and the prompt
"Use the add tool to compute 2+3.":

| # | Client | Result |
|---|--------|--------|
| 1 | raw `requests` POST `/chat/completions` with `tools=[add]`, `tool_choice=auto`, `max_tokens=200` | HTTP 200, `tool_calls=[{name: "add", arguments: "{\"a\": 2, \"b\": 3}"}]`, id `chatcmpl-b7be9251-9faf-48d1-8fc7-e4368b786dfd`, `x_0g_trace.request_id` `4ba956e4-7fbf-4ebc-be95-5fa0c83a198e`, provider `0xf4FB8d2bD856e672b5f9848b0eD235A20079B250`, 315 prompt / 35 completion tokens, `reasoning_tokens: 0`, total cost 42 micro-USD |
| 2 | `langchain_openai.ChatOpenAI(...).bind_tools([add])`, `include_response_headers=True` | `finish_reason=tool_calls`, `tool_calls=[{'name': 'add', 'args': {'a': 2, 'b': 3}}]`, `response_metadata.id` `chatcmpl-4d61300b-b9bd-443b-a5e8-888172b0a0e0`, header `x-request-id: 3663df6151cf80d6, 98dea1ae-3e40-461e-8674-e7a799bc9aae`, `x-0g-e2ee: sealed`, `x-provider: 0xf4FB…B250` |

What this means for the steward:
- `agent` mode uses 0G as its default brain (`--llm 0g`). `--llm groq` is still available.
- `steward.py` records each AI turn's `response_metadata.id` and the `x-request-id` /
  `x-provider` headers in the proof JSON under `llm`.
- LangChain does not expose the `x_0g_trace` body field (it is outside the OpenAI
  schema). The response id and `x-request-id` header are what we can record.
- Tool calling working on a toy tool does **not** prove the 35B model will produce the
  right Hedera transfer on its own. This is why the steward checks every agent result on
  the mirror node, and why `direct` mode (no LLM) exists.
