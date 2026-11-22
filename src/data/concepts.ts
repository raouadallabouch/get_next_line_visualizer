export type ConceptId =
  | 'cpu'
  | 'registers'
  | 'rings'
  | 'ram'
  | 'user_space'
  | 'kernel_space'
  | 'text_segment'
  | 'buffer_size'
  | 'buffer'
  | 'heap'
  | 'stack'
  | 'bss'
  | 'libc_read'
  | 'syscall'
  | 'syscall_table'
  | 'fdtable'
  | 'struct_file'
  | 'inode'
  | 'page_cache'
  | 'ssd';

export interface ConceptEntry {
  id: ConceptId;
  title: string;
  subtitle: string;
  category: 'Hardware' | 'User RAM' | 'CPU & Syscall' | 'Linux Kernel';
  physicalLocation: string;
  whatItIs: string;
  whyItExists: string;
  roleInGnl: string;
  evalQuestion: string;
  evalAnswer: string;
  related: ConceptId[];
}

export const CONCEPTS: Record<ConceptId, ConceptEntry> = {
  cpu: {
    id: 'cpu',
    title: 'CPU (Central Processing Unit)',
    subtitle: 'The silicon processor executing instructions one by one',
    category: 'Hardware',
    physicalLocation: 'Physical Processor Chip (Silicon)',
    whatItIs:
      'The CPU is the hardware chip that fetches machine instructions from RAM, executes arithmetic/logic operations, and enforces security rules in hardware circuits.',
    whyItExists:
      'Programs in RAM are just inert numbers until the CPU reads and executes them. The CPU also acts as a hardware security guard separating untrusted programs (Ring 3) from the OS Kernel (Ring 0).',
    roleInGnl:
      'Executes your user-space loop in Ring 3, flips to Ring 0 during `syscall` so Linux can read the file, and flips back to Ring 3 on `sysret`.',
    evalQuestion: 'Can your program talk directly to the SSD using only the CPU in Ring 3?',
    evalAnswer:
      'No. In Ring 3 (User Mode), CPU hardware circuits physically block hardware I/O instructions and Kernel RAM access. You must ask the Kernel via `syscall`.',
    related: ['registers', 'rings', 'syscall', 'ram'],
  },
  registers: {
    id: 'registers',
    title: 'CPU Registers',
    subtitle: 'Ultra-fast tiny storage slots built directly inside the CPU chip',
    category: 'CPU & Syscall',
    physicalLocation: 'Inside the CPU Silicon (~0.3 ns access)',
    whatItIs:
      'Registers are tiny 64-bit slots welded directly inside the CPU (`rax`, `rdi`, `rsi`, `rdx`, `rip`, `rcx`). They hold the exact numbers and memory addresses the CPU is working on right this nanosecond.',
    whyItExists:
      'RAM is ~100× slower than CPU circuits. Registers also serve as the shared "drop box" (ABI) where User Space leaves arguments for the Kernel before triggering `syscall`.',
    roleInGnl:
      'Before `syscall`, `libc` puts `0` (read ID) in `rax`, `fd` in `rdi`, the Heap `buffer` address in `rsi`, and `BUFFER_SIZE` in `rdx`. Afterwards, the Kernel puts the byte count back in `rax`, while `rip` tracks the current instruction address.',
    evalQuestion: 'Which 4 registers carry a Linux x86-64 `read()` request?',
    evalAnswer:
      '`rax = 0` (syscall number), `rdi = fd`, `rsi = buffer address`, `rdx = BUFFER_SIZE`. Return value comes back in `rax`.',
    related: ['cpu', 'libc_read', 'syscall', 'rings'],
  },
  rings: {
    id: 'rings',
    title: 'Privilege Rings (Ring 3 vs Ring 0)',
    subtitle: 'Hardware security mode inside the CPU',
    category: 'CPU & Syscall',
    physicalLocation: 'CPU Control Register (Current Privilege Level)',
    whatItIs:
      'A built-in hardware permission level inside the CPU. **Ring 3 (User Mode)** is restricted — it can only touch its own User Space RAM. **Ring 0 (Kernel Mode)** has full control over every byte of RAM and every hardware device.',
    whyItExists:
      'If normal programs ran in Ring 0, one buggy pointer or malicious app could overwrite the OS, spy on other processes, or corrupt the SSD.',
    roleInGnl:
      'Your program runs in Ring 3. Every `read()` forces a controlled Ring 3 → Ring 0 crossing (`syscall`) and back (`sysret`), which is why `BUFFER_SIZE=1` is so slow.',
    evalQuestion: 'Why is `BUFFER_SIZE=1` drastically slower than `BUFFER_SIZE=4096`?',
    evalAnswer:
      'Even when the file is already cached in RAM, `BUFFER_SIZE=1` pays a full Ring 3 → Ring 0 → Ring 3 hardware switch for every single byte instead of scanning thousands of bytes at full speed in Ring 3.',
    related: ['cpu', 'syscall', 'user_space', 'kernel_space'],
  },
  ram: {
    id: 'ram',
    title: 'RAM (Virtual Address Space)',
    subtitle: 'Volatile working memory divided into User Space & Kernel Space',
    category: 'Hardware',
    physicalLocation: 'System Memory Chips (DRAM)',
    whatItIs:
      'RAM is a massive flat array of numbered byte slots (addresses). Every running Linux process gets its own virtual address map split into two halves: **User Space** (bottom half, accessible to your program) and **Kernel Space** (top half, locked to Ring 0).',
    whyItExists:
      'Storage drives (SSDs) are far too slow for live program execution. RAM holds running instructions, variables, Heap allocations, and Kernel tables/caches.',
    roleInGnl:
      'Holds your instructions (`.text`), static leftover pointer (`.bss`), temporary call frame (`Stack`), `buffer`/lines (`Heap`), AND the Linux Kernel’s file tables + Page Cache.',
    evalQuestion: 'What stops your C code from reading a Kernel RAM address like `0xffff...`?',
    evalAnswer:
      'The CPU’s MMU (Memory Management Unit) checks the current privilege ring. Accessing a Kernel page while in Ring 3 immediately triggers a hardware fault (`SIGSEGV`).',
    related: ['user_space', 'kernel_space', 'heap', 'stack', 'bss'],
  },
  user_space: {
    id: 'user_space',
    title: 'User Space (Ring 3 RAM)',
    subtitle: 'The private memory sandbox owned by your process',
    category: 'User RAM',
    physicalLocation: 'Lower Virtual Memory (0x0000000000000000 – 0x00007fffffffffff)',
    whatItIs:
      'The region of RAM where your program is allowed to read and write. It is organized into 4 classic zones: `.text` (instructions), `.bss` (static data), `Heap` (dynamic allocations), and `Stack` (local function frames).',
    whyItExists:
      'Gives every program an isolated sandbox so one crashing program cannot crash the operating system or other apps.',
    roleInGnl:
      'Once the Kernel copies bytes into your User-Space Heap `buffer`, scanning for `\\n`, appending `\\0`, and slicing lines happen 100% inside User Space with zero syscalls.',
    evalQuestion: 'How does the Kernel make sure your `buffer` address is really in User Space?',
    evalAnswer:
      'Before copying bytes in Ring 0, the Kernel checks `access_ok(rsi, rdx)` to prove the entire `[buffer, buffer + BUFFER_SIZE)` range lies strictly below `TASK_SIZE_MAX`.',
    related: ['kernel_space', 'text_segment', 'bss', 'heap', 'stack'],
  },
  kernel_space: {
    id: 'kernel_space',
    title: 'Kernel Space (Ring 0 RAM)',
    subtitle: 'Protected memory reserved exclusively for the Linux OS Kernel',
    category: 'Linux Kernel',
    physicalLocation: 'Upper Virtual Memory (0xffff800000000000+)',
    whatItIs:
      'The protected upper region of RAM where the Linux Kernel code and internal data structures live: `sys_call_table`, every process’s `fdtable`, the System Open File Table (`struct file`), `inode` cache, and the Page Cache.',
    whyItExists:
      'Centralizes hardware access and security checks inside one trusted supervisor that no User-Space pointer can tamper with.',
    roleInGnl:
      'Tracks your open file offset (`f_pos`), caches 4 KB blocks from the SSD in the Page Cache, validates your `fd` and `buffer`, and safely copies bytes across the boundary into User Space.',
    evalQuestion: 'Where is your file’s current reading position (`f_pos`) stored?',
    evalAnswer:
      'In Kernel Space inside the Open File Description (`struct file`), NOT inside your C program. That is why two consecutive `read()` calls continue where the last one stopped.',
    related: ['user_space', 'syscall_table', 'fdtable', 'struct_file', 'page_cache'],
  },
  text_segment: {
    id: 'text_segment',
    title: '.text Segment (Machine Code)',
    subtitle: 'Read-only region holding compiled CPU instructions',
    category: 'User RAM',
    physicalLocation: 'User Space RAM — Low Addresses (~0x00401000)',
    whatItIs:
      'When your program compiles into `a.out`, its compiled binary CPU instructions are loaded into the read-only `.text` segment of RAM.',
    whyItExists:
      'Separating read-only executable instructions from writable data prevents bugs from accidentally overwriting your own program code.',
    roleInGnl:
      'This is where **`BUFFER_SIZE`** physically lives! Because it is a preprocessor macro (`-D BUFFER_SIZE=42`), the compiler embeds the raw number `42` directly inside `.text` instructions — using **0 bytes** of runtime data RAM.',
    evalQuestion: 'Does `BUFFER_SIZE` live on the Stack, Heap, or `.bss`?',
    evalAnswer:
      'None of them! `BUFFER_SIZE` is replaced before compilation and encoded as an immediate constant directly inside machine instructions in `.text`.',
    related: ['buffer_size', 'buffer', 'user_space'],
  },
  buffer_size: {
    id: 'buffer_size',
    title: 'BUFFER_SIZE (Capacity Constant)',
    subtitle: 'Just a compile-time number — NOT a container in RAM',
    category: 'User RAM',
    physicalLocation: 'Embedded as Immediate Constant inside .text (0 B data RAM)',
    whatItIs:
      'A preprocessor macro (e.g. `-D BUFFER_SIZE=42`) replaced by a plain integer before compilation. It represents the **maximum number of bytes** we ask the Kernel to read in one `read()` call.',
    whyItExists:
      'Lets you tune the trade-off between memory footprint and number of `read()` syscalls without changing a single line of code.',
    roleInGnl:
      'Used in two places: deciding how big to allocate `buffer` (`BUFFER_SIZE + 1`), and filling register `rdx` to tell the Kernel the maximum bytes it may copy.',
    evalQuestion: 'What is the physical difference between `BUFFER_SIZE` and `buffer`?',
    evalAnswer:
      '`BUFFER_SIZE` is just a number (capacity) baked into `.text` instructions (0 bytes of data RAM). `buffer` is an actual physical array of `BUFFER_SIZE + 1` bytes allocated on the Heap.',
    related: ['buffer', 'text_segment', 'heap', 'registers'],
  },
  buffer: {
    id: 'buffer',
    title: 'buffer (Physical Heap Container)',
    subtitle: 'Real contiguous RAM bytes where the Kernel drops raw file data',
    category: 'User RAM',
    physicalLocation: 'User Space Heap (`BUFFER_SIZE + 1` bytes)',
    whatItIs:
      'An actual row of contiguous byte slots allocated on the **Heap** at runtime. Its starting memory address is passed to the Kernel in `rsi` so `sys_read` knows where to copy raw bytes.',
    whyItExists:
      'The Kernel needs a real physical destination in User Space RAM to write incoming bytes. The extra **`+ 1` byte** holds the manual `\\0` null terminator because `read()` never adds one.',
    roleInGnl:
      'Acts as a temporary landing pad during the read loop. Once a full line (or EOF) is collected into the static stash, `buffer` is immediately freed so it never leaks or wastes RAM.',
    evalQuestion: 'Why allocate `BUFFER_SIZE + 1` on the Heap instead of a local array on the Stack?',
    evalAnswer:
      'Two reasons: (1) `read()` copies raw bytes without `\\0`, so `+1` prevents a 1-byte overflow; (2) testers compile with `-D BUFFER_SIZE=10000000` (10 MB), which crashes the 8 MB Linux Stack (`SIGSEGV`) but works safely on the Heap.',
    related: ['buffer_size', 'heap', 'stack', 'bss'],
  },
  heap: {
    id: 'heap',
    title: 'Heap Memory (Dynamic RAM)',
    subtitle: 'On-demand RAM blocks that survive until explicitly freed',
    category: 'User RAM',
    physicalLocation: 'User Space RAM — Middle Region (grows upward)',
    whatItIs:
      'A large pool of User-Space RAM managed dynamically at runtime (`malloc` / `free`). Unlike Stack frames, Heap blocks stay alive even after a function returns, until your program explicitly frees them.',
    whyItExists:
      'Needed whenever data size is only known at runtime, is too big for the Stack, or must outlive the function call that created it.',
    roleInGnl:
      'Holds three distinct things: (1) the temporary `buffer` (`BUFFER_SIZE + 1`), (2) the accumulated leftover string pointed to by `.bss`, and (3) each finished line returned to the caller.',
    evalQuestion: 'Who is responsible for freeing each Heap block in `get_next_line`?',
    evalAnswer:
      '`get_next_line` must free its temporary `buffer` and every obsolete `stash` block internally. The caller (`main`) owns and frees each returned line string.',
    related: ['buffer', 'bss', 'stack', 'user_space'],
  },
  stack: {
    id: 'stack',
    title: 'Stack Memory (Temporary Call Frame)',
    subtitle: 'Automatic short-lived memory wiped out on every return',
    category: 'User RAM',
    physicalLocation: 'User Space RAM — Top Region (grows downward, ~8 MB limit)',
    whatItIs:
      'Every time a function is called, the CPU pushes a temporary workspace called a **Stack Frame** holding its local variables (`fd`, `buffer` pointer, `bytes_read`, `line` pointer). The instant the function returns, that entire frame disappears.',
    whyItExists:
      'Instant, zero-overhead automatic allocation/cleanup for local function variables and return addresses.',
    roleInGnl:
      'Explains TWO critical rules: (1) local variables cannot remember leftovers between calls (they vanish on return — that is why `.bss` `static` is mandatory); (2) placing a giant `BUFFER_SIZE` array on the Stack overflows its ~8 MB limit (`SIGSEGV`).',
    evalQuestion: 'Why can’t a normal local pointer remember leftover bytes for the next call?',
    evalAnswer:
      'Because a local variable lives on the Stack frame, which is popped and destroyed the moment `get_next_line()` returns.',
    related: ['bss', 'heap', 'buffer', 'user_space'],
  },
  bss: {
    id: 'bss',
    title: '.bss Segment (Static Memory)',
    subtitle: 'Zero-initialized memory that lives for the entire program',
    category: 'User RAM',
    physicalLocation: 'User Space RAM — Fixed Address (~0x00404040)',
    whatItIs:
      'The **Block Started by Symbol** (`.bss`) segment holds uninitialized `static` and global variables. The OS automatically sets every byte in `.bss` to `0` (`NULL`) before the program starts, and never destroys it until the program exits.',
    whyItExists:
      'Allows a function to keep private persistent state across multiple calls without relying on global variables.',
    roleInGnl:
      'Stores the 8-byte `static` pointer (`stash`, or `stash[fd]` in Bonus) holding the Heap address of leftover bytes that came after `\\n`. Note: the **pointer** lives in `.bss`, while the **characters** live on the **Heap**!',
    evalQuestion: 'Why can’t we avoid a `.bss` static variable by calling `lseek()` to rewind the file?',
    evalAnswer:
      'First, `lseek()` is forbidden in 42 GNL. Second, `stdin`, pipes, and network sockets are streams that CANNOT be rewound (`lseek` fails with `ESPIPE`).',
    related: ['stack', 'heap', 'struct_file', 'buffer'],
  },
  libc_read: {
    id: 'libc_read',
    title: 'libc read() Wrapper & ABI',
    subtitle: 'The Ring 3 translator that prepares CPU registers before syscall',
    category: 'CPU & Syscall',
    physicalLocation: 'User Space Shared Library (libc.so, Ring 3)',
    whatItIs:
      'When C code calls `read(fd, buffer, BUFFER_SIZE)`, it is NOT calling the Linux Kernel directly. `read()` is a tiny User-Space wrapper function inside the C standard library (`libc`).',
    whyItExists:
      'C code doesn’t manually manipulate CPU registers or hardware trap instructions. `libc` translates standard C arguments into the OS’s **ABI (Application Binary Interface)** and converts negative kernel error codes (`-9`) into `-1` + `errno`.',
    roleInGnl:
      'Loads `rax=0`, `rdi=fd`, `rsi=buffer`, `rdx=BUFFER_SIZE`, triggers `syscall`, and upon `sysret` hands the `ssize_t` byte count (or `-1` on error) back to your program.',
    evalQuestion: 'Why does `read()` return `-1` on error even though the Kernel returns `-9` (`-EBADF`) in `rax`?',
    evalAnswer:
      'After `sysret`, the `libc` wrapper checks if `rax` is between `-1` and `-4095`. If so, it stores the positive error number in `errno` and returns `-1` (`ssize_t`) to C.',
    related: ['registers', 'syscall', 'syscall_table', 'rings'],
  },
  syscall: {
    id: 'syscall',
    title: 'syscall & sysret Hardware Instructions',
    subtitle: 'The controlled CPU bridge across the Ring 3 ↔ Ring 0 security wall',
    category: 'CPU & Syscall',
    physicalLocation: 'CPU Hardware Instruction Circuitry',
    whatItIs:
      '`syscall` is a literal x86-64 machine instruction that atomically: **(1)** saves User `rip` into `rcx`, **(2)** elevates CPU privilege from **Ring 3 → Ring 0**, and **(3)** jumps straight to the Kernel’s fixed entry point. `sysret` does the exact reverse back to Ring 3.',
    whyItExists:
      'User Space can NEVER just "jump" to a Kernel address — that would bypass security. `syscall` forces every transition through one single, tightly guarded entry gate.',
    roleInGnl:
      'Every time `get_next_line` needs fresh bytes from the file, the CPU crosses this bridge twice (`syscall` in, `sysret` out). Larger `BUFFER_SIZE` minimizes how often you cross.',
    evalQuestion: 'How does the CPU remember where to resume in User Space after `sys_read` finishes?',
    evalAnswer:
      'At the instant `syscall` runs, hardware saves the next User instruction address (`rip`) into register `rcx`. When `sysret` executes, hardware copies `rcx` back into `rip`.',
    related: ['rings', 'registers', 'libc_read', 'syscall_table'],
  },
  syscall_table: {
    id: 'syscall_table',
    title: 'Syscall Table (sys_call_table)',
    subtitle: 'The Kernel’s dispatch directory mapping syscall numbers to functions',
    category: 'Linux Kernel',
    physicalLocation: 'Kernel Space RAM (Ring 0)',
    whatItIs:
      'An array of function pointers inside the Linux Kernel. Every OS service has an integer ID (on 64-bit Linux: `0` = `sys_read`, `1` = `sys_write`, `2` = `sys_open`, `3` = `sys_close`).',
    whyItExists:
      'User Space is never allowed to pick arbitrary Kernel function addresses. It can only submit an integer index in `rax`, and the Kernel safely looks up the matching function.',
    roleInGnl:
      'Upon entering Ring 0, the Kernel checks `rax` (`0`), indexes `sys_call_table[0]`, and invokes the real `sys_read` implementation.',
    evalQuestion: 'What happens if User Space puts an out-of-range syscall number in `rax`?',
    evalAnswer:
      'The Kernel bounds-checks `rax` before indexing `sys_call_table` and immediately returns `-ENOSYS` ("Function not implemented") without crashing.',
    related: ['syscall', 'kernel_space', 'fdtable', 'registers'],
  },
  fdtable: {
    id: 'fdtable',
    title: 'Process File Descriptor Table (fdtable)',
    subtitle: 'Per-process array mapping small integer `fd` numbers to open files',
    category: 'Linux Kernel',
    physicalLocation: 'Kernel Space RAM (inside each process’s `task_struct`)',
    whatItIs:
      'Every running process has its own private table indexed by small integers called **File Descriptors (`fd`)**: `0` = stdin, `1` = stdout, `2` = stderr, and `3`, `4`, ... for files you `open()`. Each open slot points to an entry in the System Open File Table (`struct file`).',
    whyItExists:
      'Processes never touch raw Kernel pointers directly. Giving User Space a simple integer index (`3`) lets the Kernel validate permissions and catch closed descriptors (`-EBADF`).',
    roleInGnl:
      '`sys_read` uses `rdi` (`fd`) to look up `fdtable[fd]`. If the slot is `NULL` (closed or invalid `fd`), `sys_read` immediately returns `-EBADF` (-9). In **42 Bonus**, `fd=3` and `fd=4` point to two separate `struct file` entries.',
    evalQuestion: 'Why does `open()` usually return `3` for the first file you open?',
    evalAnswer:
      'Because slots `0` (stdin), `1` (stdout), and `2` (stderr) are already open by default. Linux always assigns the lowest available non-negative slot.',
    related: ['struct_file', 'inode', 'kernel_space', 'syscall_table'],
  },
  struct_file: {
    id: 'struct_file',
    title: 'System Open File Table (struct file & f_pos)',
    subtitle: 'Kernel record tracking the live read cursor (`f_pos`) of an open file',
    category: 'Linux Kernel',
    physicalLocation: 'Kernel Space RAM (System-wide Open File Table)',
    whatItIs:
      'Created each time `open()` succeeds. A `struct file` (also called an **Open File Description**) stores the **current byte offset (`f_pos`)**, access mode (`READ`/`WRITE`), and a pointer to the file’s `inode`.',
    whyItExists:
      'Separates "where am I currently reading in this open session?" (`f_pos` in `struct file`) from "what is this file on disk?" (`inode`). Two separate `open()` calls on the same file get two independent `f_pos` cursors!',
    roleInGnl:
      'Every `sys_read` starts reading at `f_pos`, copies up to `BUFFER_SIZE` bytes, and automatically advances `f_pos += bytes_read`. When `f_pos` reaches the file’s total size, `sys_read` returns `0` (EOF).',
    evalQuestion: 'In 42 Bonus, why don’t interleaved reads on `fd=3` and `fd=4` corrupt each other’s file offset?',
    evalAnswer:
      'Each open file has its own `struct file` with its own `f_pos` in Kernel Space, AND its own `stash[fd]` pointer in User `.bss`.',
    related: ['fdtable', 'inode', 'page_cache', 'bss'],
  },
  inode: {
    id: 'inode',
    title: 'inode (Index Node)',
    subtitle: 'The true identity card & disk-block map of a file in Linux',
    category: 'Linux Kernel',
    physicalLocation: 'Stored on SSD filesystem & cached in Kernel RAM',
    whatItIs:
      'Every file in Linux is uniquely identified by an **inode** (Index Node) — a metadata structure containing the file’s **exact byte size**, owner, read/write permissions, timestamps, and **pointers to the physical data blocks on the SSD**. A filename is just a directory label pointing to an inode number!',
    whyItExists:
      'Separating the human filename from the file’s metadata and disk blocks allows multiple names (hard links), fast permission/EOF checks, and lets an already-open file keep being read even if its filename is deleted (`unlink`).',
    roleInGnl:
      '`struct file` points to the file’s `inode` so the Kernel knows (1) the file’s exact size (to detect **EOF** when `f_pos == i_size`), and (2) which **Page Cache / SSD blocks** hold the bytes at offset `f_pos`.',
    evalQuestion: 'What happens if you delete a file (`rm notes.txt`) while your program still has `fd=3` open?',
    evalAnswer:
      'Your program can keep reading until EOF! Deleting only removes the filename link; the Kernel keeps the `inode` and its disk blocks alive until every open `struct file` referencing it is closed.',
    related: ['struct_file', 'page_cache', 'ssd', 'fdtable'],
  },
  page_cache: {
    id: 'page_cache',
    title: 'Kernel Page Cache',
    subtitle: 'Kernel RAM mirror holding recently read 4 KB chunks from the SSD',
    category: 'Linux Kernel',
    physicalLocation: 'Kernel Space RAM (4 KB memory pages)',
    whatItIs:
      'A high-speed cache managed automatically by the Linux Kernel in unused RAM. Whenever you read even 1 byte from disk, Linux reads a full **4 KB (4096 B) page** from the SSD into the Page Cache.',
    whyItExists:
      'SSDs take microseconds (~50,000 ns) while RAM takes nanoseconds (~100 ns). Caching recently accessed file pages makes sequential reads hundreds of times faster.',
    roleInGnl:
      'On your very first `read()`, Linux takes a **Cache Miss** and fetches a 4 KB page from the SSD into Page Cache RAM. Subsequent `read()` calls within that 4 KB page are **Cache Hits** (pure Kernel-RAM → User-RAM copies, zero SSD access).',
    evalQuestion: 'If the Page Cache already has the file in RAM, why is `BUFFER_SIZE=1` still slow?',
    evalAnswer:
      'Because Page Cache lives in **Kernel Space (Ring 0)**. Every `read(fd, buf, 1)` still pays a full `syscall`/`sysret` privilege transition, validation, and copy — plus repeated Heap reallocations in User Space.',
    related: ['ssd', 'inode', 'struct_file', 'rings'],
  },
  ssd: {
    id: 'ssd',
    title: 'SSD / Backing Storage',
    subtitle: 'Permanent non-volatile storage holding the file’s raw bytes',
    category: 'Hardware',
    physicalLocation: 'Physical NVMe / SATA Storage Drive',
    whatItIs:
      'Persistent hardware storage where your text files survive power-off. Files are stored as raw sequences of bytes (including `0x0a` for `\\n` — there is NO `\\0` stored at the end of a text file on disk!).',
    whyItExists:
      'RAM clears when power turns off; SSD keeps files permanently, though reading from it is orders of magnitude slower than RAM.',
    roleInGnl:
      'The ultimate origin of the bytes read by `get_next_line`. Only Ring 0 Kernel storage drivers can read blocks from the SSD into the Kernel Page Cache.',
    evalQuestion: 'Does a text file on the SSD end with a null terminator `\\0`?',
    evalAnswer:
      'No! Files on disk are pure byte counts tracked by `inode.i_size`. C strings require `\\0` only in User Space RAM, which is why GNL must manually write `\\0` after `read()`.',
    related: ['page_cache', 'inode', 'buffer', 'rings'],
  },
};

export const CONCEPT_LIST: ConceptEntry[] = Object.values(CONCEPTS);
