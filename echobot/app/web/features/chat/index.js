import { createComposerAttachmentsController } from "./composer-attachments.js";
import { createChatRunner } from "./job-runner.js";

export function createChatModule(deps) {
    const composer = createComposerAttachmentsController(deps);
    const runner = createChatRunner({
        ...deps,
        clearComposerAttachments: composer.clearComposerAttachments,
    });

    return {
        ...composer,
        ...runner,
    };
}
