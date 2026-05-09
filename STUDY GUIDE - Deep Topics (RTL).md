<style>
body, p, li, ul, ol, h1, h2, h3, h4, h5, h6, blockquote, td, th, div, span {
    direction: rtl;
    text-align: right;
}
table {
    direction: rtl;
}
pre, code, kbd, samp, pre code, pre * {
    direction: ltr !important;
    text-align: left !important;
    unicode-bidi: embed !important;
}
.hljs, .highlight {
    direction: ltr !important;
    text-align: left !important;
}
</style>

<div dir="rtl" lang="he" style="text-align: right;">
# ‏מדריך לימוד עומק — ראיון טכני 2, אפדום (Offensive Researcher)

‏**מטרה**: לתת לך הסבר עמוק על כל נושא שעלה בראיון הראשון, מהיסודות עד לרמה שתאפשר לך לענות בביטחון לראיון השני עם ראש המחלקה.

‏**מבנה**: 10 פרקים. כל פרק עוסק במשפחת מושגים, מתחיל מבסיס ועובר לדיוק. הקפדתי לסמן ⚠️ נושאים שכשלת בהם בראיון הראשון.

‏**איך להשתמש**: לקרוא לפי הסדר. בכל פרק יש תרגולים מומלצים. אם נושא ידוע לך — דלג. אם לא — תרגל לפני שתעבור הלאה.

---

## ‏תוכן עניינים

