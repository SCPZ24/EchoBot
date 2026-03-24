import { DOM } from "../core/dom.js";
import { chatState, sessionState } from "../core/store.js";
import { scheduleMessagesScrollToBottom } from "../modules/messages.js";

export function createUiStatusController() {
    const features = {
        asr: null,
        chat: null,
        roles: null,
        sessions: null,
    };

    function bindFeatures(nextFeatures) {
        Object.assign(features, nextFeatures || {});
    }

    function setChatBusy(isBusy) {
        chatState.chatBusy = isBusy;
        if (DOM.sendButton) {
            DOM.sendButton.disabled = isBusy;
        }
        if (DOM.composerFileButton) {
            DOM.composerFileButton.disabled = isBusy || Boolean(chatState.activeChatJobId);
        }
        if (DOM.composerFileInput) {
            DOM.composerFileInput.disabled = isBusy || Boolean(chatState.activeChatJobId);
        }
        if (DOM.composerImageButton) {
            DOM.composerImageButton.disabled = isBusy || Boolean(chatState.activeChatJobId);
        }
        if (DOM.composerImageInput) {
            DOM.composerImageInput.disabled = isBusy || Boolean(chatState.activeChatJobId);
        }
        if (DOM.sessionCreateButton) {
            DOM.sessionCreateButton.disabled = isBusy || sessionState.sessionLoading;
        }
        if (DOM.sessionRefreshButton) {
            DOM.sessionRefreshButton.disabled = isBusy || sessionState.sessionLoading;
        }
        if (DOM.routeModeSelect) {
            DOM.routeModeSelect.disabled = (
                isBusy
                || sessionState.sessionLoading
                || Boolean(chatState.activeChatJobId)
            );
        }

        features.sessions?.renderSessionList(sessionState.sessions);
        features.roles?.updateRoleActionState();
        features.asr?.updateVoiceInputControls();
        updateComposerBackgroundJobState();
        features.chat?.refreshComposerAttachments();
    }

    function setActiveBackgroundJob(jobId) {
        chatState.activeChatJobId = String(jobId || "").trim();
        updateComposerBackgroundJobState();
    }

    function setConnectionState(kind, text) {
        if (!DOM.connectionBadge) {
            return;
        }

        DOM.connectionBadge.className = `status-badge status-${kind}`;
        DOM.connectionBadge.textContent = text;
    }

    function setRunStatus(text) {
        if (DOM.runStatus) {
            DOM.runStatus.textContent = text;
        }
    }

    function updateComposerBackgroundJobState() {
        const backgroundJobRunning = Boolean(chatState.activeChatJobId);

        if (DOM.promptInput) {
            DOM.promptInput.disabled = backgroundJobRunning;
        }
        if (DOM.composerFileButton) {
            DOM.composerFileButton.disabled = backgroundJobRunning || chatState.chatBusy;
        }
        if (DOM.composerFileInput) {
            DOM.composerFileInput.disabled = backgroundJobRunning || chatState.chatBusy;
        }
        if (DOM.composerImageButton) {
            DOM.composerImageButton.disabled = backgroundJobRunning || chatState.chatBusy;
        }
        if (DOM.composerImageInput) {
            DOM.composerImageInput.disabled = backgroundJobRunning || chatState.chatBusy;
        }
        if (DOM.composerStatusBanner) {
            DOM.composerStatusBanner.hidden = !backgroundJobRunning;
        }
        if (DOM.stopAgentButton) {
            DOM.stopAgentButton.disabled = !backgroundJobRunning;
            DOM.stopAgentButton.classList.toggle("is-active", backgroundJobRunning);
        }
        if (DOM.routeModeSelect) {
            DOM.routeModeSelect.disabled = (
                backgroundJobRunning
                || chatState.chatBusy
                || sessionState.sessionLoading
            );
        }

        scheduleMessagesScrollToBottom();
        features.chat?.refreshComposerAttachments();
    }

    return {
        bindFeatures,
        setActiveBackgroundJob,
        setChatBusy,
        setConnectionState,
        setRunStatus,
    };
}
