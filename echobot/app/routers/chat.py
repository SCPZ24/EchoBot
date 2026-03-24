from __future__ import annotations

import asyncio
import json
from contextlib import suppress

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from ...turn_inputs import (
    has_file_processing_capability,
    resolve_attachment_files,
    resolve_attachment_images,
    resolve_file_attachment_route_mode,
)
from ..schemas import ChatJobResponse, ChatJobTraceResponse, ChatRequest, ChatResponse
from ..state import get_app_runtime


router = APIRouter(tags=["chat"])


@router.post("/chat", response_model=ChatResponse)
async def run_chat(
    request: ChatRequest,
    runtime=Depends(get_app_runtime),
) -> ChatResponse:
    try:
        image_urls = await _resolve_chat_images(
            request,
            runtime.context.attachment_store,
            supports_image_input=runtime.context.supports_image_input,
        )
        file_attachments = await _resolve_chat_files(
            request,
            runtime.context.attachment_store,
            runtime.context.workspace,
        )
        result = await runtime.chat_service.run_prompt(
            request.session_name,
            request.prompt,
            image_urls=image_urls,
            file_attachments=file_attachments,
            role_name=request.role_name,
            route_mode=await _resolve_effective_route_mode(
                request,
                runtime,
                has_file_attachments=bool(file_attachments),
            ),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return ChatResponse(
        session_name=result.session.name,
        response=result.response_text,
        response_content=result.response_content,
        updated_at=result.session.updated_at,
        steps=result.steps,
        compressed_summary=result.compressed_summary,
        delegated=result.delegated,
        completed=result.completed,
        job_id=result.job_id,
        status=result.status,
        role_name=result.role_name,
    )


@router.post("/chat/stream")
async def run_chat_stream(
    request: ChatRequest,
    runtime=Depends(get_app_runtime),
) -> StreamingResponse:
    queue: asyncio.Queue[bytes | None] = asyncio.Queue()

    async def on_chunk(chunk: str) -> None:
        await queue.put(
            _stream_payload_bytes(
                {
                    "type": "chunk",
                    "delta": chunk,
                }
            )
        )

    async def produce() -> None:
        try:
            image_urls = await _resolve_chat_images(
                request,
                runtime.context.attachment_store,
                supports_image_input=runtime.context.supports_image_input,
            )
            file_attachments = await _resolve_chat_files(
                request,
                runtime.context.attachment_store,
                runtime.context.workspace,
            )
            result = await runtime.chat_service.run_prompt_stream(
                request.session_name,
                request.prompt,
                image_urls=image_urls,
                file_attachments=file_attachments,
                role_name=request.role_name,
                route_mode=await _resolve_effective_route_mode(
                    request,
                    runtime,
                    has_file_attachments=bool(file_attachments),
                ),
                on_chunk=on_chunk,
            )
        except ValueError as exc:
            await queue.put(
                _stream_payload_bytes(
                    {
                        "type": "error",
                        "message": str(exc),
                    }
                )
            )
        except RuntimeError as exc:
            await queue.put(
                _stream_payload_bytes(
                    {
                        "type": "error",
                        "message": str(exc),
                    }
                )
            )
        else:
            await queue.put(
                _stream_payload_bytes(
                    {
                        "type": "done",
                        "session_name": result.session.name,
                        "response": result.response_text,
                        "response_content": result.response_content,
                        "updated_at": result.session.updated_at,
                        "steps": result.steps,
                        "compressed_summary": result.compressed_summary,
                        "delegated": result.delegated,
                        "completed": result.completed,
                        "job_id": result.job_id,
                        "status": result.status,
                        "role_name": result.role_name,
                    }
                )
            )
        finally:
            await queue.put(None)

    producer_task = asyncio.create_task(produce())

    async def body():
        try:
            while True:
                payload = await queue.get()
                if payload is None:
                    break
                yield payload
        finally:
            if not producer_task.done():
                producer_task.cancel()
            with suppress(asyncio.CancelledError):
                await producer_task

    return StreamingResponse(
        body(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache"},
    )


@router.get("/chat/jobs/{job_id}", response_model=ChatJobResponse)
async def get_chat_job(
    job_id: str,
    runtime=Depends(get_app_runtime),
) -> ChatJobResponse:
    job = await runtime.chat_service.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")

    response_text = job.final_response or job.immediate_response
    return ChatJobResponse(
        job_id=job.job_id,
        session_name=job.session_name,
        status=job.status,
        response=response_text,
        response_content=job.final_response_content or response_text,
        error=job.error,
        steps=job.steps,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


@router.get("/chat/jobs/{job_id}/trace", response_model=ChatJobTraceResponse)
async def get_chat_job_trace(
    job_id: str,
    runtime=Depends(get_app_runtime),
) -> ChatJobTraceResponse:
    job, events = await runtime.chat_service.get_job_trace(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")

    return ChatJobTraceResponse(
        job_id=job.job_id,
        session_name=job.session_name,
        status=job.status,
        updated_at=job.updated_at,
        events=events,
    )


@router.post("/chat/jobs/{job_id}/cancel", response_model=ChatJobResponse)
async def cancel_chat_job(
    job_id: str,
    runtime=Depends(get_app_runtime),
) -> ChatJobResponse:
    job = await runtime.chat_service.cancel_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")

    response_text = job.final_response or job.immediate_response
    return ChatJobResponse(
        job_id=job.job_id,
        session_name=job.session_name,
        status=job.status,
        response=response_text,
        response_content=job.final_response_content or response_text,
        error=job.error,
        steps=job.steps,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


def _stream_payload_bytes(payload: dict[str, object]) -> bytes:
    return (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")


async def _resolve_chat_images(
    request: ChatRequest,
    attachment_store,
    *,
    supports_image_input: bool,
) -> list[dict[str, str]]:
    if not supports_image_input or not request.images:
        return []
    return await asyncio.to_thread(
        resolve_attachment_images,
        attachment_store,
        request.images,
    )


async def _resolve_chat_files(
    request: ChatRequest,
    attachment_store,
    workspace,
) -> list[dict[str, object]]:
    if not request.files:
        return []
    return await asyncio.to_thread(
        resolve_attachment_files,
        attachment_store,
        workspace,
        request.files,
    )


async def _resolve_effective_route_mode(
    request: ChatRequest,
    runtime,
    *,
    has_file_attachments: bool,
):
    can_process_files = False
    current_route_mode = None
    if has_file_attachments:
        can_process_files = has_file_processing_capability(
            runtime.context.skill_registry,
            getattr(runtime.context, "tool_registry_factory", None),
            request.session_name,
        )
    if request.route_mode is None and can_process_files:
        current_route_mode = await runtime.chat_service.current_route_mode(
            request.session_name,
        )

    return resolve_file_attachment_route_mode(
        requested_route_mode=request.route_mode,
        current_route_mode=current_route_mode,
        has_file_attachments=has_file_attachments,
        can_process_files=can_process_files,
    )
