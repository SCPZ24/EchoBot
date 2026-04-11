import test from "node:test";
import assert from "node:assert/strict";

const documentStub = {
    getElementById() {
        return null;
    },
};

globalThis.document = documentStub;
globalThis.window = {
    localStorage: {
        getItem() {
            return null;
        },
        setItem() {},
        removeItem() {},
    },
    PIXI: {
        Point: class {
            constructor(x = 0, y = 0) {
                this.x = x;
                this.y = y;
            }
        },
    },
};

test("applyExternalFocusPoint stores pointer coordinates and updates focus", async () => {
    const { live2dState } = await import("../echobot/app/web/core/store.js");
    const { createLive2DModelController } = await import(
        "../echobot/app/web/features/live2d/model.js"
    );

    const originalModel = live2dState.live2dModel;
    const originalPixiApp = live2dState.pixiApp;
    const originalPointerX = live2dState.live2dLastPointerX;
    const originalPointerY = live2dState.live2dLastPointerY;
    const originalMouseFollowEnabled = live2dState.live2dMouseFollowEnabled;

    let focused = null;
    live2dState.live2dModel = {
        internalModel: {
            originalWidth: 100,
            originalHeight: 200,
            focusController: {
                focus(x, y) {
                    focused = { x, y };
                },
            },
        },
        toModelPosition(point) {
            return {
                x: point.x,
                y: point.y,
            };
        },
        getBounds() {
            return {
                x: 0,
                y: 0,
                width: 100,
                height: 200,
            };
        },
    };
    live2dState.pixiApp = {
        screen: {
            x: 0,
            y: 0,
            width: 100,
            height: 200,
        },
    };
    live2dState.live2dLastPointerX = null;
    live2dState.live2dLastPointerY = null;
    live2dState.live2dMouseFollowEnabled = true;

    try {
        const controller = createLive2DModelController({
            clamp(value, min, max) {
                return Math.min(Math.max(value, min), max);
            },
            roundTo(value) {
                return value;
            },
            readJson() {
                return null;
            },
            removeStoredValue() {},
            setStageMessage() {},
            writeJson() {},
        });

        controller.applyExternalFocusPoint(75, 100);

        assert.equal(live2dState.live2dLastPointerX, 75);
        assert.equal(live2dState.live2dLastPointerY, 100);
        assert.equal(focused.x, 1);
        assert.equal(Math.abs(focused.y), 0);
    } finally {
        live2dState.live2dModel = originalModel;
        live2dState.pixiApp = originalPixiApp;
        live2dState.live2dLastPointerX = originalPointerX;
        live2dState.live2dLastPointerY = originalPointerY;
        live2dState.live2dMouseFollowEnabled = originalMouseFollowEnabled;
    }
});
