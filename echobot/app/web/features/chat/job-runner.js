import { DOM } from "../../core/dom.js";
import { audioState, chatState, roleState, sessionState } from "../../core/store.js";
import {
    buildUserMessageContent,
    hasMessageContent,
    messageContentToText,
} from "../../modules/content.js";

export function createChatRunner(deps) {
    const {
        addMessage,
        applySessionSummaries,
        cancelChatJob,
        clearComposerAttachments,
        createSpeechSession,
        drainVoicePromptQueue,
        ensureAudioContextReady,
        finalizeSpeechSession,
        normalizeSessionName,
        queueSpeechSessionText,
        removeMessage,
        requestChatJob,
        requestChatJobTrace,
        requestChatStream,
        requestSessionSummaries,
        resetTracePanel,
        setActiveBackgroundJob,
        setChatBusy,
        setRunStatus,
        speakText,
        startTracePanel,
        stopSpeechPlayback,
        syncCurrentSessionFromServer,
        applyTracePayload,
        updateMessage,
    } = deps;

    async function handleChatSubmit(event) {
        event.preventDefault();
        if (chatState.chatBusy) {
            return;
        }

        const prompt = String(DOM.promptInput?.value || "").trim();
        const composerImages = [...(chatState.composerImages || [])];
        const composerFiles = [...(chatState.composerFiles || [])];
        if (!prompt && composerImages.length === 0 && composerFiles.length === 0) {
            return;
        }

        await ensureAudioContextReady();

        const sessionName = normalizeSessionName(
            sessionState.currentSessionName || "",
        );
        sessionState.currentSessionName = sessionName;
        DOM.sessionLabel.textContent = `会话: ${sessionName}`;
        window.localStorage.setItem("echobot.web.session", sessionName);

        stopSpeechPlayback();
        setActiveBackgroundJob("");
        resetTracePanel();
        setChatBusy(true);
        const speechSession = audioState.ttsEnabled ? createSpeechSession() : null;
        setRunStatus("正在请求回复...");

        addMessage(
            "user",
            buildUserMessageContent(
                prompt,
                composerImages.map((image) => ({
                    attachment_id: image.attachmentId,
                    url: image.url,
                    preview_url: image.previewUrl,
                })),
                composerFiles.map((file) => ({
                    attachment_id: file.attachmentId,
                    download_url: file.downloadUrl,
                    name: file.name,
                    content_type: file.contentType,
                    size_bytes: file.sizeBytes,
                    workspace_path: file.workspacePath,
                })),
            ),
            "你",
            { renderMode: "plain" },
        );
        let assistantMessageId = addMessage(
            "assistant",
            "...",
            "Echo",
            { renderMode: "plain" },
        );
        let streamedText = "";

        try {
            const response = await requestChatStream(
                {
                    prompt,
                    session_name: sessionName,
                    role_name: roleState.currentRoleName || "default",
                    route_mode: sessionState.currentRouteMode || "auto",
                    images: composerImages.map((image) => ({
                        attachment_id: image.attachmentId,
                    })),
                    files: composerFiles.map((file) => ({
                        attachment_id: file.attachmentId,
                    })),
                },
                {
                    onChunk(delta) {
                        streamedText += delta;
                        updateMessage(
                            assistantMessageId,
                            streamedText || "...",
                            "Echo",
                            { renderMode: "plain" },
                        );
                        queueSpeechSessionText(speechSession, delta);
                    },
                },
            );
            DOM.promptInput.value = "";
            clearComposerAttachments();

            if (response.session_name) {
                sessionState.currentSessionName = normalizeSessionName(response.session_name);
                DOM.sessionLabel.textContent = `会话: ${sessionState.currentSessionName}`;
                window.localStorage.setItem("echobot.web.session", sessionState.currentSessionName);
            }
            roleState.currentRoleName = response.role_name || roleState.currentRoleName;

            const immediateContent = response.response_content ?? response.response ?? streamedText ?? "";
            const immediateText = messageContentToText(
                immediateContent,
                { includeImageMarker: false },
            ).trim();
            const hideImmediateReply = Boolean(
                response.job_id
                && response.status === "running"
                && !hasMessageContent(immediateContent),
            );
            let finalContent = immediateContent;
            let finalText = immediateText || "处理中...";
            let speakFinalText = true;
            const startupSpeech = hideImmediateReply
                ? Promise.resolve()
                : finalizeSpeechSession(speechSession, finalText);
            if (hideImmediateReply) {
                removeMessage(assistantMessageId);
                assistantMessageId = "";
                finalText = "";
            } else {
                updateMessage(
                    assistantMessageId,
                    finalContent,
                    response.completed ? "Echo" : "处理中",
                );
            }

            if (response.job_id && response.status === "running") {
                setActiveBackgroundJob(response.job_id);
                setRunStatus("Agent 正在后台处理...");
                startTracePanel(response.job_id);

                const finalJob = await pollChatJob(response.job_id);
                finalContent = finalJob.response_content ?? finalJob.response ?? finalContent;
                finalText = messageContentToText(
                    finalContent,
                    { includeImageMarker: false },
                ).trim() || "任务已结束，但没有返回内容。";
                if (assistantMessageId) {
                    updateMessage(assistantMessageId, finalContent, "Echo");
                } else {
                    assistantMessageId = addMessage("assistant", finalContent, "Echo");
                }

                await startupSpeech;
                if (finalText === immediateText || finalJob.status === "cancelled") {
                    speakFinalText = false;
                }

                if (finalJob.status === "cancelled") {
                    setRunStatus("后台任务已停止");
                } else if (finalJob.status === "failed") {
                    setRunStatus("后台任务失败");
                } else {
                    setRunStatus("回复已完成");
                }
            } else {
                speakFinalText = false;
                setRunStatus("回复已完成");
            }

            if (audioState.ttsEnabled && speakFinalText && finalText.trim()) {
                await speakText(finalText);
            }

            try {
                applySessionSummaries(await requestSessionSummaries());
            } catch (sessionError) {
                console.error("Failed to refresh session list after chat", sessionError);
            }
            await syncCurrentSessionFromServer({
                force: true,
                announceNewMessages: false,
            });
        } catch (error) {
            console.error(error);
            stopSpeechPlayback();
            if (assistantMessageId && !streamedText.trim()) {
                removeMessage(assistantMessageId);
            }
            addMessage("system", `请求失败：${error.message || error}`, "状态");
            setRunStatus(error.message || "请求失败");
        } finally {
            setActiveBackgroundJob("");
            setChatBusy(false);
            void drainVoicePromptQueue();
        }
    }

    async function pollChatJob(jobId) {
        const maxAttempts = 240;

        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            const [payload, tracePayload] = await Promise.all([
                requestChatJob(jobId),
                loadChatJobTrace(jobId),
            ]);
            if (tracePayload) {
                applyTracePayload(jobId, tracePayload);
            }
            if (payload.status !== "running") {
                return payload;
            }
            await new Promise((resolve) => {
                window.setTimeout(resolve, 1000);
            });
        }

        throw new Error("Agent 后台任务等待超时");
    }

    async function loadChatJobTrace(jobId) {
        try {
            return await requestChatJobTrace(jobId);
        } catch (error) {
            console.warn("Failed to load agent trace", error);
            return null;
        }
    }

    async function handleStopBackgroundJob() {
        const jobId = chatState.activeChatJobId;
        if (!jobId) {
            return;
        }

        if (DOM.stopAgentButton) {
            DOM.stopAgentButton.disabled = true;
        }
        setRunStatus("正在停止后台任务...");

        try {
            const payload = await cancelChatJob(jobId);
            if (payload.status === "cancelled") {
                setRunStatus("后台任务已停止");
                return;
            }
            if (payload.status === "completed") {
                setRunStatus("后台任务已完成");
                return;
            }
            if (payload.status === "failed") {
                setRunStatus("后台任务已失败");
                return;
            }

            if (DOM.stopAgentButton) {
                DOM.stopAgentButton.disabled = false;
            }
        } catch (error) {
            console.error(error);
            if (DOM.stopAgentButton) {
                DOM.stopAgentButton.disabled = false;
            }
            addMessage("system", `停止后台任务失败：${error.message || error}`, "状态");
            setRunStatus(error.message || "停止后台任务失败");
        }
    }

    return {
        handleChatSubmit,
        handleStopBackgroundJob,
    };
}
