from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from ....runtime.settings import RuntimeSettingsStore


class WebRuntimeSettingsService:
    def __init__(self, workspace: Path) -> None:
        self._store = RuntimeSettingsStore(
            workspace / ".echobot" / "runtime_settings.json",
        )

    async def save_settings(
        self,
        *,
        delegated_ack_enabled: bool,
    ) -> dict[str, Any]:
        settings = await asyncio.to_thread(
            self._store.update_named_value,
            "delegated_ack_enabled",
            bool(delegated_ack_enabled),
        )
        return settings.to_dict()


__all__ = [
    "WebRuntimeSettingsService",
]
