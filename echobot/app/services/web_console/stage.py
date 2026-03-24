from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any
from urllib.parse import quote


STAGE_BACKGROUND_SOURCE_WORKSPACE = "workspace"
STAGE_BACKGROUND_SOURCE_BUILTIN = "builtin"
DEFAULT_STAGE_BACKGROUND_KEY = "default"
DEFAULT_STAGE_BACKGROUND_KIND = "none"
BUILTIN_STAGE_BACKGROUND_KIND = "builtin"
UPLOADED_STAGE_BACKGROUND_KIND = "uploaded"
ALLOWED_STAGE_BACKGROUND_SUFFIXES = {
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".avif",
}
MAX_STAGE_BACKGROUND_BYTES = 10 * 1024 * 1024


class StageBackgroundService:
    def __init__(self, workspace_root: Path, builtin_root: Path) -> None:
        self._workspace_root = workspace_root
        self._builtin_root = builtin_root

    async def build_config(self) -> dict[str, Any]:
        return await asyncio.to_thread(self._build_config_sync)

    def resolve_asset(self, asset_path: str) -> Path:
        source, relative_path = self._parse_asset_path(asset_path)
        if not relative_path.parts:
            raise ValueError("Stage background path must not be empty")

        base_dir = self._root_for(source).resolve()
        candidate = (base_dir / relative_path).resolve()
        if candidate != base_dir and base_dir not in candidate.parents:
            raise ValueError(f"Invalid stage background path: {asset_path}")
        if not candidate.is_file():
            raise FileNotFoundError(asset_path)
        return candidate

    async def save_background(
        self,
        *,
        filename: str,
        content_type: str | None,
        file_bytes: bytes,
    ) -> dict[str, Any]:
        cleaned_name = self._clean_filename(filename)
        if not cleaned_name:
            raise ValueError("Background file name must not be empty")
        if not file_bytes:
            raise ValueError("Background file must not be empty")
        if len(file_bytes) > MAX_STAGE_BACKGROUND_BYTES:
            raise ValueError("Background file is too large. Keep it under 10 MB.")
        if content_type and not content_type.startswith("image/"):
            raise ValueError("Background file must be an image")

        target_path = await asyncio.to_thread(
            self._prepare_background_path,
            cleaned_name,
        )
        await asyncio.to_thread(target_path.write_bytes, file_bytes)
        return await asyncio.to_thread(self._build_config_sync)

    def _build_config_sync(self) -> dict[str, Any]:
        backgrounds = [self._default_option()]
        backgrounds.extend(
            self._option_for(path, source=STAGE_BACKGROUND_SOURCE_BUILTIN)
            for path in self._background_files(self._builtin_root)
        )
        backgrounds.extend(
            self._option_for(path, source=STAGE_BACKGROUND_SOURCE_WORKSPACE)
            for path in self._background_files(self._workspace_root)
        )
        return {
            "default_background_key": DEFAULT_STAGE_BACKGROUND_KEY,
            "backgrounds": backgrounds,
        }

    def _option_for(self, path: Path, *, source: str) -> dict[str, Any]:
        if source == STAGE_BACKGROUND_SOURCE_BUILTIN:
            key = f"{STAGE_BACKGROUND_SOURCE_BUILTIN}:{path.name}"
            url = (
                f"/api/web/stage/backgrounds/"
                f"{STAGE_BACKGROUND_SOURCE_BUILTIN}/{quote(path.name)}"
            )
            kind = BUILTIN_STAGE_BACKGROUND_KIND
        else:
            key = path.name
            url = f"/api/web/stage/backgrounds/{quote(path.name)}"
            kind = UPLOADED_STAGE_BACKGROUND_KIND

        return {
            "key": key,
            "label": path.stem,
            "url": url,
            "kind": kind,
        }

    @staticmethod
    def _default_option() -> dict[str, Any]:
        return {
            "key": DEFAULT_STAGE_BACKGROUND_KEY,
            "label": "不使用背景",
            "url": "",
            "kind": DEFAULT_STAGE_BACKGROUND_KIND,
        }

    @staticmethod
    def _background_files(root: Path) -> list[Path]:
        if not root.exists():
            return []

        return sorted(
            (
                path
                for path in root.iterdir()
                if path.is_file() and path.suffix.lower() in ALLOWED_STAGE_BACKGROUND_SUFFIXES
            ),
            key=lambda path: path.name.casefold(),
        )

    def _root_for(self, source: str) -> Path:
        if source == STAGE_BACKGROUND_SOURCE_BUILTIN:
            return self._builtin_root
        return self._workspace_root

    @staticmethod
    def _parse_asset_path(asset_path: str) -> tuple[str, Path]:
        relative_path = Path(asset_path)
        if not relative_path.parts:
            raise ValueError("Stage background path must not be empty")

        source = relative_path.parts[0]
        if source in {STAGE_BACKGROUND_SOURCE_WORKSPACE, STAGE_BACKGROUND_SOURCE_BUILTIN}:
            resolved_path = Path(*relative_path.parts[1:])
            if not resolved_path.parts:
                raise ValueError(f"Invalid stage background path: {asset_path}")
            return source, resolved_path

        return STAGE_BACKGROUND_SOURCE_WORKSPACE, relative_path

    def _prepare_background_path(self, filename: str) -> Path:
        self._workspace_root.mkdir(parents=True, exist_ok=True)

        original_path = Path(filename)
        stem = original_path.stem
        suffix = original_path.suffix.lower()
        candidate = self._workspace_root / f"{stem}{suffix}"
        index = 2
        while candidate.exists():
            candidate = self._workspace_root / f"{stem}-{index}{suffix}"
            index += 1
        return candidate

    @staticmethod
    def _clean_filename(filename: str) -> str:
        raw_name = Path(str(filename or "")).name.strip()
        if not raw_name:
            return ""

        suffix = Path(raw_name).suffix.lower()
        if suffix not in ALLOWED_STAGE_BACKGROUND_SUFFIXES:
            raise ValueError("Only png, jpg, jpeg, webp, gif, and avif backgrounds are supported")

        stem = Path(raw_name).stem.strip()
        stem = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", stem)
        stem = re.sub(r"\s+", "_", stem)
        stem = re.sub(r"_+", "_", stem).strip(" ._")
        if not stem:
            stem = "background"
        return f"{stem}{suffix}"

