---
name: echobot-skill-authoring
description: Use when creating, revising, or validating a skill for this EchoBot repository, including SKILL.md frontmatter, trigger descriptions, project skill folders under skills/, bundled references or scripts or assets or agents, or EchoBot skill discovery, explicit activation, and lazy resource loading. Also use for requests like “更新 skill”, “写 SKILL.md”, “这个 skill 为什么没触发”, or “给 EchoBot 加一个项目内技能”.
---

# EchoBot Skill Authoring

Create or revise repository-local skills that EchoBot can discover and activate.

## Authoring goals

- Put project-specific skills under `skills/<skill-name>/`.
- Use lowercase kebab-case for the folder name and the `name` frontmatter field.
- Keep frontmatter minimal. EchoBot routing reads `name` and `description` from `SKILL.md`.
- Keep `name` as a single-line value. `description` may be a single line or a YAML block scalar with `>` or `|`.
- Write `description` as the trigger surface: what the skill does, when to use it, and what kinds of user requests or contexts should activate it. Include likely request phrasing when that improves triggering.
- Keep the main body procedural and concise. Move deeper material into small files under `references/` or `scripts/`.
- Design for lazy loading. After activation, EchoBot exposes the body plus a resource summary. It does not auto-load bundled files.
- Only put text resources that an agent may need to read into `references/`, `scripts/`, or `agents/`. `read_skill_resource` only reads UTF-8 text files.
- Use `assets/` for templates or binary output artifacts, not for essential instructions.
- Do not treat `agents/openai.yaml` as required. Current EchoBot discovery ignores it.
- Avoid extra docs like `README.md` or changelog files inside a skill unless the runtime truly needs them.

## Frontmatter checklist

- Keep `name` stable and specific. Renaming a skill changes explicit `/skill-name` and `$skill-name` activation.
- Make `description` concrete. Good descriptions say both the task and the trigger context.
- Do not put "when to use" guidance only in the body. The body is loaded after activation.
- EchoBot currently ignores extra frontmatter keys. The validator is more permissive for compatibility, but project-local skills should usually keep only `name` and `description`.

## Resource layout

```text
skills/<skill-name>/
|-- SKILL.md
|-- references/   # short, focused UTF-8 docs loaded on demand
|-- scripts/      # executable helpers or deterministic workflows
|-- assets/       # templates or binary resources not meant for context loading
`-- agents/       # optional helper prompts or agent-specific text resources
```

You do not need every folder. Create only what the skill actually uses.

## Practical workflow

1. Choose a stable kebab-case skill name and create or update `skills/<skill-name>/SKILL.md`.
2. Draft or refine the trigger description in `SKILL.md` before writing body details.
3. Keep the main body short and procedural. Tell the agent which resource to inspect first when the skill has multiple files.
4. Split long or variant-specific details into focused resource files.
5. Validate the skill with `python -X utf8 echobot/skills/skill-creator/scripts/quick_validate.py skills/<skill-name>`.
6. If the skill changes runtime expectations, update tests.

## EchoBot-specific notes

- Project skills override built-in skills with the same `name`.
- Explicit `/skill-name` or `$skill-name` activates the skill immediately.
- Otherwise the model may call `activate_skill`.
- Activation loads the skill body and a resource summary, not the bundled file contents.
- After activation, the agent must call `list_skill_resources` and `read_skill_resource` to inspect bundled files.
- If a skill depends on bundled files, make the body tell the agent which file to open first and why.
- If you change discovery, parsing, or activation behavior in `echobot/skill_support/`, run `python -m unittest tests.test_skill_support tests.test_chat_agent tests.test_agent -v`.

Read `references/runtime.md` before changing the skill runtime or designing a skill with many bundled files.
