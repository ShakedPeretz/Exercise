/*
 * diag_a1_keyboardguard.js — Why didn't KeyboardGuard fire?
 *
 * Recon installed all 5 hooks but none caught any event, and AnySoftKeyboard
 * worked unobstructed in TimeCard. KeyboardGuard either:
 *   (a) was never invoked (initializeKeyboardGuard not called)
 *   (b) ran but threw a caught reflection exception
 *       (Reflections.handleReflectionException(e, false) only does
 *        printStackTrace() — goes to logcat, not the Frida console)
 *   (c) ran successfully but Android 15's IMM doesn't route through
 *       mH.mCallback the way it did on older versions.
 *
 * This script tells the three cases apart:
 *   - Hook runtime.Reflections.handleReflectionException → surface silent
 *     swallowed exceptions to the Frida console with class + message + stack.
 *   - Wrap KeyboardGuard.initializeKeyboardGuard → log entry / exit / throw.
 *   - Filter Settings.Secure.getString("default_input_method") → see whether
 *     Appdome's logic ever even reads the IME id at runtime.
 *   - At t=6s on main thread: inspect static KG.finishInputLockedMethod
 *     (null = init didn't reach line 140) and walk live IMM instances to
 *     report mH and mH.mCallback class.
 *
 * Procedure (same as recon):
 *   adb -s RFCR10YLNVB shell am force-stop com.hartman.timecard
 *   adb -s RFCR10YLNVB shell am start -n com.hartman.timecard/.MainCheckInActivity
 *   frida -U -n Gadget -l scripts/diag_a1_keyboardguard.js \
 *     | tee solution/evidence/a1_diag.log
 *   Wait at the first Activity for ~10s. Then tap any TextEdit field.
 *
 * Decision tree from the [CHECK] line for IMM #1:
 *   mCallback=KeyboardGuardHookHandler → init OK; problem is in dispatch path
 *     (Android 15 may post messages directly without using mCallback). The
 *     correct bypass surface moves to InputMethodManager binder client level.
 *   mCallback=null → init never set the callback. Look at [REFL-FAIL] /
 *     [INIT] lines to see why. Likely: mH or mCallback field renamed/removed
 *     on API 35; finishInputLocked method renamed; or whole init never ran.
 *   mCallback=<other class> → some other library or app code holds the slot.
 */

