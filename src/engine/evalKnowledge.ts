import { EvalQuestionItem } from './types';

export const EVAL_QUESTIONS: EvalQuestionItem[] = [
  {
    id: 'q-buffer-vs-buffersize',
    category: 'Memory',
    question: 'What is the physical difference between BUFFER_SIZE and buffer inside the computer?',
    answer:
      'BUFFER_SIZE is a preprocessor macro replaced before compilation (e.g. -D BUFFER_SIZE=42). It allocates 0 bytes of runtime data RAM — it is encoded directly as an immediate operand inside CPU machine instructions in the .text segment (e.g. `mov edx, 0x2a`). By contrast, `buffer` is a real contiguous array of RAM bytes allocated on the Heap via `malloc(BUFFER_SIZE + 1)` whose base address is passed in `rsi` to the kernel.',
    keyTakeaway: 'BUFFER_SIZE = compile-time immediate in .text (0 B data RAM). buffer = runtime Heap allocation.',
    demoPresetId: 'standard',
  },
  {
    id: 'q-plus-one',
    category: 'Memory',
    question: 'Why do we allocate malloc(BUFFER_SIZE + 1) instead of malloc(BUFFER_SIZE)?',
    answer:
      'The Linux `read()` syscall operates on raw byte streams (files can be binary) and NEVER appends a null terminator (`\\0`). To safely pass `buffer` into C string functions like `ft_strjoin` or `ft_strlen`, we must manually write `buffer[bytes_read] = \'\\0\'`. If `read()` fills all `BUFFER_SIZE` bytes, index `BUFFER_SIZE` requires that extra +1 byte to avoid a 1-byte Heap buffer overflow.',
    keyTakeaway: 'read() returns raw bytes without \\0; the +1 byte guarantees space for buffer[bytes_read] = \'\\0\'.',
    demoPresetId: 'standard',
  },
  {
    id: 'q-heap-vs-stack',
    category: 'Memory',
    question: 'Why must `buffer` be allocated on the Heap with malloc() instead of `char buffer[BUFFER_SIZE + 1]` on the Stack?',
    answer:
      'On Linux, the default process stack limit (`ulimit -s`) is typically 8 MB. During 42 evaluation, testers compile with `-D BUFFER_SIZE=10000000` (10 MB) or larger. A stack-allocated VLA/array of 10 MB immediately overflows the stack frame and crashes with SIGSEGV. Heap allocations via `malloc()` use `brk`/`mmap` and safely support huge `BUFFER_SIZE` values.',
    keyTakeaway: 'Large BUFFER_SIZE (e.g. 10M) overflows the 8 MB Stack (SIGSEGV); Heap via malloc() handles it safely.',
    demoPresetId: 'large_buffer',
  },
  {
    id: 'q-static-bss',
    category: 'Memory',
    question: 'Where does `static char *stash` live in virtual memory, and why does it survive after get_next_line() returns?',
    answer:
      'An uninitialized `static` pointer lives in the `.bss` (Block Started by Symbol) segment, which the OS ELF loader zero-initializes (`NULL`) before `main()` runs. Unlike local variables (`buffer`, `bytes_read`, `line`) whose Stack frame is popped when `get_next_line()` executes `ret`, `.bss` persists for the entire lifetime of the process — preserving the Heap address of leftover bytes after `\\n` for the next call.',
    keyTakeaway: 'The pointer `stash` lives in .bss (process lifetime); the characters it points to live on the Heap.',
    demoPresetId: 'standard',
  },
  {
    id: 'q-read-wrapper-abi',
    category: 'CPU & Syscall',
    question: 'Is `read()` in C the Linux Kernel itself? How does it talk to the Kernel on x86-64?',
    answer:
      'No. `read()` is a small User-Space wrapper function in `libc` running in Ring 3. It follows the x86-64 Linux syscall ABI: puts syscall number `0` (`__NR_read`) in `rax`, `fd` in `rdi`, `buffer` pointer in `rsi`, and `BUFFER_SIZE` in `rdx`, then executes the hardware `syscall` instruction.',
    keyTakeaway: 'libc read() sets rax=0, rdi=fd, rsi=buf, rdx=count, then executes hardware `syscall`.',
    demoPresetId: 'standard',
  },
  {
    id: 'q-syscall-hardware',
    category: 'CPU & Syscall',
    question: 'What exact atomic steps does the CPU hardware perform when it executes `syscall` and `sysret`?',
    answer:
      'On `syscall`: (1) saves next User-Space `rip` into `rcx` and `rflags` into `r11`, (2) switches hardware privilege level from Ring 3 (User Mode) to Ring 0 (Kernel Mode), and (3) jumps `rip` to the protected Kernel entry address in `MSR_LSTAR` (`entry_SYSCALL_64`). On `sysret`: reverses the switch (Ring 0 -> Ring 3) and restores `rip <- rcx` back into `libc`.',
    keyTakeaway: 'syscall: save rip->rcx, Ring 3->0, jump LSTAR. sysret: Ring 0->3, restore rip<-rcx.',
    demoPresetId: 'standard',
  },
  {
    id: 'q-bs1-performance',
    category: 'CPU & Syscall',
    question: 'Why is `BUFFER_SIZE=1` drastically slower than `BUFFER_SIZE=4096` even when the file is already in RAM?',
    answer:
      'Even after the first read loads a 4 KB page from SSD into the Kernel Page Cache (RAM), `BUFFER_SIZE=1` still executes one full Ring 3 -> Ring 0 `syscall`/`sysret` transition, `fdtable` lookup, `access_ok()` check, and `copy_to_user()` for EVERY SINGLE BYTE — plus O(N²) `malloc`/`ft_strjoin` reallocations in User Space. A larger `BUFFER_SIZE` amortizes one syscall over thousands of bytes scanned purely in User Space.',
    keyTakeaway: 'Ring 3<->0 transitions + KPTI + repeated malloc/strjoin dominate when BUFFER_SIZE=1.',
    demoPresetId: 'bs1_storm',
  },
  {
    id: 'q-kernel-file-offset',
    category: 'Kernel & VFS',
    question: 'How does `read()` know where to resume reading on the next call, and why can\'t we use `lseek()` instead of a static stash?',
    answer:
      'In Kernel Space, `task_struct -> files -> fdtable` maps `fd` (e.g. 3) to an Open File Description (`struct file`), which stores `f_pos` — the current byte offset. Each `sys_read` automatically advances `f_pos += bytes_read`. We cannot avoid `static stash` by calling `lseek()` to rewind past `\\n` because (a) `lseek` is forbidden in GNL, and (b) pipes, `stdin`, and sockets are non-seekable (`ESPIPE`).',
    keyTakeaway: 'Kernel `struct file->f_pos` tracks read position; `lseek()` fails on stdin/pipes and is forbidden.',
    demoPresetId: 'standard',
  },
  {
    id: 'q-access-ok',
    category: 'Kernel & VFS',
    question: 'How does the Kernel stop a buggy or malicious program from passing a Kernel memory address as `buffer` to `read()`?',
    answer:
      'Because `sys_read` executes in Ring 0 with unrestricted RAM access, trusting `rsi` blindly would let User Space overwrite Kernel data structures. Before copying bytes, `copy_to_user()` runs `access_ok(rsi, rdx)` to verify the entire `[buffer, buffer + BUFFER_SIZE)` range lies strictly below `TASK_SIZE_MAX` (`0x00007fffffffffff`, canonical User Space). Otherwise it aborts and returns `-EFAULT` (-14).',
    keyTakeaway: 'access_ok() ensures `rsi` lies strictly in User Space (< TASK_SIZE_MAX) before copy_to_user().',
    demoPresetId: 'standard',
  },
  {
    id: 'q-page-cache',
    category: 'Kernel & VFS',
    question: 'Does every `read()` syscall physically hit the SSD?',
    answer:
      'No. The Linux VFS checks the **Page Cache** in Kernel Space RAM first. On the first read of a 4 KB file page (cache miss), the storage driver fetches the 4 KB page from SSD/NVMe into Kernel Page Cache RAM. Subsequent `read()` calls within that 4 KB page hit the Page Cache directly and only execute `copy_to_user()` from Kernel RAM to User Heap.',
    keyTakeaway: 'First read of a 4 KB block = SSD -> Page Cache (miss). Subsequent reads = Page Cache hit.',
    demoPresetId: 'bs1_storm',
  },
  {
    id: 'q-ssize-errno',
    category: '42 Edge Cases',
    question: 'Why does `read()` return `ssize_t` instead of `size_t`, and what must GNL free when `read()` returns `-1`?',
    answer:
      '`ssize_t` is signed so it can distinguish error (`-1`), EOF (`0`), and bytes read (`> 0`). Inside the kernel, `sys_read` returns a negative errno in `rax` (e.g. `-9` for `-EBADF` on a closed/invalid fd); the `libc` wrapper detects `rax >= -4095`, stores `+9` in `errno`, and returns `-1`. On `-1`, GNL must free BOTH `buffer` AND `stash` (setting `stash = NULL`) before returning `NULL` to avoid leaks and corrupted state.',
    keyTakeaway: 'Kernel returns -errno in rax; libc maps it to -1 + errno. Free BOTH buffer & stash on error.',
    demoPresetId: 'invalid_fd',
  },
  {
    id: 'q-eof-no-nl',
    category: '42 Edge Cases',
    question: 'What happens when the last line of a file has no trailing `\\n`, or when the file is completely empty?',
    answer:
      'When there is no trailing `\\n`, `read()` eventually returns `0` (EOF) and exits the loop. Because `stash` is non-empty (`stash[0] != \'\\0\'`), GNL returns those remaining bytes as the final line and sets `stash = NULL`. On the *subsequent* call, `read()` again returns `0`, `stash` is empty/NULL, so GNL frees resources and returns `NULL`. On an empty file, this happens immediately on Call #1.',
    keyTakeaway: 'EOF with non-empty stash returns the final line; EOF with empty stash returns NULL with 0 leaks.',
    demoPresetId: 'no_trailing_nl',
  },
  {
    id: 'q-bonus-multifd',
    category: '42 Edge Cases',
    question: 'How does 42 Bonus handle reading from multiple FDs alternately without mixing lines?',
    answer:
      'In Kernel Space, opening two files (`fd=3`, `fd=4`) already creates two independent `struct file` descriptions with separate `f_pos` offsets. In User Space, replacing `static char *stash` with `static char *stash[FD_MAX]` in `.bss` gives each file descriptor its own independent Heap remainder pointer, so calling `get_next_line(3)` then `get_next_line(4)` never corrupts either stream.',
    keyTakeaway: 'Independent Kernel `struct file->f_pos` + independent User `.bss` `stash[fd]` pointers.',
    demoPresetId: 'bonus_multi_fd',
  },
];
