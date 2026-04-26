/*
 * bypass_a2_clipboard.js — A2: Copy/Paste Prevention bypass
 *
 * Target: com.hartman.timecard on Samsung Galaxy S21+ (API 35).
 *
 * Protection layers to defeat:
 *   1. ClipboardManager.getPrimaryClip()  — returns null / cleared by Appdome
 *   2. ClipboardManager.setPrimaryClip()  — blocked or cleared on paste
 *   3. TextView.setFilters(InputFilter[]) — paste-blocking InputFilter
 *   4. EditText.onTextContextMenuItem()   — Paste menu item hidden/no-op'd
 *
 * Strategy:
 *   A) Log all ClipboardManager read/write calls — proves exfiltration bypass.
 *   B) Hook setFilters to strip all InputFilters — clears any paste blocker.
 *   C) Hook onTextContextMenuItem to force-execute paste even if Appdome intercepts it.
 *   D) Hook commitText to log every string the IME commits (covers typed + pasted text).
 *
 * Usage:
 *   adb shell am start -n com.hartman.timecard/.MainCheckInActivity
 *   (wait for frida-ps -U to show Gadget)
 *   frida -U -n Gadget -l scripts/bypass_a2_clipboard.js
 */

Java.perform(function () {

    // ── A: ClipboardManager hooks ──────────────────────────────────────────────
    try {
        var CM = Java.use("android.content.ClipboardManager");

        CM.getPrimaryClip.implementation = function () {
            var clip = this.getPrimaryClip();
            if (clip != null && clip.getItemCount() > 0) {
                try {
                    var text = clip.getItemAt(0).getText();
                    console.log("[CLIP] getPrimaryClip() -> \"" + text + "\"");
                } catch (e) {
                    console.log("[CLIP] getPrimaryClip() -> (item unreadable: " + e + ")");
                }
            } else {
                console.log("[CLIP] getPrimaryClip() -> null/empty (Appdome may have cleared it)");
            }
            return clip;
        };

        CM.setPrimaryClip.implementation = function (clip) {
            var text = "(unknown)";
            try { text = clip.getItemAt(0).getText().toString(); } catch (e) {}
            console.log("[CLIP] setPrimaryClip(\"" + text + "\")");
            return this.setPrimaryClip(clip);
        };

        CM.clearPrimaryClip.implementation = function () {
            console.log("[CLIP] clearPrimaryClip() called — SUPPRESSED (Appdome would erase clipboard here)");
            // Do NOT call through — this is the Appdome-injected listener clearing the clipboard.
        };

        CM.hasPrimaryClip.implementation = function () {
            var has = this.hasPrimaryClip();
            console.log("[CLIP] hasPrimaryClip() -> " + has);
            return has;
        };

        console.log("[+] ClipboardManager hooks installed");
    } catch (e) {
        console.log("[-] ClipboardManager hook failed: " + e);
    }

    // ── B: Strip all InputFilters (removes paste-blocking filter) ─────────────
    try {
        var TextView = Java.use("android.widget.TextView");

        TextView.setFilters.implementation = function (filters) {
            if (filters && filters.length > 0) {
                console.log("[FILTER] setFilters called with " + filters.length +
                            " filter(s) — stripping all (Appdome paste-blocker removed)");
                for (var i = 0; i < filters.length; i++) {
                    try { console.log("          [" + i + "] " + filters[i].getClass().getName()); } catch (e) {}
                }
                return this.setFilters([]);
            }
            return this.setFilters(filters);
        };

        console.log("[+] TextView.setFilters hook installed");
    } catch (e) {
        console.log("[-] TextView.setFilters hook failed: " + e);
    }

    // ── C: onTextContextMenuItem — log and force Paste execution ──────────────
    try {
        var EditText = Java.use("android.widget.EditText");

        EditText.onTextContextMenuItem.implementation = function (id) {
            var PASTE      = 0x1020022;  // android.R.id.paste
            var PASTE_PLAIN = 0x102003f; // android.R.id.pasteAsPlainText (API 26+)
            var COPY       = 0x1020020;
            var CUT        = 0x1020021;

            var names = {};
            names[PASTE]       = "PASTE";
            names[PASTE_PLAIN] = "PASTE_AS_PLAIN_TEXT";
            names[COPY]        = "COPY";
            names[CUT]         = "CUT";
            var name = names[id] || ("0x" + id.toString(16));

            console.log("[MENU] onTextContextMenuItem(" + name + ")");

            // Always call through — we want paste to execute even if Appdome
            // would have blocked it by returning false before calling super.
            var result = this.onTextContextMenuItem(id);
            console.log("[MENU] -> returned " + result);
            return result;
        };

        console.log("[+] EditText.onTextContextMenuItem hook installed");
    } catch (e) {
        console.log("[-] onTextContextMenuItem hook failed: " + e);
    }

    // ── D: InputConnection.commitText — log every IME commit ──────────────────
    try {
        // BaseInputConnection is the common base; hook via Java.choose on active connections
        // is unreliable. Instead hook the abstract interface via all registered subclasses.
        // Simplest reliable path: hook android.view.inputmethod.InputConnection proxy.
        var BIC = Java.use("android.view.inputmethod.BaseInputConnection");

        BIC.commitText.overload("java.lang.CharSequence", "int").implementation = function (text, pos) {
            console.log("[IME] commitText(\"" + text + "\", " + pos + ")");
            return this.commitText(text, pos);
        };

        console.log("[+] BaseInputConnection.commitText hook installed");
    } catch (e) {
        console.log("[-] BaseInputConnection.commitText hook failed: " + e);
    }

    console.log("[+] === A2 Copy/Paste bypass active ===");
    console.log("    Now: long-press a text field → Paste, or use adb to put text in clipboard.");
});
