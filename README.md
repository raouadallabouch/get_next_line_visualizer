# `get_next_line` — Physical Systems & Kernel Mental Model Visualizer

An interactive, spoiler-free **Light Technical Blueprint** mental-model visualizer for 42's `get_next_line(int fd)`. Zero `get_next_line` C implementation code is shown — instead, it traces the real physical journey across User Space RAM (`.text`, `.bss`, Stack, Heap), x86-64 CPU registers, hardware `syscall`/`sysret` privilege ring transitions (`Ring 3 ↔ Ring 0`), and Linux kernel internals (`sys_call_table`, `fdtable`, `struct file` / `f_pos`, `access_ok()`, Page Cache, and SSD backing storage).

## Features

- **8-Stage Physical Execution Pipeline**: Visual step-by-step flow (`Heap buffer` → `4 CPU Regs` → `SYSCALL Ring 3→0` → `Kernel Check` → `SSD/Cache → RAM` → `SYSRET Ring 0→3` → `'\0' & Stash` → `Line & Leftover`).
- **Physical Memory Anatomy (Left Half — Ring 3)**: Contrasts compile-time `BUFFER_SIZE` (0 B data RAM, baked in `.text`) vs physical Heap `buffer` (`BUFFER_SIZE + 1`), byte-level Heap blocks & freed tombstones, `.bss` static pointer persistence vs temporary Stack frame destruction, and returned line stream.
- **CPU Hardware & Linux Kernel (Right Half — Ring 3 ⇄ Ring 0)**: Live x86-64 ABI registers (`rax`, `rdi`, `rsi`, `rdx`, `rip`, `rcx`, `r11`, `rsp`), Ring 3/0 security wall, `sys_call_table[0]`, Process `fdtable`, `access_ok()` protection check, `struct file` `f_pos`, and 4 KB Page Cache vs SSD byte tape.
- **Mandatory & 42 Bonus (Multi-FD) Modes**: Compare single `.bss` `stash` against `stash[fd]` with interleaved `fd=3` & `fd=4` reads.
- **Curated 42 Edge Cases, Custom File Editor & 13-Topic Eval Q&A**: Test `BUFFER_SIZE=1`, `BUFFER_SIZE=42`, missing trailing `\n`, `\n\n\n`, empty file, and closed-FD `-EBADF`.

## Run Locally

```bash
git clone https://github.com/raouadallabouch/get_next_line_visualizer.git
cd get_next_line_visualizer
npm install
npm run dev
```
