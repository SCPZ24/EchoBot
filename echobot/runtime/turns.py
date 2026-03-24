from __future__ import annotations

from collections.abc import Sequence

from ..agent import AgentCore, AgentRunResult, TraceCallback
from ..models import FileInput, ImageInput, LLMMessage
from ..skill_support import SkillRegistry
from ..tools import ToolRegistry


async def run_agent_turn(
    agent: AgentCore,
    prompt: str,
    history: list[LLMMessage],
    *,
    image_urls: Sequence[ImageInput] | None = None,
    file_attachments: Sequence[FileInput] | None = None,
    compressed_summary: str,
    skill_registry: SkillRegistry | None,
    tool_registry: ToolRegistry | None,
    extra_system_messages: Sequence[str] | None = None,
    transient_system_messages: Sequence[str] | None = None,
    temperature: float | None,
    max_tokens: int | None,
    max_steps: int = 50,
    trace_callback: TraceCallback | None = None,
) -> AgentRunResult:
    if skill_registry is not None:
        return await agent.ask_with_skills(
            prompt,
            image_urls=image_urls,
            file_attachments=file_attachments,
            history=history,
            compressed_summary=compressed_summary,
            skill_registry=skill_registry,
            tool_registry=tool_registry,
            extra_system_messages=extra_system_messages,
            transient_system_messages=transient_system_messages,
            temperature=temperature,
            max_tokens=max_tokens,
            max_steps=max_steps,
            trace_callback=trace_callback,
        )

    if tool_registry is not None:
        return await agent.ask_with_tools(
            prompt,
            image_urls=image_urls,
            file_attachments=file_attachments,
            history=history,
            compressed_summary=compressed_summary,
            tool_registry=tool_registry,
            extra_system_messages=extra_system_messages,
            transient_system_messages=transient_system_messages,
            temperature=temperature,
            max_tokens=max_tokens,
            max_steps=max_steps,
            trace_callback=trace_callback,
        )

    return await agent.ask_with_memory(
        prompt,
        image_urls=image_urls,
        file_attachments=file_attachments,
        history=history,
        compressed_summary=compressed_summary,
        extra_system_messages=extra_system_messages,
        transient_system_messages=transient_system_messages,
        temperature=temperature,
        max_tokens=max_tokens,
        trace_callback=trace_callback,
    )
