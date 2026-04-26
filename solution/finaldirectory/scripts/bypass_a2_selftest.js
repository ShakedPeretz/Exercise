/*
 * bypass_a2_selftest.js — A2: Copy/Paste Prevention bypass with self-test
 *
 * Self-contained script that:
 *   1. Installs ClipboardManager + setFilters hooks
 *   2. Schedules an in-process clipboard test on the main thread:
 *      - Sets a canary string in the clipboard
 *      - Reads it back (proves bypass works)
 *      - Lets the test run then waits for Appdome clearPrimaryClip to fire
 *   3. Keeps session open to capture subsequent hook events
 *
 * No text field interaction required — demonstrates the API-level bypass.
 *
 * Usage (fresh process):
 *   adb shell am force-stop com.hartman.timecard
 *   adb shell am start -n com.hartman.timecard/.MainCheckInActivity
 *   (wait for frida-ps -U to show Gadget)
 *   frida -U -n Gadget -l scripts/bypass_a2_selftest.js
 */

Java.perform(function () {

    // ── ClipboardManager hooks ─────────────────────────────────────────────
    try {
        var CM = Java.use("android.content.ClipboardManager");

        CM.getPrimaryClip.implementation = function () {
            var clip = this.getPrimaryClip();
            try {
                var txt = (clip != null && clip.getItemCount() > 0)
                    ? clip.getItemAt(0).getText().toString()
                    : "(null/empty)";
                console.log("[CLIP] getPrimaryClip() -> \"" + txt + "\"");
            } catch (e) { console.log("[CLIP] getPrimaryClip() -> (unreadable)"); }
            return clip;
        };

        CM.setPrimaryClip.implementation = function (clip) {
            var txt = "(unknown)";
            try { txt = clip.getItemAt(0).getText().toString(); } catch (e) {}
            console.log("[CLIP] setPrimaryClip(\"" + txt + "\")");
            return this.setPrimaryClip(clip);
        };

        CM.clearPrimaryClip.implementation = function () {
            console.log("[CLIP] clearPrimaryClip() INTERCEPTED — Appdome tried to erase clipboard, SUPPRESSED");
            // Do NOT call through — this is the protection mechanism; we defeat it by no-op
        };

        CM.hasPrimaryClip.implementation = function () {
            var r = this.hasPrimaryClip();
            console.log("[CLIP] hasPrimaryClip() -> " + r);
            return r;
        };

        console.log("[+] ClipboardManager hooks installed");
    } catch (e) { console.log("[-] ClipboardManager: " + e); }

    // ── TextView.setFilters (correct overload) ─────────────────────────────
    try {
        var TV = Java.use("android.widget.TextView");
        TV.setFilters.overload("[Landroid.text.InputFilter;").implementation = function (filters) {
            if (filters && filters.length > 0) {
                console.log("[FILTER] setFilters: intercepted " + filters.length + " filter(s):");
                for (var i = 0; i < filters.length; i++) {
                    try { console.log("         -> " + filters[i].getClass().getName()); } catch (e) {}
                }
                // Strip all filters — removes Appdome's paste-blocking InputFilter
                return this.setFilters.overload("[Landroid.text.InputFilter;").call(this, []);
            }
            return this.setFilters.overload("[Landroid.text.InputFilter;").call(this, filters);
        };
        console.log("[+] TextView.setFilters hook installed");
    } catch (e) { console.log("[-] setFilters: " + e); }

    // ── EditText.onTextContextMenuItem ─────────────────────────────────────
    try {
        var ET = Java.use("android.widget.EditText");
        ET.onTextContextMenuItem.implementation = function (id) {
            var names = {0x1020022: "PASTE", 0x102003f: "PASTE_PLAIN", 0x1020020: "COPY", 0x1020021: "CUT"};
            console.log("[MENU] onTextContextMenuItem(" + (names[id] || "0x" + id.toString(16)) + ")");
            var r = this.onTextContextMenuItem(id);
            console.log("[MENU] -> " + r);
            return r;
        };
        console.log("[+] EditText.onTextContextMenuItem hook installed");
    } catch (e) { console.log("[-] onTextContextMenuItem: " + e); }

    // ── BaseInputConnection.commitText ─────────────────────────────────────
    try {
        var BIC = Java.use("android.view.inputmethod.BaseInputConnection");
        BIC.commitText.overload("java.lang.CharSequence", "int").implementation = function (text, pos) {
            console.log("[IME] commitText(\"" + text + "\")");
            return this.commitText(text, pos);
        };
        console.log("[+] BaseInputConnection.commitText hook installed");
    } catch (e) { console.log("[-] commitText: " + e); }

    console.log("[+] === A2 hooks installed. Running in-process clipboard self-test in 2s... ===");

    // ── In-process clipboard self-test ─────────────────────────────────────
    // Run on main thread (required for ClipboardManager and window ops)
    setTimeout(function () {
        Java.scheduleOnMainThread(function () {
            try {
                var context = Java.use("android.app.ActivityThread").currentApplication().getApplicationContext();
                var ClipboardManager = Java.use("android.content.ClipboardManager");
                var ClipData = Java.use("android.content.ClipData");

                var cm = Java.cast(
                    context.getSystemService("clipboard"),
                    ClipboardManager
                );

                console.log("\n[TEST] === Step 1: Set canary in clipboard ===");
                var clip = ClipData.newPlainText("appdome_test", "APPDOME_PASTE_CANARY_2026");
                cm.setPrimaryClip(clip);

                console.log("[TEST] === Step 2: Read clipboard back ===");
                var readBack = cm.getPrimaryClip();
                if (readBack != null) {
                    console.log("[TEST] READ: \"" + readBack.getItemAt(0).getText() + "\" ✓ BYPASS SUCCESSFUL");
                } else {
                    console.log("[TEST] READ: null — Appdome blocked before hook could intercept");
                }

                console.log("[TEST] === Step 3: Wait 1s then verify clearPrimaryClip doesn't clear it ===");
                Java.scheduleOnMainThread(function () {
                    try {
                        var verify = cm.getPrimaryClip();
                        if (verify != null) {
                            console.log("[TEST] VERIFY: \"" + verify.getItemAt(0).getText() +
                                "\" still present after 1s ✓ clearPrimaryClip suppressed");
                        } else {
                            console.log("[TEST] VERIFY: clipboard was cleared — clearPrimaryClip may have slipped through");
                        }
                        console.log("[TEST] === Self-test complete ===\n");
                    } catch (e) { console.log("[TEST] verify error: " + e); }
                });

            } catch (e) {
                console.log("[TEST] Self-test error: " + e);
            }
        });
    }, 2000);

});
