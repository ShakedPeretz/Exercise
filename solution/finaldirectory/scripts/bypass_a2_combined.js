/*
 * bypass_a2_combined.js — A2: Copy/Paste Prevention bypass
 * (includes FLAG_SECURE bypass for visible screenshots)
 *
 * Two-in-one script for A2 testing session:
 *   Part 1: FLAG_SECURE bypass (Window.setFlags / addFlags)
 *   Part 2: Copy/Paste bypass (ClipboardManager, TextView.setFilters, commitText)
 *
 * Usage (fresh launch — force-stop app first, then am start, then attach):
 *   frida -U -n Gadget -l scripts/bypass_a2_combined.js
 */

Java.perform(function () {
    var FLAG_SECURE = 0x2000;

    // ══════════════════════════════════════════════════════════════════════════
    // PART 1 — FLAG_SECURE bypass (needed for visible screenshots as evidence)
    // ══════════════════════════════════════════════════════════════════════════

    try {
        var Window = Java.use("android.view.Window");

        Window.setFlags.implementation = function (flags, mask) {
            var had = (flags & FLAG_SECURE) !== 0 || (mask & FLAG_SECURE) !== 0;
            // mask | FLAG_SECURE forces FLAG_SECURE to be explicitly zeroed in attrs
            var newFlags = flags & ~FLAG_SECURE;
            var newMask  = mask  | FLAG_SECURE;
            if (had) console.log("[WIN] setFlags: stripped FLAG_SECURE (flags=0x" +
                flags.toString(16) + " mask=0x" + mask.toString(16) + ")");
            return this.setFlags(newFlags, newMask);
        };

        Window.addFlags.implementation = function (flags) {
            if ((flags & FLAG_SECURE) !== 0) {
                console.log("[WIN] addFlags: stripped FLAG_SECURE");
                flags = flags & ~FLAG_SECURE;
            }
            return this.addFlags(flags);
        };

        console.log("[+] FLAG_SECURE bypass: Window.setFlags / addFlags hooked");
    } catch (e) {
        console.log("[-] FLAG_SECURE hook failed: " + e);
    }

    // Also hook WindowManagerImpl.updateViewLayout to catch any direct
    // LayoutParams.flags modifications that bypass Window.setFlags
    try {
        var WMI = Java.use("android.view.WindowManagerImpl");
        WMI.updateViewLayout.implementation = function (view, params) {
            var LP = Java.use("android.view.WindowManager$LayoutParams");
            var lp = Java.cast(params, LP);
            if ((lp.flags.value & FLAG_SECURE) !== 0) {
                console.log("[WM] updateViewLayout: stripped FLAG_SECURE from LayoutParams");
                lp.flags.value = lp.flags.value & ~FLAG_SECURE;
            }
            return this.updateViewLayout(view, params);
        };
        console.log("[+] WindowManagerImpl.updateViewLayout hooked");
    } catch (e) {
        console.log("[-] updateViewLayout hook failed (non-fatal): " + e);
    }

    // Periodic clear — every 500ms scan all Activities and call clearFlags(FLAG_SECURE).
    // This is the most robust fallback: regardless of which path sets the flag,
    // we un-set it on the next tick.
    var cleared = false;
    setInterval(function () {
        Java.perform(function () {
            try {
                Java.choose("android.app.Activity", {
                    onMatch: function (act) {
                        try {
                            var win = act.getWindow();
                            var lp = win.getAttributes();
                            if ((lp.flags.value & FLAG_SECURE) !== 0) {
                                lp.flags.value = lp.flags.value & ~FLAG_SECURE;
                                win.setAttributes(lp);
                                if (!cleared) {
                                    console.log("[POLL] Cleared FLAG_SECURE on: " + act.getClass().getName());
                                    cleared = true;
                                }
                            }
                        } catch (e) {}
                    },
                    onComplete: function () {}
                });
            } catch (e) {}
        });
    }, 500);

    // ══════════════════════════════════════════════════════════════════════════
    // PART 2 — Copy/Paste Prevention bypass
    // ══════════════════════════════════════════════════════════════════════════

    // A: ClipboardManager — log reads/writes; suppress clearPrimaryClip
    try {
        var CM = Java.use("android.content.ClipboardManager");

        CM.getPrimaryClip.implementation = function () {
            var clip = this.getPrimaryClip();
            if (clip != null && clip.getItemCount() > 0) {
                try {
                    console.log("[CLIP] getPrimaryClip() -> \"" + clip.getItemAt(0).getText() + "\"");
                } catch (e) {
                    console.log("[CLIP] getPrimaryClip() -> (item unreadable)");
                }
            } else {
                console.log("[CLIP] getPrimaryClip() -> null/empty");
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
            console.log("[CLIP] clearPrimaryClip() SUPPRESSED — Appdome would erase clipboard here");
            // intentionally not calling through
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

    // B: Strip InputFilters — removes any paste-blocking filter Appdome injects
    try {
        var TextView = Java.use("android.widget.TextView");

        // Use the correct overload: (InputFilter[])
        TextView.setFilters.overload("[Landroid.text.InputFilter;").implementation = function (filters) {
            if (filters && filters.length > 0) {
                console.log("[FILTER] setFilters: stripping " + filters.length + " filter(s):");
                for (var i = 0; i < filters.length; i++) {
                    try { console.log("         [" + i + "] " + filters[i].getClass().getName()); } catch (e) {}
                }
                return this.setFilters.overload("[Landroid.text.InputFilter;").call(this, []);
            }
            return this.setFilters.overload("[Landroid.text.InputFilter;").call(this, filters);
        };

        console.log("[+] TextView.setFilters hook installed");
    } catch (e) {
        console.log("[-] TextView.setFilters hook failed: " + e);
    }

    // C: onTextContextMenuItem — log and ensure paste executes
    try {
        var EditText = Java.use("android.widget.EditText");
        var PASTE = 0x1020022;
        var PASTE_PLAIN = 0x102003f;
        var COPY = 0x1020020;
        var CUT  = 0x1020021;
        var nameMap = {};
        nameMap[PASTE] = "PASTE"; nameMap[PASTE_PLAIN] = "PASTE_PLAIN";
        nameMap[COPY] = "COPY"; nameMap[CUT] = "CUT";

        EditText.onTextContextMenuItem.implementation = function (id) {
            var name = nameMap[id] || ("0x" + id.toString(16));
            console.log("[MENU] onTextContextMenuItem(" + name + ")");
            var result = this.onTextContextMenuItem(id);
            console.log("[MENU] -> returned " + result);
            return result;
        };

        console.log("[+] EditText.onTextContextMenuItem hook installed");
    } catch (e) {
        console.log("[-] onTextContextMenuItem hook failed: " + e);
    }

    // D: BaseInputConnection.commitText — log every string committed by the IME
    try {
        var BIC = Java.use("android.view.inputmethod.BaseInputConnection");
        BIC.commitText.overload("java.lang.CharSequence", "int").implementation = function (text, pos) {
            console.log("[IME] commitText(\"" + text + "\")");
            return this.commitText(text, pos);
        };
        console.log("[+] BaseInputConnection.commitText hook installed");
    } catch (e) {
        console.log("[-] BaseInputConnection.commitText hook failed: " + e);
    }

    console.log("[+] === A2 Copy/Paste bypass active ===");
});
