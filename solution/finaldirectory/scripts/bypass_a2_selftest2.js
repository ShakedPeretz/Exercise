Java.perform(function () {

    // ClipboardManager hooks
    try {
        var CM = Java.use("android.content.ClipboardManager");

        CM.getPrimaryClip.implementation = function () {
            var clip = this.getPrimaryClip();
            try {
                var txt = (clip != null && clip.getItemCount() > 0)
                    ? clip.getItemAt(0).getText().toString()
                    : "(null/empty)";
                console.log("[CLIP] getPrimaryClip() -> \"" + txt + "\"");
            } catch (e) { console.log("[CLIP] getPrimaryClip() -> (unreadable: " + e + ")"); }
            return clip;
        };

        CM.setPrimaryClip.implementation = function (clip) {
            var txt = "(unknown)";
            try { txt = clip.getItemAt(0).getText().toString(); } catch (e) {}
            console.log("[CLIP] setPrimaryClip(\"" + txt + "\")");
            return this.setPrimaryClip(clip);
        };

        CM.clearPrimaryClip.implementation = function () {
            console.log("[CLIP] clearPrimaryClip() INTERCEPTED & SUPPRESSED — Appdome tried to erase clipboard");
        };

        console.log("[+] ClipboardManager hooks installed");
    } catch (e) { console.log("[-] ClipboardManager: " + e); }

    // setFilters hook
    try {
        var TV = Java.use("android.widget.TextView");
        TV.setFilters.overload("[Landroid.text.InputFilter;").implementation = function (filters) {
            if (filters && filters.length > 0) {
                console.log("[FILTER] setFilters: stripping " + filters.length + " Appdome filter(s)");
                for (var i = 0; i < filters.length; i++) {
                    try { console.log("         -> " + filters[i].getClass().getName()); } catch (e) {}
                }
                return this.setFilters.overload("[Landroid.text.InputFilter;").call(this, []);
            }
            return this.setFilters.overload("[Landroid.text.InputFilter;").call(this, filters);
        };
        console.log("[+] TextView.setFilters hook installed");
    } catch (e) { console.log("[-] setFilters: " + e); }

    // onTextContextMenuItem
    try {
        var ET = Java.use("android.widget.EditText");
        ET.onTextContextMenuItem.implementation = function (id) {
            var names = {0x1020022:"PASTE", 0x102003f:"PASTE_PLAIN", 0x1020020:"COPY", 0x1020021:"CUT"};
            console.log("[MENU] onTextContextMenuItem(" + (names[id] || "0x"+id.toString(16)) + ")");
            return this.onTextContextMenuItem(id);
        };
        console.log("[+] EditText.onTextContextMenuItem hook installed");
    } catch (e) { console.log("[-] onTextContextMenuItem: " + e); }

    // commitText
    try {
        var BIC = Java.use("android.view.inputmethod.BaseInputConnection");
        BIC.commitText.overload("java.lang.CharSequence", "int").implementation = function (text, pos) {
            console.log("[IME] commitText(\"" + text + "\")");
            return this.commitText(text, pos);
        };
        console.log("[+] BaseInputConnection.commitText hook installed");
    } catch (e) { console.log("[-] commitText: " + e); }

    console.log("[+] === A2 bypass active — running clipboard self-test in 3s... ===");

    setTimeout(function () {
        Java.scheduleOnMainThread(function () {
            try {
                var ctx = Java.use("android.app.ActivityThread").currentApplication().getApplicationContext();
                var CM2 = Java.use("android.content.ClipboardManager");
                var cm = Java.cast(ctx.getSystemService("clipboard"), CM2);

                // Build clip using explicit Java String objects
                var Str = Java.use("java.lang.String");
                var ClipData = Java.use("android.content.ClipData");
                var label = Str.$new("appdome_test");
                var canary = Str.$new("APPDOME_PASTE_CANARY_2026");
                var clip = ClipData.newPlainText(label, canary);

                console.log("\n[TEST] Step 1 — setting canary in clipboard...");
                cm.setPrimaryClip(clip);

                console.log("[TEST] Step 2 — reading clipboard back...");
                var read = cm.getPrimaryClip();
                if (read != null && read.getItemCount() > 0) {
                    var txt = read.getItemAt(0).getText().toString();
                    console.log("[TEST] READ: \"" + txt + "\"");
                    if (txt === "APPDOME_PASTE_CANARY_2026") {
                        console.log("[TEST] RESULT: BYPASS SUCCESSFUL - clipboard content accessible");
                    }
                } else {
                    console.log("[TEST] READ: null/empty — clipboard inaccessible");
                }

                console.log("[TEST] Step 3 — background the app to trigger Appdome clear-on-background...");
            } catch (e) { console.log("[TEST] error: " + e); }
        });
    }, 3000);

    // After 6s: move app to background to trigger Appdome's clearPrimaryClip
    setTimeout(function () {
        Java.scheduleOnMainThread(function () {
            try {
                // Press home via ActivityManager
                var AM = Java.use("android.app.ActivityManager");
                var ctx = Java.use("android.app.ActivityThread").currentApplication().getApplicationContext();
                // Move task to back
                Java.choose("android.app.Activity", {
                    onMatch: function(act) {
                        try {
                            act.moveTaskToBack(true);
                            console.log("[TEST] Moved app to background (triggers Appdome onPause clipboard clear)");
                        } catch(e) {}
                    },
                    onComplete: function() {}
                });
            } catch(e) { console.log("[TEST] background error: " + e); }
        });
    }, 5000);

    // After 8s: bring back to foreground and check clipboard still intact
    setTimeout(function () {
        Java.scheduleOnMainThread(function () {
            try {
                var ctx = Java.use("android.app.ActivityThread").currentApplication().getApplicationContext();
                var CM3 = Java.use("android.content.ClipboardManager");
                var cm = Java.cast(ctx.getSystemService("clipboard"), CM3);
                var clip2 = cm.getPrimaryClip();
                if (clip2 != null && clip2.getItemCount() > 0) {
                    var txt2 = clip2.getItemAt(0).getText().toString();
                    console.log("[TEST] POST-BACKGROUND clipboard: \"" + txt2 + "\"");
                    console.log("[TEST] FINAL: clearPrimaryClip was SUPPRESSED — canary still in clipboard ✓");
                } else {
                    console.log("[TEST] POST-BACKGROUND clipboard: empty (clearPrimaryClip slipped through)");
                }
                console.log("[TEST] === Self-test complete ===");
            } catch(e) { console.log("[TEST] final check error: " + e); }
        });
    }, 8000);
});
