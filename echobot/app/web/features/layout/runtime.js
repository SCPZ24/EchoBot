import { DOM } from "../../core/dom.js";
import { appState, runtimeState } from "../../core/store.js";

export function createRuntimeController(deps) {
    const { addMessage, requestJson, setRunStatus } = deps;

    function applyRuntimeConfig(runtimeConfig) {
        runtimeState.delegatedAckEnabled = runtimeConfig
            ? runtimeConfig.delegated_ack_enabled !== false
            : true;

        if (DOM.delegatedAckCheckbox) {
            DOM.delegatedAckCheckbox.checked = runtimeState.delegatedAckEnabled;
        }
        updateRuntimeControls();
    }

    async function handleDelegatedAckToggle() {
        if (!DOM.delegatedAckCheckbox || runtimeState.runtimeConfigLoading) {
            return;
        }

        const nextValue = Boolean(DOM.delegatedAckCheckbox.checked);
        if (nextValue === runtimeState.delegatedAckEnabled) {
            updateRuntimeControls();
            return;
        }

        runtimeState.runtimeConfigLoading = true;
        updateRuntimeControls();
        setRunStatus("正在更新后台任务提示设置...");

        try {
            const payload = await requestJson("/api/web/runtime", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    delegated_ack_enabled: nextValue,
                }),
            });
            if (appState.config) {
                appState.config.runtime = payload;
            }
            applyRuntimeConfig(payload);
            setRunStatus(
                nextValue
                    ? "已开启后台任务开始时先发提示"
                    : "已关闭后台任务开始时先发提示",
            );
        } catch (error) {
            console.error(error);
            DOM.delegatedAckCheckbox.checked = runtimeState.delegatedAckEnabled;
            addMessage(
                "system",
                `更新后台任务提示设置失败：${error.message || error}`,
                "状态",
            );
            setRunStatus(error.message || "更新后台任务提示设置失败");
        } finally {
            runtimeState.runtimeConfigLoading = false;
            updateRuntimeControls();
        }
    }

    function updateRuntimeControls() {
        if (DOM.delegatedAckCheckbox) {
            DOM.delegatedAckCheckbox.disabled = runtimeState.runtimeConfigLoading;
        }
    }

    return {
        applyRuntimeConfig,
        handleDelegatedAckToggle,
    };
}
