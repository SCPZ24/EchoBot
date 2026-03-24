---
name: echobot-development
description: >
  Work on this EchoBot repository when the task changes repository code or runtime behavior:
  agent loop, skill runtime, tool registry, session flow, routing, roleplay, commands,
  channels, gateway delivery, FastAPI API, browser UI, scheduling, memory, attachments,
  images, ASR, TTS, or tests. Use for requests like "修改 EchoBot 逻辑", "排查 route /
  会话 / skill / 定时任务问题", "补测试", "重构这个仓库", or "review this EchoBot
  change".
---

# EchoBot Development

Work inside the current repository layout. Keep changes small, readable, and shared across CLI, gateway, and app entrypoints.

## Start here

- Read `AGENTS.md` before non-trivial changes.
- Keep Python 3.11+ code beginner-friendly. Prefer `pathlib`. Keep one clear responsibility per function or class.
- Do not block the event loop. Move blocking file, network, or CPU-heavy work to `asyncio.to_thread(...)` or an executor.
- Find the real entrypoint first: `echobot/cli/main.py`, `echobot/cli/chat.py`, `echobot/cli/gateway.py`, `echobot/cli/app.py`, or `echobot/app/create_app.py`.
- Reuse the shared runtime assembly in `echobot/runtime/bootstrap.py`. If a feature should exist in chat, gateway, and app, wire it there once.

## Choose the right layer

- Change `echobot/orchestration/decision.py` or `echobot/orchestration/route_modes.py` for route selection only.
- Change `echobot/orchestration/roleplay.py` for visible persona replies, delegated acknowledgements, and final presentation only.
- Change `echobot/agent.py`, `echobot/runtime/session_runner.py`, or `echobot/runtime/turns.py` for background agent behavior, tools, skills, memory, and scheduling.
- Change `echobot/tools/` or `echobot/skill_support/` instead of duplicating tool or skill wiring in one entrypoint.
- Change `echobot/commands/` and `echobot/cli/session_commands.py` for `/route`, `/runtime`, `/role`, and session command behavior.
- Change `echobot/app/routers/`, `echobot/app/services/`, and `echobot/app/web/` for HTTP or browser UI behavior.

## Practical workflow

1. Locate the entrypoint and the owning layer.
2. Trace shared wiring through `build_runtime_context(...)`, `ConversationCoordinator`, and `SessionAgentRunner`.
3. Make the smallest coherent change.
4. Add or update focused tests under `tests/`.
5. Run the narrowest useful test group first, then expand if the change crosses subsystem boundaries.

## Shared runtime rules

- Keep one source of truth for sessions, tools, skills, route modes, runtime settings, and scheduling.
- Extend `create_basic_tool_registry(...)` or the tool-registry factory instead of hand-building tool lists for one surface.
- Keep skill behavior inside `echobot/skill_support/` and repository-local skills under `skills/`.
- Preserve the separation between user-facing roleplay context and background agent execution context.
- Use `json.dumps(..., ensure_ascii=False)` for JSON output.
- When changing a project skill, validate it with `python -X utf8 echobot/skills/skill-creator/scripts/quick_validate.py skills/<skill-name>`.

## Focused tests

- Skills or skill runtime: `python -m unittest tests.test_skill_support tests.test_chat_agent -v`
- Agent loop, tools, or traces: `python -m unittest tests.test_agent tests.test_tools tests.test_agent_traces -v`
- Routing, coordinator, or roleplay: `python -m unittest tests.test_decision tests.test_coordinator tests.test_roleplay tests.test_roles -v`
- Commands, gateway, or API: `python -m unittest tests.test_commands tests.test_gateway tests.test_app_api -v`
- Sessions, settings, or scheduler: `python -m unittest tests.test_sessions tests.test_config tests.test_scheduler -v`
- Images, attachments, or TTS: `python -m unittest tests.test_images tests.test_channel_images tests.test_tts -v`

Read `references/architecture.md` before changing more than one subsystem or any shared runtime path.
