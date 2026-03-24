import { DOM } from "../../core/dom.js";
import { panelState } from "../../core/store.js";
import { readBoolean, writeBoolean } from "../../core/storage.js";

const SESSION_SIDEBAR_STORAGE_KEY = "echobot.web.session_sidebar_open";
const ROLE_SIDEBAR_STORAGE_KEY = "echobot.web.role_sidebar_open";

export function createSidebarController() {
    function ensureSidebarToggleButtons() {
        const sessionToggle = DOM.sessionSidebarToggle;
        if (!sessionToggle) {
            return;
        }

        let actions = sessionToggle.parentElement;
        if (!actions || !actions.classList.contains("panel-header-actions")) {
            actions = document.createElement("div");
            actions.className = "panel-header-actions";
            sessionToggle.insertAdjacentElement("afterend", actions);
            actions.appendChild(sessionToggle);
        }

        let roleToggle = DOM.roleSidebarToggle || document.getElementById("role-sidebar-toggle");
        if (!roleToggle) {
            roleToggle = document.createElement("button");
            roleToggle.id = "role-sidebar-toggle";
            roleToggle.type = "button";
            roleToggle.className = "ghost-button ghost-button-compact";
            roleToggle.textContent = "角色卡";
            actions.appendChild(roleToggle);
        }

        DOM.roleSidebarToggle = roleToggle;
    }

    function stopSummaryButtonToggle(event) {
        if (!event) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
    }

    function restoreSessionSidebarState() {
        setSessionSidebarOpen(readBoolean(SESSION_SIDEBAR_STORAGE_KEY, false));
    }

    function restoreRoleSidebarState() {
        setRoleSidebarOpen(readBoolean(ROLE_SIDEBAR_STORAGE_KEY, false));
    }

    function setSessionSidebarOpen(isOpen, options = {}) {
        panelState.sessionSidebarOpen = Boolean(isOpen);
        if (
            panelState.sessionSidebarOpen
            && options.closeOther !== false
            && panelState.roleSidebarOpen
        ) {
            setRoleSidebarOpen(false, { closeOther: false });
        }

        if (DOM.chatPanel) {
            DOM.chatPanel.classList.toggle("sessions-open", panelState.sessionSidebarOpen);
        }
        if (DOM.sessionSidebar) {
            DOM.sessionSidebar.setAttribute("aria-hidden", String(!panelState.sessionSidebarOpen));
        }
        if (DOM.sessionSidebarBackdrop) {
            DOM.sessionSidebarBackdrop.hidden = !panelState.sessionSidebarOpen;
        }
        if (DOM.sessionSidebarToggle) {
            DOM.sessionSidebarToggle.textContent = panelState.sessionSidebarOpen
                ? "隐藏会话"
                : "会话列表";
            DOM.sessionSidebarToggle.setAttribute("aria-expanded", String(panelState.sessionSidebarOpen));
        }

        writeBoolean(SESSION_SIDEBAR_STORAGE_KEY, panelState.sessionSidebarOpen);
    }

    function setRoleSidebarOpen(isOpen, options = {}) {
        panelState.roleSidebarOpen = Boolean(isOpen);
        if (
            panelState.roleSidebarOpen
            && options.closeOther !== false
            && panelState.sessionSidebarOpen
        ) {
            setSessionSidebarOpen(false, { closeOther: false });
        }

        if (DOM.chatPanel) {
            DOM.chatPanel.classList.toggle("roles-open", panelState.roleSidebarOpen);
        }
        if (DOM.roleSidebar) {
            DOM.roleSidebar.setAttribute("aria-hidden", String(!panelState.roleSidebarOpen));
        }
        if (DOM.roleSidebarBackdrop) {
            DOM.roleSidebarBackdrop.hidden = !panelState.roleSidebarOpen;
        }
        if (DOM.roleSidebarToggle) {
            DOM.roleSidebarToggle.textContent = panelState.roleSidebarOpen
                ? "隐藏角色卡"
                : "角色卡";
            DOM.roleSidebarToggle.setAttribute("aria-expanded", String(panelState.roleSidebarOpen));
        }

        writeBoolean(ROLE_SIDEBAR_STORAGE_KEY, panelState.roleSidebarOpen);
    }

    return {
        ensureSidebarToggleButtons,
        restoreRoleSidebarState,
        restoreSessionSidebarState,
        setRoleSidebarOpen,
        setSessionSidebarOpen,
        stopSummaryButtonToggle,
    };
}
