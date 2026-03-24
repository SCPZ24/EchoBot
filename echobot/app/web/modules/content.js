export const TEXT_CONTENT_BLOCK_TYPE = "text";
export const IMAGE_URL_CONTENT_BLOCK_TYPE = "image_url";
export const FILE_ATTACHMENT_CONTENT_BLOCK_TYPE = "file_attachment";

export function buildUserMessageContent(text, imageUrls = [], fileAttachments = []) {
    const cleanedText = String(text || "").trim();
    const cleanedImageUrls = imageUrls
        .map((image) => normalizeImageInput(image))
        .filter(Boolean);
    const cleanedFileAttachments = fileAttachments
        .map((fileAttachment) => normalizeFileAttachmentInput(fileAttachment))
        .filter(Boolean);

    if (cleanedImageUrls.length === 0 && cleanedFileAttachments.length === 0) {
        return cleanedText;
    }

    const blocks = [];
    if (cleanedText) {
        blocks.push({
            type: TEXT_CONTENT_BLOCK_TYPE,
            text: cleanedText,
        });
    }

    cleanedFileAttachments.forEach((fileAttachment) => {
        blocks.push({
            type: FILE_ATTACHMENT_CONTENT_BLOCK_TYPE,
            file_attachment: fileAttachment,
        });
    });

    cleanedImageUrls.forEach((imageUrl) => {
        blocks.push({
            type: IMAGE_URL_CONTENT_BLOCK_TYPE,
            image_url: imageUrl,
        });
    });
    return blocks;
}

export function normalizeMessageContent(content) {
    if (!Array.isArray(content)) {
        return String(content ?? "");
    }

    return content
        .filter((block) => block && typeof block === "object" && !Array.isArray(block))
        .map((block) => {
            const nextBlock = { ...block };
            if (block.image_url && typeof block.image_url === "object") {
                nextBlock.image_url = { ...block.image_url };
            }
            if (block.file_attachment && typeof block.file_attachment === "object") {
                nextBlock.file_attachment = { ...block.file_attachment };
            }
            return nextBlock;
        });
}

export function messageContentImageUrls(content) {
    const normalized = normalizeMessageContent(content);
    if (!Array.isArray(normalized)) {
        return [];
    }

    return normalized
        .filter((block) => String(block.type || "").trim() === IMAGE_URL_CONTENT_BLOCK_TYPE)
        .map((block) => String(block.image_url?.preview_url || block.image_url?.url || "").trim())
        .filter(Boolean);
}

export function messageContentToText(content, options = {}) {
    const normalized = normalizeMessageContent(content);
    const includeImageMarker = options.includeImageMarker !== false;

    if (!Array.isArray(normalized)) {
        return normalized;
    }

    const parts = [];
    normalized.forEach((block) => {
        const blockType = String(block.type || "").trim();
        if (blockType === TEXT_CONTENT_BLOCK_TYPE) {
            const text = String(block.text || "").trim();
            if (text) {
                parts.push(text);
            }
            return;
        }
        if (blockType === IMAGE_URL_CONTENT_BLOCK_TYPE) {
            if (includeImageMarker) {
                parts.push("[image]");
            }
            return;
        }
        if (blockType === FILE_ATTACHMENT_CONTENT_BLOCK_TYPE) {
            const fileName = String(block.file_attachment?.name || "").trim();
            if (fileName) {
                parts.push(`file: ${fileName}`);
            } else {
                parts.push("[file]");
            }
            return;
        }
        if (blockType) {
            parts.push(`[${blockType}]`);
        }
    });

    return parts.join("\n\n");
}

export function messageContentEquals(left, right) {
    return JSON.stringify(normalizeMessageContent(left)) === JSON.stringify(normalizeMessageContent(right));
}

export function hasMessageContent(content) {
    const text = messageContentToText(content, { includeImageMarker: false }).trim();
    return Boolean(text) || messageContentImageUrls(content).length > 0;
}

function normalizeImageInput(image) {
    if (image && typeof image === "object" && !Array.isArray(image)) {
        const url = String(image.url || "").trim();
        if (!url) {
            return null;
        }
        const normalized = { url: url };
        const previewUrl = String(image.preview_url || "").trim();
        if (previewUrl) {
            normalized.preview_url = previewUrl;
        }
        const attachmentId = String(image.attachment_id || "").trim();
        if (attachmentId) {
            normalized.attachment_id = attachmentId;
        }
        return normalized;
    }

    const url = String(image || "").trim();
    if (!url) {
        return null;
    }
    return { url: url };
}

function normalizeFileAttachmentInput(fileAttachment) {
    if (!fileAttachment || typeof fileAttachment !== "object" || Array.isArray(fileAttachment)) {
        return null;
    }

    const name = String(fileAttachment.name || "").trim();
    const attachmentId = String(fileAttachment.attachment_id || fileAttachment.attachmentId || "").trim();
    const downloadUrl = String(fileAttachment.download_url || fileAttachment.downloadUrl || "").trim();
    const workspacePath = String(fileAttachment.workspace_path || fileAttachment.workspacePath || "").trim();
    const contentType = String(fileAttachment.content_type || fileAttachment.contentType || "").trim();
    const sizeBytes = Number(fileAttachment.size_bytes || fileAttachment.sizeBytes || 0);

    if (!name && !attachmentId && !downloadUrl && !workspacePath) {
        return null;
    }

    const normalized = {
        name: name || "file",
    };
    if (attachmentId) {
        normalized.attachment_id = attachmentId;
    }
    if (downloadUrl) {
        normalized.download_url = downloadUrl;
    }
    if (workspacePath) {
        normalized.workspace_path = workspacePath;
    }
    if (contentType) {
        normalized.content_type = contentType;
    }
    if (Number.isFinite(sizeBytes) && sizeBytes > 0) {
        normalized.size_bytes = Math.round(sizeBytes);
    }
    return normalized;
}
