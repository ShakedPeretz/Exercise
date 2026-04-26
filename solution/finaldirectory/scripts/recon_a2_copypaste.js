/*
 * recon_a2_copypaste.js — A2: Copy/Paste Prevention reconnaissance
 *
 * PURPOSE: Discover exactly how Appdome blocks copy/paste in this app.
 *
 * Questions this script answers:
 *   Q1. Can in-process code read/write the clipboard via ClipboardManager?
 *   Q2. Does Appdome call clearPrimaryClip() when app is backgrounded?
 *   Q3. Does AdviewEditText.onTextContextMenuItem fire on long-press → Paste?
 *       Does Appdome block paste by returning false here?
 *   Q4. Does paste go through BaseInputConnection.commitText or the custom IC?
 *   Q5. Does text actually appear in the field after paste?
 *
 * How to use:
 *   frida -U -n Gadget -l scripts/recon_a2_copypaste.js
 *   Then in order:
 *     1. Navigate to הגדרות → יום ראשון → TAP the text field
 *     2. Long-press the field → tap PASTE from the context menu
 *     3. Press Home → wait 3s → come back to the app
 *   Read the output after each step.
 */

Java.perform(function () {

    // ── Q1 + Q2: ClipboardManager ──────────────────────────────────────────────
    try {
        var CM = Java.use("android.content.ClipboardManager");

        CM.getPrimaryClip.implementation = function () {
            var clip = this.getPrimaryClip();
            var txt = "(null/empty)";
            try {
                if (clip != null && clip.getItemCount() > 0)
                    txt = clip.getItemAt(0).getText().toString();
            } catch (e) {}
            console.log("[CLIP] getPrimaryClip() -> \"" + txt + "\"");
            return clip;
        };

        CM.setPrimaryClip.implementation = function (clip) {
            var txt = "(unknown)";
            try { txt = clip.getItemAt(0).getText().toString(); } catch (e) {}
            console.log("[CLIP] setPrimaryClip(\"" + txt + "\")");
            return this.setPrimaryClip(clip);
        };

        // NOT suppressed — we want to see if Appdome actually calls this
        CM.clearPrimaryClip.implementation = function () {
            console.log("[CLIP] *** clearPrimaryClip() called — Appdome is actively clearing clipboard ***");
            return this.clearPrimaryClip();
        };

        CM.hasPrimaryClip.implementation = function () {
            var r = this.hasPrimaryClip();
            console.log("[CLIP] hasPrimaryClip() -> " + r);
            return r;
        };

        console.log("[+] ClipboardManager hooks installed (Q1+Q2)");
    } catch (e) { console.log("[-] ClipboardManager: " + e); }

    // ── Q3: AdviewEditText.onTextContextMenuItem ───────────────────────────────
    // Fires when user selects Paste/Copy/Cut from long-press context menu.
    // If Appdome returns false for PASTE → paste is silently blocked at UI level.
    try {
        var AdET = Java.use("runtime.ad_protected_views.AdviewEditText");
        var MENU_NAMES = { 0x1020022: "PASTE", 0x102003f: "PASTE_AS_PLAIN_TEXT",
                           0x1020020: "COPY",  0x1020021: "CUT" };

        AdET.onTextContextMenuItem.implementation = function (id) {
            var name = MENU_NAMES[id] || ("0x" + id.toString(16));
            console.log("[MENU] AdviewEditText.onTextContextMenuItem(" + name + ")");
            var result = this.onTextContextMenuItem(id);
            console.log("[MENU] -> returned: " + result +
                (id === 0x1020022 || id === 0x102003f
                    ? (result ? "  (paste ALLOWED)" : "  *** PASTE BLOCKED by Appdome ***")
                    : ""));
            return result;
        };
        console.log("[+] AdviewEditText.onTextContextMenuItem hooked (Q3)");
    } catch (e) { console.log("[-] AdviewEditText.onTextContextMenuItem: " + e); }

    // ── Q3b: Also hook standard EditText in case Appdome delegates up ──────────
    try {
        var ET = Java.use("android.widget.EditText");
        var MENU_NAMES2 = { 0x1020022: "PASTE", 0x102003f: "PASTE_PLAIN",
                            0x1020020: "COPY",  0x1020021: "CUT" };
        ET.onTextContextMenuItem.implementation = function (id) {
            var name = MENU_NAMES2[id] || ("0x" + id.toString(16));
            console.log("[MENU-ET] EditText.onTextContextMenuItem(" + name + ")");
            var result = this.onTextContextMenuItem(id);
            console.log("[MENU-ET] -> returned: " + result);
            return result;
        };
        console.log("[+] EditText.onTextContextMenuItem hooked (Q3b)");
    } catch (e) { console.log("[-] EditText.onTextContextMenuItem: " + e); }

    // ── Q4: AdviewEditText.onCreateInputConnection — discover IC class ─────────
    try {
        var AdET2 = Java.use("runtime.ad_protected_views.AdviewEditText");
        AdET2.onCreateInputConnection
            .overload("android.view.inputmethod.EditorInfo")
            .implementation = function (outAttrs) {
                var ic = this.onCreateInputConnection(outAttrs);
                if (ic !== null) {
                    console.log("[IC] InputConnection class: " + ic.getClass().getName());
                    console.log("     -> Paste events go through THIS class's commitText");
                }
                return ic;
            };
        console.log("[+] AdviewEditText.onCreateInputConnection hooked (Q4)");
    } catch (e) { console.log("[-] onCreateInputConnection: " + e); }

    // ── Q4b: BaseInputConnection.commitText — does paste use standard path? ─────
    try {
        var BIC = Java.use("android.view.inputmethod.BaseInputConnection");
        BIC.commitText.overload("java.lang.CharSequence", "int")
            .implementation = function (text, pos) {
                console.log("[BIC] BaseInputConnection.commitText(\"" + text + "\") — standard path fired");
                return this.commitText(text, pos);
            };
        console.log("[+] BaseInputConnection.commitText hooked (Q4b — expect silence)");
    } catch (e) { console.log("[-] BaseInputConnection.commitText: " + e); }

    // ── Q5: AdviewEditText.getText — does text appear after paste? ────────────
    try {
        var AdET3  = Java.use("runtime.ad_protected_views.AdviewEditText");
        var EditText = Java.use("android.widget.EditText");
        var parentGetText = EditText.getText.overload();

        AdET3.getText.overload().implementation = function () {
            var text = parentGetText.call(this);
            var str  = text ? text.toString() : "";
            if (str.length > 0)
                console.log("[TEXT] AdviewEditText.getText() -> \"" + str + "\"");
            return text;
        };
        console.log("[+] AdviewEditText.getText hooked (Q5)");
    } catch (e) { console.log("[-] AdviewEditText.getText: " + e); }

    // ── Scan: confirm AdviewEditText instances on current screen ──────────────
    setTimeout(function () {
        Java.scheduleOnMainThread(function () {
            console.log("\n[SCAN] ── Live EditText instances ──");
            Java.choose("android.widget.EditText", {
                onMatch: function (et) {
                    try {
                        console.log("[SCAN] " + et.getClass().getName() +
                                    "  filters:" + (et.getFilters() ? et.getFilters().length : 0));
                    } catch (e) {}
                },
                onComplete: function () { console.log("[SCAN] ────────────────────────────\n"); }
            });
        });
    }, 2000);

    console.log("\n[*] Recon active. Steps:");
    console.log("[*]   1. Go to הגדרות → יום ראשון → TAP the text field  (triggers [IC])");
    console.log("[*]   2. Long-press the field → tap PASTE                (triggers [MENU] + [BIC]?)");
    console.log("[*]   3. Press Home → wait 3s → return                   (triggers [CLIP] clearPrimaryClip?)");
    console.log("[*] ──────────────────────────────────────────────────────────────\n");
});
