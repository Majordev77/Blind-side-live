"""Which model the agents run on, chosen by BLINDSIDE_MODEL.

- "foundry": a Microsoft Foundry deployment (Azure), through Agent
  Framework's OpenAI-compatible chat client.
- "foundry-local": Foundry Local on this machine (no Azure subscription),
  through agent-framework-foundry-local.
- "offline": no model. A stand-in writer returns the template sentence,
  and with BLINDSIDE_FAULT_RATE it deliberately puts a wrong number into
  some drafts, so the verifier's rejections can be exercised and shown.
  Lines it produces are always labelled as offline, never as model output.

Every provider is an Agent Framework chat client, so the same Agent and
workflow code runs on all of them.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from agent_framework import BaseChatClient, ChatResponse, Message


@dataclass
class ModelInfo:
    """What produced a line: recorded with every line for the audit trail."""

    provider: str
    model: str
    writes: bool  # False when no model writes (offline): lines are templates


def make_client() -> tuple[Any, ModelInfo]:
    """The chat client for the configured provider, and a description of it."""
    provider = os.environ.get("BLINDSIDE_MODEL", "offline")
    if provider == "foundry":
        from agent_framework.openai import OpenAIChatCompletionClient

        model = os.environ["FOUNDRY_MODEL_DEPLOYMENT"]
        kwargs: dict[str, Any] = {"model": model}
        if os.environ.get("FOUNDRY_OPENAI_BASE_URL"):
            kwargs["base_url"] = os.environ["FOUNDRY_OPENAI_BASE_URL"]  # .../openai/v1
        else:
            kwargs["azure_endpoint"] = os.environ["AZURE_OPENAI_ENDPOINT"]
            kwargs["api_version"] = os.environ.get("AZURE_OPENAI_API_VERSION")
        if os.environ.get("FOUNDRY_API_KEY"):
            kwargs["api_key"] = os.environ["FOUNDRY_API_KEY"]
        else:
            from azure.identity import DefaultAzureCredential

            kwargs["credential"] = DefaultAzureCredential()
        return OpenAIChatCompletionClient(**kwargs), ModelInfo("foundry", model, True)
    if provider == "foundry-local":
        model = os.environ.get("FOUNDRY_LOCAL_MODEL", "phi-4-mini")
        url = os.environ.get("FOUNDRY_LOCAL_URL") or _foundry_local_url()
        if url:
            # Foundry Local 0.12+ serves an OpenAI-compatible API; load the model first (foundry model load <id>).
            from agent_framework.openai import OpenAIChatCompletionClient

            client = OpenAIChatCompletionClient(model=model, base_url=url.rstrip("/") + "/v1", api_key="foundry-local")
            return client, ModelInfo("foundry-local", model, True)
        from agent_framework.foundry import FoundryLocalClient  # pip install agent-framework-foundry-local --pre

        return FoundryLocalClient(model=model), ModelInfo("foundry-local", model, True)
    rate = float(os.environ.get("BLINDSIDE_FAULT_RATE", "0"))
    return OfflineWriter(fault_rate=rate), ModelInfo("offline", f"templates, fault rate {rate}", False)


def _foundry_local_url() -> str | None:
    """The address of the running Foundry Local service, from the file it writes on start."""
    try:
        info = json.loads((Path.home() / ".foundry" / "daemon.json").read_text(encoding="utf-8"))
        return (info.get("web_urls") or [None])[0]
    except (OSError, ValueError):
        return None


def first_json(text: str) -> Any:
    """The first JSON object in a model reply. Small local models often wrap JSON in prose or fences."""
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, flags=re.DOTALL)
    if fence:
        text = fence.group(1)
    start = text.find("{")
    if start < 0:
        raise ValueError("no JSON object in the reply")
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return json.loads(text[start : i + 1])
    raise ValueError("unterminated JSON object in the reply")


class OfflineWriter(BaseChatClient):
    """A stand-in for the narrator model when no model is available.

    It answers narrator requests with the template sentence for each variant
    (the request carries it as "fallback"), so the workflow, verifier,
    retries and logs all run for real. With fault_rate > 0 it changes one
    number in some first drafts, chosen by a hash so runs are repeatable;
    retries are always clean. It never answers verifier requests: the model
    check is skipped when no model is configured.
    """

    OTEL_PROVIDER_NAME = "blindside-offline"

    def __init__(self, fault_rate: float = 0.0) -> None:
        super().__init__()
        self.fault_rate = fault_rate

    def _inner_get_response(self, *, messages: Any, stream: bool, options: Any, **kwargs: Any) -> Any:
        async def respond() -> ChatResponse:
            prompt = messages[-1].text if messages else ""
            reply = self._narrate(prompt)
            return ChatResponse(messages=[Message(role="assistant", contents=[reply])], response_id="offline")

        return respond()

    def _narrate(self, prompt: str) -> str:
        req = first_json(prompt)
        retry = bool(req.get("retry"))
        out = {}
        for key, v in req["variants"].items():
            text = v["fallback"]
            if not retry and self._faulty(req["moment_id"], key):
                text = _bump_a_number(text)
            out[key] = {"text": text, "claims": []}
        return json.dumps({"lines": out})

    def _faulty(self, moment_id: str, key: str) -> bool:
        if self.fault_rate <= 0:
            return False
        h = int(hashlib.sha256(f"{moment_id}|{key}".encode()).hexdigest()[:8], 16)
        return (h % 1000) / 1000 < self.fault_rate


def _bump_a_number(text: str) -> str:
    """Make a draft wrong in the way a model most often is: one number off by one."""
    m = re.search(r"\b(\d+)\b", text)
    if m:
        return text[: m.start()] + str(int(m.group(1)) + 1) + text[m.end():]
    return text.replace("three", "four", 1) if "three" in text else text + " That is 2 in a row."
