import { createTtsOptionsController } from "./tts/options.js";
import { createTtsPlaybackController } from "./tts/playback.js";

export function createTtsModule(deps) {
    let hooks = {
        updateVoiceInputControls() {},
    };

    const options = createTtsOptionsController({
        requestJson: deps.requestJson,
    });
    const playback = createTtsPlaybackController({
        addMessage: deps.addMessage,
        applyMouthValue: deps.applyMouthValue,
        clamp: deps.clamp,
        getHooks: () => hooks,
        responseToError: deps.responseToError,
        setConnectionState: deps.setConnectionState,
        setRunStatus: deps.setRunStatus,
        smoothValue: deps.smoothValue,
    });

    function bindHooks(nextHooks) {
        hooks = {
            ...hooks,
            ...(nextHooks || {}),
        };
    }

    return {
        bindHooks: bindHooks,
        createSpeechSession: playback.createSpeechSession,
        ensureAudioContextReady: playback.ensureAudioContextReady,
        finalizeSpeechSession: playback.finalizeSpeechSession,
        handleTtsProviderChange: options.handleTtsProviderChange,
        handleVoiceSelectionChange: options.handleVoiceSelectionChange,
        loadTtsOptions: options.loadTtsOptions,
        queueSpeechSessionText: playback.queueSpeechSessionText,
        speakText: playback.speakText,
        stopSpeechPlayback: playback.stopSpeechPlayback,
    };
}
