/*
 * bypass_a3_flag_secure.js — A3: Prevent App Screen Sharing bypass
 *
 * Target: Appdome-protected TimeCard app (com.hartman.timecard) on Samsung Galaxy S21+.
 * Protection: WindowManager.LayoutParams.FLAG_SECURE (0x2000), which blocks:
 *   - adb screencap / screenrecord
 *   - MediaProjection-based capture (RAT / screen-recording malware)
 *   - Hardware mirroring (Chromecast / Miracast / Samsung Smart View)
 *   - Recents-screen thumbnail (replaced with placeholder when FLAG_SECURE is set)
 *
 * Strategy: strip bit 0x2000 on every surface the app can set the flag through.
 *   1) Window.setFlags(flags, mask)   — most common call path
 *   2) Window.addFlags(flags)          — convenience wrapper over setFlags
 *   3) WindowManager$LayoutParams.flags field — used when LayoutParams is built directly
 *      (e.g. dialogs, PopupWindow, overlay views that bypass setFlags)
 *
 * Usage:
 *   frida -U -f com.hartman.timecard -l scripts/bypass_a3_flag_secure.js --no-pause
 * (spawn — not attach — so we catch FLAG_SECURE set during onCreate)
 */

Java.perform(function () {
    var FLAG_SECURE = 0x2000;
    var stripped = 0;

    // 1) Window.setFlags(int flags, int mask)
    try {
        var Window = Java.use("android.view.Window");
        Window.setFlags.implementation = function (flags, mask) {
            var had = (flags & FLAG_SECURE) !== 0 || (mask & FLAG_SECURE) !== 0;
            if (had) {
                stripped++;
                console.log("[WIN] setFlags: stripped FLAG_SECURE (call #" + stripped +
                            ", flags=0x" + flags.toString(16) + ", mask=0x" + mask.toString(16) + ")");
            }
            return this.setFlags(flags & ~FLAG_SECURE, mask & ~FLAG_SECURE);
        };
        console.log("[+] Hook installed: android.view.Window.setFlags");
    } catch (e) {
        console.log("[-] setFlags hook failed: " + e);
    }

    // 2) Window.addFlags(int flags)
    try {
        var Window2 = Java.use("android.view.Window");
        Window2.addFlags.implementation = function (flags) {
            if ((flags & FLAG_SECURE) !== 0) {
                stripped++;
                console.log("[WIN] addFlags: stripped FLAG_SECURE (call #" + stripped +
                            ", flags=0x" + flags.toString(16) + ")");
            }
            return this.addFlags(flags & ~FLAG_SECURE);
        };
        console.log("[+] Hook installed: android.view.Window.addFlags");
    } catch (e) {
        console.log("[-] addFlags hook failed: " + e);
    }

    // 3) Retroactively clear FLAG_SECURE on every currently-live Activity.
    //    Needed because attaching after onCreate misses the initial setFlags() call.
    //    clearFlags() must run on the UI thread — use Activity.runOnUiThread().
    try {
        var Activity = Java.use("android.app.Activity");
        Java.choose("android.app.Activity", {
            onMatch: function (act) {
                try {
                    var klass = act.getClass().getName();
                    act.runOnUiThread(Java.registerClass ? null : null);
                    // runOnUiThread needs a Runnable — build one inline:
                    var Runnable = Java.use("java.lang.Runnable");
                    var MyRunnable = Java.registerClass({
                        name: "com.hb.ClearSecureRunnable_" + Math.floor(Math.random() * 1e9),
                        implements: [Runnable],
                        fields: { act: "android.app.Activity" },
                        methods: {
                            run: function () {
                                try {
                                    this.act.value.getWindow().clearFlags(0x2000);
                                    console.log("[RETRO] Cleared FLAG_SECURE on live activity: " +
                                                this.act.value.getClass().getName());
                                } catch (e) { console.log("[RETRO] clearFlags error: " + e); }
                            }
                        }
                    });
                    var r = MyRunnable.$new();
                    r.act.value = act;
                    act.runOnUiThread(r);
                } catch (e) { console.log("[RETRO] per-activity error: " + e); }
            },
            onComplete: function () { console.log("[+] Retroactive scan complete"); }
        });
    } catch (e) {
        console.log("[-] Retroactive clear failed: " + e);
    }

    console.log("[+] === A3 FLAG_SECURE bypass active ===");
    console.log("    Expected: adb screencap now returns real UI, recents thumbnail is visible, mirroring works.");
});
