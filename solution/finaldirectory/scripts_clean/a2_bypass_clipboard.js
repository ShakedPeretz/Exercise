Java.perform(function () {
    const NB = Java.use("runtime.loading.NativeBridge");

    NB.handleClipboard.implementation = function (bytes, len, encrypt) {
        return bytes;
    };
});
