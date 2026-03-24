export function readBoolean(key, fallback = false) {
    const rawValue = window.localStorage.getItem(key);
    if (rawValue === null) {
        return fallback;
    }
    return rawValue === "true";
}

export function writeBoolean(key, value) {
    window.localStorage.setItem(key, String(Boolean(value)));
}

export function readString(key, fallback = "") {
    const rawValue = window.localStorage.getItem(key);
    if (rawValue === null) {
        return fallback;
    }
    return String(rawValue);
}

export function writeString(key, value) {
    window.localStorage.setItem(key, String(value ?? ""));
}

export function readJson(key, fallback = null) {
    const rawValue = window.localStorage.getItem(key);
    if (!rawValue) {
        return fallback;
    }

    try {
        return JSON.parse(rawValue);
    } catch (_error) {
        return fallback;
    }
}

export function writeJson(key, value) {
    window.localStorage.setItem(key, JSON.stringify(value));
}

export function removeStoredValue(key) {
    window.localStorage.removeItem(key);
}
