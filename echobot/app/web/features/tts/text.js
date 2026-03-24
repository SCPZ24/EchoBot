import {
    TTS_STREAM_MAX_SEGMENT_LENGTH,
    TTS_STREAM_SENTENCE_BATCH_SIZE,
} from "../../core/store.js";

const EMOJI_PATTERN = /[\u200D\u20E3\uFE0E\uFE0F\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;

export function prepareTextForTts(text) {
    return String(text || "")
        .replace(/\r\n?/g, "\n")
        .replace(/^\s*(```|~~~)[^\n]*$/gm, "")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
        .replace(/^\s{0,3}#{1,6}\s+/gm, "")
        .replace(/^\s*>\s?/gm, "")
        .replace(/^\s*[-*+]\s+/gm, "")
        .replace(/^\s*\d+[.)]\s+/gm, "")
        .replace(/[*_~]/g, "")
        .replace(EMOJI_PATTERN, " ")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
}

export function drainSpeechSessionSegments(speechSession, forceFlush, enqueueSegment) {
    while (true) {
        const segmentText = takeNextSpeechSegment(speechSession, forceFlush);
        if (!segmentText) {
            break;
        }

        enqueueSegment(segmentText);
        speechSession.nextSentenceTarget = TTS_STREAM_SENTENCE_BATCH_SIZE;
    }
}

function takeNextSpeechSegment(speechSession, forceFlush) {
    const pendingText = speechSession.pendingText;
    if (!pendingText.trim()) {
        speechSession.pendingText = "";
        return "";
    }

    const sentenceBoundaryIndex = findNthSentenceBoundaryIndex(
        pendingText,
        speechSession.nextSentenceTarget,
    );

    let splitIndex = -1;
    if (
        sentenceBoundaryIndex !== -1
        && sentenceBoundaryIndex <= TTS_STREAM_MAX_SEGMENT_LENGTH
    ) {
        splitIndex = sentenceBoundaryIndex;
    } else if (pendingText.length >= TTS_STREAM_MAX_SEGMENT_LENGTH) {
        splitIndex = findForcedSpeechSplitIndex(
            pendingText,
            TTS_STREAM_MAX_SEGMENT_LENGTH,
        );
    } else if (forceFlush) {
        splitIndex = sentenceBoundaryIndex !== -1
            ? sentenceBoundaryIndex
            : pendingText.length;
    }

    if (splitIndex <= 0) {
        return "";
    }

    const segmentText = pendingText.slice(0, splitIndex).trim();
    speechSession.pendingText = pendingText.slice(splitIndex);
    return segmentText;
}

function findNthSentenceBoundaryIndex(text, targetCount) {
    let seenBoundaries = 0;

    for (let index = 0; index < text.length; index += 1) {
        if (!isSentenceBoundaryAt(text, index)) {
            continue;
        }

        seenBoundaries += 1;
        if (seenBoundaries === targetCount) {
            return consumeSplitSuffix(text, index);
        }
    }

    return -1;
}

function findForcedSpeechSplitIndex(text, maxLength) {
    const limit = Math.min(maxLength, text.length);

    for (let index = limit - 1; index >= 0; index -= 1) {
        if (isSentenceBoundaryAt(text, index)) {
            return consumeSplitSuffix(text, index);
        }
    }

    for (let index = limit - 1; index >= 0; index -= 1) {
        if (isSoftSpeechSplitCharacter(text[index])) {
            return consumeSplitSuffix(text, index);
        }
    }

    for (let index = limit - 1; index >= 0; index -= 1) {
        if (/\s/.test(text[index])) {
            return index + 1;
        }
    }

    return limit;
}

function isSentenceBoundaryAt(text, index) {
    const character = text[index];
    if (!".!?。！？；;".includes(character)) {
        return false;
    }

    if (character === ".") {
        const previous = text[index - 1] || "";
        const next = text[index + 1] || "";
        if (/\d/.test(previous) && /\d/.test(next)) {
            return false;
        }
        if (previous === "." || next === ".") {
            return false;
        }
    }

    return true;
}

function isSoftSpeechSplitCharacter(character) {
    return ",，、:\n".includes(character);
}

function consumeSplitSuffix(text, index) {
    let nextIndex = index + 1;

    while (nextIndex < text.length && "\"'”’》）」】".includes(text[nextIndex])) {
        nextIndex += 1;
    }
    while (nextIndex < text.length && /\s/.test(text[nextIndex])) {
        nextIndex += 1;
    }

    return nextIndex;
}
