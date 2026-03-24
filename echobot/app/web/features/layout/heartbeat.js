import { DOM } from "../../core/dom.js";
import { panelState } from "../../core/store.js";
import { writeHeartbeatPanelState } from "./panels.js";

export function createHeartbeatController(deps) {
    const { isSettingsPanelOpen, requestJson } = deps;

    function handleHeartbeatPanelToggle() {
        if (!DOM.heartbeatPanel || !DOM.heartbeatSummaryText) {
            return;
        }

        const isExpanded = DOM.heartbeatPanel.open;
        const settingsPanelOpen = isSettingsPanelOpen();
        writeHeartbeatPanelState(isExpanded);

        if (!isExpanded) {
            DOM.heartbeatSummaryText.textContent = panelState.heartbeatDirty
                ? "有未保存修改"
                : "已隐藏";
            renderHeartbeatState();
            return;
        }

        if (!settingsPanelOpen) {
            DOM.heartbeatSummaryText.textContent = panelState.heartbeatDirty
                ? "有未保存修改"
                : "已展开";
            renderHeartbeatState();
            return;
        }

        if (panelState.heartbeatLoaded || panelState.heartbeatDirty) {
            renderHeartbeatState();
            return;
        }

        DOM.heartbeatSummaryText.textContent = "正在加载…";
        void refreshHeartbeatPanel();
    }

    async function refreshHeartbeatPanel(options = {}) {
        if (
            !DOM.heartbeatPanel
            || !DOM.heartbeatPanel.open
            || !isSettingsPanelOpen()
            || panelState.heartbeatLoading
            || panelState.heartbeatSaving
        ) {
            return;
        }
        if (!options.force && panelState.heartbeatDirty) {
            renderHeartbeatState();
            return;
        }

        panelState.heartbeatLoading = true;
        updateHeartbeatControls();
        if (DOM.heartbeatStatus) {
            DOM.heartbeatStatus.textContent = "正在加载 HEARTBEAT 周期任务…";
        }

        try {
            const payload = await requestJson("/api/heartbeat");
            renderHeartbeatPanel(payload);
        } catch (error) {
            console.error(error);
            if (DOM.heartbeatSummaryText) {
                DOM.heartbeatSummaryText.textContent = "加载失败";
            }
            if (DOM.heartbeatStatus) {
                DOM.heartbeatStatus.textContent = error.message || "HEARTBEAT 加载失败";
            }
        } finally {
            panelState.heartbeatLoading = false;
            updateHeartbeatControls();
        }
    }

    async function saveHeartbeat() {
        if (!DOM.heartbeatInput || panelState.heartbeatLoading || panelState.heartbeatSaving) {
            return;
        }

        panelState.heartbeatSaving = true;
        updateHeartbeatControls();
        if (DOM.heartbeatStatus) {
            DOM.heartbeatStatus.textContent = "正在保存 HEARTBEAT 周期任务…";
        }

        try {
            const payload = await requestJson("/api/heartbeat", {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    content: DOM.heartbeatInput.value,
                }),
            });
            renderHeartbeatPanel(payload);
        } catch (error) {
            console.error(error);
            if (DOM.heartbeatSummaryText) {
                DOM.heartbeatSummaryText.textContent = "保存失败";
            }
            if (DOM.heartbeatStatus) {
                DOM.heartbeatStatus.textContent = error.message || "HEARTBEAT 保存失败";
            }
        } finally {
            panelState.heartbeatSaving = false;
            updateHeartbeatControls();
        }
    }

    function handleHeartbeatInputChange() {
        if (!DOM.heartbeatInput) {
            return;
        }

        panelState.heartbeatDirty = DOM.heartbeatInput.value !== panelState.heartbeatSavedContent;
        renderHeartbeatState();
    }

    function renderHeartbeatPanel(payload) {
        panelState.heartbeatData = payload || null;
        panelState.heartbeatLoaded = true;
        panelState.heartbeatSavedContent = String((payload && payload.content) || "");
        panelState.heartbeatDirty = false;

        if (DOM.heartbeatInput) {
            DOM.heartbeatInput.value = panelState.heartbeatSavedContent;
        }

        renderHeartbeatState();
    }

    function renderHeartbeatState() {
        const payload = panelState.heartbeatData;

        if (DOM.heartbeatSummaryText) {
            DOM.heartbeatSummaryText.textContent = buildHeartbeatSummaryText(payload);
        }
        if (DOM.heartbeatStatus) {
            DOM.heartbeatStatus.textContent = buildHeartbeatStatusText(payload);
        }
        if (DOM.heartbeatMeta) {
            DOM.heartbeatMeta.textContent = buildHeartbeatMetaText(payload);
        }

        updateHeartbeatControls();
    }

    function buildHeartbeatSummaryText(payload) {
        const isExpanded = Boolean(DOM.heartbeatPanel && DOM.heartbeatPanel.open);
        const settingsPanelOpen = isSettingsPanelOpen();

        if (panelState.heartbeatDirty) {
            return "有未保存修改";
        }
        if (!isExpanded) {
            return "已隐藏";
        }
        if (!settingsPanelOpen) {
            return "已展开";
        }
        if (!payload) {
            return "展开后加载";
        }
        if (!payload.enabled) {
            return payload.has_meaningful_content ? "已配置但未启用" : "未启用";
        }
        if (!payload.has_meaningful_content) {
            return "当前无有效任务";
        }
        return `每 ${payload.interval_seconds || 0} 秒检查`;
    }

    function buildHeartbeatStatusText(payload) {
        if (!isSettingsPanelOpen()) {
            return "展开设置面板后查看 HEARTBEAT 周期任务";
        }
        if (!payload) {
            return "展开后加载 HEARTBEAT 周期任务";
        }
        if (panelState.heartbeatDirty) {
            return "内容已修改，保存后会更新 HEARTBEAT 周期任务";
        }

        const stateText = payload.enabled ? "HEARTBEAT 运行中" : "HEARTBEAT 未启用";
        const contentText = payload.has_meaningful_content
            ? "文件中有有效任务"
            : "文件中暂无有效任务";
        return `${stateText} · ${contentText}`;
    }

    function buildHeartbeatMetaText(payload) {
        if (!payload) {
            return "间隔会在加载后显示";
        }
        return `间隔 ${payload.interval_seconds || 0} 秒`;
    }

    function updateHeartbeatControls() {
        const isBusy = panelState.heartbeatLoading || panelState.heartbeatSaving;

        if (DOM.heartbeatInput) {
            DOM.heartbeatInput.disabled = isBusy;
        }
        if (DOM.heartbeatRefreshButton) {
            DOM.heartbeatRefreshButton.disabled = isBusy;
        }
        if (DOM.heartbeatSaveButton) {
            DOM.heartbeatSaveButton.disabled = isBusy || !panelState.heartbeatDirty;
        }
    }

    return {
        handleHeartbeatInputChange,
        handleHeartbeatPanelToggle,
        refreshHeartbeatPanel,
        saveHeartbeat,
    };
}