Java.perform(function () {
    let KG, Reflections, Settings_Secure, Handler, ThrowableCls;
    try {
        KG              = Java.use("runtime.keyboardGuard.KeyboardGuard");
        Reflections     = Java.use("runtime.Reflections");
        Settings_Secure = Java.use("android.provider.Settings$Secure");
        Handler         = Java.use("android.os.Handler");
        ThrowableCls    = Java.use("java.lang.Throwable");
    } catch (e) {
        console.log("[!!] class resolution failed: " + e);
        return;
    }

    // 1. Surface silent reflection failures ----------------------------------
    try {
        Reflections.handleReflectionException.implementation = function (exc, z) {
            try {
                const cls = exc.getClass().getName();
                const msg = exc.getMessage();
                console.log("[REFL-FAIL] " + cls + ": " + msg + "  (exiting=" + z + ")");
                const sw = Java.use("java.io.StringWriter").$new();
                const pw = Java.use("java.io.PrintWriter").$new(sw);
                exc.printStackTrace(pw);
                const stack = sw.toString();
                // First 8 lines is enough to identify the call site
                const lines = stack.split("\n").slice(0, 10).join("\n");
                console.log("[REFL-FAIL] stack:\n" + lines);
            } catch (e2) {
                console.log("[REFL-FAIL] (logging failure: " + e2 + ")");
            }
            return this.handleReflectionException(exc, z);
        };
        console.log("[+] Reflections.handleReflectionException hooked");
    } catch (e) { console.log("[-] handleReflectionException hook: " + e); }

    // 2. Wrap initializeKeyboardGuard ----------------------------------------
    try {
        KG.initializeKeyboardGuard.implementation = function () {
            console.log("[INIT] KeyboardGuard.initializeKeyboardGuard ENTRY");
            try {
                this.initializeKeyboardGuard();
                console.log("[INIT] KeyboardGuard.initializeKeyboardGuard EXIT (returned normally)");
            } catch (e) {
                console.log("[INIT] KeyboardGuard.initializeKeyboardGuard threw uncaught: " + e);
                throw e;
            }
        };
        console.log("[+] KeyboardGuard.initializeKeyboardGuard hooked");
    } catch (e) { console.log("[-] initializeKeyboardGuard hook: " + e); }

    // 3. Settings.Secure.getString filter -------------------------------------
    try {
        Settings_Secure.getString.overload("android.content.ContentResolver", "java.lang.String")
            .implementation = function (cr, key) {
                const ret = this.getString(cr, key);
                if (key === "default_input_method") {
                    console.log("[SECURE] getString(default_input_method) -> \"" + ret + "\"");
                }
                return ret;
            };
        console.log("[+] Settings.Secure.getString hooked (filter: default_input_method)");
    } catch (e) { console.log("[-] Settings.Secure hook: " + e); }

    // 4. Delayed self-check + RE-INVOKE init ---------------------------------
    // The first init runs during MainCheckInActivity.onCreate, often BEFORE
    // Frida finishes attaching. So [INIT]/[REFL-FAIL] won't catch the original
    // call. We re-invoke initializeKeyboardGuard() with hooks in place to
    // observe the exact failure path. finishInputLockedMethod is just
    // re-cached (idempotent). mCallback re-set is also harmless.
    setTimeout(function () {
        Java.scheduleOnMainThread(function () {
            console.log("\n[CHECK] === Post-init state inspection (t=6s) ===");

            // 4a. static field finishInputLockedMethod
            try {
                const fld = KG.class.getDeclaredField("finishInputLockedMethod");
                fld.setAccessible(true);
                const v = fld.get(null);
                if (v === null) {
                    console.log("[CHECK] KG.finishInputLockedMethod = null  -> init didn't reach line 140");
                } else {
                    console.log("[CHECK] KG.finishInputLockedMethod = " + v.toString());
                }
            } catch (e) {
                console.log("[CHECK] finishInputLockedMethod read failed: " + e);
            }

            // 4b. live IMM instances → mH and mH.mCallback
            try {
                let count = 0;
                Java.choose("android.view.inputmethod.InputMethodManager", {
                    onMatch: function (imm) {
                        count++;
                        try {
                            const mHFld = imm.getClass().getDeclaredField("mH");
                            mHFld.setAccessible(true);
                            const mH = mHFld.get(imm);
                            const mHCls = mH ? mH.getClass().getName() : "null";

                            let mCbCls = "null";
                            let appdomeCallback = false;
                            if (mH) {
                                try {
                                    const mCbFld = Handler.class.getDeclaredField("mCallback");
                                    mCbFld.setAccessible(true);
                                    const mCb = mCbFld.get(mH);
                                    if (mCb !== null) {
                                        mCbCls = mCb.getClass().getName();
                                        if (mCbCls.indexOf("KeyboardGuardHookHandler") !== -1) {
                                            appdomeCallback = true;
                                        }
                                    }
                                } catch (e2) {
                                    mCbCls = "<read failed: " + e2 + ">";
                                }
                            }
                            console.log("[CHECK] IMM #" + count +
                                        "  mH=" + mHCls +
                                        "  mCallback=" + mCbCls);
                            if (appdomeCallback) {
                                console.log("[CHECK]   -> Appdome's callback IS installed; problem is downstream of mH dispatch");
                            } else if (mCbCls === "null") {
                                console.log("[CHECK]   -> mCallback is null; init never set it (see [INIT]/[REFL-FAIL])");
                            } else {
                                console.log("[CHECK]   -> mCallback held by something else: " + mCbCls);
                            }
                        } catch (e) {
                            console.log("[CHECK] IMM #" + count + " inspect failed: " + e);
                        }
                    },
                    onComplete: function () {
                        console.log("[CHECK] IMM instances seen: " + count);
                        console.log("[CHECK] === done ===\n");

                        // 4c. Manual re-invocation of initializeKeyboardGuard
                        console.log("[REINVOKE] === manually calling KG.initializeKeyboardGuard() ===");
                        try {
                            KG.initializeKeyboardGuard();
                            console.log("[REINVOKE] returned without throwing");
                        } catch (e) {
                            console.log("[REINVOKE] threw: " + e);
                        }

                        // 4d. Re-inspect mCallback after re-invoke
                        try {
                            Java.choose("android.view.inputmethod.InputMethodManager", {
                                onMatch: function (imm) {
                                    try {
                                        const mHFld = imm.getClass().getDeclaredField("mH");
                                        mHFld.setAccessible(true);
                                        const mH = mHFld.get(imm);
                                        const mCbFld = Handler.class.getDeclaredField("mCallback");
                                        mCbFld.setAccessible(true);
                                        const mCb = mCbFld.get(mH);
                                        const cls = mCb ? mCb.getClass().getName() : "null";
                                        console.log("[REINVOKE] post-state mCallback=" + cls);
                                        if (cls.indexOf("KeyboardGuardHookHandler") !== -1) {
                                            console.log("[REINVOKE] -> SUCCESS: original failure was a timing race; protection now armed");
                                        } else {
                                            console.log("[REINVOKE] -> FAILED: reflection genuinely blocked on this Android version");
                                        }
                                    } catch (e) {
                                        console.log("[REINVOKE] post-state read failed: " + e);
                                    }
                                },
                                onComplete: function () {}
                            });
                        } catch (e) { console.log("[REINVOKE] re-inspect failed: " + e); }
                    }
                });
            } catch (e) {
                console.log("[CHECK] Java.choose IMM failed: " + e);
            }
        });
    }, 6000);

    console.log("\n[*] === A1 diagnostic active ===");
    console.log("[*] Watch order:");
    console.log("[*]   1. [INIT] ENTRY/EXIT lines (or absence) when first Activity loads");
    console.log("[*]   2. [REFL-FAIL] lines if Appdome's reflection silently failed");
    console.log("[*]   3. [SECURE] line whenever default_input_method is read");
    console.log("[*]   4. [CHECK] block at t=6s — verdict on installed callback\n");
});
