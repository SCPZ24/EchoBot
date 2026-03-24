import { DOM } from "../../core/dom.js";
import { readJson, removeStoredValue, writeJson } from "../../core/storage.js";
import { createStageBackgroundController } from "./backgrounds.js";
import { createLive2DConfigController } from "./config.js";
import { createStageEffectsController } from "./effects.js";
import { createLive2DModelController } from "./model.js";
import { createLive2DSceneController } from "./scene.js";

export function createLive2DModule(deps) {
    const {
        clamp,
        roundTo,
        responseToError,
        setRunStatus,
    } = deps;

    function setStageMessage(text) {
        const message = String(text || "").trim();
        if (!DOM.stageMessage) {
            return;
        }

        DOM.stageMessage.textContent = message;
        DOM.stageMessage.hidden = message === "";
    }

    let sceneController = null;

    const effectsController = createStageEffectsController({
        clamp,
        roundTo,
        setRunStatus,
        applyStageLightingVars(...args) {
            sceneController?.applyStageLightingVars(...args);
        },
        updateStageAtmosphereFrame(...args) {
            sceneController?.updateStageAtmosphereFrame(...args);
        },
    });

    const backgroundController = createStageBackgroundController({
        clamp,
        roundTo,
        responseToError,
        setRunStatus,
        applyStageEffectsToRuntime(...args) {
            effectsController.applyStageEffectsToRuntime(...args);
        },
    });

    const modelController = createLive2DModelController({
        clamp,
        roundTo,
        readJson,
        removeStoredValue,
        setStageMessage,
        writeJson,
    });

    sceneController = createLive2DSceneController({
        clamp,
        roundTo,
        applyStageEffectsSettings(...args) {
            effectsController.applyStageEffectsSettings(...args);
        },
        applyStageBackgroundTransform(...args) {
            backgroundController.applyStageBackgroundTransform(...args);
        },
        currentStageBackgroundOption(...args) {
            return backgroundController.currentStageBackgroundOption(...args);
        },
        refreshLive2DFocusFromLastPointer(...args) {
            modelController.refreshLive2DFocusFromLastPointer(...args);
        },
        syncPixiStageBackground(...args) {
            return backgroundController.syncPixiStageBackground(...args);
        },
    });

    const configController = createLive2DConfigController({
        responseToError,
        setRunStatus,
        setStageMessage,
        applyLive2DMouseFollowSetting(...args) {
            modelController.applyLive2DMouseFollowSetting(...args);
        },
        applyStageBackgroundByKey(...args) {
            backgroundController.applyStageBackgroundByKey(...args);
        },
        applyStageEffectsSettings(...args) {
            effectsController.applyStageEffectsSettings(...args);
        },
        buildStageConfig(...args) {
            return backgroundController.normalizeStageConfig(...args);
        },
        loadLive2DModel(...args) {
            return modelController.loadLive2DModel(...args);
        },
        loadSavedStageEffectsSettings(...args) {
            return effectsController.loadSavedStageEffectsSettings(...args);
        },
        renderStageBackgroundOptions(...args) {
            backgroundController.renderStageBackgroundOptions(...args);
        },
        resolveInitialStageBackgroundKey(...args) {
            return backgroundController.resolveInitialStageBackgroundKey(...args);
        },
    });

    return {
        applyConfigToUI: configController.applyConfigToUI,
        applyLive2DMouseFollowSetting: modelController.applyLive2DMouseFollowSetting,
        applyMouthValue: modelController.applyMouthValue,
        handleLive2DDirectoryUpload: configController.handleLive2DDirectoryUpload,
        handleLive2DModelChange: configController.handleLive2DModelChange,
        handleMouseFollowToggle: configController.handleMouseFollowToggle,
        handleStageBackgroundChange: backgroundController.handleStageBackgroundChange,
        handleStageBackgroundReset: backgroundController.handleStageBackgroundReset,
        handleStageBackgroundTransformInput: backgroundController.handleStageBackgroundTransformInput,
        handleStageBackgroundTransformReset: backgroundController.handleStageBackgroundTransformReset,
        handleStageBackgroundUpload: backgroundController.handleStageBackgroundUpload,
        handleStageEffectsInput: effectsController.handleStageEffectsInput,
        handleStageEffectsReset: effectsController.handleStageEffectsReset,
        handleStageWheel: modelController.handleStageWheel,
        initializePixiApplication: sceneController.initializePixiApplication,
        loadLive2DModel: modelController.loadLive2DModel,
        resetLive2DViewToDefault: modelController.resetLive2DViewToDefault,
        setStageMessage,
    };
}
