import { DOM } from "../../core/dom.js";
import { chatState, sessionState } from "../../core/store.js";
import { normalizeRouteMode } from "./route-mode.js";

export function createSessionSidebarController(deps) {
    const { formatTimestamp } = deps;

    function applySessionSummaries(sessionSummaries) {
        sessionState.sessions = Array.isArray(sessionSummaries) ? sessionSummaries : [];
        renderSessionList(sessionState.sessions);
        updateSessionSidebarSummary();
    }

    function syncRouteModeSelect() {
        if (!DOM.routeModeSelect) {
            return;
        }
        DOM.routeModeSelect.value = normalizeRouteMode(sessionState.currentRouteMode);
    }

    function setSessionControlsBusy(isBusy, statusText = null) {
        sessionState.sessionLoading = isBusy;

        if (DOM.sessionCreateButton) {
            DOM.sessionCreateButton.disabled = isBusy || chatState.chatBusy;
        }
        if (DOM.sessionRefreshButton) {
            DOM.sessionRefreshButton.disabled = isBusy || chatState.chatBusy;
        }
        if (DOM.sessionSidebarClose) {
            DOM.sessionSidebarClose.disabled = isBusy;
        }
        if (DOM.routeModeSelect) {
            DOM.routeModeSelect.disabled = (
                isBusy
                || chatState.chatBusy
                || Boolean(chatState.activeChatJobId)
            );
        }

        renderSessionList(sessionState.sessions);
        if (typeof statusText === "string") {
            setSessionSidebarStatus(statusText);
        }
    }

    function setSessionSidebarStatus(text) {
        if (!DOM.sessionSidebarStatus) {
            return;
        }
        DOM.sessionSidebarStatus.textContent = String(text || "").trim();
    }

    function updateSessionSidebarSummary() {
        if (!DOM.sessionSidebarSummary) {
            return;
        }

        if (!sessionState.sessions || sessionState.sessions.length === 0) {
            DOM.sessionSidebarSummary.textContent = "暂无会话";
            return;
        }

        const currentSessionName = sessionState.currentSessionName || sessionState.sessions[0].name;
        DOM.sessionSidebarSummary.textContent = `共 ${sessionState.sessions.length} 个会话 · 当前会话：${currentSessionName}`;
    }

    function renderSessionList(sessionSummaries) {
        if (!DOM.sessionList) {
            return;
        }

        DOM.sessionList.innerHTML = "";
        if (!sessionSummaries || sessionSummaries.length === 0) {
            const empty = document.createElement("p");
            empty.className = "session-empty";
            empty.textContent = "当前还没有会话。";
            DOM.sessionList.appendChild(empty);
            return;
        }

        sessionSummaries.forEach((sessionSummary) => {
            DOM.sessionList.appendChild(buildSessionCard(sessionSummary));
        });
    }

    function buildSessionCard(sessionSummary) {
        const isActive = sessionSummary.name === sessionState.currentSessionName;
        const container = document.createElement("article");
        container.className = isActive ? "session-card session-card-active" : "session-card";

        const mainButton = document.createElement("button");
        mainButton.type = "button";
        mainButton.className = "session-card-main";
        mainButton.dataset.sessionAction = "switch";
        mainButton.dataset.sessionName = sessionSummary.name;
        mainButton.disabled = chatState.chatBusy || sessionState.sessionLoading || isActive;

        const header = document.createElement("div");
        header.className = "session-card-header";

        const title = document.createElement("p");
        title.className = "session-card-title";
        title.textContent = sessionSummary.name;

        const count = document.createElement("span");
        count.className = "session-card-count";
        count.textContent = `${sessionSummary.message_count || 0} 条`;

        header.appendChild(title);
        header.appendChild(count);
        mainButton.appendChild(header);

        const meta = document.createElement("div");
        meta.className = "session-card-meta";
        meta.textContent = formatTimestamp(sessionSummary.updated_at) || "暂无更新时间";
        mainButton.appendChild(meta);

        const actions = document.createElement("div");
        actions.className = "session-card-actions";
        actions.appendChild(buildSessionActionButton("重命名", "rename", sessionSummary.name));
        actions.appendChild(
            buildSessionActionButton("删除", "delete", sessionSummary.name, {
                danger: true,
            }),
        );

        container.appendChild(mainButton);
        container.appendChild(actions);
        return container;
    }

    function buildSessionActionButton(label, action, sessionName, options = {}) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = options.danger
            ? "session-card-action session-card-action-danger"
            : "session-card-action";
        button.textContent = label;
        button.dataset.sessionAction = action;
        button.dataset.sessionName = sessionName;
        button.disabled = chatState.chatBusy || sessionState.sessionLoading;
        return button;
    }

    return {
        applySessionSummaries: applySessionSummaries,
        renderSessionList: renderSessionList,
        setSessionControlsBusy: setSessionControlsBusy,
        setSessionSidebarStatus: setSessionSidebarStatus,
        syncRouteModeSelect: syncRouteModeSelect,
        updateSessionSidebarSummary: updateSessionSidebarSummary,
    };
}
