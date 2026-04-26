Java.perform(function () {
    const KG   = Java.use("runtime.keyboardGuard.KeyboardGuard");
    const KGHH = Java.use("runtime.keyboardGuard.KeyboardGuard$KeyboardGuardHookHandler");
    const KGT  = Java.use("runtime.keyboardGuard.KeyboardGuard$KeyboardGuardThread");
    const NB   = Java.use("runtime.loading.NativeBridge");

    KG.isIllegalKeyboard.implementation = function () {
        return false;
    };

    KGHH.handleMessage.implementation = function () {
        return false;
    };

    KGT.run.implementation = function () {};

    NB.shouldBlockEvent.implementation = function (eventId) {
        if (eventId === "b96e7a45095f5ed683d3169f4c7196ee") {
            return false;
        }
        return this.shouldBlockEvent(eventId);
    };
});