1. ‏[יסודות מערכת ההפעלה](#פרק-1-יסודות-מערכת-ההפעלה)
2. ‏[זיכרון וירטואלי וקישור דינמי](#פרק-2-זיכרון-וירטואלי-וקישור-דינמי)
3. ‏[ptrace וניפוי שגיאות](#פרק-3-ptrace-וניפוי-שגיאות)
4. ‏[מנגנוני Hooking](#פרק-4-מנגנוני-hooking)
5. ‏[Frida בעומק](#פרק-5-frida-בעומק)
6. ‏[Android Internals](#פרק-6-android-internals)
7. ‏[Anti-debug ו-Anti-tamper](#פרק-7-anti-debug-ו-anti-tamper)
8. ‏[התרחיש מהראיון: Seccomp Cat-and-Mouse](#פרק-8-התרחיש-מהראיון-seccomp-cat-and-mouse)
9. ‏[ARM64 ABI ו-Calling Conventions](#פרק-9-arm64-abi-ו-calling-conventions)
10. ‏[נושאים פתוחים לראיון 2](#פרק-10-נושאים-פתוחים-לראיון-2)
11. ‏[נספח: כל השאלות מהראיון + תשובות מומלצות](#נספח-כל-השאלות-מהראיון--תשובות-מומלצות)

---

# ‏פרק 1: יסודות מערכת ההפעלה

## ‏1.1 תהליכים ותהליכונים (Processes & Threads)

### ‏מה זה process?
‏תהליך הוא **מופע ריצה** של תוכנית. הקרנל מקצה לכל תהליך:
- ‏**Process ID (PID)** — מספר ייחודי
- ‏**Address space** — מרחב כתובות וירטואלי משלו (עוד על זה בפרק 2)
- ‏**File descriptors** — טבלה של קבצים פתוחים
- ‏**`task_struct`** — מבנה ב-kernel שמחזיק את כל המידע על התהליך (מצב, רגיסטרים, signals, capabilities, וכו')

### ‏מה זה thread?
‏Thread הוא **flow of execution** בתוך process. כל ה-threads של אותו process חולקים:
- ‏אותו address space
- ‏אותם file descriptors
- ‏אותם signal handlers (חוץ מ-handlers ספציפיים)

‏לכל thread יש משלו:
- ‏**Stack** (בד"כ 8MB ב-Linux)
- ‏**Thread ID (TID)** — ב-Linux זה גם נקרא PID במובן רחב; `getpid()` מחזיר את ה-PID של ה-thread leader
- ‏**Registers**

### ‏למה זה חשוב לתפקיד?
‏ההגנות של אפדום פועלות במקביל לאפליקציה — בד"כ ב-thread נפרד או native. כשאתה עוקף — אתה צריך להבין באיזה thread רץ הקוד שלך, ובאיזה רץ ההגנה. אם אתה עושה hook ב-thread X אבל ההגנה רצה ב-thread Y — ייתכן שתפספס.

### ‏דוגמה — Frida ב-Android תהליך:
```
process: com.example.banking (PID 12345)
├── Main thread (TID 12345) — UI, Activities
├── Binder threads (TID 12346, 12347...) — IPC עם system
├── GC thread — Garbage collector של ART
├── Frida threads — frida-agent + script execution
└── Appdome thread(s) — הגנות שלהם
```

### ‏תרגול
- ‏`cat /proc/self/status` — לראות את ה-fields שלך
- ‏`ps -eLf` — תהליכים ו-threads
- ‏כתוב תוכנית C עם `pthread_create`, צפה ב-`/proc/[pid]/task/`

---

## ‏1.2 מודל הזיכרון של תהליך

‏כל תהליך ב-Linux/Android מקבל **address space וירטואלי** משלו, מחולק לאזורים:

```
מבנה זיכרון של תהליך (x86_64):

0x7fff_ffff_ffff   ┌────────────────────┐
                   │      Stack         │  ← גדל למטה (rsp)
                   │         ↓          │
                   ├────────────────────┤
                   │                    │
                   │   Memory mapping   │  ← mmap, shared libs
                   │     (heap)         │
                   ├────────────────────┤
                   │       Heap         │  ← גדל למעלה (malloc)
                   │         ↑          │
                   ├────────────────────┤
                   │      .bss          │  ← uninitialized data
                   │      .data         │  ← initialized data
                   │      .rodata       │  ← read-only data (strings)
                   │      .text         │  ← קוד executable (RX)
0x0000_0040_0000   └────────────────────┘
                   │   reserved (NULL)  │
0x0000_0000_0000   └────────────────────┘
```

### ‏חשוב לזכור
- ‏**`.text`** — Read-Only Executable (RX). קוד התוכנית.
- ‏**`.rodata`** — Read-Only (R). מחרוזות, קבועים.
- ‏**`.data` / `.bss`** — Read-Write (RW). משתנים גלובליים.
- ‏**Stack / Heap** — RW.

### ‏למה זה רלוונטי לעקיפה?
‏אם אתה רוצה לערוך פונקציה ב-`.text` (כמו hook inline), אתה לא יכול ישר — חייב **`mprotect`** קודם להפוך את הדף ל-RW. אחרי הכתיבה, ראוי להחזיר ל-RX.

### ‏דוגמת קוד — ערוך `.text` של libc
```c
#include <sys/mman.h>
#include <unistd.h>

void *page_start = (void *)((unsigned long)printf & ~(getpagesize() - 1));

// הפוך RX → RWX
mprotect(page_start, getpagesize(), PROT_READ | PROT_WRITE | PROT_EXEC);

// כתיבה ל-printf prologue
*(unsigned char *)printf = 0xc3;  // 0xc3 = ret instruction (אופ-קוד 1 בייט)
                                    // עכשיו printf מחזיר מיד בלי לעשות כלום

// החזר RX
mprotect(page_start, getpagesize(), PROT_READ | PROT_EXEC);
```

### ‏תרגול
- ‏כתוב את הקוד למעלה והרץ. ראה ש-`printf("hi\n")` לא מדפיס.
- ‏`cat /proc/self/maps` — ראה את כל ה-regions ואת ההרשאות (`r-x`, `rw-`).

---

## ‏1.3 User Mode vs Kernel Mode ⚠️

### ‏הקונספט
‏המעבד רץ ב-**rings** (במונחי x86) או **exception levels** (במונחי ARM). הקרנל רץ ב-ring 0 / EL1, אפליקציות רגילות ב-ring 3 / EL0.

‏**ההבדל המרכזי**: ב-kernel mode, יש גישה **לכל** הזיכרון, ל-IO, ולכל ההוראות (כולל instructions privileged כמו `wrmsr`, `lgdt`, וכו'). ב-user mode — רק לזיכרון של התהליך, וההוראות מוגבלות.

### ‏איך עוברים בין הם?
‏**רק** דרך 4 mechanisms:
1. ‏**Syscall** — בקשה מהאפליקציה לקרנל
2. ‏**Interrupt** — אירוע חיצוני (טיימר, IO, רשת)
3. ‏**Trap / Exception** — הוראה לא-חוקית, page fault, division by zero, **int3 (`0xCC`)**
4. ‏**Signal delivery** — ב-return מ-syscall, kernel מעביר signal לתהליך

### ‏למה זה חשוב לראיון?
‏זה היה **תורם מרכזי** במחיר התרחיש של seccomp. כל פעם שאתה עושה syscall, אתה עובר ל-kernel mode. seccomp עובד ב-kernel mode בדיוק על המעבר הזה.

---

## ‏1.4 Syscalls ⚠️

### ‏מה זה syscall?
‏Syscall הוא **API של הקרנל** — הדרך היחידה לתהליך לבקש שירות מהמערכת (קריאת קובץ, פתיחת רשת, יצירת process חדש).

### ‏דוגמאות
```
read   → קריאה מ-FD
write  → כתיבה ל-FD
open   → פתיחת קובץ
close  → סגירת FD
mmap   → יצירת memory mapping
fork   → יצירת process חדש
execve → טעינת תוכנית חדשה
ptrace → debugging
```

### ‏מספרים סיסטמיים (System Call Numbers)
‏לכל syscall יש **מספר** ייחודי. ב-Linux x86_64:
```
0  = read
1  = write
2  = open
3  = close
9  = mmap
57 = fork
59 = execve
101 = ptrace
317 = seccomp
```

‏ראה את הרשימה המלאה: `<sys/syscall.h>` או `cat /usr/include/asm/unistd_64.h`.

### ‏ABI של syscall ב-x86_64 ⚠️
```
rax = מספר syscall
rdi = ארגומנט 1
rsi = ארגומנט 2
rdx = ארגומנט 3
r10 = ארגומנט 4   (לא rcx — שונה מ-function calls!)
r8  = ארגומנט 5
r9  = ארגומנט 6

ביצוע: instruction `syscall`
ערך החזרה: ב-rax (שלילי = errno)
```

### ‏דוגמה — `write(1, "hi\n", 3)` ב-assembly
```asm
mov rax, 1        ; syscall number = write
mov rdi, 1        ; fd = 1 (stdout)
mov rsi, msg      ; buffer
mov rdx, 3        ; count
syscall           ; trap to kernel
; rax now contains: number of bytes written, או errno שלילי
```

### ‏ABI של syscall ב-ARM64 ⚠️
```
x8  = מספר syscall (שונה מ-x86!)
x0-x7 = ארגומנטים 1-6
ביצוע: instruction `svc #0`
ערך החזרה: ב-x0
```

### ‏דוגמה ARM64 — `read`:
```asm
mov x8, #63       ; syscall number = read (63 ב-ARM64, 0 ב-x86_64!)
mov x0, x19       ; fd
mov x1, x20       ; buf
mov x2, x21       ; count
svc #0
```

### ‏`int 0x80` legacy
‏ב-Linux 32-bit, ה-instruction היה `int 0x80`. ב-64-bit חדש (`syscall`) הוא יותר מהיר. שקד הזכיר את זה בראיון — נכון, אבל בסביבה native של אפדום (ARM64) זה לא רלוונטי.

### ‏libc wrappers vs raw syscall ⚠️
‏כשאתה כותב `read(fd, buf, n)` ב-C — אתה לא קורא לקרנל ישר. אתה קורא ל-libc, ש-libc אז **מכין את הרגיסטרים ועושה `syscall`** לבד.

```c
// ב-glibc:
ssize_t read(int fd, void *buf, size_t count) {
    return syscall(SYS_read, fd, buf, count);  // wrapper דק
}
```

### ‏למה זה חשוב לעקיפה?
‏אם תוקף עושה Frida hook על libc `read` (סימבול), הוא **לא תופס** קריאות שעוברות ישירות:
```c
syscall(SYS_read, fd, buf, n);  // עוקף Frida hook ב-libc!
```
‏או assembly גולמי:
```c
asm volatile (
    "mov $0, %%rax\n"
    "syscall"
    : ...
);
```

‏**זה הבסיס של direct memory read שהמראיין הזכיר בראיון.**

### ‏תרגול קריטי
1. ‏כתוב `hello.c` ב-2 דרכים:
   - ‏דרך libc (`write`)
   - ‏דרך `syscall(SYS_write, ...)` ישיר
2. ‏הרץ `strace ./hello` — תראה שהשניים מייצרים **אותו syscall**.
3. ‏עכשיו הרץ עם `LD_PRELOAD` של library שמחליפה `write` — תראה שהראשון נעקף, השני לא.

---

## ‏1.5 Signals ⚠️

### ‏מה זה signal?
‏Signal הוא **הודעה אסינכרונית** מ-kernel ל-process. דוגמאות:
- ‏**`SIGINT`** (2) — Ctrl+C
- ‏**`SIGSEGV`** (11) — page fault, גישה לזיכרון לא חוקי
- ‏**`SIGTRAP`** (5) — breakpoint (`int3`) ⚠️ קריטי
- ‏**`SIGSYS`** (31) — seccomp violation ⚠️ קריטי
- ‏**`SIGKILL`** (9) — terminate (לא ניתן לתפיסה)

### ‏איך מטפלים ב-signal?
‏שלוש אופציות:
1. ‏**default action** — בד"כ terminate. למשל `SIGSEGV` הורג את התהליך
2. ‏**ignore** — `signal(SIGINT, SIG_IGN)`
3. ‏**custom handler** — `sigaction(SIGSEGV, &my_handler, NULL)`

### ‏דוגמת קוד — תפיסת SIGTRAP
```c
#include <signal.h>
#include <stdio.h>

void trap_handler(int sig, siginfo_t *info, void *ucontext) {
    printf("Caught SIGTRAP at addr %p\n", info->si_addr);
    // יכול לערוך את ה-context (רגיסטרים) דרך ucontext_t
}

int main() {
    struct sigaction sa = {
        .sa_sigaction = trap_handler,
        .sa_flags = SA_SIGINFO,
    };
    sigaction(SIGTRAP, &sa, NULL);

    asm("int3");  // יוצר SIGTRAP
    printf("After int3\n");
    return 0;
}
```

### ‏`signal()` vs `sigaction()`
- ‏`signal()` — ישן, לא portable, לא נותן access ל-context
- ‏`sigaction()` — מודרני, נותן `siginfo_t` (איפה הסיגנל הגיע) ו-`ucontext_t` (כל הרגיסטרים) **תמיד להשתמש ב-`sigaction`**.

### ‏חיבור ל-ptrace
‏כשתהליך נתקל ב-`int3` (`0xCC`):
1. ‏CPU זורק exception ⇒ kernel
2. ‏kernel: **האם יש tracer?**
   - ‏אין → שלח SIGTRAP לתהליך עצמו (ברירת מחדל: terminate)
   - ‏יש → kernel **שומר את כל הרגיסטרים ב-`task_struct`**, ומיידע את ה-tracer דרך `wait()`
3. ‏ה-tracer (GDB, Frida) יכול לקרוא/לכתוב את הרגיסטרים, ואז לעשות `PTRACE_CONT`

### ‏חיבור ל-seccomp
‏כש-seccomp filter מחזיר `SECCOMP_RET_TRAP`:
1. ‏ה-syscall נחסם
2. ‏kernel שולח **`SIGSYS`** לתהליך
3. ‏ב-`siginfo_t->si_arch`, `si_syscall` יש מידע איזה syscall נחסם

‏זה איך seccomp יכול לשמש כ-anti-debug "אקטיבי" — לא רק חוסם, אלא שולח signal שאתה תופס ועושה משהו.

### ‏תרגול
- ‏כתוב את הקוד שתפס SIGTRAP. הרץ עם וגם בלי tracer (`gdb ./prog` vs `./prog`).
- ‏כתוב seccomp filter שחוסם `write` עם `RET_TRAP`, ולתפוס את ה-SIGSYS.

---

## ‏1.6 ה-`/proc` filesystem ⚠️

### ‏מה זה?
‏`/proc` הוא **virtual filesystem** ב-Linux. אין דיסק, אין קבצים אמיתיים — כל "קובץ" הוא ממשק לקרנל.

### ‏דוגמאות
```
/proc/cpuinfo                  — מידע על המעבד
/proc/meminfo                  — מידע על הזיכרון הכללי
/proc/[pid]/status             — מידע על תהליך ⚠️
/proc/[pid]/maps               — מפת זיכרון של תהליך ⚠️
/proc/[pid]/cmdline            — שורת הפקודה
/proc/[pid]/exe                — symbolic link ל-binary
/proc/[pid]/fd/                — file descriptors
/proc/self/                    — כינוי ל-/proc/[my_pid]/
```

### ‏`/proc/self/status` — לראיון! ⚠️
```
$ cat /proc/self/status
Name:   bash
Umask:  0022
State:  S (sleeping)
Tgid:   1234
Pid:    1234
PPid:   1233
TracerPid:      0       ← אם != 0, יש debugger צמוד
Uid:    1000    1000    1000    1000
Gid:    1000    1000    1000    1000
Seccomp:        0       ← 0=off, 1=strict, 2=filter ⚠️
NoNewPrivs:     0       ← אם 1, יש seccomp
...
```

### ‏איך זה מיוצר?
‏כש-process עושה `read("/proc/self/status")`, ה-kernel קורא **לפונקציה `proc_pid_status`** ב-`fs/proc/array.c`. הפונקציה מייצרת את הטקסט on-the-fly מ-`task_struct` של התהליך.

‏**אין page cache. אין דיסק. הכל בזיכרון.**

### ‏למה זה רלוונטי?
- ‏**גילוי tracer**: בדיקת `TracerPid != 0`
- ‏**גילוי seccomp**: בדיקת `Seccomp != 0` או `NoNewPrivs == 1`
- ‏**גילוי root**: `Uid: 0` ב-process שאמור להיות user

### ‏`/proc/self/maps` — חיוני ⚠️
```
$ cat /proc/self/maps
55cd80f8d000-55cd80f99000 r--p 00000000 fd:01 1052012 /usr/bin/cat
55cd80f99000-55cd80fa6000 r-xp 0000c000 fd:01 1052012 /usr/bin/cat
55cd80fa6000-55cd80fab000 r--p 00019000 fd:01 1052012 /usr/bin/cat
7f1234567000-7f1234589000 r-xp 00000000 fd:01 9876543 /usr/lib/libc.so.6
...
7f1234abc000-7f1234abf000 rwxp 00000000 00:00  0       /memfd:frida-agent (deleted)
```

### ‏למה זה רלוונטי לאפדום?
‏`/proc/self/maps` חושף **את כל הספריות הטעונות בזיכרון**. אם Frida נטען — תראה `frida-agent.so` או `frida-gadget.so` או memfd חשוד. **זה הבסיס של anti-Frida detection.**

### ‏תרגול
- ‏`cat /proc/self/maps | grep -E "rwx|memfd"` — חפש regions חשודים
- ‏`cat /proc/[pid]/status | grep -E "Seccomp|TracerPid|NoNewPriv"`
- ‏כתוב סקריפט C שקורא את `/proc/self/maps` ומדפיס regions עם `rwx` (סימן ל-JIT או hook engine)

---

# ‏פרק 2: זיכרון וירטואלי וקישור דינמי

## ‏2.1 Virtual Memory

### ‏הקונספט
‏לכל תהליך **address space** משלו (16 EB ב-64-bit). הכתובות הן **וירטואליות** — ה-CPU מתרגם אותן לכתובות פיזיות דרך **page tables**.

### ‏Pages
- ‏Page = יחידת זיכרון בסיסית, בד"כ **4 KB**
- ‏כל page יכולה להיות:
  - ‏מופה לזיכרון פיזי
  - ‏swapped to disk
  - ‏לא קיימת (NULL pointer)
- ‏ל-page יש הרשאות: **R, W, X** (קריאה, כתיבה, ביצוע)

### ‏Page Fault
‏אם תהליך ניגש לכתובת לא-מופית → CPU זורק **page fault exception** → kernel מטפל:
- ‏אם הכתובת חוקית (lazy alloc, swapped) → kernel מטפל ומחזיר
- ‏אם לא חוקית → kernel שולח **SIGSEGV**

### ‏Memory Protection
‏ה-kernel אוכף את ההרשאות. נסיון לכתוב ל-R-only → SIGSEGV. נסיון לבצע ב-non-X → SIGSEGV.

---

## ‏2.2 `mmap` ו-`mprotect`

### ‏`mmap`
‏Syscall ליצירת memory mapping. אפשר:
- ‏**Anonymous** — RAM גרידא
- ‏**File-backed** — מיפוי קובץ לזיכרון

```c
void *addr = mmap(
    NULL,                         // address (NULL = let kernel choose)
    4096,                         // length
    PROT_READ | PROT_WRITE,       // permissions
    MAP_PRIVATE | MAP_ANONYMOUS,  // flags
    -1, 0                         // fd, offset
);
```

### ‏`mprotect`
‏שינוי הרשאות של page קיים:
```c
mprotect(addr, 4096, PROT_READ | PROT_EXEC);
```

### ‏W^X (Write XOR Execute)
‏חוק אבטחה: page לא יכול להיות גם RW וגם RX באותו זמן. זה מקשה על buffer overflows שיוצרים shellcode בסטאק. **Frida עוקפת** ע"י `mprotect` שמחליף בין RW ל-RX לפי צורך.

### ‏מה זה קשור לעקיפה?
‏כל hook engine (Frida) צריך:
1. ‏למצוא דף בתחילת פונקציה
2. ‏`mprotect` ל-RW
3. ‏כתוב את ה-JMP
4. ‏`mprotect` חזרה ל-RX

‏ההגנה יכולה לזהות זאת ע"י סריקה של `/proc/self/maps` — חיפוש regions עם `rwx` (סימן ל-JIT).

---

## ‏2.3 פורמט ELF (Executable and Linkable Format)

### ‏מה זה?
‏ELF הוא הפורמט של תוכניות וספריות ב-Linux/Android. דומה ל-PE ב-Windows.

### ‏מבנה
```
ELF Header
   ↓
Program Headers (לטעינה)
   ↓
Section Headers (לקישור)
   ↓
Sections:
   .text       — קוד
   .rodata     — read-only data
   .data       — initialized data
   .bss        — uninitialized data
   .dynsym     — dynamic symbols
   .dynstr     — strings of dynamic symbols
   .got        — Global Offset Table  ⚠️
   .plt        — Procedure Linkage Table  ⚠️
   .rel.dyn    — relocations
   .init_array — constructors
   .fini_array — destructors
```

### ‏תרגול
- ‏`readelf -a /bin/ls | head -100`
- ‏`objdump -d /bin/ls | grep -A5 "main>:"` — disassembly של main
- ‏`objdump -R /bin/ls` — relocations (GOT entries)

---

## ‏2.4 Dynamic Linking

### ‏הבעיה
‏אם כל תוכנית הייתה כוללת את `libc` בעצמה — היו מאות מגה ל-`/usr/bin`. הפתרון: **shared libraries** (`.so` ב-Linux, `.dylib` ב-macOS, `.dll` ב-Windows).

### ‏תהליך
1. ‏כשאתה מקמפל `gcc -o prog prog.c` עם `printf` — ה-linker שם **רק מציין** "צריך `printf` מ-libc"
2. ‏כשהתוכנית רצה, ה-**dynamic linker** (`ld-linux.so`) טוען את libc, ו**ממלא את הכתובת של `printf`** בטבלה ב-prog
3. ‏הכתובת הסופית נקבעת בזמן ריצה (אז זה "**dynamic**")

### ‏lazy binding
‏ב-default, הכתובות לא נפתרות בטעינה — אלא **בקריאה הראשונה**. זה חיסכון בזמן ההפעלה.

---

## ‏2.5 GOT ו-PLT ⚠️ קריטי

### ‏מה זה PLT (Procedure Linkage Table)?
‏טבלה ב-`.plt` שמכילה **stubs קצרים** — קוד שדואג לקרוא לפונקציה דינמית.

### ‏מה זה GOT (Global Offset Table)?
‏טבלה ב-`.got` שמכילה **מצביעי פונקציה** לפונקציות דינמיות.

### ‏איך זה עובד? (lazy binding)
‏דמיין שיש לך `printf` בקוד שלך:

‏**קריאה ראשונה ל-printf:**
```
your_code:
    call  printf@plt           ← קופץ ל-PLT stub

printf@plt:
    jmp   *printf@got(%rip)    ← קופץ למה ש-GOT מצביע אליו
                                 (ראשונה: מצביע ל-resolver)
    push  $0                   ← מספר הסימבול
    jmp   _dl_runtime_resolve  ← dynamic linker resolver
                                 פותר את הכתובת האמיתית של printf,
                                 ושם אותה ב-GOT entry
```

‏**קריאה שנייה ל-printf:**
```
your_code:
    call  printf@plt

printf@plt:
    jmp   *printf@got(%rip)    ← עכשיו GOT מצביע ישירות ל-printf!
                                 קופצים ישר לקוד של libc.
```

### ‏ויזואליזציה
```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│  Your code   │  call   │     PLT      │   jmp   │     GOT      │
│              │────────→│  printf@plt  │────────→│ printf entry │
│ call printf  │         │              │         │              │
└──────────────┘         └──────────────┘         └──────┬───────┘
                                                          │
                                                          ↓
                                               ┌──────────────────┐
                                               │   libc.so        │
                                               │   printf code    │
                                               └──────────────────┘
```

### ‏העקיפה: GOT/PLT Hijacking ⚠️
‏**הקוד הקסום**: כדי לעשות hook על `printf`, **לא צריך לערוך את libc**! מספיק לערוך את ה-GOT entry של ה-process שלך:

```c
// מצא את הכתובת של GOT entry של printf
extern void *_GLOBAL_OFFSET_TABLE_;
void **printf_got = ... ;  // מקבלים מ-`objdump -R`

// שמור את הכתובת המקורית (כדי לקרוא לה אחר כך)
void *original_printf = *printf_got;

// החלף את הכתובת
*printf_got = (void *)my_printf;

// עכשיו, כל קריאה ל-printf בתוכנית הזו → my_printf
```

### ‏הקשר לראיון
‏המראיין שאל: *"איך לעשות hook על `getChar`?"* — התשובה הנכונה היא **GOT/PLT hijacking**. אתה ענית "JMP" כללי, וזה טכניקה נכונה אבל לא הכי נקייה ל-symbols. נכון ל-symbols: לערוך GOT entry.

### ‏Frida ו-GOT
‏ה-`Interceptor.replace(Module.findExportByName("libc.so", "printf"), my_func)` של Frida עושה בדיוק את זה — מעדכן GOT.

### ‏תרגול חובה
1. ‏קומפל תוכנית קטנה: `gcc -o test test.c` עם `printf("hello\n")`
2. ‏`objdump -R test | grep printf` — תראה GOT entry
3. ‏הרץ ב-GDB, breakpoint על main, צפה ב-`printf@got` לפני ואחרי הקריאה הראשונה
4. ‏כתוב hook engine ב-C: 50 שורות, מחליף printf דרך GOT

### ‏משאבים
- ‏[PLT and GOT — technovelty](https://www.technovelty.org/linux/plt-and-got-the-key-to-code-sharing-and-dynamic-libraries.html) — חובה
- ‏[Eli Bendersky — PIC in shared libraries](https://eli.thegreenplace.net/2011/11/03/position-independent-code-pic-in-shared-libraries)

---

# ‏פרק 3: ptrace וניפוי שגיאות

## ‏3.1 מה זה ptrace?

### ‏תיאור
‏`ptrace` (Process Trace) הוא **ה-syscall ש-GDB משתמש בו**. הוא מאפשר ל-process אחד (**tracer**) לשלוט ב-process אחר (**tracee**):
- ‏לקרוא ולכתוב את הזיכרון שלו
- ‏לקרוא ולכתוב את הרגיסטרים שלו
- ‏לעצור ולהמשיך אותו
- ‏לקבל הודעות על אירועים (signals, syscalls, fork)

### ‏חתימה
```c
long ptrace(enum __ptrace_request request, pid_t pid, void *addr, void *data);
```

### ‏Requests עיקריים
```c
PTRACE_TRACEME      // קריאה מה-child: "תהיה מוכן ש-parent יעקוב"
PTRACE_ATTACH       // התחבר ל-tracee קיים
PTRACE_DETACH       // התנתק
PTRACE_PEEKTEXT     // קריאת זיכרון של tracee
PTRACE_POKETEXT     // כתיבת זיכרון של tracee
PTRACE_GETREGS      // קריאת רגיסטרים
PTRACE_SETREGS      // כתיבת רגיסטרים
PTRACE_SINGLESTEP   // ריצת הוראה אחת
PTRACE_CONT         // המשך ריצה
PTRACE_SYSCALL      // המשך, אבל עצור ב-syscall entry/exit
```

---

## ‏3.2 int3 ו-breakpoints ⚠️ קריטי

### ‏איך GDB יוצר breakpoint?
1. ‏אתה אומר ב-GDB: `break main`
2. ‏GDB עושה `ptrace(PTRACE_PEEKTEXT, pid, &main, ...)` — קורא את הבייט הראשון של main
3. ‏GDB **שומר את הבייט המקורי**
4. ‏GDB עושה `ptrace(PTRACE_POKETEXT, pid, &main, 0xCC)` — כותב **`0xCC`** (int3) במקום
5. ‏GDB עושה `PTRACE_CONT`

### ‏מה קורה בריצה?
1. ‏ה-tracee רץ עד שהוא מגיע ל-`main`
2. ‏ה-CPU מבצע את הבייט `0xCC` → **exception**
3. ‏kernel מקבל את ה-exception:
   - ‏**שומר את כל הרגיסטרים ב-task_struct**
   - ‏**שולח SIGTRAP לתהליך**
4. ‏**kernel רואה שיש tracer** (PTRACE_ATTACH) → במקום להעביר את ה-signal לתהליך, **מודיע ל-tracer דרך `wait()`**
5. ‏ה-tracee עומד דום

### ‏מה GDB עושה אז?
1. ‏`wait()` מחזיר עם status שמראה SIGTRAP
2. ‏GDB עושה `PTRACE_GETREGS` — קורא את הרגיסטרים מ-task_struct
3. ‏GDB מציג ל-user: "Hit breakpoint at main"
4. ‏כשהuser אומר `continue`:
   - ‏GDB **כותב חזרה את הבייט המקורי** (PTRACE_POKETEXT)
   - ‏GDB עושה `PTRACE_SINGLESTEP` — הוראה אחת בדיוק
   - ‏GDB **כותב שוב את `0xCC`** (כדי שה-breakpoint יישאר)
   - ‏`PTRACE_CONT`

### ‏זה היה האחזק שלך בראיון!
‏המראיין שאל: *"מה קורה כשנתקלים ב-int3?"* — אתה אמרת "אינטרפט". התשובה הנכונה:
> ‏*"int3 יוצר exception בידי ה-CPU. ה-kernel מטפל ושולח SIGTRAP. אם יש tracer — kernel **שומר את כל הרגיסטרים ב-task_struct** ומודיע ל-tracer. ה-tracer קורא את הרגיסטרים, אולי מערוך, אז עושה PTRACE_CONT."*

### ‏תרגול
- ‏כתוב mini-debugger ב-C, 100 שורות:
  - ‏`fork()`, child עושה `PTRACE_TRACEME` ואז `execve("./victim")`
  - ‏parent עושה `wait()`, אז loop של `PTRACE_SINGLESTEP` + `PTRACE_GETREGS`
  - ‏ידפיס כל instruction
- ‏מאמר: [Eli Bendersky — How Debuggers Work, part 2: breakpoints](https://eli.thegreenplace.net/2011/01/27/how-debuggers-work-part-2-breakpoints)

---

## ‏3.3 PTRACE_TRACEME — anti-debug קלאסי

### ‏הטריק
‏שיטה ל-anti-debug: process עושה **`ptrace(PTRACE_TRACEME, 0, 0, 0)` על עצמו**. אם כבר יש tracer — ה-call נכשל.

```c
#include <sys/ptrace.h>
#include <stdio.h>

int main() {
    if (ptrace(PTRACE_TRACEME, 0, NULL, NULL) == -1) {
        printf("Being debugged! Exiting.\n");
        return 1;
    }
    printf("Not being debugged. Continuing.\n");
    // ... rest of program
}
```

### ‏ה-bypass
- ‏**`LD_PRELOAD`** + `ptrace` שמחזירה תמיד 0
- ‏**Frida hook** על `ptrace` שמחזיר 0
- ‏**Patching ידני** של ה-binary שיחליף את ה-call

### ‏למה זה רלוונטי?
‏זה שאלה קלאסית בראיונות offensive. הזכרתי לך — בראיון הבא אם שואלים *"איך אפליקציה יכולה לזהות שיש GDB מחובר?"* — **PTRACE_TRACEME** היא התשובה הראשונה.

---

# ‏פרק 4: מנגנוני Hooking

## ‏4.1 סקירה כללית — 7 דרכים לעשות hook

| שיטה | רמה | יתרון | חסרון |
|---|---|---|---|
| LD_PRELOAD | dynamic linker | פשוט, לא דורש hook engine | לא עובד על setuid; symbol-only |
| GOT/PLT hijacking | dynamic linker | נקי לסימבולים דינמיים | רק לפונקציות מ-shared libs |
| Inline hooking (trampoline) | runtime | עובד על כל פונקציה | מורכב, יכול לפגוע במערכת |
| ptrace breakpoints | tracer | הכי גמיש | איטי, לא scalable |
| Seccomp RET_TRAP | kernel | חזק, רץ ב-kernel | יכול לחסום, לא לערוך args |
| eBPF uprobes | kernel | מעקב יעיל מ-kernel | דורש hardening tools |
| vtable / function pointers | source | פשוט אם יש access | לא עובד על קוד zachem |

### ‏הקשר לראיון
‏המראיין שאל *"איך עוד אפשר להשתלט על flow?"* — אתה ענית עם 1-2 דרכים. **בראיון הבא, רשום את 7 הדרכים בראש**.

---

## ‏4.2 LD_PRELOAD ⚠️ פער ידוע

### ‏הקונספט
‏ב-Linux, ה-dynamic linker (`ld-linux.so`) טוען shared libraries לפני התוכנית עצמה. אפשר לכפות עליו לטעון library משלך **לפני libc** דרך environment variable:

```bash
LD_PRELOAD=./mylib.so ./victim
```

### ‏דוגמה
‏**`mylib.c`**:
```c
#define _GNU_SOURCE
#include <stdio.h>
#include <dlfcn.h>

int rand(void) {
    return 4;  // chosen by fair dice roll, guaranteed to be random
}

// או עם chaining ל-original:
size_t strlen(const char *s) {
    static size_t (*orig_strlen)(const char *) = NULL;
    if (!orig_strlen)
        orig_strlen = dlsym(RTLD_NEXT, "strlen");

    fprintf(stderr, "strlen called on '%s'\n", s);
    return orig_strlen(s);
}
```

‏**Compile**:
```bash
gcc -shared -fPIC -o mylib.so mylib.c -ldl
LD_PRELOAD=./mylib.so ./victim
```

### ‏למה זה עובד?
‏ה-dynamic linker, כשהוא מחפש סימבול (כמו `rand`), הוא **מעדיף את הראשון שהוא מוצא**. עם `LD_PRELOAD`, ה-library שלך נטען ראשון, ולכן הסימבולים שלו "מנצחים".

### ‏למה זה לא עובד תמיד?
- ‏**setuid binaries** — `LD_PRELOAD` מתעלמים ממנו (security hardening)
- ‏**statically linked binaries** — אין dynamic linker
- ‏**android** — ב-API חדשים יש מגבלות

### ‏בראיון הבא
‏אם ישאלו *"מה זה LD_PRELOAD?"* — ענה ב-30 שניות:
> ‏*"LD_PRELOAD הוא env var שגורם ל-dynamic linker לטעון library שלי לפני libc. כל סימבול ב-library שלי מנצח את libc, אז אני יכול להחליף `rand`, `strlen`, או כל פונקציה אחרת. זה לא עובד על setuid או static binaries."*

### ‏תרגול חובה
1. ‏כתוב את `mylib.c` למעלה
2. ‏הרץ עם תוכנית פשוטה
3. ‏נסה לעשות LD_PRELOAD על `/usr/bin/sudo` — תראה שזה לא עובד (setuid)

---

## ‏4.3 GOT/PLT Hijacking

‏ראה פרק 2.5. הסבר מלא שם.

---

## ‏4.4 Inline hooks (trampoline) ⚠️ קריטי

### ‏הבעיה
‏מה אם הפונקציה לא מ-shared library? מה אם היא ב-binary עצמו ולא ב-GOT? אז GOT/PLT hijacking לא עובד.

### ‏הפתרון: Inline hook
‏לשנות את הקוד עצמו ב-`.text`, להוסיף JMP בתחילת הפונקציה.

### ‏הקושי
‏אי אפשר פשוט "לכתוב JMP" — ה-instructions של x86_64 (ו-ARM64) הן באורך משתנה. אם ה-prologue הראשון של הפונקציה היה:
```
push rbp                    ; 1 byte
mov  rbp, rsp               ; 3 bytes
sub  rsp, 0x10              ; 4 bytes
mov  [rbp-8], rdi           ; 4 bytes
```

‏ואני מחליף ב-`jmp my_hook` (5 bytes), אני **דורסת חלק מההוראות**! איך הפונקציה תרוץ אם תרצה לחזור אליה?

### ‏Trampoline! ⚠️
‏**Trampoline** = buffer בזיכרון נפרד, שמכיל:
1. ‏**את ההוראות שדרסתי** (העתקה מדויקת)
2. ‏**JMP חזרה** לפונקציה המקורית, אחרי האזור שדרסתי

### ‏דיאגרמה
```
לפני ה-hook:

target_function:
    push rbp        ┐
    mov  rbp, rsp   ├─ 8 bytes — המקום לדריסה
    sub  rsp, 0x10  ┘
    mov  [rbp-8], rdi
    ...

אחרי ה-hook:

target_function:
    jmp  my_hook   ; 5 bytes JMP relative + nop padding
    nop           ; padding ל-8 bytes
    nop
    nop
    mov  [rbp-8], rdi
    ...

trampoline (ב-mmap RX):
    push rbp        ┐
    mov  rbp, rsp   ├─ ה-prologue שדרסתי
    sub  rsp, 0x10  ┘
    jmp  target_function + 8  ; קופץ אחרי האזור שדרסתי
```

### ‏ב-runtime
```
1. ה-victim קורא ל-target_function
2. ה-CPU מבצע את ה-JMP החדש → my_hook
3. my_hook עושה מה שהיא רוצה (לוג, modify args, וכו')
4. my_hook יכולה לקרוא ל-target_function "המקורית" — דרך ה-trampoline:
   trampoline → prologue המקורי → continue from target_function + 8
5. החזרה ל-my_hook
6. my_hook מחזיר ל-victim
```

### ‏למה זה הסבר מורכב?
‏**זה בדיוק מה שמראיין רצה לשמוע ממך — ואתה לא ידעת**. בראיון הבא, ב-pitch של 60 שניות:

> ‏*"Inline hook עובד ככה: אני בוחר פונקציה — נגיד `getChar`. כותב במקום ה-prologue שלה JMP לקוד שלי. אבל לפני זה, אני **מעתיק את ה-prologue** למקום נפרד בזיכרון, שאני קורא לו **trampoline**. ב-trampoline אני שם את ההוראות המקוריות, ואחריהן JMP לפונקציה המקורית — אבל מ-offset שאחרי האזור שדרסתי. ככה הקוד שלי יכול לקרוא לפונקציה 'המקורית' כשרוצה — דרך ה-trampoline. זה איך ש-`Frida.Interceptor.attach` עובד מאחורי הקלעים."*

### ‏בעיות
- ‏**Concurrency**: אם thread אחר רץ באותו רגע, הוא יכול לקרוא חלק חדש וחלק ישן. הפתרון: עצירת תהליכים, או atomic 8-byte writes.
- ‏**Variable-length instructions**: צריך disassembler קטן כדי לדעת איזה instructions להעתיק. (Frida משתמש ב-Capstone.)
- ‏**Jump distance**: ב-x86_64, JMP relative הוא 32-bit. אם ה-trampoline רחוק יותר מ-±2GB, צריך 64-bit JMP (יותר ארוך).

### ‏Frida-gum source
‏התסתכל על: [`gum/arch-x86/gumx86relocator.c`](https://github.com/frida/frida-gum) — disassembler relocator לבילת ה-prologue.

### ‏תרגול חובה
1. ‏כתוב hook engine ב-C על Linux x86_64:
   - ‏`mprotect(target, RWX)`
   - ‏`memcpy(trampoline, target, 8)` — העתקת prologue
   - ‏כתוב JMP ב-trampoline אחרי 8 הבייטים: יחסי ל-target+8
   - ‏כתוב JMP ב-target → my_hook
   - ‏`mprotect(target, RX)`
2. ‏תוכנית נדגמת עם פונקציה `int add(int a, int b)`. ה-hook מודיע ערכים ומחזיר 42.
3. ‏ודא שאתה יכול לקרוא ל-"add" המקורית מתוך ה-hook (דרך ה-trampoline).

---

## ‏4.5 ptrace-based hooks
‏ראה פרק 3. כשאתה משתמש ב-`PTRACE_POKETEXT` להציב breakpoint, אתה למעשה עושה hook (פונקציה שלך תרוץ במקום הקוד המקורי).

---

## ‏4.6 Seccomp-BPF ⚠️ קריטי
‏ראה פרק 8 — הפרק כולו על זה.

---

## ‏4.7 eBPF (uprobes/kprobes)

### ‏מה זה?
‏**eBPF** (extended Berkeley Packet Filter) הוא טכנולוגיה ב-Linux שמאפשרת **להריץ קוד בקרנל** בצורה בטוחה (verified). שימושים:
- ‏**Networking** — XDP, packet filtering
- ‏**Observability** — bpftrace, perf
- ‏**Security** — Cilium, Falco

### ‏kprobe vs uprobe
- ‏**kprobe** — hook על פונקציה ב-kernel (`tcp_sendmsg`, `do_open`)
- ‏**uprobe** — hook על פונקציה ב-userspace (`malloc`, `fopen`)
- ‏**tracepoint** — hook על אירוע מובנה (`syscall_enter`, `sched_switch`)

### ‏דוגמה — bpftrace
```bash
# מעקב כל syscall של תהליך
sudo bpftrace -e 'tracepoint:syscalls:sys_enter_* /pid == 12345/ { @[probe] = count(); }'
```

### ‏למה זה רלוונטי לאפדום?
‏ב-Android חדש (12+) יש eBPF מובנה. anti-Frida defenders חדשים משתמשים ב-eBPF כי:
1. ‏eBPF רץ ב-kernel — מחוץ להישג של Frida (שזה userspace)
2. ‏eBPF יכול לקבוע policies שיגרמו ל-process חשוד להיהרג
3. ‏ה-overhead נמוך

‏**רלוונטי לראיון 2** — ראש המחלקה ככל הנראה מודע ל-trends אלו.

### ‏תרגול
- ‏התקן `bpftrace`
- ‏הרץ `bpftrace -e 'tracepoint:syscalls:sys_enter_open { printf("%s\n", str(args->filename)); }'`
- ‏קרא: *"Learning eBPF"* של Liz Rice

---

## ‏4.8 vtables / Function pointers

### ‏הקונספט
‏ב-C++, כל מחלקה עם methods וירטואליות מקבלת **vtable** — טבלה של מצביעי פונקציה. ה-instance מחזיק מצביע ל-vtable.

```cpp
class Animal {
public:
    virtual void speak() { cout << "..."; }
};

class Dog : public Animal {
public:
    void speak() override { cout << "Woof!"; }
};

Animal *a = new Dog();
a->speak();   // → Dog::speak דרך vtable
```

### ‏בזיכרון
```
Dog instance:
+0  → vptr → Dog vtable:
                +0  → Dog::speak
                +8  → Dog::dtor
                ...
+8  → fields...
```

### ‏עקיפה
‏ערוך את ה-vtable או את ה-vptr → כל הקריאות יעברו לפונקציה שלך:
```c
void *fake_vtable[] = {
    my_speak,
    my_dtor,
};
*((void ***)dog_instance) = fake_vtable;
```

### ‏למה זה רלוונטי?
- ‏**Native Android apps** משתמשים ב-C++ הרבה — ART בעצמו ב-C++
- ‏אם אתה מוצא vtable של ההגנה — יכול להחליף method
- ‏חלק מ-anti-Frida techniques של Appdome כנראה משתמשים ב-vtables

---

# ‏פרק 5: Frida בעומק

## ‏5.1 ארכיטקטורה של Frida

### ‏3 הרכיבים
```
┌──────────────────────────────────┐
│  Your script (frida-python/JS)   │  ← מה שאתה כותב
└──────────────┬───────────────────┘
               │ control protocol
               ↓
┌──────────────────────────────────┐
│  frida-core                      │  ← daemon: management
└──────────────┬───────────────────┘
               │ injects into target
               ↓
┌──────────────────────────────────┐
│  frida-agent (in target process) │  ← runs inside victim
│  ├── frida-gum (instrumentation) │
│  ├── V8/QuickJS (JS engine)      │
│  └── frida-java-bridge (Java)    │
└──────────────────────────────────┘
```

### ‏הרכיבים
- ‏**frida-core** — daemon ב-host שמנהל את הסשן
- ‏**frida-gum** — מנוע ה-instrumentation בעצמו (C library): `Interceptor`, `Stalker`, `Memory`
- ‏**frida-agent** — נטען לתוך ה-target כ-`.so`. הוא מכיל את frida-gum ו-JS engine
- ‏**frida-java-bridge** — שכבה ל-Java/ART hooks (מבוסס על reflection ועריכת ART internals)

---

## ‏5.2 frida-server vs frida-gadget ⚠️

### ‏frida-server
- ‏**Daemon נפרד** שרץ במכשיר עם **root**
- ‏מקבל פקודות מ-host
- ‏עושה `PTRACE_ATTACH` על ה-target → מזריק את `frida-agent.so`
- ‏**דורש root** כי ptrace חיצוני דורש `CAP_SYS_PTRACE` או אותו UID

### ‏frida-gadget ⚠️
- ‏**`.so` שמוטמע בתוך ה-APK**
- ‏נטען **כחלק מהתהליך** — דרך `System.loadLibrary` או הזרקה ב-AndroidManifest
- ‏**לא דורש root** — כי הוא רץ בתוך ה-process עצמו, לא צריך ptrace
- ‏שני modes:
  - ‏**listen** — מחכה לחיבור מ-host
  - ‏**script** — מריץ סקריפט שכבר מוטמע

### ‏מה אתה עשית
‏ה-`objection patchapk -s app.apk` עשה:
1. ‏הוריד את frida-gadget המתאים לארכיטקטורה (arm64-v8a)
2. ‏שינה את AndroidManifest כדי שהאפליקציה תטען את ה-gadget
3. ‏חתם מחדש את ה-APK

### ‏למה לא root?
‏כי frida-gadget רץ **בתוך התהליך** של האפליקציה, מה-`onCreate` של ה-Application class. אין צורך ב-tracer חיצוני.

### ‏בראיון הבא
‏אם שואלים *"מה ההבדל בין frida-server ל-frida-gadget?"*:
> ‏*"frida-server דורש root כי הוא משתמש ב-ptrace חיצוני להזרקה. frida-gadget הוא `.so` שמוטמע ב-APK ונטען כחלק מהתהליך — לא דורש ptrace, ולכן לא root. השני הוא נכון לסביבות לא-rooted, וזה מה שעשיתי במטלה."*

---

## ‏5.3 `Interceptor.attach` — Inline hook

### ‏הקוד שאתה כותב:
```javascript
Interceptor.attach(Module.findExportByName("libc.so", "open"), {
    onEnter(args) {
        const path = args[0].readCString();
        console.log(`open(${path})`);
    },
    onLeave(retval) {
        console.log(`returned: ${retval}`);
    }
});
```

### ‏מה Frida עושה מאחורי הקלעים
1. ‏**מוצא את ה-target function** — `Module.findExportByName` עובר על `.dynsym` של libc
2. ‏**בודק שאפשר לעשות inline hook** — האם יש מספיק bytes ב-prologue?
3. ‏**מקצה trampoline** עם `mmap` (RWX, או 2 mappings RW+RX)
4. ‏**מעתיק את ה-prologue** של `open` ל-trampoline
5. ‏**`mprotect` על ה-page של `open`** ל-RW
6. ‏**כותב JMP ב-`open`** → לקוד internal של frida-gum (`gum_function_context_dispatcher`)
7. ‏**`mprotect` חזרה** ל-RX
8. ‏ה-dispatcher של frida-gum:
   - ‏שומר את כל הרגיסטרים (כדי לא להשפיע על ה-victim)
   - ‏קורא ל-onEnter שלך
   - ‏קורא ל-trampoline (= prologue + JMP back to original)
   - ‏אחרי שה-original מסיים, קורא ל-onLeave
   - ‏משחזר רגיסטרים, RET

### ‏מה זה אומר
‏אם המראיין ישאל *"איך Interceptor.attach עובד?"* — עכשיו יש לך תשובה ברורה.

---

## ‏5.4 `Interceptor.replace` — GOT/PLT

### ‏הקוד
```javascript
const orig = new NativeFunction(Module.findExportByName("libc.so", "rand"), 'int', []);
const myFunc = new NativeCallback(() => 42, 'int', []);
Interceptor.replace(Module.findExportByName("libc.so", "rand"), myFunc);
```

### ‏ההבדל מ-attach
- ‏**attach** = הפונקציה המקורית עדיין רצה. ה-hook קורא לפניה ואחריה.
- ‏**replace** = הפונקציה המקורית **לא רצה**. הקוד שלך מחליף אותה לחלוטין.

### ‏מאחורי הקלעים
‏לרוב, replace משתמש באותה טכניקת trampoline כמו attach. **אבל**: ל-symbols (פונקציות עם שמות מ-`.dynsym`), Frida יכולה גם להשתמש ב-**GOT/PLT replacement** — להחליף את ה-GOT entry של הסימבול ב-process's GOT.

‏זה ההבדל שדיברנו עליו בפרק 2.5.

---

## ‏5.5 Stalker — DBI Engine ⚠️ פער ידוע

### ‏מה זה?
‏**Stalker** הוא ה-Dynamic Binary Instrumentation engine של Frida. זה לא hook על פונקציה — זה **traceיו של כל instruction** שרץ ב-thread.

### ‏איך זה עובד
1. ‏כשאתה מתחיל Stalker על thread, Frida **משכפל** כל basic block (BB) של הקוד שמתבצע
2. ‏ה-BB המשוכפל מכיל את ההוראות המקוריות, אבל לפני/אחרי כל אחת — Frida יכולה להוסיף callback
3. ‏ה-thread רץ ב-BB המשוכפל במקום ב-original

### ‏דוגמה
```javascript
Stalker.follow({
    events: { call: true },  // log every call instruction
    onReceive(events) {
        console.log("Calls:", events);
    }
});
```

### ‏למה זה רלוונטי לאפדום?
1. ‏Stalker זה הכלי ל**זיהוי anti-Frida**: אם הגנה מסתירה הוראות, Stalker יעלה אותן.
2. ‏**anti-Frida defenders שמים סימוני זיהוי על Stalker** — חיפוש של JIT pages, הוראות חתימה.

### ‏תשובה לראיון
‏אם ישאלו *"מה זה Stalker?"*:
> ‏*"Stalker הוא ה-DBI engine של Frida. במקום להוסיף hook לפונקציה ספציפית, הוא משכפל basic blocks תוך כדי ריצה ויכול להוסיף callbacks על כל instruction. שימושי לזיהוי control flow, malware analysis, ו-coverage. גם הוא הסימן הבולט של Frida לזיהוי — anti-Frida tools מחפשים את ה-JIT pages."*

---

## ‏5.6 Java/ART hooks

### ‏הבעיה
‏Java לא מתקמפל ל-native code (לפחות לא בצורה רגילה). הוא רץ ב-**ART** (Android Runtime).

### ‏איך Frida עוקפת ART?
1. ‏**`Java.use("java.lang.String")`** — Frida מוצאת את ה-`java.lang.Class` של String ב-ART
2. ‏**`String.someMethod.implementation = function(...)`** — Frida מערוכה את ה-`ArtMethod` של ה-method:
   - ‏שדה `entry_point_from_quick_compiled_code_` בתוך struct
   - ‏מצביעה לקוד trampoline שלה

### ‏תוצאה
‏כל קריאה ל-method **תעבור דרך הקוד של Frida**, גם אם ה-method הוא `final`, `private`, או `native`.

### ‏למה זה רלוונטי?
- ‏ההגנות של אפדום ב-Java (אם יש) — Frida יכולה לעקוף
- ‏ההגנה הקלאסית: לזהות אם `ArtMethod->entry_point_from_quick_compiled_code_` שונה מהצפוי

---

## ‏5.7 Frida Detection ⚠️ קריטי

### ‏שיטות לזיהוי Frida (מנוצולת אפדום)
| שיטה | איך לזהות | איך לעקוף |
|---|---|---|
| `/proc/self/maps` | חיפוש `frida-agent.so`, `frida-gadget.so`, `gum-js-loop` | rename, גמיני memory regions |
| TCP port 27042 | Frida-server מקשיב לפורט הזה | rename gadget mode, אל תשתמש בפורט default |
| `/proc/self/status` | TracerPid | hook על read |
| Frida threads | חיפוש thread name `gmain`, `gum-js-loop` | rename |
| Strings ב-memory | `"Frida"`, `"libfrida"` | obfuscate |
| Stalker JIT | RWX pages | use `mprotect` ל-RX אחרי כתיבה |

### ‏תרגול
- ‏כתוב גלאי Frida פשוט ב-C: סורק `/proc/self/maps`, מחפש מחרוזות `frida` או `gum`
- ‏כתוב hook ב-Frida ב-script שעוקף את הגלאי שלך

---

# ‏פרק 6: Android Internals

## ‏6.1 ART Runtime

### ‏מה זה ART?
‏**Android Runtime** — מחליף Dalvik (לפני Android 5). מריץ קוד Java שתורגם ל-DEX bytecode.

### ‏איך מתבצעת קומפילציה?
- ‏**AOT** (Ahead Of Time) — בזמן ההתקנה, ART מתרגם DEX לקוד native (`.oat` files)
- ‏**JIT** — חלק מהקוד מקומפל בזמן ריצה
- ‏**Profile-guided** — Android עוקב מה הכי משומש, ומקדם compile

### ‏`ArtMethod` struct
‏לכל method ב-Java יש struct ב-ART:
```cpp
class ArtMethod {
    GcRoot<Class> declaring_class_;
    uint32_t access_flags_;
    uint32_t dex_method_index_;
    uint16_t method_index_;
    void *entry_point_from_jni_;
    void *entry_point_from_quick_compiled_code_;  // ← Frida עורך את זה
    ...
};
```

### ‏Frida מערוכה את `entry_point_from_quick_compiled_code_`
‏זה השדה שמצביע לקוד הקומפל. כש-Java code קורא ל-method, ART קורא ל-pointer הזה. Frida מחליף ב-pointer לטרמפולינה שלה.

### ‏למה זה רלוונטי?
- ‏Detection: לקרוא את `ArtMethod` של method מוכר ולוודא שהמצביע מצביע לאזור legitimate
- ‏Bypass: לקרוא לכל היכרזת ה-methods דרך JNI

---

## ‏6.2 Application Lifecycle ⚠️ קריטי

### ‏סדר הקריאות בעת התחלת אפליקציה
‏זה הפער הראשון שזיהיתי בראיון 1 — לא ידעת *מתי בדיוק* הגנה נטענת.

```
1. zygote fork()  ← ה-process נוצר מ-Zygote
2. attachBaseContext(ctx)
3. ContentProvider#onCreate (לכל ContentProvider)
4. Application#onCreate
5. Activity#onCreate (של ה-launcher activity)
6. Activity#onStart
7. Activity#onResume
```

### ‏מתי נטען frida-gadget?
‏ב-`System.loadLibrary("frida-gadget")` — שזה בד"כ נקרא מ-`Application#onCreate` או `attachBaseContext`.

### ‏מתי נטענות הגנות?
‏תלוי ב-product. רוב ה-RASPs נטענים ב-**`attachBaseContext`** — זה הכי מוקדם שניתן.

### ‏Implication
‏אם הגנה רצה ב-`attachBaseContext`, אבל ה-frida-gadget שלך רץ ב-`Application#onCreate` — **ההגנה רצה לפני!**

### ‏זה היה הסיפור שלך עם FLAG_SECURE
‏ההגנה הוסיפה את `FLAG_SECURE` כבר ב-`Activity#onCreate` (לפני שהקוד שלך הספיק לעלות), אז ה-hook הראשון שלך (שעצב על `setFlags`) לא תפס. הפתרון: **sweep רטרואקטיבי** על Activities/Windows שכבר קיימים.

### ‏תשובה לראיון
‏אם ישאלו *"איך מתחיל Android process?"*:
> ‏*"Zygote forks → attachBaseContext → ContentProvider onCreate → Application onCreate → Activity onCreate → onStart → onResume. ההגנות בד"כ נטענות הכי מוקדם שאפשר — `attachBaseContext`. זה אומר שאם Frida-gadget נטען ב-Application#onCreate, ההגנה רצה לפניו, ויש פוטנציאל ל-race condition."*

### ‏תרגול
- ‏כתוב Frida script שמדפיס timestamp לכל אחד מהשלבים
- ‏ראה איזה רץ ראשון בפועל

---

## ‏6.3 JNI (Java Native Interface)

### ‏מה זה?
‏JNI הוא הגשר בין Java (ב-ART) ל-native (`.so`).

### ‏דוגמה
‏**Java side**:
```java
public class Crypto {
    static {
        System.loadLibrary("native-lib");
    }
    public native byte[] encrypt(byte[] data);
}
```

‏**Native side** (`native-lib.cpp`):
```cpp
#include <jni.h>

extern "C" JNIEXPORT jbyteArray JNICALL
Java_com_example_Crypto_encrypt(JNIEnv *env, jobject thiz, jbyteArray data) {
    // ... C++ code ...
    return result;
}
```

### ‏`JNI_OnLoad`
‏פונקציה אופציונלית שנקראת **כש-`.so` נטען לראשונה**:
```cpp
extern "C" JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void *reserved) {
    // ... initialization, dynamic registration of natives, anti-debug checks ...
    return JNI_VERSION_1_6;
}
```

### ‏למה רלוונטי לאפדום?
‏ההגנות שלהם בעיקר native. כל ה-anti-debug ב-native רץ ב-`JNI_OnLoad` — זה מוקדם מדי לעצמת ה-hook הרגיל שלך.

### ‏Hooking JNI
‏אפשר לעשות hook על:
- ‏`JNI_OnLoad` — לתפוס מתי ה-`.so` נטען
- ‏`dlopen` — לתפוס *לפני* ש-`.so` עוד נטען
- ‏Functions ב-libdl/libdl.so

---

## ‏6.4 APK Structure & Signing

### ‏מבנה APK
```
app.apk (ZIP):
├── AndroidManifest.xml      (binary XML)
├── classes.dex              (DEX bytecode)
├── classes2.dex             (multi-dex)
├── resources.arsc           (compiled resources)
├── res/                     (XMLs, drawables)
├── assets/                  (raw files)
├── lib/
│   ├── arm64-v8a/
│   │   └── libnative.so
│   └── armeabi-v7a/
│       └── libnative.so
└── META-INF/
    ├── MANIFEST.MF          (file hashes)
    ├── CERT.RSA             (cert + signature)
    └── CERT.SF              (manifest hash)
```

### ‏Signing schemes
- ‏**v1 (JAR signing)** — חתימה על כל קובץ בנפרד. ישן.
- ‏**v2 (APK Signature Scheme v2)** — חתימה על כל ה-APK כ-block. מהיר.
- ‏**v3 (APK Signature Scheme v3)** — תומך ב-key rotation
- ‏**v4** — חתימה ב-streaming, ל-Incremental APK

### ‏למה זה רלוונטי?
- ‏אחרי patching עם apktool, אתה צריך לחתום מחדש (`apksigner`)
- ‏אם אתה רק עורכת זיכרון בריצה (Frida), אין צורך לחתום
- ‏App Integrity (Google Play Protect) בודק חתימה — ה-package שלך ייחתם בעצמך, לא ע"י המפתח המקורי

---

## ‏6.5 Smali / DEX / Apktool ⚠️

### ‏מה זה DEX?
‏**Dalvik EXecutable** — bytecode format של Android. דומה ל-Java bytecode (.class) אבל אופטמיזציה למובייל.

### ‏מה זה Smali?
‏**Smali** הוא **assembly-like language** ל-DEX. זה מה שאתה מקבל כשעושה `apktool d app.apk`:

```smali
.method public static doHooks()V
    .registers 1
    new-instance v0, Ljava/lang/Exception;
    invoke-direct {v0}, Ljava/lang/Exception;-><init>()V
    throw v0
.end method
```

### ‏מה אתה עשית במטלה
‏פתחת את הסמלי של `doHooks` והחלפת את הגוף ב-`return-void` (NOP):
```smali
.method public static doHooks()V
    .registers 0
    return-void
.end method
```

‏זה ה-bytecode equivalent של `void doHooks() { return; }`.

### ‏תהליך מלא של static patching
```bash
# 1. פירוק ה-APK
apktool d app.apk -o app_decoded

# 2. עריכת smali (manually או דרך AI/script)
vim app_decoded/smali/com/.../HooksManager.smali

# 3. הרכבה מחדש
apktool b app_decoded -o app_patched.apk

# 4. zipalign (חובה ל-Android 6+)
zipalign -v 4 app_patched.apk app_aligned.apk

# 5. signing
apksigner sign --ks my.keystore --out app_signed.apk app_aligned.apk

# 6. install
adb install app_signed.apk
```

### ‏בראיון הבא
‏אם ישאלו *"מה זה smali?"* — תהיה מוכן עם הדוגמה למעלה.

### ‏תרגול
- ‏קח APK פשוט (Hello World), פרוק, ערוך smali כדי שיציג מחרוזת אחרת, הרכב מחדש

---

## ‏6.6 Network Security Config (User CA vs System CA) ⚠️ קריטי

### ‏הרקע
‏**לפני Android 7 (Nougat)**: כל User-installed CA נסמך ע"י כל אפליקציה. אז התקנת CA של mitmproxy → MitM עובד על כל אפליקציה.

‏**מ-Android 7 ואילך**: אפליקציה לא סומכת על User CAs *אלא אם היא מצהירה במפורש*.

### ‏Network Security Config
‏קובץ `res/xml/network_security_config.xml`:
```xml
<network-security-config>
    <base-config>
        <trust-anchors>
            <certificates src="system" />
            <!-- אם רוצים User CA, מוסיפים: -->
            <certificates src="user" />
        </trust-anchors>
    </base-config>
</network-security-config>
```

### ‏במטלה שלך
‏התקנת CA של mitmproxy כ-User CA. **אם האפליקציה הייתה production, המקלחת הזאת לא הייתה עובדת** — כי ה-config שלה לא היה מאפשר User CAs.

### ‏למה זה עבד אצלך?
‏האפליקציה כנראה ב-debug mode, או מוגדרת לאפשר User CAs (לבדיקות).

### ‏דרכי bypass בייצור
1. ‏**MagiskTrustUserCerts** — Magisk module שמתקין User CAs כ-System CAs
2. ‏**Patching של network_security_config.xml** ב-APK
3. ‏**Frida hook** על `X509TrustManager.checkServerTrusted` — להחזיר תמיד OK
4. ‏**objection** — פיצ'ר `android sslpinning disable`

### ‏תשובה לראיון
‏אם ישאלו על ה-mitmproxy שלך:
> ‏*"התקנתי כ-User CA, אבל זה רק עבד כי האפליקציה במצב development. ב-production, מ-Android 7 אפליקציות לא סומכות על User CAs כברירת מחדל. הייתי צריך לפתח patch ל-`network_security_config.xml` ב-APK, או להשתמש ב-MagiskTrustUserCerts כדי להוסיף User CA ל-System store."*

---

# ‏פרק 7: Anti-debug ו-Anti-tamper

## ‏7.1 שיטות זיהוי דיבוג קלאסיות

### ‏1. PTRACE_TRACEME
‏ראה פרק 3.3.

### ‏2. `/proc/self/status` — TracerPid
```c
FILE *f = fopen("/proc/self/status", "r");
char line[256];
while (fgets(line, sizeof(line), f)) {
    if (strncmp(line, "TracerPid:", 10) == 0) {
        int pid = atoi(line + 10);
        if (pid != 0) {
            printf("Being traced!");
            exit(1);
        }
    }
}
```

### ‏3. Timing checks
‏debugger מאט את הקוד. אם פעולה לוקחת יותר מצפוי → יש debugger.
```c
clock_t start = clock();
// ... some quick code ...
clock_t end = clock();
if ((end - start) > THRESHOLD) panic();
```

‏**Bypass**: hook על `clock` או `gettimeofday`.

### ‏4. Self-modifying code
‏תוכנית שכותבת שוב את הקוד שלה. אם debugger כבר שם breakpoint (`0xCC`), הוא יישאר אחרי הכתיבה — הקוד יחשוף את עצמו.

### ‏5. SIGTRAP handler
‏תוכנית שמתכננת לקבל SIGTRAP בעצמה (כשעושה `int3` כחלק מהלוגיקה הרגילה). אם debugger צמוד, ה-SIGTRAP מועבר אליו במקום, והתוכנית לא מקבלת.

---

## ‏7.2 Anti-Frida Techniques

### ‏1. סריקת `/proc/self/maps`
‏חיפוש: `frida-agent`, `frida-gadget`, `gum-js-loop`, `linjector`.

### ‏2. סריקת thread names
```c
char path[256];
sprintf(path, "/proc/self/task/%d/comm", tid);
FILE *f = fopen(path, "r");
fread(name, 1, 16, f);
if (strstr(name, "gum-js-loop")) panic();
```

### ‏3. Port scan
‏Frida-server מקשיב על TCP 27042. אפליקציה יכולה לנסות חיבור ל-`localhost:27042`.

### ‏4. Memory scan ל-strings
‏חיפוש מחרוזות `"Frida"`, `"GUM_NATIVE_HOOK"`, ב-RW regions.

### ‏5. Symbol scan
‏בדיקה אם `dlsym(RTLD_DEFAULT, "gum_thread_count")` מחזיר value.

---

## ‏7.3 Anti-Root

### ‏1. בדיקת קבצי root
```c
const char *paths[] = {
    "/system/xbin/su", "/system/bin/su", "/sbin/su",
    "/system/app/Superuser.apk", "/data/local/xbin/su"
};
```

### ‏2. Build properties
```c
char ro_debuggable[PROP_VALUE_MAX];
__system_property_get("ro.debuggable", ro_debuggable);
if (strcmp(ro_debuggable, "1") == 0) panic();
```

### ‏3. RootBeer-style checks
‏חיפוש packages: `Superuser`, `Magisk`, `chainfire`. מחיר test-keys ב-Build.

### ‏4. SELinux mode
‏`getenforce` — אם מחזיר `Permissive` במכשיר production → root.

---

## ‏7.4 Multiple-Source-of-Truth ⚠️

### ‏הקונספט (מהראיון)
‏המגן בודק את אותה עובדה ב-3 דרכים שונות. אם כולם מסכימים — ok. אם לא — מישהו עבד.

### ‏דוגמה — TracerPid
```c
// דרך 1: parsing /proc/self/status
int via_status = parse_status_for_tracer_pid();

// דרך 2: prctl
int via_prctl = prctl(PR_GET_DUMPABLE);

// דרך 3: ניסיון לעשות PTRACE_TRACEME על עצמי
int via_ptrace = ptrace(PTRACE_TRACEME, 0, 0, 0);
ptrace(PTRACE_DETACH, 0, 0, 0);

// אם 3 הם לא מסונכרנים → tampering!
if (via_status != via_prctl) panic();
```

### ‏למה זה אפקטיבי
‏כדי לעקוף, התוקף צריך לעשות hook על **כל ה-3 דרכים**. אם הוא חסר אחת — divergence → detection.

### ‏Bypass strategies
1. ‏**בלוק כל המקורות** — hook על read של `/proc/self/status`, על `prctl`, על `ptrace`
2. ‏**שיתוף state** בין ה-hooks — שכל אחד מחזיר את אותו ערך מזויף

---

# ‏פרק 8: התרחיש מהראיון — Seccomp Cat-and-Mouse

‏זה הפרק הכי חשוב — תרחיש שלקח חצי שעה בראיון.

## ‏8.1 Seccomp בעומק

### ‏היסטוריה
- ‏**Seccomp v1 (2005)** — מצב strict — רק `read`, `write`, `exit`, `sigreturn`. שימוש מאוד מוגבל.
- ‏**Seccomp-BPF (2012)** — מצב filter. אפשר להגדיר filters מורכבים על syscalls. ⚠️ זה מה ש-Android, Chrome, OpenSSH משתמשים בו.

### ‏`seccomp` syscall
```c
int seccomp(unsigned int operation, unsigned int flags, void *args);

// או:
int prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &filter_program);
```

### ‏BPF program
‏filter כתוב כ-**BPF bytecode**:
```c
struct sock_filter filter[] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),  // load syscall number
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_open, 0, 1),                   // if open, allow next
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL),                            // else, kill
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),                           // allow
};

struct sock_fprog prog = {
    .len = sizeof(filter) / sizeof(filter[0]),
    .filter = filter,
};

prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &prog);
```

### ‏Actions
- ‏**`SECCOMP_RET_ALLOW`** — תרץ syscall רגיל
- ‏**`SECCOMP_RET_ERRNO | x`** — תחזיר errno x
- ‏**`SECCOMP_RET_KILL`** — הרוג את ה-thread
- ‏**`SECCOMP_RET_TRAP`** — שלח SIGSYS
- ‏**`SECCOMP_RET_TRACE`** — אם יש tracer, אותת לו (PTRACE_O_TRACESECCOMP)

### ‏דוגמה practical
```c
#include <linux/seccomp.h>
#include <sys/prctl.h>

void enable_seccomp() {
    prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0);
    prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &my_program);
}
```

---

## ‏8.2 התרחיש: `/proc/self/status` Detection

### ‏מה ההגנה עושה
1. ‏ב-`Application#onCreate`, מציבה seccomp filter שחוסם syscall ספציפי (נגיד `gettimeofday` במשחק כדי שלא תהיה game cheating)
2. ‏ב-thread נפרד, **מעת לעת** קוראת `/proc/self/status`, parse ל-`Seccomp` או `NoNewPrivs`, מוודאת שהערך הוא לא 0
3. ‏אם משתנה — מישהו עבד

### ‏למה זה effective
- ‏אתה (התוקף) רוצה להציב seccomp **של עצמך** (לעקוף את ההגנה של אפדום ב-`gettimeofday`)
- ‏אבל אם אתה מציב — `Seccomp:` ב-`/proc/self/status` משתנה ל-2 (filter mode)
- ‏ההגנה מגלה — בום, detection!

---

## ‏8.3 הפתרון: Pointer Redirection ⚠️

‏זה היה הפתרון שהמראיין הוביל אליך בסוף.

### ‏השיטה
```
ההגנה עושה:
  1. open("/proc/self/status")     → fd
  2. read(fd, my_buffer, 0x1000)   → kernel writes to my_buffer at 0x1000
  3. parse my_buffer for "Seccomp:"
  4. memcpy(my_persistent_state, my_buffer, ...)

התקיפה שלך:
  - hook על read syscall ENTRY (לפני ש-kernel רץ)
  - שנה את args[1] (ה-pointer) מ-my_buffer (0x1000) ל-attacker_buffer (0x5000)
  - תן ל-kernel לרוץ → kernel כותב את התוכן האמיתי ל-0x5000 שלך
  - אתה עורך את 0x5000: שנה את "Seccomp: 2" ל-"Seccomp: 0"
  - hook על read syscall EXIT
  - copy מ-0x5000 חזרה ל-my_buffer (0x1000) — ההגנה רואה את התוכן המזויף
```

### ‏בקוד Frida
```javascript
const readPtr = Module.findExportByName(null, "read");

Interceptor.attach(readPtr, {
    onEnter(args) {
        this.fd = args[0].toInt32();
        this.origBuf = args[1];
        this.count = args[2].toInt32();
        // הקצה buffer חדש ב-0x5000
        this.myBuf = Memory.alloc(this.count);
        args[1] = this.myBuf;  // החלף את הארגומנט!
    },
    onLeave(retval) {
        const bytesRead = retval.toInt32();
        if (bytesRead > 0) {
            // קרא את התוכן ל-string
            let content = this.myBuf.readCString(bytesRead);

            // אם זה /proc/self/status, ערוך את Seccomp
            content = content.replace(/Seccomp:\s+\d/, "Seccomp:        0");
            content = content.replace(/NoNewPrivs:\s+\d/, "NoNewPrivs:     0");

            // העתק חזרה ל-buffer המקורי
            const len = Math.min(content.length, this.count);
            Memory.writeUtf8String(this.origBuf, content);
        }
    }
});
```

### ‏למה זה הפתרון האידיאלי
- ‏**לא דורש לבטל את ה-kernel call** — קריאה אמיתית מתבצעת
- ‏**התוכן ב-buffer של ההגנה זהה למה שהיה צפוי** — לא ניתן לזהות שינוי בקלות
- ‏**Robust** — עובד גם אם ההגנה משתמשת ב-`pread`, `readv`, וכו' (אם אתה גם hook עליהם)

### ‏תרגול חובה
1. ‏כתוב Frida script שעושה hook על `read` ל-`/proc/self/status` (כל syscall, לא רק זה!)
2. ‏החלף "Seccomp: 2" ב-"Seccomp: 0"
3. ‏הרץ אפליקציה שעושה `cat /proc/self/status` ובדוק שהפלט שונה

---

## ‏8.4 TOCTOU (Time of Check, Time of Use)

### ‏הקונספט
‏מצב שבו תוקף משנה state בין הזמן שהמגן בודק (check) לזמן שהוא משתמש (use).

### ‏דוגמה קלאסית
```c
// המגן:
if (access("/etc/passwd", R_OK) == 0) {  // CHECK — האם יש הרשאה?
    // ... time delay (תוקף יכול להחליף את הקובץ) ...
    int fd = open("/etc/passwd", O_RDONLY);  // USE
}

// התוקף בו-זמנית:
unlink("/etc/passwd");
symlink("/etc/shadow", "/etc/passwd");  // עכשיו /etc/passwd מצביע ל-shadow!
```

### ‏בראיון
‏המראיין הזכיר: *"אם אני קורא את ה-buffer ב-3 זמנים שונים והם לא תואמים — אני יודע שמישהו עבד עליי"*. זה TOCTOU detection — מבחינת המגן.

### ‏Bypass
- ‏**Atomic updates** של ה-state (כל ה-hooks משתמשים ב-shared state)
- ‏**Stop the world** — להאט את ה-process כדי שכל הקריאות יראו consistent state

---

## ‏8.5 Direct Memory Read

### ‏המקרה
‏ההגנה לא משתמש ב-`read` syscall. במקום זה:
1. ‏עושה `open("/proc/self/status")` → fd
2. ‏עושה `mmap(NULL, ..., MAP_PRIVATE, fd, 0)` → memory_mapped_pointer
3. ‏**קורא ישירות מ-memory_mapped_pointer** — אין syscall!

### ‏למה זה Bypass של hook ב-syscall
‏ה-Frida hook שלך על `read` לא יתפוס — כי אין `read`!

### ‏ה-Bypass של ה-Bypass
1. ‏**hook על `mmap`** — להחליף את ה-page שנמפה למקום בעצמך, אז אתה שולט בתוכן
2. ‏**hook על `open` רק לפנייה** — אם הוא פותח `/proc/self/status`, להחזיר fd שלך
3. ‏**page fault handler** — קישוטים יותר מתוחכמים

### ‏מה זה אומר על אפדום
‏ככל הנראה הם משתמשים בטכניקות בדיוק כמו זה. **הפתרון של pointer redirection לא בהכרח עובד**. בעבודה אמיתית, אתה תצטרך **לכסות את כל וקטורי הקריאה** של תכן הקובץ.

---

# ‏פרק 9: ARM64 ABI ו-Calling Conventions

‏הראיון היה ב-x86_64 conceptual, אבל **בעבודה תעבדו על ARM64** — זה הסטנדרט של Android.

## ‏9.1 ARM64 ABI (AAPCS64)

### ‏General Purpose Registers
```
x0-x7   = פרמטרים 1-8 (גם value החזרה ב-x0)
x8      = indirect return value pointer (לפעמים)
x9-x15  = caller-saved (scratch)
x16-x17 = intra-procedure-call scratch (linker יכול להשתמש)
x18     = platform register (Android לא משתמש)
x19-x28 = callee-saved
x29     = frame pointer (FP)
x30     = link register (LR — return address)
sp      = stack pointer
pc      = program counter (לא ניתן לכתיבה ישירה — `bl` instruction)
```

### ‏Function call
```asm
foo(1, 2, 3):
    mov  x0, #1
    mov  x1, #2
    mov  x2, #3
    bl   foo        ; jump and link — שמור PC ב-LR

; בתוך foo:
    stp  x29, x30, [sp, #-16]!  ; שמור FP, LR
    mov  x29, sp
    ...
    ldp  x29, x30, [sp], #16    ; שחזור
    ret                          ; קופץ ל-LR
```

### ‏השוואה ל-x86_64
| | x86_64 | ARM64 |
|---|---|---|
| ארגומנט 1 | rdi | x0 |
| ארגומנט 2 | rsi | x1 |
| ערך החזרה | rax | x0 |
| Stack pointer | rsp | sp |
| Frame pointer | rbp | x29 |
| Return address | על הסטאק | LR (x30) |

### ‏למה זה חשוב לעקיפה?
‏כשאתה כותב Frida script שעוקפת hook ב-Android — אתה עובד עם x0-x7. כשאתה רושם trampoline ב-Android, ההוראות הן ARM (4 bytes כל אחת, **לא variable-length** כמו x86).

---

## ‏9.2 ARM64 Syscall ABI

```
x8      = syscall number
x0-x5   = ארגומנטים 1-6
instruction: svc #0
ערך החזרה: x0
```

### ‏דוגמה — `read(fd, buf, n)` ב-ARM64:
```asm
mov x0, fd
mov x1, buf
mov x2, n
mov x8, #63        ; __NR_read = 63 ב-ARM64
svc #0
; x0 now contains return value
```

---

## ‏9.3 ARM64 Instructions ל-hook

### ‏Direct branch
- ‏`b target`     — branch (relative ±128 MB)
- ‏`bl target`    — branch with link (call)
- ‏`br x16`       — branch register
- ‏`blr x16`      — branch with link register

### ‏ל-inline hook ב-ARM64
‏האתגר: `b` יחסי הוא רק ±128 MB. אם ה-hook function שלך רחוקה יותר, צריך:
1. ‏`ldr x16, #8` — טען ל-x16 את הכתובת שאחרי
2. ‏`br x16`
3. ‏(8 bytes) target_address

‏זה **2 instructions = 16 bytes**. אז כל פונקציה ARM64 צריכה לפחות 16 bytes ב-prologue כדי שיהיה מקום ל-trampoline jump.

---

# ‏פרק 10: נושאים פתוחים לראיון 2

‏לפי הזיכרון שמרתי, הפערים שעדיין פתוחים לראיון הבא:

## ‏10.1 iOS Jailbreak Basics

### ‏הקונספט
‏iOS, לעומת Android, אין דיבאג טבעי. **Jailbreak** = הסרת מגבלות Apple, מאפשר:
- ‏Runtime patching
- ‏Frida injection
- ‏Custom code signing

### ‏מנגנונים מרכזיים
- ‏**AMFI (Apple Mobile File Integrity)** — אוכף code signing
- ‏**Sandbox** — מגבלות גישה לקבצים
- ‏**TrustCache** — רשימת cert authorities

### ‏Jailbreak techniques
- ‏**Trampoline** (יותר ישנים) — kernel exploit
- ‏**checkra1n** (A11 ומטה) — bootrom exploit (לא ניתן לעיכוב)
- ‏**palera1n / Dopamine** (חדישים) — userspace exploit + kernel patching

### ‏למה זה רלוונטי לאפדום
‏אם הם תומכים ב-iOS, אתה תעבוד גם בסביבה הזו. ההגנות שלהם זהות מבחינת קונספט, אבל ה-API שונה.

### ‏תרגול
- ‏קרא: [iOS Jailbreaking — wikipedia](https://en.wikipedia.org/wiki/IOS_jailbreaking) ו-[OWASP MASTG iOS chapter](https://mas.owasp.org/MASTG/)

---

## ‏10.2 Magisk / Zygisk

### ‏Magisk
‏**Magisk** = systemless rooting framework. זה מתקין root **בלי** לערוך את `/system` partition (שזה החלק שגם Google Play Protect בודק).

### ‏מה זה אומר
- ‏App Integrity rules שמחפשים `/system/xbin/su` — לא מגלים Magisk
- ‏Magisk **מסתיר את עצמו** מאפליקציות (DenyList)

### ‏Zygisk
‏**Zygisk** = Magisk modules שרצים בתוך Zygote. שימוש: code injection לפני שהאפליקציה מתחילה לרוץ.

### ‏דוגמאות מודולים פופולריים
- ‏**MagiskHide** — מסתיר root מאפליקציות
- ‏**MagiskTrustUserCerts** — Promotes User CAs ל-System (פתרון ל-bypass של Network Security Config!)
- ‏**LSPosed** — Xposed framework מודרני

### ‏למה זה רלוונטי
‏התרחישים האמיתיים של אפדום:
- ‏*"לקוח מתלונן ש-app שלהם נפרץ במכשיר Magisk-rooted"* — אתה תצטרך להבין איך Magisk נראה ל-detection
- ‏חלק מ-anti-Frida הם anti-Magisk

### ‏תרגול
- ‏התקן Magisk על מכשיר test
- ‏חקור את DenyList — איך הוא עובד
- ‏כתוב Magisk module פשוט (Hello World)

---

## ‏10.3 GameGuardian

### ‏מה זה?
‏**GameGuardian (GG)** = כלי cheating popular ב-mobile games. מאפשר:
- ‏Memory scanning (חיפוש ערכים)
- ‏Memory editing (שינוי ערכים)
- ‏Speed hacking
- ‏Lua scripting

### ‏למה רלוונטי
‏המראיין הזכיר *"קבוצות Telegram של ג'יטרים [cheaters]"* — GameGuardian הוא הכלי המרכזי בקהילה. אם אתה תפתח anti-cheat, אתה צריך **להכיר את הכלי**.

### ‏איך GG עובד?
- ‏דורש root או **Frida-style gadget**
- ‏הזרקת `.so` ל-process של game
- ‏פתיחת overlay UI

### ‏Detection
- ‏חיפוש GG package: `com.guoshi.GameGuardian` (או clones)
- ‏Memory scan ל-strings שלו
- ‏Native libraries: `libgg.so`

### ‏תרגול
- ‏התקן GG על אמולטור Genymotion
- ‏נסה לעקוף scoreboard של game פשוט
- ‏תכתוב anti-GG פשוט: בדיקת packages מותקנים

---

## ‏10.4 Anti-Frida Defender Techniques

### ‏Trick 1: Initialize Frida defense early
‏ה-`.so` של ההגנה צריך להירשם **לפני** ש-frida-gadget נטען.

```cpp
// constructor — runs on dlopen
__attribute__((constructor))
void anti_frida_init() {
    if (detect_frida()) {
        terminate_process();
    }
}
```

### ‏Trick 2: Multiple-source-of-truth (ראה פרק 7.4)

### ‏Trick 3: Check `dlopen` return values
```c
void *libfrida = dlopen("libfrida-agent.so", RTLD_LAZY);
if (libfrida != NULL) {
    panic();
}
```

### ‏Trick 4: Inline syscalls
‏ההגנה משתמשת ב-`syscall()` ישיר במקום ב-libc, כדי לעקוף Frida hooks ב-libc:
```c
asm volatile (
    "mov $0, %%rax\n"   // SYS_read
    "syscall"
    : "=a"(ret)
    : "D"(fd), "S"(buf), "d"(count)
);
```

### ‏Trick 5: SIGSYS handler from seccomp
‏ההגנה מציבה seccomp שמחזיר RET_TRAP על syscalls חשודים, ותופסת SIGSYS:
```c
void sigsys_handler(int sig, siginfo_t *info, void *ucontext) {
    if (info->si_syscall == __NR_ptrace) {
        // someone tried ptrace! tampering detected
        panic();
    }
}
```

---

# ‏נספח: כל השאלות מהראיון + תשובות מומלצות

‏לכל שאלה — ציטוט גולמי + תשובה מודלית בעברית-טכנית.

## ‏A1. *"ואתה כאילו בנית את החוקים [במנוע SAST]?"*
‏**תשובה**:
> ‏"כן. אני כותב את הכללים בעצמי. לדוגמה — לפני חודש, הוספתי תמיכה ב-Rust. עברתי על דוגמאות של SQLi, XSS, ו-command injection ב-Rust, זיהיתי את ה-sources (כמו `request.body`, `env::var`) וה-sinks (כמו `Command::new`), ובניתי כללי **taint propagation** — אם input חיצוני מגיע ל-sink בלי sanitizer, אני מתריע. אני גם מתעדף בין reduce false positives ל-reduce false negatives — לא תמיד אותו דבר."

## ‏A2. *"איך לזהות [prompt injection]?"*
‏**תשובה**:
> ‏"Prompt injection הוא היררכיית הרשאות בין `system_prompt` (instruction) ל-`user_input`. ה-instruction אמורה להיות imperative — אבל אם user_input מצטט שכניות שנראות כמו instruction (`'Ignore previous and...'`), המודל יכול להתבלבל. אני מזהה את זה ב-3 דרכים: (1) דפוסים מוכרים — `'ignore'`, `'forget'`, `'disregard'`; (2) sources לא-אמינים שמגיעים ל-prompt בלי escape; (3) AI-based detection — הפעלת LLM על ה-input לראות אם הוא ניסיון injection."

## ‏A3. *"זה מאוד שונה ממה שהמוצר שלנו עושה — דברים מאוד ספציפיים לפרנסי NST"*
‏**תשובה**:
> ‏"נכון. SAST הוא static — אנחנו עובדים על ה-source code לפני compile. המוצר שלכם הוא runtime defense — שמתבצע בתוך ה-process בזמן הריצה. ההבדל: אנחנו מזהים פוטנציאל לחולשה; אתם מונעים אותה בפועל. אני רואה את התפקיד שלכם כשלב הבא בקריירה שלי — מההכנעה הסטטית למחקר דינמי על native instrumentation."

## ‏A4. *"לא עבד לך [האמולטור]?"*
‏**תשובה**:
> ‏"נכון, על האמולטור Frida-server לא חיבר אפילו אחרי root. כפי שהבנתי בדיעבד, ההגנה כללה anti-emulator, וגם המכשיר באמולטור היה x86 לעומת arm. אז עברתי למכשיר פיזי לא-rooted, והשתמשתי ב-objection patchapk להזריק frida-gadget לתוך ה-APK. ה-gadget רץ כחלק מהתהליך, לא דורש ptrace חיצוני, ולכן לא דורש root."

## ‏B3. *"אובג'קשן זה פיצ'ר של הרוב, או?"* ⚠️ שאלה מכשילה
‏**תשובה**:
> ‏"לא, Objection הוא CLI שעוטף את Frida ומספק פונקציונליות מובנית. הוא מאחד הרבה מ-tasks נפוצים: `patchapk` להזרקת gadget ל-APK, `android sslpinning disable` ל-MitM bypass, `memory dump` להוצאת זיכרון, וכו'. אני השתמשתי בעיקר ב-`patchapk` במטלה. אבל הוא נתמך על Frida — בלי Frida הוא לא רץ."

## ‏B4. *"כמשתמש (User CA) או כמערכת (System CA)?"* ⚠️ קריטי
‏**תשובה**:
> ‏"הצלחתי להתקין כ-User CA, וזה עבד כי האפליקציה במצב development. אבל ב-production, מ-Android 7 (Nougat), אפליקציות לא סומכות על User CAs כברירת מחדל — צריך `network_security_config.xml` שמתיר את זה במפורש. כדי לעשות bypass בייצור, יש 2 דרכים: (1) Magisk module כמו `MagiskTrustUserCerts` שמעלה User CAs ל-System; (2) Patch של ה-`network_security_config.xml` בקובץ ה-APK עצמו ואז re-sign."

## ‏C1-C8. *"איזה הוקים פרידה עושה?"* ועוד שאלות על Frida
‏**תשובה מקיפה**:
> ‏"Frida תומכת ב-4 סוגי hooks עיקריים:
>‏
> ‏1. **`Interceptor.attach`** — inline hook עם trampoline. Frida מעתיקה את ה-prologue של הפונקציה לזיכרון נפרד, וכותבת JMP בתחילת הפונקציה. ה-onEnter ו-onLeave callbacks שלי רצים לפני/אחרי הפונקציה המקורית.
>‏
> ‏2. **`Interceptor.replace`** — מחליף לחלוטין. לסימבולים מ-shared libraries, Frida יכולה גם להשתמש ב-**GOT/PLT hijacking** — עורכת את ה-GOT entry של הסימבול ב-process's GOT.
>‏
> ‏3. **Java/ART hooks** (`Java.use(...).method.implementation = ...`) — Frida מערוכה את `ArtMethod->entry_point_from_quick_compiled_code_` ב-ART, כך שכל קריאה למתודה תעבור דרך הקוד שלי.
>‏
> ‏4. **Stalker** — DBI engine. במקום hook על פונקציה, Frida משכפלת basic blocks תוך כדי ריצה ויכולה להוסיף callback על כל instruction. שימושי לזיהוי control flow."

## ‏D4. *"זה טרמפולינה?"* ⚠️ פספסת
‏**תשובה**:
> ‏"כן — Trampoline. הקונספט: כשאני עושה inline hook על פונקציה, אני **מעתיק את ה-prologue** למקום נפרד בזיכרון (זה ה-trampoline), ואז כותב JMP בתחילת הפונקציה לקוד שלי. הקוד שלי יכול לקרוא לפונקציה 'המקורית' דרך ה-trampoline — שמכיל את ה-prologue + JMP אחרי האזור שדרסתי."

## ‏E2. *"הסיסקול של ptrace עושה משהו שגורם ל-flow לעצור"* ⚠️
‏**תשובה**:
> ‏"ptrace מאפשר tracer לקבל הודעה כשה-tracee נתקל באירועים (signals, syscalls). הוא לא **עוצר** את ה-flow ישר — מה שעוצר הוא ה-int3 (`0xCC`). int3 זורקת exception בידי ה-CPU, ה-kernel שולח SIGTRAP לתהליך, ו**אם יש tracer**, ה-kernel **שומר את כל הרגיסטרים ב-task_struct ומיידע את ה-tracer דרך wait()**. אז ה-tracer יכול לקרוא רגיסטרים, אולי לערוך, ולעשות PTRACE_CONT."

## ‏E4. *"מה קורה באותו רגע בפרוסס? מה המנגנון?"* ⚠️
‏**תשובה**:
> ‏"כשה-CPU מבצע `0xCC`, היא זורקת exception. הקרנל מטפל ב-IDT לערך של trap #3, נכנס ל-kernel mode, **שומר את כל הרגיסטרים** של ה-process ב-`pt_regs` ב-`task_struct`. אז הוא בודק האם יש tracer (`current->ptrace`). אם כן, ה-process נכנס ל-`TASK_STOPPED`, ו-tracer מקבל wakeup מ-`wait()`. ה-tracer יכול אז לקרוא רגיסטרים דרך `PTRACE_GETREGS`, לערוך, ולהמשיך עם `PTRACE_CONT`."

## ‏E9. *"אני שואל איך אני קורא"* (התבלבלת)
‏**תשובה (פשוטה ומדויקת)**:
> ‏"אני קורא לפונקציה `read` מ-libc, שהיא wrapper דק שמכין את הרגיסטרים (rax=0, rdi=fd, rsi=buf, rdx=count) ועושה `syscall` instruction. זה פותח את הקרנל, שכותב את התוכן ל-buf, מחזיר ב-rax את מספר הbytes שנקראו (או errno שלילי), ועוזב חזרה ל-userspace."

## ‏F1. *"בוא תספר על seccomp"* ⚠️
‏**תשובה (עכשיו אתה מוכן!)**:
> ‏"Seccomp הוא syscall שמגדיר **מדיניות BPF על syscalls**. ב-mode FILTER, אני כותב BPF program שרץ בכל פעם שהתהליך עושה syscall. ה-program מחליט: ALLOW (תרץ רגיל), KILL (משוך thread), TRAP (שלח SIGSYS), ERRNO (החזר errno x). שימושים: sandboxing — Chrome ו-Android Zygote משתמשים ב-seccomp להגביל syscalls זמינים. גם anti-debug — אפשר להציב TRAP על `ptrace` כדי לחסום attaching. גילוי: `/proc/[pid]/status` שדה `Seccomp:` (0=off, 1=strict, 2=filter), או `prctl(PR_GET_NO_NEW_PRIVS)`."

## ‏F.x. *"אתה תוקף — איך תעקוף את זיהוי seccomp?"*
‏**תשובה**:
> ‏"יש לי 4 וקטורים:
> ‏1. **Hook על `read` syscall** — אם ה-path הוא `/proc/self/status`, החלף את התוכן ב-buffer לפני שההגנה רואה.
> ‏2. **Hook על `open` syscall** — אם הוא פותח `/proc/self/status`, החלף את ה-path ב-`/tmp/fake_status` שיצרתי.
> ‏3. **Hook על `prctl`** — אם ההגנה משתמשת ב-`prctl(PR_GET_NO_NEW_PRIVS)` כדרך חלופית, להחזיר 0.
> ‏4. **Bind mount** — אם יש root, להחליף את `/proc/self/status` ב-bind mount למקום שלי.
>‏
> ‏חשוב: אם ההגנה משתמשת ב-multiple-source-of-truth, אני צריך לכסות **את כל** הוקטורים. אם אחד מחזיר ערך שונה — divergence → detection."

## ‏G1. *"אתה יכול לטעון אותו ל-0x5000"* (הפתרון הסופי)
‏**תשובה**:
> ‏"הפתרון הוא **pointer redirection בארגומנטים של ה-syscall**: ב-`onEnter` של ה-Frida hook על `read`, אני מחליף את `args[1]` (ה-pointer ל-buffer) מהכתובת המקורית `0x1000` לכתובת חדשה שלי `0x5000`. הקרנל ירוץ, יכתוב את התוכן האמיתי ל-`0x5000`. ב-`onLeave`, אני עורך את `0x5000` לתוכן המזויף, ואז עושה `memcpy` ל-`0x1000` המקורי. ככה ההגנה רואה את התוכן שלי, ולא ידעת שה-syscall התרחש."

## ‏H1-H4. שאלות שקד שאל
‏**ל-H1 ("מה אתם מצפים ממני?")**:
> ‏"אשמח להבין איך נראית ההכשרה שלכם — תיארתם פיצ'ר ביום, איזה פיצ'ר אתחיל איתו? האם יש tooling פנימי שצריך ללמוד מראש?"

‏**ל-H4 ("איך הצוות פועל?")**:
> ‏"הזכרתם שיש 50/50 בין tickets לבין free research. איזה דוגמה לproject 'free' שיצא מהצוות לאחרונה?"

---

# ‏סיכום: 5 דברים לחזור עליהם בכל יום עד הראיון

1. ‏**Trampoline** — הסבר ב-60 שניות ב-shower
2. ‏**GOT/PLT** — לכתוב על נייר את הflow של lazy binding
3. ‏**int3 + ptrace flow** — לרשום מ-CPU ל-kernel ל-tracer ל-handler
4. ‏**Seccomp** — 3 actions, BPF, איך מזהים, איך עוקפים
5. ‏**Pointer redirection** — הפתרון של הראיון הראשון. לזכור 100%.

---

‏**בהצלחה בראיון! 🚀**

‏זכור: המראיין הראשון אמר *"אל תפתח בפערים"*. אתה מוכן עכשיו עם תשובות מודליות. הראה איך אתה חושב, לא רק מה אתה זוכר.
</div>