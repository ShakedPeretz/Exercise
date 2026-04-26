Java.perform(function () {
    const FLAG_SECURE = 0x2000;
    const Window   = Java.use("android.view.Window");
    const Runnable = Java.use("java.lang.Runnable");

    Window.setFlags.implementation = function (flags, mask) {
        return this.setFlags(flags & ~FLAG_SECURE, mask & ~FLAG_SECURE);
    };

    Window.addFlags.implementation = function (flags) {
        return this.addFlags(flags & ~FLAG_SECURE);
    };

    const ClearSecure = Java.registerClass({
        name: "com.bypass.ClearSecureRunnable",
        implements: [Runnable],
        fields: { activity: "android.app.Activity" },
        methods: {
            run: function () {
                this.activity.value.getWindow().clearFlags(FLAG_SECURE);
            }
        }
    });

    Java.choose("android.app.Activity", {
        onMatch: function (activity) {
            const r = ClearSecure.$new();
            r.activity.value = activity;
            activity.runOnUiThread(r);
        },
        onComplete: function () {}
    });
});
