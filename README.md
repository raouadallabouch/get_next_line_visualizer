# `get_next_line` — Systems & Kernel Visualizer

An interactive, textbook-grade technical schematic tracing 42's `get_next_line(int fd)` from C user-space code and virtual memory segments (`.text`, `.bss`, Stack, Heap) down through the `libc` `read()` wrapper, x86-64 CPU registers, hardware `syscall`/`sysret` privilege ring transitions (`Ring 3 ↔ Ring 0`), and Linux kernel VFS internals (`sys_call_table`, `fdtable`, `struct file` / `f_pos`, `access_ok()`, Page Cache, and SSD backing storage).

## Features

- **Physical Memory Anatomy**: Visually distinguishes compile-time `BUFFER_SIZE` (baked as an immediate operand in `.text`, 0 bytes of runtime data RAM) from the physical `buffer` (`malloc(BUFFER_SIZE + 1)` on the Heap), Stack frame lifetime vs `.bss` static pointer persistence, byte-level Hex/ASCII cells, freed tombstones, and leak accounting.
- **Full x86-64 & Linux Kernel Pipeline**: Steps through `rax=0`, `rdi=fd`, `rsi=buffer`, `rdx=BUFFER_SIZE`, hardware `syscall` (`rip → rcx`, `Ring 3 → Ring 0`, `MSR_LSTAR`), `sys_call_table[0] → __x64_sys_read`, `fdtable` lookup (including `-EBADF`), `access_ok()` user-space boundary verification, 4 KB Page Cache miss (SSD fetch) vs cache hit, `copy_to_user()`, `f_pos` update, and `sysret`.
- **Micro & Macro Granularity**: Toggle seamlessly between deep CPU/Kernel micro-stepping and fast C-level memory stepping with full time-travel scrubbing.
- **Mandatory & 42 Bonus (Multi-FD) Modes**: Compare single `static char *stash` against `static char *stash[FD_MAX]` with interleaved `fd=3` and `fd=4` reads and independent kernel `struct file` offsets.
- **Curated 42 Edge-Case Presets & Custom File Editor**: Test `BUFFER_SIZE=1` syscall storms, large `BUFFER_SIZE=42`/`1024` zero-syscall calls, missing trailing `\n`, consecutive `\n\n\n`, empty files, and closed-FD `-EBADF` cleanup.
- **42 Eval Defense Compendium**: Contextual evaluation Q&As on every step plus a searchable 13-topic reference drawer with one-click proof scenarios.

## Development

```bash
npm install
npm run dev      # Start local dev server
npm test         # Run Vitest engine unit tests
npm run build    # Type-check & build static production bundle (dist/)
```
