import {
    DEFAULT_SESSION_NAME,
    SESSION_SYNC_POLL_INTERVAL_MS,
    audioState,
    chatState,
    roleState,
    sessionState,
} from "../core/store.js";
import { DOM } from "../core/dom.js";
import { createSessionsApi } from "./sessions/api.js";
import {
    buildSpokenText,
    findAppendedMessages,
    normalizeHistory,
    renderSessionHistory,
    shouldAnnounceNewMessages,
} from "./sessions/history.js";
import { normalizeRouteMode, routeModeLabel } from "./sessions/route-mode.js";
import { createSessionSidebarController } from "./sessions/sidebar.js";

export function createSessionsModule(deps) {
    const {
        addMessage,
        addSystemMessage,
        clearMessages,
        formatTimestamp,
        normalizeSessionName,
        requestJson,
        speakText,
        setRunStatus,
        stopSpeechPlayback,
    } = deps;

    const api = createSessionsApi({
        requestJson: requestJson,
    });
    const sidebar = createSessionSidebarController({
        formatTimestamp: formatTimestamp,
    });

    let roleHooks = {
        closeRoleEditor() {},
        syncRolePanelForCurrentSession() {
            return Promise.resolve();
        },
    };

    function bindRoleHooks(hooks) {
        roleHooks = {
            ...roleHooks,
            ...(hooks || {}),
        };
    }

    async function initializeSessionPanel(defaultSessionName) {
        sidebar.setSessionControlsBusy(true, "正在加载会话...");

        try {
            const sessionSummaries = await api.requestSessionSummaries();
            sidebar.applySessionSummaries(sessionSummaries);

            const initialSessionName = resolveInitialSessionName(defaultSessionName, sessionSummaries);
            const sessionDetail = initialSessionName === defaultSessionName
                ? await requestJson("/api/sessions/current")
                : await api.switchCurrentSession(initialSessionName);

            applySessionDetail(sessionDetail);
            sidebar.setSessionSidebarStatus("");
            startSessionSyncPolling();
        } finally {
            sidebar.setSessionControlsBusy(false);
        }
    }

    function resolveInitialSessionName(defaultSessionName, sessionSummaries) {
        const storedSessionName = String(window.localStorage.getItem("echobot.web.session") || "").trim();
        const candidateNames = new Set((sessionSummaries || []).map((item) => item.name));

        if (storedSessionName && candidateNames.has(storedSessionName)) {
            return storedSessionName;
        }
        if (defaultSessionName && candidateNames.has(defaultSessionName)) {
            return defaultSessionName;
        }
        if (sessionSummaries && sessionSummaries.length > 0) {
            return sessionSummaries[0].name;
        }
        return defaultSessionName || DEFAULT_SESSION_NAME;
    }

    async function refreshSessionList() {
        if (sessionState.sessionLoading) {
            return;
        }

        sidebar.setSessionControlsBusy(true, "正在加载会话...");
        try {
            const sessionSummaries = await api.requestSessionSummaries();
            sidebar.applySessionSummaries(sessionSummaries);
            sidebar.setSessionSidebarStatus("");
        } catch (error) {
            console.error(error);
            sidebar.setSessionSidebarStatus(error.message || "会话列表加载失败");
            addMessage("system", `会话列表加载失败：${error.message || error}`, "状态");
        } finally {
            sidebar.setSessionControlsBusy(false);
        }
    }

    function startSessionSyncPolling() {
        if (sessionState.sessionSyncPollTimerId) {
            return;
        }

        sessionState.sessionSyncPollTimerId = window.setInterval(() => {
            void syncCurrentSessionFromServer({
                announceNewMessages: true,
                refreshSummaries: true,
            });
        }, SESSION_SYNC_POLL_INTERVAL_MS);
    }

    async function syncCurrentSessionFromServer(options = {}) {
        if (
            sessionState.sessionSyncInFlight
            || sessionState.sessionLoading
            || (
                !options.force
                && (chatState.chatBusy || chatState.activeChatJobId)
            )
        ) {
            return;
        }

        const sessionName = normalizeSessionName(
            options.sessionName || sessionState.currentSessionName || DEFAULT_SESSION_NAME,
        );
        sessionState.sessionSyncInFlight = true;
        try {
            const sessionDetail = await api.requestSessionDetail(sessionName);
            if (
                !options.force
                && sessionDetail.updated_at === sessionState.currentSessionUpdatedAt
            ) {
                return;
            }
            applySessionDetail(sessionDetail, {
                announceNewMessages: Boolean(options.announceNewMessages),
            });
            if (Boolean(options.refreshSummaries)) {
                sidebar.applySessionSummaries(await api.requestSessionSummaries());
            }
        } catch (error) {
            console.error("Failed to sync session detail", error);
        } finally {
            sessionState.sessionSyncInFlight = false;
        }
    }

    async function handleSessionListClick(event) {
        const actionButton = event.target.closest("[data-session-action]");
        if (!actionButton || !DOM.sessionList || !DOM.sessionList.contains(actionButton)) {
            return;
        }

        const action = actionButton.dataset.sessionAction || "";
        const sessionName = actionButton.dataset.sessionName || "";
        if (!sessionName) {
            return;
        }

        if (action === "switch") {
            await switchSession(sessionName);
            return;
        }
        if (action === "rename") {
            await handleRenameSession(sessionName);
            return;
        }
        if (action === "delete") {
            await handleDeleteSession(sessionName);
        }
    }

    async function switchSession(sessionName) {
        if (
            chatState.chatBusy
            || sessionState.sessionLoading
            || !sessionName
            || sessionName === sessionState.currentSessionName
        ) {
            return;
        }

        stopSpeechPlayback();
        sidebar.setSessionControlsBusy(true, "正在切换会话...");

        try {
            const sessionDetail = await api.switchCurrentSession(sessionName);
            applySessionDetail(sessionDetail);
            sidebar.setSessionSidebarStatus("");
            setRunStatus(`已切换到会话：${sessionDetail.name}`);
        } catch (error) {
            console.error(error);
            sidebar.setSessionSidebarStatus(error.message || "切换会话失败");
            addMessage("system", `切换会话失败：${error.message || error}`, "状态");
        } finally {
            sidebar.setSessionControlsBusy(false);
        }
    }

    async function handleCreateSession() {
        if (chatState.chatBusy || sessionState.sessionLoading) {
            return;
        }

        const rawName = window.prompt("输入新会话名，留空则自动生成：", "");
        if (rawName === null) {
            return;
        }

        let sessionName = "";
        const preferredRoleName = roleState.currentRoleName || "default";
        const preferredRouteMode = normalizeRouteMode(sessionState.currentRouteMode);
        try {
            sessionName = rawName.trim() ? normalizeSessionName(rawName) : "";
        } catch (error) {
            sidebar.setSessionSidebarStatus(error.message || "会话名不合法");
            addMessage("system", `新建会话失败：${error.message || error}`, "状态");
            return;
        }

        stopSpeechPlayback();
        sidebar.setSessionControlsBusy(true, "正在创建会话...");

        try {
            let sessionDetail = await api.createSession(sessionName);
            if (
                preferredRoleName
                && sessionDetail.role_name !== preferredRoleName
            ) {
                sessionDetail = await api.updateSessionRole(
                    sessionDetail.name,
                    preferredRoleName,
                );
            }
            if (sessionDetail.route_mode !== preferredRouteMode) {
                sessionDetail = await api.updateSessionRouteMode(
                    sessionDetail.name,
                    preferredRouteMode,
                );
            }
            sidebar.applySessionSummaries(await api.requestSessionSummaries());
            applySessionDetail(sessionDetail);
            sidebar.setSessionSidebarStatus("");
            setRunStatus(`已新建会话：${sessionDetail.name}`);
        } catch (error) {
            console.error(error);
            sidebar.setSessionSidebarStatus(error.message || "创建会话失败");
            addMessage("system", `创建会话失败：${error.message || error}`, "状态");
        } finally {
            sidebar.setSessionControlsBusy(false);
        }
    }

    async function handleRenameSession(sessionName) {
        if (chatState.chatBusy || sessionState.sessionLoading || !sessionName) {
            return;
        }

        const rawName = window.prompt("输入新的会话名：", sessionName);
        if (rawName === null) {
            return;
        }

        let nextSessionName = "";
        try {
            nextSessionName = normalizeSessionName(rawName);
        } catch (error) {
            sidebar.setSessionSidebarStatus(error.message || "会话名不合法");
            addMessage("system", `重命名会话失败：${error.message || error}`, "状态");
            return;
        }

        if (nextSessionName === sessionName) {
            return;
        }

        sidebar.setSessionControlsBusy(true, "正在重命名会话...");

        try {
            const sessionDetail = await api.renameSession(sessionName, nextSessionName);
            sidebar.applySessionSummaries(await api.requestSessionSummaries());
            applySessionDetail(sessionDetail);
            sidebar.setSessionSidebarStatus("");
            setRunStatus(`会话已重命名为：${sessionDetail.name}`);
        } catch (error) {
            console.error(error);
            sidebar.setSessionSidebarStatus(error.message || "重命名会话失败");
            addMessage("system", `重命名会话失败：${error.message || error}`, "状态");
        } finally {
            sidebar.setSessionControlsBusy(false);
        }
    }

    async function handleDeleteSession(sessionName) {
        if (chatState.chatBusy || sessionState.sessionLoading || !sessionName) {
            return;
        }
        if (!window.confirm(`确定删除会话“${sessionName}”吗？`)) {
            return;
        }

        stopSpeechPlayback();
        sidebar.setSessionControlsBusy(true, "正在删除会话...");

        try {
            await api.deleteSession(sessionName);
            sidebar.applySessionSummaries(await api.requestSessionSummaries());

            if (sessionName === sessionState.currentSessionName) {
                const sessionDetail = await requestJson("/api/sessions/current");
                applySessionDetail(sessionDetail);
            } else {
                sidebar.renderSessionList(sessionState.sessions);
                sidebar.updateSessionSidebarSummary();
            }

            setRunStatus(`已删除会话：${sessionName}`);
            sidebar.setSessionSidebarStatus("");
        } catch (error) {
            console.error(error);
            sidebar.setSessionSidebarStatus(error.message || "删除会话失败");
            addMessage("system", `删除会话失败：${error.message || error}`, "状态");
        } finally {
            sidebar.setSessionControlsBusy(false);
        }
    }

    function applySessionDetail(sessionDetail, options = {}) {
        const sessionName = normalizeSessionName(sessionDetail.name || DEFAULT_SESSION_NAME);
        const nextHistory = normalizeHistory(sessionDetail.history);
        const appendedMessages = shouldAnnounceNewMessages(
            options,
            sessionName,
            sessionState.currentSessionName,
            sessionState.currentSessionHistory,
        )
            ? findAppendedMessages(sessionState.currentSessionHistory, nextHistory)
            : [];

        roleHooks.closeRoleEditor();
        sessionState.currentSessionName = sessionName;
        sessionState.currentSessionUpdatedAt = String(sessionDetail.updated_at || "").trim();
        sessionState.currentSessionHistory = nextHistory;
        roleState.currentRoleName = sessionDetail.role_name || "default";
        sessionState.currentRouteMode = normalizeRouteMode(sessionDetail.route_mode);

        DOM.sessionLabel.textContent = `会话: ${sessionName}`;
        window.localStorage.setItem("echobot.web.session", sessionName);
        sidebar.syncRouteModeSelect();

        renderSessionHistory(nextHistory, {
            addMessage: addMessage,
            addSystemMessage: addSystemMessage,
            clearMessages: clearMessages,
        });
        sidebar.renderSessionList(sessionState.sessions);
        sidebar.updateSessionSidebarSummary();
        void roleHooks.syncRolePanelForCurrentSession();
        if (appendedMessages.length > 0) {
            void handleAppendedMessages(appendedMessages);
        }
    }

    async function handleAppendedMessages(messages) {
        const spokenText = buildSpokenText(messages);
        if (!spokenText) {
            return;
        }

        setRunStatus("收到新的会话消息");
        if (!audioState.ttsEnabled) {
            return;
        }

        try {
            await speakText(spokenText);
        } catch (error) {
            console.error("Failed to speak synced session messages", error);
        }
    }

    async function handleRouteModeChange() {
        if (
            !DOM.routeModeSelect
            || chatState.chatBusy
            || sessionState.sessionLoading
            || chatState.activeChatJobId
        ) {
            sidebar.syncRouteModeSelect();
            return;
        }

        const nextRouteMode = normalizeRouteMode(DOM.routeModeSelect.value);
        const currentRouteMode = normalizeRouteMode(sessionState.currentRouteMode);
        if (nextRouteMode === currentRouteMode) {
            sidebar.syncRouteModeSelect();
            return;
        }

        const sessionName = normalizeSessionName(
            sessionState.currentSessionName || DEFAULT_SESSION_NAME,
        );
        DOM.routeModeSelect.disabled = true;
        setRunStatus("正在切换路由模式...");

        try {
            const sessionDetail = await api.updateSessionRouteMode(
                sessionName,
                nextRouteMode,
            );
            applySessionDetail(sessionDetail);
            setRunStatus(`已切换路由模式：${routeModeLabel(nextRouteMode)}`);
        } catch (error) {
            console.error(error);
            sidebar.syncRouteModeSelect();
            addMessage("system", `切换路由模式失败：${error.message || error}`, "状态");
            setRunStatus(error.message || "切换路由模式失败");
        } finally {
            DOM.routeModeSelect.disabled = (
                chatState.chatBusy
                || sessionState.sessionLoading
                || Boolean(chatState.activeChatJobId)
            );
        }
    }

    return {
        applySessionDetail: applySessionDetail,
        applySessionSummaries: sidebar.applySessionSummaries,
        bindRoleHooks: bindRoleHooks,
        handleCreateSession: handleCreateSession,
        handleRouteModeChange: handleRouteModeChange,
        handleSessionListClick: handleSessionListClick,
        initializeSessionPanel: initializeSessionPanel,
        refreshSessionList: refreshSessionList,
        renderSessionList: sidebar.renderSessionList,
        requestSessionDetail: api.requestSessionDetail,
        requestSessionSummaries: api.requestSessionSummaries,
        syncCurrentSessionFromServer: syncCurrentSessionFromServer,
    };
}
