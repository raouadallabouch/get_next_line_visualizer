# `get_next_line` — Interactive Visual Systems Mental Model

A spoiler-free, **diagram-first interactive visual guide** to 42's `get_next_line(int fd)` — showing zero `get_next_line` C implementation code. Instead of a text-heavy debugger, it teaches the full physical mental model across **4 structured visual chapters** + an interactive **20-concept encyclopedia** (`CPU`, `RAM`, `Registers`, `Ring 3/0`, `User Space`, `Kernel Space`, `.text`, `BUFFER_SIZE`, `buffer`, `Heap`, `Stack`, `.bss`, `libc read()`, `syscall`/`sysret`, `sys_call_table`, `fdtable`, `struct file`, `inode`, `Page Cache`, `SSD`):

1. **System Map** — Interactive hardware & OS context diagram connecting User Space RAM, CPU Registers/Rings, Kernel tables, Page Cache, and SSD.
2. **Memory Map** — Visual Virtual RAM Tower comparing `BUFFER_SIZE` (`.text`) vs physical `buffer` (`Heap`), `BUFFER_SIZE=10 MB` Stack crash test, and `.bss` survival after Stack frames vanish.
3. **Syscall & Kernel** — Concentric Privilege Rings (`Ring 3 ↔ Ring 0`), live 6-beat register sequence, and the 3-table Linux file chain (`fdtable → struct file → inode → Page Cache ↔ SSD`), including Cache Hit and `-EBADF` modes.
4. **Live GNL Flow** — Interactive decision flowchart paired with a live animated data-flow machine (supporting all 42 edge cases, custom file editing, and 42 Bonus Multi-FD).

## Run Locally

```bash
git clone https://github.com/raouadallabouch/get_next_line_visualizer.git
cd get_next_line_visualizer
npm install
npm run dev
```
