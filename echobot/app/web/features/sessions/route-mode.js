const ROUTE_MODE_VALUES = new Set(["auto", "chat_only", "force_agent"]);

export function normalizeRouteMode(routeMode) {
    const value = String(routeMode || "").trim().toLowerCase();
    return ROUTE_MODE_VALUES.has(value) ? value : "auto";
}

export function routeModeLabel(routeMode) {
    if (routeMode === "chat_only") {
        return "纯聊天";
    }
    if (routeMode === "force_agent") {
        return "强制 Agent";
    }
    return "自动决策";
}
