/*
 * recon_a2_v2_clipboard_proxy.js — A2: Observe Appdome's clipboard encryption
 *
 * PURPOSE: Prove the actual A2 mechanism is the IClipboard binder proxy +
 *          NativeBridge.handleClipboard encryption (not the ClipboardManager API).
 *
 * Discovered via reverse engineering of classes3.dex (jadx output):
 *   - runtime.clipboard.Clipboard       — installs the IClipboard binder proxy
 *   - runtime.clipboard.Clipboard$ClipboardInvocationHandler.invoke
 *                                       — proxy entry: routes setPrimaryClip→encrypt,
 *                                                       getPrimaryClip→decrypt
 *   - runtime.loading.NativeBridge.handleClipboard(bytes, len, encrypt)
 *                                       — actual encryption (libcore_engine.so)
 *   - runtime.clipboard.ActionCallbackProtection.onActionItemClicked
 *                                       — wraps long-press menu, sends telemetry
 *
 * How to use:
 *   adb shell am force-stop com.hartman.timecard
 *   adb shell am start -n com.hartman.timecard/.MainCheckInActivity
 *   (wait for Gadget)
 *   frida -U -n Gadget -l scripts/recon_a2_v2_clipboard_proxy.js
 *
 *   Then:
 *     1. Tap Settings (3 dots) → הגדרות → tap a day's alarm-text field (יום ראשון).
 *     2. Type a recognizable plaintext: "PLAINTEXTCANARY"
 *     3. Long-press → Select All → tap Copy. Watch for:
 *          [MENU-AC] Copy (id=16908321)
 *          [PROXY] invoke(setPrimaryClip)
 *          [CRYPT] handleClipboard ENCRYPT in="PLAINTEXTCANARY" out="<garbage>"
 *     4. Switch to Samsung Notes / Messages → Paste.
 *        You should see encrypted bytes, NOT "PLAINTEXTCANARY".
 *     5. Come back to the app, paste back into the field.
 *        Watch for [CRYPT] handleClipboard DECRYPT — text returns to plaintext.
 */

Java.perform(function () {

    var Str = Java.use("java.lang.String");

    function bytesToString(bytes) {
        try { return Str.$new(bytes); }
        catch (e) { return "(" + bytes.length + " bytes — non-UTF8)"; }
    }

    // ── 1. NativeBridge.handleClipboard — the actual encryption call ──────────
    try {
        var NB = Java.use("runtime.loading.NativeBridge");
        NB.handleClipboard.implementation = function (bytes, len, encrypt) {
            var input = bytesToString(bytes);
            var out   = this.handleClipboard(bytes, len, encrypt);
            var output = out ? bytesToString(out) : "(null)";
            console.log("[CRYPT] handleClipboard " +
                        (encrypt ? "ENCRYPT" : "DECRYPT") +
                        " len=" + len +
                        " in=\""  + input  + "\"" +
                        " out=\"" + output + "\"");
            return out;
        };
        console.log("[+] NativeBridge.handleClipboard hooked");
    } catch (e) { console.log("[-] NativeBridge.handleClipboard: " + e); }

    // ── 2. Clipboard$ClipboardInvocationHandler.invoke — proxy entry ──────────
    try {
        var Handler = Java.use("runtime.clipboard.Clipboard$ClipboardInvocationHandler");
        Handler.invoke.implementation = function (proxy, method, args) {
            var name = method.getName();
            console.log("[PROXY] IClipboard." + name + "(" +
                        (args ? args.length : 0) + " args)");
            return this.invoke(proxy, method, args);
        };
        console.log("[+] Clipboard$ClipboardInvocationHandler.invoke hooked");
    } catch (e) { console.log("[-] ClipboardInvocationHandler.invoke: " + e); }

    // ── 3. Clipboard.getCryptedClip — high-level encrypt/decrypt entry ────────
    try {
        var Clip = Java.use("runtime.clipboard.Clipboard");
        // overload(ClipData, boolean, [boolean) is the main one used by the proxy
        Clip.getCryptedClip.overload(
            "android.content.ClipData", "boolean", "[Z"
        ).implementation = function (clip, encrypt, didModify) {
            var inText = "(empty)";
            try {
                if (clip != null && clip.getItemCount() > 0) {
                    var item = clip.getItemAt(0);
                    var ctx  = Java.use("runtime.ContextSaver").get();
                    inText   = item.coerceToText(ctx).toString();
                }
            } catch (e) {}
            console.log("[GCC]   getCryptedClip(ClipData) " +
                        (encrypt ? "ENCRYPT" : "DECRYPT") +
                        " in=\"" + inText + "\"");
            var out = this.getCryptedClip(clip, encrypt, didModify);
            try {
                if (out != null && out.getItemCount() > 0) {
                    var oitem = out.getItemAt(0);
                    var ctx2  = Java.use("runtime.ContextSaver").get();
                    console.log("[GCC]   → out=\"" +
                                oitem.coerceToText(ctx2).toString() + "\"");
                }
            } catch (e) {}
            return out;
        };
        console.log("[+] Clipboard.getCryptedClip(ClipData,bool,[Z) hooked");
    } catch (e) { console.log("[-] Clipboard.getCryptedClip: " + e); }

    // ── 4. ActionCallbackProtection.onActionItemClicked — Cut/Copy/Paste UI ───
    try {
        var ACP = Java.use("runtime.clipboard.ActionCallbackProtection");
        ACP.onActionItemClicked.implementation = function (mode, item) {
            var id    = item.getItemId();
            var title = item.getTitle() ? item.getTitle().toString() : "(no title)";
            console.log("[MENU-AC] action=\"" + title + "\" id=" + id);
            var result = this.onActionItemClicked(mode, item);
            console.log("[MENU-AC] → returned: " + result);
            return result;
        };
        console.log("[+] ActionCallbackProtection.onActionItemClicked hooked");
    } catch (e) { console.log("[-] ActionCallbackProtection: " + e); }

    // ── 5. ClipboardManager API (for comparison — what the app code sees) ─────
    try {
        var CM = Java.use("android.content.ClipboardManager");

        CM.setPrimaryClip.implementation = function (clip) {
            var t = "(empty)";
            try { t = clip.getItemAt(0).getText().toString(); } catch (e) {}
            console.log("[API]   ClipboardManager.setPrimaryClip(\"" + t + "\")");
            return this.setPrimaryClip(clip);
        };

        CM.getPrimaryClip.implementation = function () {
            var clip = this.getPrimaryClip();
            var t = "(null)";
            try { t = clip.getItemAt(0).getText().toString(); } catch (e) {}
            console.log("[API]   ClipboardManager.getPrimaryClip() -> \"" + t + "\"");
            return clip;
        };
        console.log("[+] ClipboardManager API hooked (for comparison)");
    } catch (e) { console.log("[-] ClipboardManager: " + e); }

    console.log("\n[*] === A2 Recon v2 active ===");
    console.log("[*] Test plan:");
    console.log("[*]   1. Type \"PLAINTEXTCANARY\" into יום ראשון alarm field");
    console.log("[*]   2. Long-press → Select All → Copy");
    console.log("[*]      Expected: [MENU-AC] Copy → [PROXY] setPrimaryClip");
    console.log("[*]                → [GCC] ENCRYPT → [CRYPT] handleClipboard ENCRYPT");
    console.log("[*]   3. Switch to Samsung Notes → Paste — should see encrypted garbage");
    console.log("[*]   4. Return to app, Paste back — should see DECRYPT path → plaintext\n");
});
