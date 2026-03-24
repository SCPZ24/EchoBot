from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Any

from ....asr import ASRService
from ....tts import TTSService
from .live2d import Live2DService, Live2DUploadFile
from .settings import WebRuntimeSettingsService
from .stage import StageBackgroundService


class WebConsoleService:
    def __init__(
        self,
        workspace: Path,
        tts_service: TTSService,
        asr_service: ASRService,
    ) -> None:
        self._tts_service = tts_service
        self._asr_service = asr_service
        app_root = Path(__file__).resolve().parents[2]
        self._runtime_settings_service = WebRuntimeSettingsService(workspace)
        self._live2d_service = Live2DService(
            workspace / ".echobot" / "live2d",
            app_root / "builtin_live2d",
        )
        self._stage_background_service = StageBackgroundService(
            workspace / ".echobot" / "web" / "backgrounds",
            app_root / "builtin_stage_backgrounds",
        )

    @property
    def tts_service(self) -> TTSService:
        return self._tts_service

    @property
    def asr_service(self) -> ASRService:
        return self._asr_service

    async def build_frontend_config(
        self,
        *,
        session_name: str,
        role_name: str,
        route_mode: str,
        delegated_ack_enabled: bool,
    ) -> dict[str, Any]:
        live2d = await self._live2d_service.build_config()
        stage = await self._stage_background_service.build_config()
        return {
            "session_name": session_name,
            "role_name": role_name,
            "route_mode": route_mode,
            "runtime": {
                "delegated_ack_enabled": bool(delegated_ack_enabled),
            },
            "live2d": live2d or self._live2d_service.empty_config(),
            "stage": stage,
            "asr": asdict(await self._asr_service.status_snapshot()),
            "tts": {
                "default_provider": self._tts_service.default_provider,
                "default_voice": self._tts_service.default_voice_for(),
                "default_voices": {
                    provider_name: self._tts_service.default_voice_for(provider_name)
                    for provider_name in self._tts_service.provider_names()
                },
                "providers": self._tts_service.providers_status(),
            },
        }

    async def build_stage_config(self) -> dict[str, Any]:
        return await self._stage_background_service.build_config()

    async def save_runtime_settings(
        self,
        *,
        delegated_ack_enabled: bool,
    ) -> dict[str, Any]:
        return await self._runtime_settings_service.save_settings(
            delegated_ack_enabled=delegated_ack_enabled,
        )

    def resolve_live2d_asset(self, asset_path: str) -> Path:
        return self._live2d_service.resolve_asset(asset_path)

    async def save_live2d_directory(
        self,
        *,
        uploaded_files: list[Live2DUploadFile],
    ) -> dict[str, Any]:
        return await self._live2d_service.save_directory(uploaded_files)

    def resolve_stage_background_asset(self, asset_path: str) -> Path:
        return self._stage_background_service.resolve_asset(asset_path)

    async def save_stage_background(
        self,
        *,
        filename: str,
        content_type: str | None,
        file_bytes: bytes,
    ) -> dict[str, Any]:
        return await self._stage_background_service.save_background(
            filename=filename,
            content_type=content_type,
            file_bytes=file_bytes,
        )


__all__ = [
    "Live2DUploadFile",
    "WebConsoleService",
]
