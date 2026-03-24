---
name: echobot-development
description: Use when working on this EchoBot repository and changing Python implementation details such as the agent or tool loop, providers, skill runtime, sessions, routing and roleplay, CLI or gateway or app wiring, channels, web API or web UI, scheduling, memory, attachments or images, roles, ASR or TTS, commands, or tests. Also use for requests like “修改 EchoBot”, “更新 skill 运行时”, “排查路由或会话问题”, “补测试”, “重构这个仓库”, or “review this EchoBot change”.
---

# EchoBot Development

Work inside the current repository layout. Favor small, readable changes that keep shared runtime paths unified.

## Start here

- Read `AGENTS.md` before large changes. Keep code beginner-friendly, prefer `pathlib`, and avoid blocking the event loop.
- Find the real entrypoint first: `echobot/cli/main.py`, `echobot/cli/chat.py`, `echobot/cli/gateway.py`, `echobot/cli/app.py`, or `echobot/app/create_app.py`.
- Reuse the shared runtime assembly in `echobot/runtime/bootstrap.py`. Do not create separate business logic for CLI, gateway, and app entrypoints.
- Trace agent work through `echobot/runtime/session_runner.py` and `echobot/runtime/turns.py` before changing behavior inside `echobot/agent.py`.
- Prefer extending existing registries and services over adding parallel code paths.
- Keep user-visible roleplay behavior separate from background agent execution.

## Practical workflow

1. Locate the real entrypoint for the behavior you are changing.
2. Trace the flow through `bootstrap.py`, `ConversationCoordinator`, `SessionAgentRunner`, and the relevant subsystem.
3. Make the smallest coherent change.
4. Run focused tests first, then broader tests if the change crosses subsystem boundaries.

## Shared runtime rules

- Blocking file, network, or CPU-heavy work must stay off the event loop. Use `asyncio.to_thread(...)` or an executor when needed.
- Keep one source of truth for sessions, tools, skills, routing, and scheduling. If a feature belongs in `RuntimeContext`, wire it there once and reuse it.
- `create_basic_tool_registry(...)` is the shared base tool set. Extend it or the downstream factory instead of hand-building tool lists in one entrypoint only.
- Use `json.dumps(..., ensure_ascii=False)` for JSON output.
- When behavior changes, update or add tests under `tests/`.
- When changing a project skill, validate it with `python -X utf8 echobot/skills/skill-creator/scripts/quick_validate.py skills/<skill-name>`.

## Key code areas

| Area | Path | Purpose |
|---|---|---|
| Agent loop | `echobot/agent.py` | `AgentCore` request flow, tool loop, and skill-aware prompting |
| Providers | `echobot/providers/` | Provider abstraction and OpenAI-compatible settings |
| Tools | `echobot/tools/` | Base registry plus filesystem, shell, web, media, memory, and cron tools |
| Skills | `echobot/skill_support/` | Discovery, parsing, explicit activation, and lazy resource tools |
| Runtime | `echobot/runtime/` | Bootstrap, sessions, traces, turn execution, and runtime settings |
| Orchestration | `echobot/orchestration/` | Decision layer, roleplay layer, coordinator, jobs, and route modes |
| Roles | `echobot/orchestration/roles.py`, `echobot/roles/` | Role card discovery, normalization, and defaults |
| Commands | `echobot/commands/` | CLI and gateway command parsing and dispatch |
| Channels | `echobot/channels/` | Bus, manager, channel configs, and console/qq/telegram adapters |
| Gateway | `echobot/gateway/` | Route-to-session mapping and outbound delivery |
| App | `echobot/app/` | FastAPI app, routers, services, runtime wrapper, and browser assets |
| Attachments and images | `echobot/attachments.py`, `echobot/images.py` | Attachment storage plus image limits and promotion |
| Memory | `echobot/memory/` | ReMeLight integration |
| Scheduling | `echobot/scheduling/` | Cron and heartbeat services |
| Speech | `echobot/asr/`, `echobot/tts/` | Local ASR and TTS backends |
| Built-in skills | `echobot/skills/` | Runtime-bundled skills used as defaults or examples |
| Tests | `tests/` | Focused regression coverage by subsystem |

## Focused tests

- Skills or skill runtime: `python -m unittest tests.test_skill_support tests.test_chat_agent -v`
- Agent, tools, or traces: `python -m unittest tests.test_agent tests.test_tools tests.test_agent_traces -v`
- Routing, roleplay, or roles: `python -m unittest tests.test_decision tests.test_roleplay tests.test_coordinator tests.test_roles -v`
- Gateway, channels, attachments, or API: `python -m unittest tests.test_gateway tests.test_app_api tests.test_commands tests.test_channel_images tests.test_images -v`
- Sessions, config, or scheduler: `python -m unittest tests.test_sessions tests.test_config tests.test_scheduler -v`
- TTS changes: `python -m unittest tests.test_tts -v`

Read `references/architecture.md` before touching more than one subsystem or any shared runtime path.
