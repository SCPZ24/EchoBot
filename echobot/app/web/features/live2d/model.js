import { DEFAULT_LIP_SYNC_IDS, appState, live2dState } from "../../core/store.js";

export function createLive2DModelController(deps) {
    const {
        clamp,
        roundTo,
        readJson,
        removeStoredValue,
        setStageMessage,
        writeJson,
    } = deps;

    async function loadLive2DModel(live2dConfig) {
        if (!live2dConfig.available || !live2dConfig.model_url) {
            disposeCurrentLive2DModel();
            setStageMessage("未找到 Live2D 模型。请检查 .echobot/live2d 目录。");
            return false;
        }

        const loadToken = ++live2dState.live2dLoadToken;
        setStageMessage("正在加载 Live2D 模型…");

        try {
            const model = await window.PIXI.live2d.Live2DModel.from(live2dConfig.model_url, {
                autoInteract: false,
            });
            if (loadToken !== live2dState.live2dLoadToken) {
                destroyLive2DModel(model);
                return false;
            }

            disposeCurrentLive2DModel();
            live2dState.live2dModel = model;
            if (live2dState.live2dCharacterLayer) {
                live2dState.live2dCharacterLayer.addChild(model);
            } else {
                live2dState.live2dStage.addChild(model);
            }

            model.anchor.set(0.5, 0.5);
            model.cursor = "grab";
            model.interactive = true;

            applyLive2DMouseFollowSetting();
            bindLive2DDrag(model);
            attachLipSyncHook(model, live2dConfig);
            resetLive2DView();

            setStageMessage("");
            return true;
        } catch (error) {
            console.error(error);
            if (loadToken === live2dState.live2dLoadToken) {
                setStageMessage(`Failed to load model: ${error.message || error}`);
            }
            throw new Error(`Failed to load Live2D model: ${error.message || error}`);
        }
    }

    function bindLive2DDrag(model) {
        unbindLive2DDrag();

        const pointerDown = (event) => {
            const point = event.data.getLocalPosition(live2dState.live2dStage);
            live2dState.dragging = true;
            live2dState.dragPointerId = event.data.pointerId;
            live2dState.dragOffsetX = model.x - point.x;
            live2dState.dragOffsetY = model.y - point.y;
            model.cursor = "grabbing";
        };

        const pointerMove = (event) => {
            if (!live2dState.dragging || event.data.pointerId !== live2dState.dragPointerId) {
                return;
            }

            const point = event.data.getLocalPosition(live2dState.live2dStage);
            model.x = point.x + live2dState.dragOffsetX;
            model.y = point.y + live2dState.dragOffsetY;
            refreshLive2DFocusFromLastPointer();
            persistLive2DTransform();
        };

        const stopDragging = () => {
            if (!live2dState.dragging) {
                return;
            }

            live2dState.dragging = false;
            live2dState.dragPointerId = null;
            model.cursor = "grab";
            persistLive2DTransform();
        };

        model.on("pointerdown", pointerDown);
        live2dState.live2dStage.on("pointermove", pointerMove);
        live2dState.live2dStage.on("pointerup", stopDragging);
        live2dState.live2dStage.on("pointerupoutside", stopDragging);
        live2dState.live2dStage.on("pointerleave", stopDragging);

        live2dState.live2dDragModel = model;
        live2dState.live2dDragHandlers = {
            pointerDown: pointerDown,
            pointerMove: pointerMove,
            stopDragging: stopDragging,
        };
    }

    function unbindLive2DDrag() {
        if (!live2dState.live2dDragHandlers || !live2dState.live2dStage) {
            return;
        }

        if (live2dState.live2dDragModel && typeof live2dState.live2dDragModel.off === "function") {
            live2dState.live2dDragModel.off("pointerdown", live2dState.live2dDragHandlers.pointerDown);
        }

        live2dState.live2dStage.off("pointermove", live2dState.live2dDragHandlers.pointerMove);
        live2dState.live2dStage.off("pointerup", live2dState.live2dDragHandlers.stopDragging);
        live2dState.live2dStage.off("pointerupoutside", live2dState.live2dDragHandlers.stopDragging);
        live2dState.live2dStage.off("pointerleave", live2dState.live2dDragHandlers.stopDragging);

        live2dState.live2dDragModel = null;
        live2dState.live2dDragHandlers = null;
    }

    function bindLive2DFocus() {
        unbindLive2DFocus();

        if (!live2dState.live2dStage) {
            return;
        }

        const pointerMove = (event) => {
            const globalPoint = event && event.data ? event.data.global : null;
            if (!globalPoint) {
                return;
            }

            live2dState.live2dLastPointerX = globalPoint.x;
            live2dState.live2dLastPointerY = globalPoint.y;
            updateLive2DFocusFromGlobalPoint(globalPoint.x, globalPoint.y);
        };

        live2dState.live2dStage.on("pointermove", pointerMove);
        live2dState.live2dFocusHandlers = {
            pointerMove: pointerMove,
        };
        refreshLive2DFocusFromLastPointer();
    }

    function unbindLive2DFocus() {
        if (!live2dState.live2dFocusHandlers || !live2dState.live2dStage) {
            return;
        }

        live2dState.live2dStage.off("pointermove", live2dState.live2dFocusHandlers.pointerMove);
        live2dState.live2dFocusHandlers = null;
    }

    function refreshLive2DFocusFromLastPointer() {
        if (
            !live2dState.live2dMouseFollowEnabled
            || !Number.isFinite(live2dState.live2dLastPointerX)
            || !Number.isFinite(live2dState.live2dLastPointerY)
        ) {
            return;
        }

        updateLive2DFocusFromGlobalPoint(
            live2dState.live2dLastPointerX,
            live2dState.live2dLastPointerY,
        );
    }

    function updateLive2DFocusFromGlobalPoint(globalX, globalY) {
        const model = live2dState.live2dModel;
        const internalModel = model && model.internalModel;
        if (
            !model
            || !internalModel
            || !internalModel.focusController
            || typeof internalModel.focusController.focus !== "function"
        ) {
            return;
        }

        const localPoint = toLive2DModelPoint(model, globalX, globalY);
        if (!localPoint) {
            return;
        }

        const rawFocusX = normalizeLive2DFocusAxis(
            localPoint.x,
            0,
            internalModel.originalWidth,
        );
        const visibleVerticalBounds = resolveVisibleLive2DVerticalBounds(model);
        const rawFocusY = visibleVerticalBounds
            ? normalizeLive2DFocusAxis(
                localPoint.y,
                visibleVerticalBounds.top,
                visibleVerticalBounds.bottom,
            )
            : normalizeLive2DFocusAxis(
                localPoint.y,
                0,
                internalModel.originalHeight,
            );

        applyLive2DFocusTarget(
            internalModel.focusController,
            rawFocusX,
            rawFocusY,
        );
    }

    function toLive2DModelPoint(model, globalX, globalY) {
        if (
            !window.PIXI
            || typeof window.PIXI.Point !== "function"
            || typeof model.toModelPosition !== "function"
        ) {
            return null;
        }

        const globalPoint = new window.PIXI.Point(globalX, globalY);
        return model.toModelPosition(globalPoint, new window.PIXI.Point());
    }

    function resolveVisibleLive2DVerticalBounds(model) {
        if (!live2dState.pixiApp || typeof model.getBounds !== "function") {
            return null;
        }

        const modelBounds = model.getBounds();
        const screen = live2dState.pixiApp.screen;
        if (
            !modelBounds
            || modelBounds.width <= 0
            || modelBounds.height <= 0
            || screen.width <= 0
            || screen.height <= 0
        ) {
            return null;
        }

        const visibleLeft = Math.max(modelBounds.x, screen.x);
        const visibleTop = Math.max(modelBounds.y, screen.y);
        const visibleRight = Math.min(
            modelBounds.x + modelBounds.width,
            screen.x + screen.width,
        );
        const visibleBottom = Math.min(
            modelBounds.y + modelBounds.height,
            screen.y + screen.height,
        );

        if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) {
            return null;
        }

        const topPoint = toLive2DModelPoint(model, visibleLeft, visibleTop);
        const bottomPoint = toLive2DModelPoint(model, visibleLeft, visibleBottom);
        if (!topPoint || !bottomPoint) {
            return null;
        }

        const top = Math.min(topPoint.y, bottomPoint.y);
        const bottom = Math.max(topPoint.y, bottomPoint.y);
        if (bottom - top <= 0.0001) {
            return null;
        }

        return {
            top: top,
            bottom: bottom,
        };
    }

    function normalizeLive2DFocusAxis(value, min, max) {
        const span = max - min;
        if (!Number.isFinite(span) || Math.abs(span) <= 0.0001) {
            return 0;
        }

        return clamp(((value - min) / span) * 2 - 1, -1, 1);
    }

    function applyLive2DFocusTarget(focusController, rawX, rawY) {
        const distance = Math.hypot(rawX, rawY);
        if (!Number.isFinite(distance) || distance <= 0.0001) {
            focusController.focus(0, 0);
            return;
        }

        focusController.focus(rawX / distance, -rawY / distance);
    }

    function attachLipSyncHook(model, live2dConfig) {
        detachLive2DLipSyncHook();

        const internalModel = model.internalModel;
        if (!internalModel || typeof internalModel.on !== "function") {
            return;
        }

        live2dState.lipSyncHook = function () {
            applyMouthValue(live2dConfig, live2dState.currentMouthValue);
        };
        internalModel.on("beforeModelUpdate", live2dState.lipSyncHook);
        live2dState.live2dInternalModel = internalModel;
    }

    function applyLive2DMouseFollowSetting() {
        const model = live2dState.live2dModel;
        if (!model) {
            return;
        }

        model.interactive = true;
        model.autoInteract = false;
        if (typeof model.unregisterInteraction === "function") {
            model.unregisterInteraction();
        }

        if (!live2dState.live2dMouseFollowEnabled) {
            unbindLive2DFocus();
            resetLive2DFocus();
            return;
        }

        bindLive2DFocus();
    }

    function resetLive2DFocus() {
        const internalModel = live2dState.live2dModel && live2dState.live2dModel.internalModel;
        if (
            !internalModel
            || !internalModel.focusController
            || typeof internalModel.focusController.focus !== "function"
        ) {
            return;
        }

        internalModel.focusController.focus(0, 0, true);
    }

    function detachLive2DLipSyncHook() {
        if (
            live2dState.live2dInternalModel
            && live2dState.lipSyncHook
            && typeof live2dState.live2dInternalModel.off === "function"
        ) {
            live2dState.live2dInternalModel.off("beforeModelUpdate", live2dState.lipSyncHook);
        }

        live2dState.live2dInternalModel = null;
        live2dState.lipSyncHook = null;
    }

    function disposeCurrentLive2DModel() {
        unbindLive2DDrag();
        unbindLive2DFocus();
        detachLive2DLipSyncHook();

        if (live2dState.live2dCharacterLayer) {
            live2dState.live2dCharacterLayer.removeChildren();
        } else if (live2dState.live2dStage) {
            live2dState.live2dStage.removeChildren();
        }

        if (live2dState.live2dModel) {
            destroyLive2DModel(live2dState.live2dModel);
        }

        live2dState.live2dModel = null;
        live2dState.dragging = false;
        live2dState.dragPointerId = null;
    }

    function destroyLive2DModel(model) {
        if (!model || typeof model.destroy !== "function") {
            return;
        }

        try {
            model.destroy({
                children: true,
            });
        } catch (error) {
            console.warn("Failed to destroy Live2D model", error);
        }
    }

    function handleStageWheel(event) {
        if (!live2dState.live2dModel) {
            return;
        }

        event.preventDefault();
        const scaleStep = event.deltaY < 0 ? 1.06 : 0.94;
        const nextScale = clamp(
            live2dState.live2dModel.scale.x * scaleStep,
            0.08,
            3.2,
        );
        live2dState.live2dModel.scale.set(nextScale);
        refreshLive2DFocusFromLastPointer();
        persistLive2DTransform();
    }

    function resetLive2DView() {
        const model = live2dState.live2dModel;
        if (!model || !live2dState.pixiApp) {
            return;
        }

        const savedTransform = loadSavedLive2DTransform();
        if (savedTransform) {
            model.position.set(savedTransform.x, savedTransform.y);
            model.scale.set(savedTransform.scale);
            refreshLive2DFocusFromLastPointer();
            return;
        }

        applyDefaultLive2DTransform(model);
        refreshLive2DFocusFromLastPointer();
        persistLive2DTransform();
    }

    function resetLive2DViewToDefault() {
        const model = live2dState.live2dModel;
        if (!model || !live2dState.pixiApp) {
            return;
        }

        clearSavedLive2DTransform();
        applyDefaultLive2DTransform(model);
        refreshLive2DFocusFromLastPointer();
        persistLive2DTransform();
    }

    function applyDefaultLive2DTransform(model) {
        const stageWidth = live2dState.pixiApp.screen.width;
        const stageHeight = live2dState.pixiApp.screen.height;
        const baseSize = measureLive2DBaseSize(model);
        const widthRatio = stageWidth / Math.max(baseSize.width, 1);
        const heightRatio = stageHeight / Math.max(baseSize.height, 1);
        const nextScale = Math.min(widthRatio, heightRatio) * 0.82;

        model.scale.set(nextScale);
        model.position.set(stageWidth * 0.5, stageHeight * 0.62);
    }

    function measureLive2DBaseSize(model) {
        if (typeof model.getLocalBounds === "function") {
            const bounds = model.getLocalBounds();
            if (bounds && bounds.width > 0 && bounds.height > 0) {
                return {
                    width: bounds.width,
                    height: bounds.height,
                };
            }
        }

        const scaleX = Math.max(Math.abs(model.scale.x) || 0, 0.0001);
        const scaleY = Math.max(Math.abs(model.scale.y) || 0, 0.0001);
        return {
            width: model.width / scaleX,
            height: model.height / scaleY,
        };
    }

    function persistLive2DTransform() {
        const model = live2dState.live2dModel;
        if (!model) {
            return;
        }

        writeJson(live2dStorageKey(), {
            x: roundTo(model.x, 2),
            y: roundTo(model.y, 2),
            scale: roundTo(model.scale.x, 4),
        });
    }

    function loadSavedLive2DTransform() {
        const payload = readJson(live2dStorageKey());
        if (
            payload
            && typeof payload.x === "number"
            && typeof payload.y === "number"
            && typeof payload.scale === "number"
        ) {
            return payload;
        }

        return null;
    }

    function clearSavedLive2DTransform() {
        removeStoredValue(live2dStorageKey());
    }

    function live2dStorageKey() {
        const selectionKey = appState.config && appState.config.live2d
            ? (appState.config.live2d.selection_key || appState.config.live2d.model_url)
            : "default";
        return `echobot.web.live2d.${selectionKey}`;
    }

    function applyMouthValue(live2dConfig, value) {
        if (!live2dConfig || !live2dState.live2dModel || !live2dState.live2dModel.internalModel) {
            return;
        }

        const coreModel = live2dState.live2dModel.internalModel.coreModel;
        if (!coreModel || typeof coreModel.setParameterValueById !== "function") {
            return;
        }

        const lipSyncIds = (live2dConfig.lip_sync_parameter_ids || []).length > 0
            ? live2dConfig.lip_sync_parameter_ids
            : DEFAULT_LIP_SYNC_IDS;

        lipSyncIds.forEach((parameterId) => {
            try {
                coreModel.setParameterValueById(parameterId, value);
            } catch (error) {
                console.warn(`Failed to update lip sync parameter ${parameterId}`, error);
            }
        });

        if (live2dConfig.mouth_form_parameter_id) {
            try {
                coreModel.setParameterValueById(live2dConfig.mouth_form_parameter_id, 0);
            } catch (error) {
                console.warn("Failed to reset mouth form parameter", error);
            }
        }
    }

    return {
        applyLive2DMouseFollowSetting,
        applyMouthValue,
        handleStageWheel,
        loadLive2DModel,
        refreshLive2DFocusFromLastPointer,
        resetLive2DViewToDefault,
    };
}
