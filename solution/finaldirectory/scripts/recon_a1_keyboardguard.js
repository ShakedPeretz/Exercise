/*
 * recon_a1_keyboardguard.js — A1 mechanism recon (observation only)
 *
 * Verifies on device that Appdome's "Keylogging Prevention" is the IME-policy
 * mechanism described by static RE of:
 *   RE_dex/runtime_decomp/sources/runtime/keyboardGuard/KeyboardGuard.java
 *
 * Hooks installed (NO bypass — pure logging):
 *   1. KeyboardGuard$KeyboardGuardHookHandler.handleMessage
 *        → log message.what (MSG_BIND/MSG_SET_ACTIVE/MSG_USER_ACTION_NOTIF)
 *   2. KeyboardGuard.isIllegalKeyboard(String)
 *        → log input IME id and bool verdict (called from handleMessage AND
 *          from the DoS loop, so cadence reflects iterations)
 *   3. KeyboardGuard$KeyboardGuardThread.run()
 *        → confirm the force-close thread spawns and exits
 *   4. NativeBridge.shouldBlockEvent(String)
 *        → confirm native gate is consulted with the keyboard event id
 *          "b96e7a45095f5ed683d3169f4c7196ee"
 *   5. InputMethodManager.showInputMethodPicker()
 *        → confirm picker dialog is forced open on illegal-IME bind
 *
 * Procedure:
 *   1. Settings → General management → Keyboard list and default → set
 *      AnySoftKeyboard as default. Confirm Honeyboard is no longer default.
 *   2. adb -s RFCR10YLNVB shell am force-stop com.hartman.timecard
 *   3. adb -s RFCR10YLNVB shell am start -n com.hartman.timecard/.MainCheckInActivity
 *   4. frida -U -n Gadget -l scripts/recon_a1_keyboardguard.js \
 *        | tee solution/evidence/a1_recon_anysoftkeyboard.log
 *   5. Tap any text field in the app. Watch the log.
 *   6. Switch the default IME back to Samsung Honeyboard via the picker
 *      dialog Appdome opens. Tap field again. Watch the log.
 *
 * Expected sequence (AnySoftKeyboard default):
 *   [KG] handleMessage what=MSG_BIND(2)
 *   [KG] isIllegalKeyboard in="<ASK component>" -> true
 *   [NB] shouldBlockEvent KEYBOARD ... -> true
 *   [IMM] showInputMethodPicker called
 *   [KG] GuardThread run() ENTRY
 *   [KG] isIllegalKeyboard in="<ASK>" -> true   (repeating every 300-1000ms)
 *   ...
 *   (after user picks Honeyboard from the picker)
 *   [KG] handleMessage what=MSG_SET_ACTIVE(4)
 *   [KG] isIllegalKeyboard in="<honeyboard>" -> false
 *   [KG] GuardThread run() EXIT
 *
 * If the log diverges from this sequence, the static model needs adjustment
 * before writing a bypass — share the log first.
 */

Java.perform(function () {
    const TAG_KG  = "[KG]";
    const TAG_NB  = "[NB]";
    const TAG_IMM = "[IMM]";

    let KG, KGHH, KGT, NB, IMM;
    try {
        KG   = Java.use("runtime.keyboardGuard.KeyboardGuard");
        KGHH = Java.use("runtime.keyboardGuard.KeyboardGuard$KeyboardGuardHookHandler");
        KGT  = Java.use("runtime.keyboardGuard.KeyboardGuard$KeyboardGuardThread");
        NB   = Java.use("runtime.loading.NativeBridge");
        IMM  = Java.use("android.view.inputmethod.InputMethodManager");
    } catch (e) {
        console.log("[!!] Class resolution failed: " + e);
        return;
    }

    function msgName(what) {
        if (what === 2) return "MSG_BIND(2)";
        if (what === 4) return "MSG_SET_ACTIVE(4)";
        if (what === 9) return "MSG_USER_ACTION_NOTIF(9)";
        return "MSG_OTHER(" + what + ")";
    }

    // 1. handleMessage — Appdome's installed Handler.Callback ------------------
    KGHH.handleMessage.implementation = function (msg) {
        console.log(TAG_KG + " handleMessage what=" + msgName(msg.what.value));
        return this.handleMessage(msg);
    };
    console.log("[+] " + TAG_KG + " KeyboardGuardHookHandler.handleMessage hooked");

    // 2. isIllegalKeyboard — decision logic ------------------------------------
    // Throttled: log first 8 calls verbatim, then every 15th, to keep loop
    // cadence visible without flooding.
    let illegalCount = 0;
    KG.isIllegalKeyboard.implementation = function (str) {
        const ret = this.isIllegalKeyboard(str);
        illegalCount++;
        if (illegalCount <= 8 || illegalCount % 15 === 0) {
            console.log(TAG_KG + " isIllegalKeyboard in=\"" + str + "\" -> " + ret +
                        " (call #" + illegalCount + ")");
        }
        return ret;
    };
    console.log("[+] " + TAG_KG + " KeyboardGuard.isIllegalKeyboard hooked");

    // 3. KeyboardGuardThread.run — force-close DoS loop ------------------------
    KGT.run.implementation = function () {
        console.log(TAG_KG + " GuardThread run() ENTRY -- DoS loop starting");
        try {
            this.run();
        } finally {
            console.log(TAG_KG + " GuardThread run() EXIT  -- loop terminated");
        }
    };
    console.log("[+] " + TAG_KG + " KeyboardGuardThread.run hooked");

    // 4. NativeBridge.shouldBlockEvent — native gate ---------------------------
    NB.shouldBlockEvent.implementation = function (eventId) {
        const ret = this.shouldBlockEvent(eventId);
        if (eventId === "b96e7a45095f5ed683d3169f4c7196ee") {
            console.log(TAG_NB + " shouldBlockEvent KEYBOARD eventId=" + eventId + " -> " + ret);
        }
        return ret;
    };
    console.log("[+] " + TAG_NB + " NativeBridge.shouldBlockEvent hooked (filtered to keyboard)");

    // 5. showInputMethodPicker — picker dialog forced open ---------------------
    IMM.showInputMethodPicker.implementation = function () {
        console.log(TAG_IMM + " showInputMethodPicker called -- picker dialog forced");
        return this.showInputMethodPicker();
    };
    console.log("[+] " + TAG_IMM + " InputMethodManager.showInputMethodPicker hooked");

    console.log("\n[*] === A1 KeyboardGuard recon active (no bypass) ===");
    console.log("[*] 1. AnySoftKeyboard must be the default IME before launching the app.");
    console.log("[*] 2. Tap any text field. Expected log sequence is in the script header.");
    console.log("[*] 3. If the log diverges, share it before writing a bypass.\n");
});
