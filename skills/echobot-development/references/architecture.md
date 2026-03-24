# Architecture

Read this file when a change crosses module boundaries or when you need to trace a request end to end.

## Top-level entrypoints

- `echobot/cli/main.py` is the unified CLI. With no subcommand it falls back to `chat`.
- `echobot/cli/chat.py`, `echobot/cli/gateway.py`, and `echobot/cli/app.py` all build the shared runtime through `echobot/runtime/bootstrap.py`.
- `echobot/app/create_app.py` builds the FastAPI app, mounts routers, and serves the browser UI from `echobot/app/web/`.
- `echobot/app/runtime.py` wraps the shared runtime with channel, gateway, ASR, TTS, and web-console services.

## Shared runtime assembly

`build_runtime_context(...)` in `echobot/runtime/bootstrap.py` is the single assembly point. It creates:

- `AttachmentStore`
- provider instances
- decider and roleplay providers
- `AgentCore`
- session stores for user sessions and agent sessions
- `AgentTraceStore`
- a `ToolRegistry` factory
- `SkillRegistry`
- `CronService` and optional `HeartbeatService`
- `SessionAgentRunner`
- `RoleCardRegistry`
- `DecisionEngine`
- `RoleplayEngine`
- `ConversationCoordinator`
- `AgentTraceStore`

If a feature should exist in chat, gateway, and app, wire it here once.

## User turn flow

1. A CLI command, gateway event, or API handler resolves a session and calls the coordinator.
2. `ConversationCoordinator.handle_user_turn_stream(...)` loads session state, role, and route mode.
3. `DecisionEngine.decide(...)` picks `chat` or `agent`.
4. Chat route goes straight to `RoleplayEngine.stream_chat_reply(...)`.
5. Agent route optionally creates a short delegated acknowledgement, stores visible history, and starts a background job.
6. The background job calls `SessionAgentRunner.run_prompt(...)`.
7. `run_agent_turn(...)` chooses `ask_with_skills(...)`, `ask_with_tools(...)`, or `ask_with_memory(...)`.
8. When skills are enabled, `AgentCore.ask_with_skills(...)` adds the skill catalog prompt, persists explicit `/skill-name` or `$skill-name` activations, and registers `activate_skill`, `list_skill_resources`, and `read_skill_resource` on top of the base tools.
9. The raw agent result is wrapped back through `RoleplayEngine.present_agent_result(...)`, `present_agent_failure(...)`, or the scheduled-task presenters before it is shown to the user.

## Base tool and skill composition

- `create_basic_tool_registry(...)` in `echobot/tools/builtin.py` builds the shared base tool set.
- The default base tools are time, directory listing, text file read/write, web requests, and shell commands.
- If attachments are enabled, media tools are added for viewing images and sending image or file outputs back to the user.
- If memory is enabled, the memory search tool is added.
- If cron is enabled, the cron tool is added with mutation rules that depend on whether the turn is scheduled.
- Skill tools are not part of the base registry. They are layered in by `AgentCore.ask_with_skills(...)`.

## Separation of concerns

### Decision layer

- `echobot/orchestration/decision.py`
- Rule-based routing handles obvious tool, workspace, memory, and scheduling requests.
- The lightweight decider LLM handles ambiguous turns.
- Route modes are defined in `echobot/orchestration/route_modes.py`.

### Roleplay layer

- `echobot/orchestration/roleplay.py`
- Only uses visible conversation context plus explicit system instructions.
- Must not inspect files, tools, memory, or schedules directly.
- Presents chat replies, delegated acknowledgements, final agent results, failures, and scheduled notifications.

### Roles layer

- `echobot/orchestration/roles.py`
- Discovers role cards from `echobot/roles/`, `roles/`, and `.echobot/roles/`.
- Keeps role prompts separate from agent-side tool execution.

### Agent layer

- `echobot/agent.py`
- `echobot/runtime/session_runner.py`
- `echobot/runtime/turns.py`
- Owns tool use, skill use, file access, memory lookup, scheduling changes, and other background work.

## Skills and tools

- `SkillRegistry.discover(...)` searches project skills first, then built-in and user roots.
- Skill activation can happen via explicit `/skill-name` or `$skill-name`, or through the `activate_skill` tool.
- Bundled resource files stay unloaded until the agent calls `list_skill_resources` or `read_skill_resource`.
- Base tools come from `create_basic_tool_registry(...)` in `echobot/tools/builtin.py`.

## Session and state files

- Sessions: `.echobot/sessions/`
- Agent-side session history: `.echobot/agent_sessions/`
- Agent traces: `.echobot/agent_traces/`
- Cron store: `.echobot/cron/jobs.json`
- Heartbeat file: `.echobot/HEARTBEAT.md`
- Channel config: `.echobot/channels.json`
- Delivery state: `.echobot/delivery.json`
- Gateway route sessions: `.echobot/route_sessions.json`
- Attachments: `.echobot/attachments/`
- Managed roles: `.echobot/roles/`
- Runtime settings: `.echobot/runtime_settings.json`

## Current module map

- `echobot/commands/`: user command parsing and execution for CLI and gateway flows
- `echobot/channels/`: channel configs, message bus, manager, and platform adapters
- `echobot/gateway/`: inbound route-to-session mapping and outbound delivery
- `echobot/app/runtime.py`: app-only runtime wrapper that starts channels, gateway, ASR, TTS, and web console helpers
- `echobot/app/routers/`: HTTP endpoints for chat, sessions, roles, cron, heartbeat, channels, and web
- `echobot/app/services/`: server-side helpers used by the API layer
- `echobot/app/web/`: static browser UI assets
- `echobot/attachments.py` and `echobot/images.py`: attachment persistence and image input or output limits
- `echobot/memory/`: ReMeLight support
- `echobot/asr/` and `echobot/tts/`: speech services

## Test map

- `tests/test_skill_support.py`: skill discovery, activation, and lazy resource loading
- `tests/test_chat_agent.py`: CLI trace labels for skill activation and resource reads
- `tests/test_agent.py`, `tests/test_tools.py`, and `tests/test_agent_traces.py`: agent loop, tool execution, and trace persistence
- `tests/test_decision.py`, `tests/test_roleplay.py`, `tests/test_coordinator.py`, and `tests/test_roles.py`: routing, presentation, coordinator behavior, and role cards
- `tests/test_commands.py`, `tests/test_gateway.py`, and `tests/test_app_api.py`: command, gateway, and API surfaces
- `tests/test_sessions.py`, `tests/test_config.py`, and `tests/test_scheduler.py`: persisted runtime state and runtime configuration
- `tests/test_images.py`, `tests/test_channel_images.py`, and `tests/test_tts.py`: media-related flows
