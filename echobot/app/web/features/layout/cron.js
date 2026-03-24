import { DOM } from "../../core/dom.js";
import { panelState, CRON_POLL_INTERVAL_MS } from "../../core/store.js";
import { writeCronPanelState } from "./panels.js";

export function createCronController(deps) {
    const { formatTimestamp, isSettingsPanelOpen, requestJson } = deps;

    function handleCronPanelToggle() {
        if (!DOM.cronPanel || !DOM.cronSummaryText) {
            return;
        }

        const isExpanded = DOM.cronPanel.open;
        const settingsPanelOpen = isSettingsPanelOpen();
        writeCronPanelState(isExpanded);

        if (!isExpanded || !settingsPanelOpen) {
            stopCronPolling();
            DOM.cronSummaryText.textContent = isExpanded ? "已展开" : "已隐藏";
            if (DOM.cronStatus) {
                DOM.cronStatus.textContent = settingsPanelOpen
                    ? "展开后加载 CRON 定时任务"
                    : "展开设置面板后查看 CRON 定时任务";
            }
            return;
        }

        DOM.cronSummaryText.textContent = "正在加载…";
        void refreshCronPanel();
        startCronPolling();
    }

    function startCronPolling() {
        stopCronPolling();
        panelState.cronPollTimerId = window.setInterval(() => {
            if (!DOM.cronPanel || !DOM.cronPanel.open || !isSettingsPanelOpen()) {
                return;
            }
            void refreshCronPanel();
        }, CRON_POLL_INTERVAL_MS);
    }

    function stopCronPolling() {
        if (!panelState.cronPollTimerId) {
            return;
        }

        window.clearInterval(panelState.cronPollTimerId);
        panelState.cronPollTimerId = 0;
    }

    async function refreshCronPanel() {
        if (!DOM.cronPanel || !DOM.cronPanel.open || !isSettingsPanelOpen() || panelState.cronLoading) {
            return;
        }

        panelState.cronLoading = true;
        if (DOM.cronStatus) {
            DOM.cronStatus.textContent = "正在加载 CRON 定时任务…";
        }
        if (DOM.cronRefreshButton) {
            DOM.cronRefreshButton.disabled = true;
        }

        try {
            const [statusPayload, jobsPayload] = await Promise.all([
                requestJson("/api/cron/status"),
                requestJson("/api/cron/jobs?include_disabled=true"),
            ]);
            renderCronPanel(statusPayload, jobsPayload.jobs || []);
        } catch (error) {
            console.error(error);
            if (DOM.cronSummaryText) {
                DOM.cronSummaryText.textContent = "加载失败";
            }
            if (DOM.cronStatus) {
                DOM.cronStatus.textContent = error.message || "CRON 加载失败";
            }
        } finally {
            panelState.cronLoading = false;
            if (DOM.cronRefreshButton) {
                DOM.cronRefreshButton.disabled = false;
            }
        }
    }

    function renderCronPanel(statusPayload, jobs) {
        if (DOM.cronSummaryText) {
            DOM.cronSummaryText.textContent = buildCronSummaryText(statusPayload, jobs);
        }
        if (DOM.cronStatus) {
            DOM.cronStatus.textContent = buildCronStatusText(statusPayload, jobs);
        }
        renderCronJobs(jobs);
    }

    function buildCronSummaryText(statusPayload, jobs) {
        if (!statusPayload.enabled) {
            return "调度器未运行";
        }
        if (!jobs || jobs.length === 0) {
            return "没有任务";
        }
        return `${jobs.length} 个任务`;
    }

    function buildCronStatusText(statusPayload, jobs) {
        const statusText = statusPayload.enabled ? "调度器运行中" : "调度器未运行";
        if (!jobs || jobs.length === 0) {
            return `${statusText} · 当前没有 CRON 定时任务`;
        }

        const nextRunText = formatTimestamp(statusPayload.next_run_at);
        if (!nextRunText) {
            return `${statusText} · 共 ${jobs.length} 个任务`;
        }
        return `${statusText} · 共 ${jobs.length} 个任务 · 下次执行 ${nextRunText}`;
    }

    function renderCronJobs(jobs) {
        if (!DOM.cronJobs) {
            return;
        }

        DOM.cronJobs.innerHTML = "";
        if (!jobs || jobs.length === 0) {
            const empty = document.createElement("p");
            empty.className = "cron-empty";
            empty.textContent = "当前没有 CRON 定时任务。";
            DOM.cronJobs.appendChild(empty);
            return;
        }

        jobs.forEach((job) => {
            DOM.cronJobs.appendChild(buildCronJobCard(job));
        });
    }

    function buildCronJobCard(job) {
        const container = document.createElement("article");
        container.className = "cron-job";

        const header = document.createElement("div");
        header.className = "cron-job-header";

        const title = document.createElement("h3");
        title.className = "cron-job-title";
        title.textContent = job.name || "未命名任务";

        const idText = document.createElement("span");
        idText.className = "cron-job-id";
        idText.textContent = `#${job.id || "-"}`;

        header.appendChild(title);
        header.appendChild(idText);

        const meta = document.createElement("div");
        meta.className = "cron-job-meta";
        meta.appendChild(buildCronBadge(job.enabled ? "已启用" : "已停用", job.enabled ? "enabled" : "disabled"));
        meta.appendChild(buildCronBadge(buildCronLastStatusLabel(job.last_status), cronStatusClassName(job.last_status)));
        meta.appendChild(buildCronMetaText(`计划: ${job.schedule || "-"}`));
        meta.appendChild(buildCronMetaText(`会话: ${job.session_name || "-"}`));
        meta.appendChild(buildCronMetaText(`类型: ${job.payload_kind || "-"}`));

        const times = document.createElement("div");
        times.className = "cron-job-times";
        times.appendChild(buildCronMetaText(`下次: ${formatTimestamp(job.next_run_at) || "—"}`));
        times.appendChild(buildCronMetaText(`上次: ${formatTimestamp(job.last_run_at) || "—"}`));

        container.appendChild(header);
        container.appendChild(meta);
        container.appendChild(times);

        if (job.last_error) {
            const error = document.createElement("div");
            error.className = "cron-job-error";
            error.textContent = `错误: ${job.last_error}`;
            container.appendChild(error);
        }

        return container;
    }

    function buildCronBadge(text, kind) {
        const badge = document.createElement("span");
        badge.className = `cron-badge cron-badge-${kind}`;
        badge.textContent = text;
        return badge;
    }

    function buildCronMetaText(text) {
        const item = document.createElement("span");
        item.textContent = text;
        return item;
    }

    function buildCronLastStatusLabel(status) {
        if (status === "ok") {
            return "最近成功";
        }
        if (status === "error") {
            return "最近失败";
        }
        if (status === "running") {
            return "运行中";
        }
        if (status === "skipped") {
            return "已跳过";
        }
        return "暂无状态";
    }

    function cronStatusClassName(status) {
        if (status === "ok") {
            return "ok";
        }
        if (status === "error") {
            return "error";
        }
        if (status === "running") {
            return "running";
        }
        return "idle";
    }

    return {
        handleCronPanelToggle,
        refreshCronPanel,
    };
}
