import { DOM } from "../core/dom.js";
import {
    ASR_STATUS_POLL_INTERVAL_MS,
    asrState,
    audioState,
    chatState,
} from "../core/store.js";

export function createAsrModule(deps) {
    const {
        addSystemMessage,
        clamp,
        delay,
        ensureAudioContextReady,
        requestJson,
        responseToError,
        setRunStatus,
    } = deps;

    function normalizeAsrConfig(asrConfig) {
        return {
            available: Boolean(asrConfig && asrConfig.available),
            state: String((asrConfig && asrConfig.state) || "missing"),
            detail: String((asrConfig && asrConfig.detail) || ""),
            auto_download: Boolean(asrConfig && asrConfig.auto_download),
            model_directory: String((asrConfig && asrConfig.model_directory) || ""),
            sample_rate: Number((asrConfig && asrConfig.sample_rate) || 16000),
            provider: String((asrConfig && asrConfig.provider) || "cpu"),
            always_listen_supported: Boolean(
                asrConfig && Object.prototype.hasOwnProperty.call(asrConfig, "always_listen_supported")
                    ? asrConfig.always_listen_supported
                    : true,
            ),
        };
    }

    function applyAsrStatus(asrConfig) {
        asrState.asrConfig = normalizeAsrConfig(asrConfig);
        if (DOM.asrDetail) {
            DOM.asrDetail.textContent = buildAsrDetailText();
        }
        updateVoiceInputControls();
        if (asrState.asrConfig.available) {
            stopAsrStatusPolling();
        }
    }

    function buildAsrDetailText() {
        if (asrState.microphoneCaptureMode === "manual") {
            return "正在录音，再次点击麦克风结束。";
        }
        if (asrState.alwaysListenEnabled) {
            return asrState.alwaysListenPaused
                ? "常开麦已开启，回复期间暂停收音。"
                : "常开麦已开启，正在等待你说话。";
        }
        if (!asrState.asrConfig) {
            return "语音识别尚未初始化。";
        }
        return asrState.asrConfig.detail || "语音识别未就绪。";
    }

    function startAsrStatusPolling() {
        if (asrState.asrStatusPollTimerId || (asrState.asrConfig && asrState.asrConfig.available)) {
            return;
        }

        asrState.asrStatusPollTimerId = window.setInterval(() => {
            void refreshAsrStatus();
        }, ASR_STATUS_POLL_INTERVAL_MS);
    }

    function stopAsrStatusPolling() {
        if (!asrState.asrStatusPollTimerId) {
            return;
        }
        window.clearInterval(asrState.asrStatusPollTimerId);
        asrState.asrStatusPollTimerId = 0;
    }

    async function refreshAsrStatus() {
        try {
            applyAsrStatus(await requestJson("/api/web/asr/status"));
        } catch (error) {
            console.error("Failed to refresh ASR status", error);
            if (DOM.asrDetail && !asrState.asrConfig) {
                DOM.asrDetail.textContent = error.message || "语音识别状态获取失败";
            }
        }
    }

    function updateVoiceInputControls() {
        const asrReady = Boolean(asrState.asrConfig && asrState.asrConfig.available);
        const manualRecording = asrState.microphoneCaptureMode === "manual";
        const backgroundJobRunning = Boolean(chatState.activeChatJobId);

        if (DOM.recordButton) {
            DOM.recordButton.disabled = !manualRecording && (
                !asrReady
                || asrState.alwaysListenEnabled
                || chatState.chatBusy
                || audioState.speaking
            );
            DOM.recordButton.classList.toggle("is-recording", manualRecording);
            DOM.recordButton.setAttribute("aria-pressed", manualRecording ? "true" : "false");
            DOM.recordButton.setAttribute("title", manualRecording ? "结束录音" : "开始录音");
            DOM.recordButton.setAttribute("aria-label", manualRecording ? "结束录音" : "开始录音");
        }

        if (DOM.alwaysListenCheckbox) {
            DOM.alwaysListenCheckbox.checked = asrState.alwaysListenEnabled;
            DOM.alwaysListenCheckbox.disabled = !asrReady
                || manualRecording
                || (backgroundJobRunning && !asrState.alwaysListenEnabled);
        }

        if (DOM.asrDetail) {
            DOM.asrDetail.textContent = buildAsrDetailText();
        }
    }

    async function handleRecordButtonClick() {
        if (asrState.microphoneCaptureMode === "manual") {
            await stopManualRecording();
            return;
        }
        await startManualRecording();
    }

    async function startManualRecording() {
        if (!asrState.asrConfig || !asrState.asrConfig.available) {
            addSystemMessage("语音识别还没准备好。");
            return;
        }
        if (chatState.chatBusy || audioState.speaking) {
            addSystemMessage("当前正在回复，请稍后再录音。");
            return;
        }
        if (asrState.alwaysListenEnabled) {
            if (DOM.alwaysListenCheckbox) {
                DOM.alwaysListenCheckbox.checked = false;
            }
            await stopAlwaysListen();
        }

        await ensureMicrophoneCaptureReady();
        asrState.manualRecordingChunks = [];
        asrState.microphoneCaptureMode = "manual";
        updateVoiceInputControls();
        setRunStatus("正在录音…");
    }

    async function stopManualRecording() {
        if (asrState.microphoneCaptureMode !== "manual") {
            return;
        }

        asrState.microphoneCaptureMode = "idle";
        updateVoiceInputControls();
        const wavBlob = buildWavBlob(asrState.manualRecordingChunks, 16000);
        asrState.manualRecordingChunks = [];
        stopMicrophoneCapture();

        if (!wavBlob) {
            setRunStatus("未录到有效语音");
            addSystemMessage("未录到有效语音。");
            return;
        }

        try {
            await transcribeAndQueueWavBlob(wavBlob);
        } catch (error) {
            console.error(error);
            addSystemMessage(`语音识别失败：${error.message || error}`);
            setRunStatus(error.message || "语音识别失败");
        }
    }

    async function handleAlwaysListenToggle() {
        if (!DOM.alwaysListenCheckbox) {
            return;
        }

        if (DOM.alwaysListenCheckbox.checked) {
            try {
                await startAlwaysListen();
            } catch (error) {
                console.error(error);
                DOM.alwaysListenCheckbox.checked = false;
                asrState.alwaysListenEnabled = false;
                asrState.microphoneCaptureMode = "idle";
                updateVoiceInputControls();
                addSystemMessage(`常开麦启动失败：${error.message || error}`);
            }
            return;
        }

        await stopAlwaysListen();
    }

    async function startAlwaysListen() {
        if (!asrState.asrConfig || !asrState.asrConfig.available) {
            throw new Error("语音识别还没准备好。");
        }
        if (asrState.microphoneCaptureMode === "manual") {
            await stopManualRecording();
        }

        await ensureMicrophoneCaptureReady();
        await openAsrSocket();

        asrState.alwaysListenEnabled = true;
        asrState.alwaysListenPaused = chatState.chatBusy || audioState.speaking;
        asrState.microphoneCaptureMode = "always";
        updateVoiceInputControls();
        setRunStatus(
            asrState.alwaysListenPaused
                ? "常开麦已开启，回复期间暂停收音"
                : "常开麦已开启",
        );
    }

    async function stopAlwaysListen() {
        asrState.alwaysListenEnabled = false;
        asrState.alwaysListenPaused = false;
        asrState.microphoneCaptureMode = "idle";
        updateVoiceInputControls();

        await closeAsrSocket(true);
        stopMicrophoneCapture();
        setRunStatus("常开麦已关闭");
    }

    async function ensureMicrophoneCaptureReady() {
        if (asrState.microphoneStream && asrState.microphoneProcessorNode) {
            return;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("当前浏览器不支持麦克风采集。");
        }

        await ensureAudioContextReady();
        if (!audioState.audioContext) {
            throw new Error("当前浏览器不支持 Web Audio。");
        }
        if (!audioState.audioContext.audioWorklet || typeof AudioWorkletNode === "undefined") {
            throw new Error("当前浏览器不支持 AudioWorklet。");
        }

        if (!asrState.microphoneWorkletLoaded) {
            await audioState.audioContext.audioWorklet.addModule("/web/assets/pcm-recorder-worklet.js");
            asrState.microphoneWorkletLoaded = true;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
        });

        const sourceNode = audioState.audioContext.createMediaStreamSource(stream);
        const processorNode = new AudioWorkletNode(
            audioState.audioContext,
            "pcm-recorder-processor",
        );
        const muteNode = audioState.audioContext.createGain();
        muteNode.gain.value = 0;

        processorNode.port.onmessage = handleMicrophoneChunk;
        sourceNode.connect(processorNode);
        processorNode.connect(muteNode);
        muteNode.connect(audioState.audioContext.destination);

        asrState.microphoneStream = stream;
        asrState.microphoneSourceNode = sourceNode;
        asrState.microphoneProcessorNode = processorNode;
        asrState.microphoneMuteNode = muteNode;
        asrState.microphoneChunkResampler = new PcmChunkResampler(
            audioState.audioContext.sampleRate,
            16000,
        );
    }

    function stopMicrophoneCapture() {
        if (asrState.microphoneSourceNode) {
            try {
                asrState.microphoneSourceNode.disconnect();
            } catch (error) {
                console.warn("Microphone source disconnect ignored", error);
            }
        }
        if (asrState.microphoneProcessorNode) {
            try {
                asrState.microphoneProcessorNode.port.onmessage = null;
                asrState.microphoneProcessorNode.disconnect();
            } catch (error) {
                console.warn("Microphone processor disconnect ignored", error);
            }
        }
        if (asrState.microphoneMuteNode) {
            try {
                asrState.microphoneMuteNode.disconnect();
            } catch (error) {
                console.warn("Microphone mute disconnect ignored", error);
            }
        }
        if (asrState.microphoneStream) {
            asrState.microphoneStream.getTracks().forEach((track) => {
                track.stop();
            });
        }

        asrState.microphoneStream = null;
        asrState.microphoneSourceNode = null;
        asrState.microphoneProcessorNode = null;
        asrState.microphoneMuteNode = null;
        asrState.microphoneChunkResampler = null;
        if (asrState.microphoneCaptureMode !== "always") {
            asrState.microphoneCaptureMode = "idle";
        }
    }

    function handleMicrophoneChunk(event) {
        const rawChunk = event && event.data ? event.data : null;
        if (!(rawChunk instanceof Float32Array) || !asrState.microphoneChunkResampler) {
            return;
        }

        const pcmChunk = asrState.microphoneChunkResampler.push(rawChunk);
        if (!pcmChunk.length) {
            return;
        }

        if (asrState.microphoneCaptureMode === "manual") {
            asrState.manualRecordingChunks.push(pcmChunk);
            return;
        }

        if (!asrState.alwaysListenEnabled || asrState.microphoneCaptureMode !== "always") {
            return;
        }

        const shouldPause = chatState.chatBusy || audioState.speaking;
        if (shouldPause) {
            if (!asrState.alwaysListenPaused) {
                asrState.alwaysListenPaused = true;
                sendAsrSocketControl("reset");
                updateVoiceInputControls();
            }
            return;
        }

        if (asrState.alwaysListenPaused) {
            asrState.alwaysListenPaused = false;
            updateVoiceInputControls();
        }

        sendAsrSocketChunk(pcmChunk);
    }

    async function transcribeAndQueueWavBlob(wavBlob) {
        setRunStatus("正在识别语音…");
        const response = await fetch("/api/web/asr", {
            method: "POST",
            headers: {
                "Content-Type": "audio/wav",
            },
            body: wavBlob,
        });

        if (!response.ok) {
            throw await responseToError(response);
        }

        const payload = await response.json();
        const text = String((payload && payload.text) || "").trim();
        if (!text) {
            addSystemMessage("没有识别到清晰语音。");
            setRunStatus("没有识别到清晰语音");
            return;
        }

        enqueueVoicePrompt(text, "录音");
    }

    function enqueueVoicePrompt(text, sourceLabel) {
        const prompt = String(text || "").trim();
        if (!prompt) {
            return;
        }

        asrState.voicePromptQueue.push({
            text: prompt,
            sourceLabel: sourceLabel || "语音",
        });
        void drainVoicePromptQueue();
    }

    async function drainVoicePromptQueue() {
        if (
            chatState.chatBusy
            || audioState.speaking
            || !asrState.voicePromptQueue.length
        ) {
            return;
        }

        const nextPrompt = asrState.voicePromptQueue.shift();
        if (!nextPrompt) {
            return;
        }

        DOM.promptInput.value = nextPrompt.text;
        setRunStatus(`${nextPrompt.sourceLabel}已识别，准备发送…`);
        document.getElementById("chat-form").requestSubmit();
    }

    async function openAsrSocket() {
        if (asrState.asrSocket && asrState.asrSocket.readyState <= WebSocket.OPEN) {
            return;
        }

        const url = buildAsrSocketUrl();
        asrState.asrSocketIntentionalClose = false;
        const socket = new WebSocket(url);
        socket.binaryType = "arraybuffer";

        socket.addEventListener("message", handleAsrSocketMessage);
        socket.addEventListener("close", handleAsrSocketClose);
        socket.addEventListener("error", (error) => {
            console.error("ASR websocket error", error);
        });

        await new Promise((resolve, reject) => {
            const timerId = window.setTimeout(() => {
                reject(new Error("实时语音连接超时"));
            }, 8000);

            socket.addEventListener(
                "open",
                () => {
                    window.clearTimeout(timerId);
                    resolve();
                },
                { once: true },
            );
            socket.addEventListener(
                "error",
                () => {
                    window.clearTimeout(timerId);
                    reject(new Error("实时语音连接失败"));
                },
                { once: true },
            );
        });

        asrState.asrSocket = socket;
    }

    async function closeAsrSocket(flushFirst = false) {
        const socket = asrState.asrSocket;
        if (!socket) {
            return;
        }

        if (flushFirst && socket.readyState === WebSocket.OPEN) {
            sendAsrSocketControl("flush");
            await delay(160);
        }

        asrState.asrSocketIntentionalClose = true;
        asrState.asrSocket = null;
        try {
            socket.close();
        } catch (error) {
            console.warn("ASR websocket close ignored", error);
        }
    }

    function handleBeforeUnload() {
        if (asrState.asrSocket) {
            try {
                asrState.asrSocket.close();
            } catch (error) {
                console.warn("ASR websocket close ignored during unload", error);
            }
        }
        stopMicrophoneCapture();
    }

    function buildAsrSocketUrl() {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        return `${protocol}//${window.location.host}/api/web/asr/ws`;
    }

    function sendAsrSocketControl(command) {
        if (!asrState.asrSocket || asrState.asrSocket.readyState !== WebSocket.OPEN) {
            return;
        }
        asrState.asrSocket.send(String(command || ""));
    }

    function sendAsrSocketChunk(int16Chunk) {
        if (!asrState.asrSocket || asrState.asrSocket.readyState !== WebSocket.OPEN) {
            return;
        }
        asrState.asrSocket.send(
            int16Chunk.buffer.slice(
                int16Chunk.byteOffset,
                int16Chunk.byteOffset + int16Chunk.byteLength,
            ),
        );
    }

    function handleAsrSocketMessage(event) {
        if (!event || typeof event.data !== "string") {
            return;
        }

        let payload;
        try {
            payload = JSON.parse(event.data);
        } catch (error) {
            console.warn("Failed to parse ASR websocket payload", error);
            return;
        }

        if (payload.type === "ready") {
            if (asrState.asrConfig) {
                applyAsrStatus({
                    ...asrState.asrConfig,
                    available: true,
                    state: String(payload.state || "ready"),
                    detail: String(payload.detail || asrState.asrConfig.detail || ""),
                });
            }
            return;
        }
        if (payload.type === "speech_start") {
            setRunStatus("正在听你说…");
            return;
        }
        if (payload.type === "speech_end") {
            setRunStatus("正在识别语音…");
            return;
        }
        if (payload.type === "transcript") {
            enqueueVoicePrompt(payload.text, "语音");
            return;
        }
        if (payload.type === "error") {
            addSystemMessage(`实时语音失败：${payload.message || "未知错误"}`);
        }
    }

    function handleAsrSocketClose() {
        const intentional = asrState.asrSocketIntentionalClose;
        asrState.asrSocket = null;
        asrState.asrSocketIntentionalClose = false;

        if (intentional) {
            return;
        }

        if (asrState.alwaysListenEnabled) {
            asrState.alwaysListenEnabled = false;
            asrState.alwaysListenPaused = false;
            asrState.microphoneCaptureMode = "idle";
            if (DOM.alwaysListenCheckbox) {
                DOM.alwaysListenCheckbox.checked = false;
            }
            stopMicrophoneCapture();
            updateVoiceInputControls();
            addSystemMessage("实时语音连接已断开。");
        }
    }

    function buildWavBlob(chunks, sampleRate) {
        const validChunks = Array.isArray(chunks)
            ? chunks.filter((chunk) => chunk instanceof Int16Array && chunk.length > 0)
            : [];
        if (!validChunks.length) {
            return null;
        }

        const totalSamples = validChunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const pcmBytes = totalSamples * 2;
        const buffer = new ArrayBuffer(44 + pcmBytes);
        const view = new DataView(buffer);
        const merged = new Int16Array(buffer, 44, totalSamples);

        let offset = 0;
        validChunks.forEach((chunk) => {
            merged.set(chunk, offset);
            offset += chunk.length;
        });

        writeAscii(view, 0, "RIFF");
        view.setUint32(4, 36 + pcmBytes, true);
        writeAscii(view, 8, "WAVE");
        writeAscii(view, 12, "fmt ");
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeAscii(view, 36, "data");
        view.setUint32(40, pcmBytes, true);

        return new Blob([buffer], { type: "audio/wav" });
    }

    function writeAscii(view, offset, text) {
        for (let index = 0; index < text.length; index += 1) {
            view.setUint8(offset + index, text.charCodeAt(index));
        }
    }

    class PcmChunkResampler {
        constructor(inputSampleRate, outputSampleRate) {
            this.inputSampleRate = Number(inputSampleRate) || outputSampleRate;
            this.outputSampleRate = Number(outputSampleRate) || 16000;
            this.pendingChunk = new Float32Array(0);
        }

        push(floatChunk) {
            if (!(floatChunk instanceof Float32Array) || !floatChunk.length) {
                return new Int16Array(0);
            }

            const mergedChunk = mergeFloat32Chunks(this.pendingChunk, floatChunk);
            if (!mergedChunk.length) {
                return new Int16Array(0);
            }

            if (this.inputSampleRate === this.outputSampleRate) {
                this.pendingChunk = new Float32Array(0);
                return floatChunkToInt16(mergedChunk);
            }

            const ratio = this.inputSampleRate / this.outputSampleRate;
            const outputLength = Math.floor(mergedChunk.length / ratio);
            if (outputLength <= 0) {
                this.pendingChunk = mergedChunk;
                return new Int16Array(0);
            }

            const resampled = new Float32Array(outputLength);
            for (let index = 0; index < outputLength; index += 1) {
                const sourceIndex = index * ratio;
                const leftIndex = Math.floor(sourceIndex);
                const rightIndex = Math.min(leftIndex + 1, mergedChunk.length - 1);
                const offset = sourceIndex - leftIndex;
                resampled[index] = mergedChunk[leftIndex] * (1 - offset) + mergedChunk[rightIndex] * offset;
            }

            const consumedSamples = Math.floor(outputLength * ratio);
            this.pendingChunk = consumedSamples < mergedChunk.length
                ? mergedChunk.slice(consumedSamples)
                : new Float32Array(0);
            return floatChunkToInt16(resampled);
        }
    }

    function mergeFloat32Chunks(leftChunk, rightChunk) {
        if (!leftChunk.length) {
            return rightChunk;
        }
        if (!rightChunk.length) {
            return leftChunk;
        }

        const output = new Float32Array(leftChunk.length + rightChunk.length);
        output.set(leftChunk, 0);
        output.set(rightChunk, leftChunk.length);
        return output;
    }

    function floatChunkToInt16(floatChunk) {
        const output = new Int16Array(floatChunk.length);
        for (let index = 0; index < floatChunk.length; index += 1) {
            output[index] = floatToInt16Sample(floatChunk[index]);
        }
        return output;
    }

    function floatToInt16Sample(value) {
        const sample = clamp(Number(value) || 0, -1, 1);
        if (sample < 0) {
            return Math.round(sample * 32768);
        }
        return Math.round(sample * 32767);
    }

    return {
        applyAsrStatus: applyAsrStatus,
        startAsrStatusPolling: startAsrStatusPolling,
        updateVoiceInputControls: updateVoiceInputControls,
        handleRecordButtonClick: handleRecordButtonClick,
        handleAlwaysListenToggle: handleAlwaysListenToggle,
        drainVoicePromptQueue: drainVoicePromptQueue,
        handleBeforeUnload: handleBeforeUnload,
    };
}
