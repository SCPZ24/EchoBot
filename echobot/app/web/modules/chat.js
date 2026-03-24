import {
    buildUserMessageContent,
    hasMessageContent,
    messageContentToText,
} from "./content.js";
import { DEFAULT_SESSION_NAME, DOM, UI_STATE } from "./state.js";

const MAX_COMPOSER_IMAGES = 20;
const MAX_COMPOSER_FILES = 20;

export function createChatModule(deps) {
    const {
        addMessage,
        applySessionSummaries,
        cancelChatJob,
        createSpeechSession,
        drainVoicePromptQueue,
        deleteAttachment,
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
        uploadChatFile,
        uploadChatImage,
        applyTracePayload,
        updateMessage,
    } = deps;

    async function handleChatSubmit(event) {
        event.preventDefault();
        if (UI_STATE.chatBusy) {
            return;
        }

        const prompt = String(DOM.promptInput?.value || "").trim();
        const composerImages = [...(UI_STATE.composerImages || [])];
        const composerFiles = [...(UI_STATE.composerFiles || [])];
        if (!prompt && composerImages.length === 0 && composerFiles.length === 0) {
            return;
        }

        await ensureAudioContextReady();

        const sessionName = normalizeSessionName(
            UI_STATE.currentSessionName || DEFAULT_SESSION_NAME,
        );
        UI_STATE.currentSessionName = sessionName;
        DOM.sessionLabel.textContent = `会话: ${sessionName}`;
        window.localStorage.setItem("echobot.web.session", sessionName);

        stopSpeechPlayback();
        setActiveBackgroundJob("");
        resetTracePanel();
        setChatBusy(true);
        const speechSession = UI_STATE.ttsEnabled ? createSpeechSession() : null;
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
                    prompt: prompt,
                    session_name: sessionName,
                    role_name: UI_STATE.currentRoleName || "default",
                    route_mode: UI_STATE.currentRouteMode || "auto",
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
                UI_STATE.currentSessionName = normalizeSessionName(response.session_name);
                DOM.sessionLabel.textContent = `会话: ${UI_STATE.currentSessionName}`;
                window.localStorage.setItem("echobot.web.session", UI_STATE.currentSessionName);
            }
            UI_STATE.currentRoleName = response.role_name || UI_STATE.currentRoleName;

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

            if (UI_STATE.ttsEnabled && speakFinalText && finalText.trim()) {
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
        const jobId = UI_STATE.activeChatJobId;
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

    function handleComposerFileButtonClick() {
        if (
            !DOM.composerFileInput
            || UI_STATE.chatBusy
            || UI_STATE.activeChatJobId
        ) {
            return;
        }
        DOM.composerFileInput.click();
    }

    async function handleComposerFileInputChange() {
        if (!DOM.composerFileInput) {
            return;
        }

        const selectedFiles = Array.from(DOM.composerFileInput.files || []);
        DOM.composerFileInput.value = "";
        if (!selectedFiles.length) {
            return;
        }

        const existingFiles = UI_STATE.composerFiles || [];
        const availableSlots = Math.max(
            MAX_COMPOSER_FILES - existingFiles.length,
            0,
        );
        if (availableSlots <= 0) {
            setRunStatus(`最多只能附加 ${MAX_COMPOSER_FILES} 个文件`);
            return;
        }

        const filesToUpload = selectedFiles.slice(0, availableSlots);
        if (filesToUpload.length < selectedFiles.length) {
            setRunStatus(`最多只能附加 ${MAX_COMPOSER_FILES} 个文件`);
        }

        try {
            const nextFiles = await readComposerFiles(
                filesToUpload,
                uploadChatFile,
                deleteAttachment,
            );
            appendComposerFiles(nextFiles, setRunStatus);
        } catch (error) {
            console.error("Failed to load composer files", error);
            setRunStatus(error.message || "文件上传失败");
        }
    }

    async function handleComposerFilesClick(event) {
        const removeButton = event.target.closest("[data-composer-file-id]");
        if (!removeButton) {
            return;
        }

        const fileId = String(removeButton.dataset.composerFileId || "").trim();
        if (!fileId) {
            return;
        }

        const existingFiles = UI_STATE.composerFiles || [];
        const removedFile = existingFiles.find((file) => file.id === fileId) || null;
        UI_STATE.composerFiles = existingFiles.filter(
            (file) => file.id !== fileId,
        );
        renderComposerFiles();
        if (removedFile && removedFile.attachmentId) {
            try {
                await deleteAttachment(removedFile.attachmentId);
            } catch (error) {
                console.error("Failed to delete removed composer file", error);
                setRunStatus(error.message || "文件清理失败");
            }
        }
    }

    function handleComposerImageButtonClick() {
        if (
            !DOM.composerImageInput
            || UI_STATE.chatBusy
            || UI_STATE.activeChatJobId
        ) {
            return;
        }
        DOM.composerImageInput.click();
    }

    async function handleComposerImageInputChange() {
        if (!DOM.composerImageInput) {
            return;
        }

        const selectedFiles = Array.from(DOM.composerImageInput.files || []);
        DOM.composerImageInput.value = "";
        if (!selectedFiles.length) {
            return;
        }

        try {
            const existingImages = UI_STATE.composerImages || [];
            const availableSlots = Math.max(
                MAX_COMPOSER_IMAGES - existingImages.length,
                0,
            );
            if (availableSlots <= 0) {
                setRunStatus(`最多只能附加 ${MAX_COMPOSER_IMAGES} 张图片`);
                return;
            }

            const imagesToUpload = selectedFiles.slice(0, availableSlots);
            if (imagesToUpload.length < selectedFiles.length) {
                setRunStatus(`最多只能附加 ${MAX_COMPOSER_IMAGES} 张图片`);
            }

            const nextImages = await readComposerImages(
                imagesToUpload,
                uploadChatImage,
                deleteAttachment,
            );
            if (!nextImages.length) {
                return;
            }

            UI_STATE.composerImages = [...existingImages, ...nextImages];
            renderComposerImages();
        } catch (error) {
            console.error("Failed to load composer images", error);
            setRunStatus(error.message || "图片加载失败");
        }
    }

    async function handleComposerImagesClick(event) {
        const removeButton = event.target.closest("[data-composer-image-id]");
        if (!removeButton) {
            return;
        }

        const imageId = String(removeButton.dataset.composerImageId || "").trim();
        if (!imageId) {
            return;
        }

        const existingImages = UI_STATE.composerImages || [];
        const removedImage = existingImages.find((image) => image.id === imageId) || null;
        UI_STATE.composerImages = existingImages.filter(
            (image) => image.id !== imageId,
        );
        renderComposerImages();
        if (removedImage && removedImage.attachmentId) {
            try {
                await deleteAttachment(removedImage.attachmentId);
            } catch (error) {
                console.error("Failed to delete removed composer image", error);
                setRunStatus(error.message || "图片清理失败");
            }
        }
    }

    function refreshComposerAttachments() {
        renderComposerFiles();
        renderComposerImages();
    }

    return {
        handleChatSubmit: handleChatSubmit,
        handleStopBackgroundJob: handleStopBackgroundJob,
        handleComposerFileButtonClick: handleComposerFileButtonClick,
        handleComposerFileInputChange: handleComposerFileInputChange,
        handleComposerFilesClick: handleComposerFilesClick,
        handleComposerImageButtonClick: handleComposerImageButtonClick,
        handleComposerImageInputChange: handleComposerImageInputChange,
        handleComposerImagesClick: handleComposerImagesClick,
        refreshComposerAttachments: refreshComposerAttachments,
    };
}

function clearComposerAttachments() {
    UI_STATE.composerImages = [];
    UI_STATE.composerFiles = [];
    renderComposerFiles();
    renderComposerImages();
}

async function readComposerImages(files, uploadImage, deleteAttachment) {
    const imageFiles = files.filter((file) => String(file.type || "").startsWith("image/"));
    const nextImages = [];
    try {
        for (let index = 0; index < imageFiles.length; index += 1) {
            const file = imageFiles[index];
            const uploaded = await uploadImage(file);
            nextImages.push({
                id: `img-${Date.now()}-${index}-${Math.random().toString(16).slice(2, 8)}`,
                name: uploaded.original_filename || file.name || "image",
                attachmentId: String(uploaded.attachment_id || "").trim(),
                url: String(uploaded.url || "").trim(),
                previewUrl: String(uploaded.preview_url || "").trim(),
            });
        }
    } catch (error) {
        await cleanupUploadedComposerEntries(nextImages, deleteAttachment);
        throw error;
    }
    return nextImages.filter(
        (image) => String(image.attachmentId || "").trim() && String(image.url || "").trim(),
    );
}

function appendComposerFiles(nextFiles, setRunStatus) {
    if (!nextFiles.length) {
        return;
    }

    const existingFiles = UI_STATE.composerFiles || [];
    const availableSlots = Math.max(
        MAX_COMPOSER_FILES - existingFiles.length,
        0,
    );
    if (availableSlots <= 0) {
        setRunStatus(`最多只能附加 ${MAX_COMPOSER_FILES} 个文件`);
        return;
    }

    const acceptedFiles = nextFiles.slice(0, availableSlots);
    if (acceptedFiles.length < nextFiles.length) {
        setRunStatus(`最多只能附加 ${MAX_COMPOSER_FILES} 个文件`);
    }
    UI_STATE.composerFiles = [...existingFiles, ...acceptedFiles];
    renderComposerFiles();
}

async function readComposerFiles(files, uploadFile, deleteAttachment) {
    const nextFiles = [];
    try {
        for (let index = 0; index < files.length; index += 1) {
            const file = files[index];
            const uploaded = await uploadFile(file);
            nextFiles.push({
                id: `file-${Date.now()}-${index}-${Math.random().toString(16).slice(2, 8)}`,
                name: uploaded.original_filename || file.name || "file",
                attachmentId: String(uploaded.attachment_id || "").trim(),
                downloadUrl: String(uploaded.download_url || "").trim(),
                contentType: String(uploaded.content_type || "").trim(),
                sizeBytes: Number(uploaded.size_bytes || file.size || 0),
                workspacePath: String(uploaded.workspace_path || "").trim(),
            });
        }
    } catch (error) {
        await cleanupUploadedComposerEntries(nextFiles, deleteAttachment);
        throw error;
    }
    return nextFiles.filter(
        (file) => String(file.attachmentId || "").trim() && String(file.workspacePath || "").trim(),
    );
}

async function cleanupUploadedComposerEntries(entries, deleteAttachment) {
    if (!Array.isArray(entries) || entries.length === 0) {
        return;
    }

    await Promise.allSettled(
        entries
            .map((entry) => String(entry?.attachmentId || "").trim())
            .filter(Boolean)
            .map((attachmentId) => deleteAttachment(attachmentId)),
    );
}

function renderComposerFiles() {
    if (!DOM.composerFiles) {
        return;
    }

    const composerFiles = Array.isArray(UI_STATE.composerFiles)
        ? UI_STATE.composerFiles
        : [];
    DOM.composerFiles.innerHTML = "";
    DOM.composerFiles.hidden = composerFiles.length === 0;

    composerFiles.forEach((file) => {
        const card = document.createElement("div");
        card.className = "composer-file-chip";

        const body = document.createElement("div");
        body.className = "composer-file-body";

        const name = document.createElement("div");
        name.className = "composer-file-name";
        name.textContent = file.name || "file";
        body.appendChild(name);

        const meta = document.createElement("div");
        meta.className = "composer-file-meta";
        meta.textContent = describeComposerFile(file);
        if (meta.textContent) {
            body.appendChild(meta);
        }

        card.appendChild(body);

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "composer-file-remove";
        removeButton.dataset.composerFileId = file.id;
        removeButton.textContent = "移除";
        removeButton.title = "移除文件";
        removeButton.disabled = UI_STATE.chatBusy || Boolean(UI_STATE.activeChatJobId);
        card.appendChild(removeButton);

        DOM.composerFiles.appendChild(card);
    });
}

function buildComposerFileMetaText(file) {
    const parts = [];
    const contentType = String(file.contentType || "").trim();
    const workspacePath = String(file.workspacePath || "").trim();
    if (contentType) {
        parts.push(contentType);
    }
    if (workspacePath) {
        parts.push(workspacePath);
    }
    return parts.join(" · ");
}

function describeComposerFile(file) {
    const sizeText = formatComposerFileSize(file.sizeBytes);
    if (sizeText) {
        return `\u5f85\u53d1\u9001 · ${sizeText}`;
    }
    return "\u5f85\u53d1\u9001";
}

function formatComposerFileSize(sizeBytes) {
    const size = Number(sizeBytes || 0);
    if (!Number.isFinite(size) || size <= 0) {
        return "";
    }
    if (size < 1024) {
        return `${size} B`;
    }
    if (size < 1024 * 1024) {
        return `${(size / 1024).toFixed(1).replace(/\\.0$/, "")} KB`;
    }
    return `${(size / (1024 * 1024)).toFixed(1).replace(/\\.0$/, "")} MB`;
}

function renderComposerImages() {
    if (!DOM.composerImages) {
        return;
    }

    const composerImages = Array.isArray(UI_STATE.composerImages)
        ? UI_STATE.composerImages
        : [];
    DOM.composerImages.innerHTML = "";
    DOM.composerImages.hidden = composerImages.length === 0;

    composerImages.forEach((image) => {
        const card = document.createElement("div");
        card.className = "composer-image-chip";

        const preview = document.createElement("img");
        preview.className = "composer-image-thumb";
        preview.src = image.previewUrl || image.url;
        preview.alt = image.name || "Selected image";
        preview.loading = "lazy";
        card.appendChild(preview);

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "composer-image-remove";
        removeButton.dataset.composerImageId = image.id;
        removeButton.textContent = "×";
        removeButton.title = "移除图片";
        removeButton.disabled = UI_STATE.chatBusy || Boolean(UI_STATE.activeChatJobId);
        card.appendChild(removeButton);

        DOM.composerImages.appendChild(card);
    });
}
