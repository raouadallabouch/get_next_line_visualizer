import {
  BssSlot,
  ByteCell,
  CompiledTrace,
  DataBusTransfer,
  EvalTip,
  FdTableEntry,
  HeapBlock,
  KernelState,
  OpenFileDesc,
  RegisterEntry,
  ReturnedLineRecord,
  SimulationConfig,
  StackSlot,
  StepPhase,
  TraceStep,
} from './types';

const MAX_STEPS = 2500;
const MAX_DISPLAY_BYTES = 64;
const TASK_SIZE_MAX = '0x00007fffffffffff';
const LIBC_READ_ADDR = '0x00007ffff7ea1200';
const LIBC_AFTER_SYSCALL_ADDR = '0x00007ffff7ea1207';
const KERNEL_ENTRY_ADDR = '0xffffffff81c00000';
const KERNEL_SYS_READ_ADDR = '0xffffffff813a4190';
const USER_RSP = '0x00007fffffffde20';
const KERNEL_RSP = '0xffffc9000018bf40';
const BSS_BASE = 0x00404040n;
const HEAP_BASE = 0x55a4c2a012a0n;

function toHex64(val: bigint): string {
  const masked = val & 0xffffffffffffffffn;
  return '0x' + masked.toString(16).padStart(16, '0');
}

function toHexAddr(val: bigint): string {
  return '0x' + val.toString(16).padStart(12, '0');
}

function toSignedHex64(num: number): string {
  if (num < 0) {
    const twos = (1n << 64n) + BigInt(num);
    return '0x' + twos.toString(16).padStart(16, '0');
  }
  return toHex64(BigInt(num));
}

export function formatEscapedChar(code: number): string {
  if (code === 0x0a) return '\\n';
  if (code === 0x00) return '\\0';
  if (code === 0x09) return '\\t';
  if (code === 0x0d) return '\\r';
  if (code === 0x20) return '·';
  if (code >= 0x21 && code <= 0x7e) return String.fromCharCode(code);
  return '·';
}

export function formatPreviewString(str: string | null, maxLen = 22): string {
  if (str === null) return 'NULL';
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '\n') out += '\\n';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\r') out += '\\r';
    else out += ch;
  }
  if (out.length > maxLen) {
    return `"${out.slice(0, maxLen - 1)}…"`;
  }
  return `"${out}"`;
}

function makeUninitCells(size: number): { cells: ByteCell[]; hiddenUninitCount: number } {
  const displayCount = Math.min(size, MAX_DISPLAY_BYTES);
  const cells: ByteCell[] = [];
  for (let i = 0; i < displayCount; i++) {
    cells.push({
      index: i,
      byte: null,
      display: '?',
      hex: '??',
      role: 'uninit',
    });
  }
  return {
    cells,
    hiddenUninitCount: Math.max(0, size - displayCount),
  };
}

function makeStringCells(
  str: string,
  roleOverride?: 'data' | 'extracted' | 'leftover'
): ByteCell[] {
  const cells: ByteCell[] = [];
  const limit = Math.min(str.length, MAX_DISPLAY_BYTES - 1);
  for (let i = 0; i < limit; i++) {
    const code = str.charCodeAt(i);
    const isNl = code === 0x0a;
    cells.push({
      index: i,
      byte: code,
      display: formatEscapedChar(code),
      hex: code.toString(16).padStart(2, '0'),
      role: isNl ? 'newline' : roleOverride ?? 'data',
    });
  }
  cells.push({
    index: str.length,
    byte: 0,
    display: '\\0',
    hex: '00',
    role: 'null',
  });
  return cells;
}

function cloneHeapBlocks(blocks: HeapBlock[], highlightId: string | null): HeapBlock[] {
  return blocks.map((b) => ({
    ...b,
    highlight: b.id === highlightId,
    bytes: b.bytes.map((cell) => ({ ...cell })),
  }));
}

interface InternalHeapBlock extends HeapBlock {
  rawAddr: bigint;
  rawText: string;
}

interface InternalOpenFile {
  fd: number;
  structFileAddr: string;
  inode: number;
  filename: string;
  content: string;
  fPos: number;
  cachedPages: Set<number>;
  lastCacheEvent: 'idle' | 'miss_ssd_fetch' | 'hit_page_cache' | 'eof';
  isOpen: boolean;
}

interface InternalStash {
  blockId: string | null;
  text: string | null;
}

export function compileTrace(config: SimulationConfig): CompiledTrace {
  const steps: TraceStep[] = [];
  let truncated = false;

  const bufferSize = Math.max(0, Math.floor(config.bufferSize));
  const mode = config.mode;

  let nextHeapAddr = HEAP_BASE;
  let blockSeq = 1;
  const heapBlocks: InternalHeapBlock[] = [];

  const stashMap = new Map<number, InternalStash>();
  const trackedFds =
    mode === 'bonus'
      ? Array.from(new Set(config.files.filter((f) => f.isOpen).map((f) => f.fd))).sort(
          (a, b) => a - b
        )
      : [0];
  for (const key of trackedFds) {
    stashMap.set(key, { blockId: null, text: null });
  }

  const getStashKey = (fd: number): number => (mode === 'bonus' ? fd : 0);

  const openFiles = new Map<number, InternalOpenFile>();
  config.files.forEach((f, idx) => {
    if (f.isOpen) {
      openFiles.set(f.fd, {
        fd: f.fd,
        structFileAddr: `0xffff88810a20${(idx * 0x200).toString(16).padStart(4, '0')}`,
        inode: 142080 + idx * 17,
        filename: f.filename,
        content: f.content,
        fPos: 0,
        cachedPages: new Set<number>(),
        lastCacheEvent: 'idle',
        isOpen: true,
      });
    }
  });

  let syscallCount = 0;
  let pageCacheHits = 0;
  let ssdPageFetches = 0;
  let bytesCopiedToUser = 0;
  let mallocCount = 0;
  let freeCount = 0;
  const returnedLines: ReturnedLineRecord[] = [];

  const regState: Record<RegisterEntry['name'], { hex: string; meaning: string; role: RegisterEntry['role'] }> = {
    rax: { hex: toHex64(0n), meaning: 'idle', role: 'return' },
    rdi: { hex: toHex64(0n), meaning: 'arg1 (fd)', role: 'arg' },
    rsi: { hex: toHex64(0n), meaning: 'arg2 (buffer Heap addr)', role: 'arg' },
    rdx: { hex: toHex64(0n), meaning: 'arg3 (BUFFER_SIZE)', role: 'arg' },
    rip: { hex: '0x0000000000401120', meaning: 'User Program ready', role: 'control' },
    rcx: { hex: toHex64(0n), meaning: 'saved User rip', role: 'saved' },
    r11: { hex: toHex64(0x246n), meaning: 'saved CPU flags', role: 'saved' },
    rsp: { hex: USER_RSP, meaning: 'User Stack ptr', role: 'control' },
  };

  let stackActive = false;
  let stackFrameLabel = 'Caller (idle)';
  let stackFdVal = '—';
  let stackBufVal = '—';
  let stackBytesVal = '—';
  let stackLineVal = '—';

  const allocHeap = (
    size: number,
    label: string,
    kind: HeapBlock['kind'],
    ownerFd: number,
    initialText?: string,
    cellRole?: 'data' | 'extracted' | 'leftover'
  ): InternalHeapBlock => {
    const addr = nextHeapAddr;
    const alignedAdvance = BigInt(Math.ceil((Math.max(1, size) + 16) / 16) * 16);
    nextHeapAddr += alignedAdvance;
    mallocCount += 1;

    let cells: ByteCell[];
    let hiddenUninitCount = 0;
    if (initialText !== undefined) {
      cells = makeStringCells(initialText, cellRole);
      hiddenUninitCount = Math.max(0, initialText.length - (MAX_DISPLAY_BYTES - 1));
    } else {
      const uninit = makeUninitCells(size);
      cells = uninit.cells;
      hiddenUninitCount = uninit.hiddenUninitCount;
    }

    const block: InternalHeapBlock = {
      id: `blk-${blockSeq++}`,
      address: toHexAddr(addr),
      rawAddr: addr,
      size,
      label,
      kind,
      ownerFd,
      status: 'live',
      bytes: cells,
      hiddenUninitCount,
      allocatedAtStep: steps.length,
      freedAtStep: null,
      highlight: true,
      rawText: initialText ?? '',
    };
    heapBlocks.push(block);
    return block;
  };

  const freeHeap = (blockId: string | null) => {
    if (!blockId) return;
    const blk = heapBlocks.find((b) => b.id === blockId);
    if (blk && blk.status === 'live') {
      blk.status = 'freed';
      blk.freedAtStep = steps.length;
      freeCount += 1;
    }
  };

  const buildBssSlots = (changedKey: number | null): BssSlot[] => {
    if (mode === 'mandatory') {
      const st = stashMap.get(0) ?? { blockId: null, text: null };
      const blk = st.blockId ? heapBlocks.find((b) => b.id === st.blockId) : null;
      return [
        {
          name: 'static stash*',
          fd: config.files[0]?.fd ?? 3,
          address: toHexAddr(BSS_BASE),
          pointsTo: blk && blk.status === 'live' ? blk.address : null,
          preview: formatPreviewString(st.text),
          changed: changedKey === 0,
        },
      ];
    }

    const keys = Array.from(stashMap.keys()).sort((a, b) => a - b);
    return keys.map((fdKey) => {
      const st = stashMap.get(fdKey) ?? { blockId: null, text: null };
      const blk = st.blockId ? heapBlocks.find((b) => b.id === st.blockId) : null;
      return {
        name: `static stash[${fdKey}]`,
        fd: fdKey,
        address: toHexAddr(BSS_BASE + BigInt(fdKey * 8)),
        pointsTo: blk && blk.status === 'live' ? blk.address : null,
        preview: formatPreviewString(st.text),
        changed: changedKey === fdKey,
      };
    });
  };

  const buildFdTable = (lookupFd: number | null): FdTableEntry[] => {
    const entries: FdTableEntry[] = [
      { fd: 0, label: 'stdin (tty)', structFileAddr: '0xffff88810a100000', isActiveLookup: lookupFd === 0, isOpen: true },
      { fd: 1, label: 'stdout (tty)', structFileAddr: '0xffff88810a100200', isActiveLookup: lookupFd === 1, isOpen: true },
      { fd: 2, label: 'stderr (tty)', structFileAddr: '0xffff88810a100400', isActiveLookup: lookupFd === 2, isOpen: true },
    ];

    const fdsToShow = new Set<number>();
    config.files.forEach((f) => fdsToShow.add(f.fd));
    if (lookupFd !== null && lookupFd > 2) fdsToShow.add(lookupFd);

    Array.from(fdsToShow)
      .sort((a, b) => a - b)
      .forEach((fd) => {
        const of = openFiles.get(fd);
        entries.push({
          fd,
          label: of ? of.filename : '(closed / NULL)',
          structFileAddr: of ? of.structFileAddr : null,
          isActiveLookup: lookupFd === fd,
          isOpen: Boolean(of),
        });
      });

    return entries;
  };

  const buildOpenFileSnapshots = (
    activeSliceFd: number | null,
    activeSliceStart: number | null,
    activeSliceLen: number
  ): OpenFileDesc[] => {
    return Array.from(openFiles.values())
      .sort((a, b) => a.fd - b.fd)
      .map((of) => ({
        fd: of.fd,
        structFileAddr: of.structFileAddr,
        inode: of.inode,
        filename: of.filename,
        content: of.content,
        fPos: of.fPos,
        activeSliceStart: activeSliceFd === of.fd ? activeSliceStart : null,
        activeSliceLen: activeSliceFd === of.fd ? activeSliceLen : 0,
        fMode: 'FMODE_READ',
        cachedPages: Array.from(of.cachedPages).sort((a, b) => a - b),
        lastCacheEvent: of.lastCacheEvent,
      }));
  };

  interface EmitParams {
    callIndex: number;
    activeFd: number;
    stageIndex: TraceStep['stageIndex'];
    isMacro: boolean;
    phase: StepPhase;
    title: string;
    explanation: string;
    evalTip: EvalTip;
    isSyscallMarker?: boolean;
    isReturnMarker?: boolean;
    ring: 3 | 0;
    activeInstruction: string;
    changedRegs?: RegisterEntry['name'][];
    dataBusTransfer?: DataBusTransfer | null;
    errnoValue?: string | null;
    changedStack?: ('fd' | 'buffer' | 'bytes_read' | 'line')[];
    changedBssKey?: number | null;
    highlightHeapId?: string | null;
    textImmediateHighlight?: boolean;
    activeSyscallIndex?: number | null;
    lookupFd?: number | null;
    lookupStatus?: KernelState['lookupStatus'];
    accessOkCheck?: KernelState['accessOkCheck'];
    kernelErrno?: number | null;
    activeSliceFd?: number | null;
    activeSliceStart?: number | null;
    activeSliceLen?: number;
  }

  const emit = (p: EmitParams): boolean => {
    if (steps.length >= MAX_STEPS) {
      truncated = true;
      return false;
    }

    const changedRegSet = new Set(p.changedRegs ?? []);
    const changedStackSet = new Set(p.changedStack ?? []);

    const registers: RegisterEntry[] = (
      ['rax', 'rdi', 'rsi', 'rdx', 'rip', 'rcx', 'r11', 'rsp'] as RegisterEntry['name'][]
    ).map((name) => ({
      name,
      hex: regState[name].hex,
      meaning: regState[name].meaning,
      role: regState[name].role,
      changed: changedRegSet.has(name),
    }));

    const stackSlots: StackSlot[] = stackActive
      ? [
          { name: 'fd', type: 'int', address: '0x7fffffffde3c', value: stackFdVal, note: 'target descriptor', changed: changedStackSet.has('fd') },
          { name: 'buffer', type: 'char *', address: '0x7fffffffde30', value: stackBufVal, note: '8B ptr -> Heap', changed: changedStackSet.has('buffer') },
          { name: 'bytes_read', type: 'ssize_t', address: '0x7fffffffde28', value: stackBytesVal, note: 'signed count / -1', changed: changedStackSet.has('bytes_read') },
          { name: 'line', type: 'char *', address: '0x7fffffffde20', value: stackLineVal, note: 'result ptr -> Heap', changed: changedStackSet.has('line') },
        ]
      : [];

    const liveGnlHeapBytes = heapBlocks
      .filter((b) => b.status === 'live')
      .reduce((acc, b) => acc + b.size, 0);
    const callerOwnedBytes = heapBlocks
      .filter((b) => b.status === 'returned_to_caller')
      .reduce((acc, b) => acc + b.size, 0);

    steps.push({
      id: steps.length,
      callIndex: p.callIndex,
      activeFd: p.activeFd,
      stageIndex: p.stageIndex,
      isMacro: p.isMacro,
      phase: p.phase,
      title: p.title,
      explanation: p.explanation,
      evalTip: p.evalTip,
      isSyscallMarker: p.isSyscallMarker ?? false,
      isReturnMarker: p.isReturnMarker ?? false,
      cpu: {
        ring: p.ring,
        registers,
        activeInstruction: p.activeInstruction,
        dataBusTransfer: p.dataBusTransfer ?? null,
        errnoValue: p.errnoValue ?? null,
      },
      memory: {
        stackActive,
        stackFrameLabel,
        stackSlots,
        heapBlocks: cloneHeapBlocks(heapBlocks, p.highlightHeapId ?? null),
        bssSlots: buildBssSlots(p.changedBssKey ?? null),
        textImmediateHighlight: p.textImmediateHighlight ?? false,
        bufferSize,
      },
      kernel: {
        activeSyscallIndex: p.activeSyscallIndex ?? null,
        fdTable: buildFdTable(p.lookupFd ?? null),
        openFiles: buildOpenFileSnapshots(
          p.activeSliceFd ?? null,
          p.activeSliceStart ?? null,
          p.activeSliceLen ?? 0
        ),
        lookupFd: p.lookupFd ?? null,
        lookupStatus: p.lookupStatus ?? 'idle',
        accessOkCheck: p.accessOkCheck ?? {
          status: 'idle',
          address: '—',
          count: 0,
          limit: TASK_SIZE_MAX,
        },
        kernelErrno: p.kernelErrno ?? null,
      },
      metrics: {
        syscallCount,
        pageCacheHits,
        ssdPageFetches,
        bytesCopiedToUser,
        mallocCount,
        freeCount,
        liveGnlHeapBytes,
        callerOwnedBytes,
        gnlLeakBytes: liveGnlHeapBytes,
        returnedLines: returnedLines.map((r) => ({ ...r })),
      },
    });

    return true;
  };

  // Step 0: Initial Machine State
  emit({
    callIndex: 0,
    activeFd: config.callSequence[0] ?? config.files[0]?.fd ?? 3,
    stageIndex: 0,
    isMacro: true,
    phase: 'program_start',
    title: `Initial State: BUFFER_SIZE (${bufferSize}) lives in CPU instructions; .bss pointer is NULL`,
    explanation: `Before any call starts: \`BUFFER_SIZE\` (${bufferSize}) is just a compile-time constant baked into the binary's \`.text\` instructions (0 bytes of runtime data RAM). The OS zero-initialized the \`static\` pointer in \`.bss\` to \`NULL\`, and the Linux Kernel already tracks your open file(s) at offset \`f_pos = 0\`.`,
    evalTip: {
      conceptTag: 'BUFFER_SIZE vs buffer',
      question: 'Does `BUFFER_SIZE` reserve any RAM before runtime?',
      answer:
        'No. `BUFFER_SIZE` is a preprocessor number baked directly into CPU instructions (`.text`). Only `buffer` (allocated on the Heap for `BUFFER_SIZE + 1` bytes) is a real physical container in RAM.',
    },
    ring: 3,
    activeInstruction: 'Process loaded in Ring 3 (User Mode)',
    textImmediateHighlight: true,
  });

  const plannedCalls: number[] = [];
  if (config.callSequence.length > 0) {
    plannedCalls.push(...config.callSequence);
  } else {
    plannedCalls.push(config.files[0]?.fd ?? 3);
  }

  const dynamicUntilNull = config.callSequence.length === 0;
  let callIndex = 0;
  let planIdx = 0;
  const maxCalls = 40;

  while (callIndex < maxCalls && !truncated) {
    if (!dynamicUntilNull && planIdx >= plannedCalls.length) break;

    const fd = dynamicUntilNull ? (config.files[0]?.fd ?? 3) : plannedCalls[planIdx++];
    callIndex += 1;
    let syscallsInThisCall = 0;

    // Call Entry (Stage 1)
    stackActive = true;
    stackFrameLabel = `Call #${callIndex} (fd=${fd})`;
    stackFdVal = `${fd}`;
    stackBufVal = '<empty>';
    stackBytesVal = '<empty>';
    stackLineVal = '<empty>';
    regState.rdi = { hex: toSignedHex64(fd), meaning: `fd = ${fd}`, role: 'arg' };
    regState.rip = { hex: '0x0000000000401120', meaning: 'User Space call entry', role: 'control' };
    regState.rsp = { hex: USER_RSP, meaning: 'Active Stack Frame', role: 'control' };

    const stashKey = getStashKey(fd);
    if (!stashMap.has(stashKey) && fd >= 0) {
      stashMap.set(stashKey, { blockId: null, text: null });
    }
    const existingStash = stashMap.get(stashKey)?.text ?? null;

    if (
      !emit({
        callIndex,
        activeFd: fd,
        stageIndex: 1,
        isMacro: true,
        phase: 'user_c',
        title: `Call #${callIndex} begins for fd=${fd} — Temporary Stack frame opens`,
        explanation:
          existingStash !== null
            ? `A fresh temporary Stack frame is created in Ring 3. Notice that while previous local variables vanished, the \`static\` pointer in \`.bss\` survived and still points to leftover bytes ${formatPreviewString(existingStash)} on the Heap.`
            : `A fresh temporary Stack frame is created in Ring 3 (User Mode). The \`static\` pointer in \`.bss\` is currently \`NULL\`.`,
        evalTip: {
          conceptTag: 'Stack vs .bss Lifetime',
          question: 'Why does the leftover pointer survive across calls while local variables vanish?',
          answer:
            'Local variables live on the Stack frame, which is destroyed when the call returns. A `static` pointer lives in `.bss` for the entire lifetime of the process.',
        },
        ring: 3,
        activeInstruction: `Enter get_next_line(fd=${fd})`,
        changedRegs: ['rdi', 'rip', 'rsp'],
        changedStack: ['fd', 'buffer', 'bytes_read', 'line'],
      })
    ) {
      break;
    }

    // Input Guard
    if (fd < 0 || bufferSize <= 0 || (mode === 'bonus' && fd >= 1024)) {
      stackActive = false;
      stackFrameLabel = 'Caller (idle)';
      regState.rax = { hex: toHex64(0n), meaning: 'NULL (invalid input)', role: 'return' };
      returnedLines.push({ callIndex, fd, address: null, value: null, byteLength: 0, syscallsInCall: 0 });
      emit({
        callIndex,
        activeFd: fd,
        stageIndex: 8,
        isMacro: true,
        phase: 'return',
        title: `Invalid input (fd=${fd}, BUFFER_SIZE=${bufferSize}) — returns NULL immediately`,
        explanation:
          'Before allocating any Heap RAM or trapping into the Kernel, invalid descriptors or non-positive buffer capacities return `NULL` cleanly.',
        evalTip: {
          conceptTag: 'Boundary Validation',
          question: 'What happens if `BUFFER_SIZE <= 0` or `fd < 0`?',
          answer:
            'Rejecting invalid inputs up front avoids allocating invalid Heap sizes and prevents unnecessary syscalls.',
        },
        isReturnMarker: true,
        ring: 3,
        activeInstruction: 'Return NULL (0 syscalls, 0 allocations)',
        changedRegs: ['rax'],
      });
      if (dynamicUntilNull) break;
      continue;
    }

    // Stage 1: Allocate Heap buffer (BUFFER_SIZE + 1)
    const bufBlock = allocHeap(
      bufferSize + 1,
      `temp buffer (${bufferSize} data + 1 '\\0')`,
      'buffer',
      fd
    );
    stackBufVal = bufBlock.address;
    stackBytesVal = 'ready';
    regState.rdi = { hex: toHex64(BigInt(bufferSize + 1)), meaning: `size = ${bufferSize + 1} B`, role: 'arg' };
    regState.rax = { hex: toHex64(bufBlock.rawAddr), meaning: `Heap addr ${bufBlock.address}`, role: 'return' };
    regState.rip = { hex: '0x000000000040114d', meaning: 'Heap allocation complete', role: 'control' };

    if (
      !emit({
        callIndex,
        activeFd: fd,
        stageIndex: 1,
        isMacro: true,
        phase: 'user_heap',
        title: `Stage 1 — Allocate physical Heap container: ${bufferSize + 1} bytes at ${bufBlock.address}`,
        explanation: `Using the compile-time number \`BUFFER_SIZE\` (${bufferSize}) from \`.text\`, we reserve a real contiguous ${bufferSize + 1}-byte container on the Heap: ${bufferSize} slots for raw bytes from the Kernel, plus **1 extra slot** reserved for the null terminator \`'\\0'\`.`,
        evalTip: {
          conceptTag: 'Why +1 & Why Heap?',
          question: 'Why reserve `BUFFER_SIZE + 1` bytes on the Heap instead of on the Stack?',
          answer:
            '1) `read()` copies raw bytes and never writes `\\0`, so index `BUFFER_SIZE` needs +1 byte. 2) Huge `BUFFER_SIZE` (e.g. 10 MB) overflows the 8 MB Linux Stack (`SIGSEGV`), while the Heap handles it safely.',
        },
        ring: 3,
        activeInstruction: `Reserve ${bufferSize + 1} B on Heap -> ${bufBlock.address}`,
        changedRegs: ['rdi', 'rax', 'rip'],
        changedStack: ['buffer', 'bytes_read'],
        highlightHeapId: bufBlock.id,
        textImmediateHighlight: true,
        dataBusTransfer: {
          from: `.text constant (${bufferSize} + 1)`,
          to: `Heap RAM ${bufBlock.address}`,
          label: `Allocate ${bufferSize + 1} B container`,
          kind: 'immediate',
        },
      })
    ) {
      break;
    }

    let bytesRead = 1;
    let readError = false;

    const stashHasNewline = (): boolean => {
      const t = stashMap.get(stashKey)?.text;
      return t !== null && t !== undefined && t.includes('\n');
    };

    if (stashHasNewline()) {
      emit({
        callIndex,
        activeFd: fd,
        stageIndex: 7,
        isMacro: true,
        phase: 'user_c',
        title: `Newline '\\n' already waiting in Heap stash — 0 syscalls needed!`,
        explanation: `Scanning the leftover bytes already pointed to by \`.bss\` finds a \`'\\n'\` right here in User Space RAM. The Kernel is not disturbed at all — we skip the entire read/syscall loop and jump straight to releasing the temp buffer and slicing out the line!`,
        evalTip: {
          conceptTag: 'Zero-Syscall Reuse',
          question: 'Why did this call perform 0 syscalls?',
          answer:
            'An earlier `read()` already brought multiple lines into User Space RAM and kept the remainder via `.bss`. Scanning User RAM is orders of magnitude faster than switching to Ring 0.',
        },
        ring: 3,
        activeInstruction: "Found '\\n' in User-Space Heap -> skip Kernel read",
      });
    }

    while (!stashHasNewline() && bytesRead > 0 && !truncated) {
      // Stage 2: libc read() wrapper loads 4 CPU registers
      regState.rax = { hex: toHex64(0n), meaning: 'Syscall #0 (read)', role: 'syscall_num' };
      regState.rdi = { hex: toSignedHex64(fd), meaning: `Arg 1: fd = ${fd}`, role: 'arg' };
      regState.rsi = { hex: toHex64(bufBlock.rawAddr), meaning: `Arg 2: buffer = ${bufBlock.address}`, role: 'arg' };
      regState.rdx = { hex: toHex64(BigInt(bufferSize)), meaning: `Arg 3: max bytes = ${bufferSize}`, role: 'arg' };
      regState.rip = { hex: LIBC_READ_ADDR, meaning: 'libc read() wrapper (Ring 3)', role: 'control' };

      if (
        !emit({
          callIndex,
          activeFd: fd,
          stageIndex: 2,
          isMacro: false,
          phase: 'libc_prep',
          title: `Stage 2 — libc read() wrapper loads 4 CPU registers (still in Ring 3)`,
          explanation: `\`read()\` is NOT the Kernel — it is a tiny User-Space wrapper in \`libc\`. Following the x86-64 Linux ABI, it loads 4 CPU registers: \`rax = 0\` (syscall ID for read), \`rdi = ${fd}\` (fd), \`rsi = ${bufBlock.address}\` (Heap buffer address), and \`rdx = ${bufferSize}\` (\`BUFFER_SIZE\` capacity).`,
          evalTip: {
            conceptTag: 'x86-64 Syscall ABI',
            question: 'Which 4 CPU registers carry a `read()` request to the 64-bit Linux Kernel?',
            answer:
              '`rax = 0` (syscall number for read), `rdi = fd`, `rsi = buffer address in User RAM`, and `rdx = BUFFER_SIZE`. The CPU is still restricted in Ring 3.',
          },
          ring: 3,
          activeInstruction: `Load ABI registers: rax=0, rdi=${fd}, rsi=${bufBlock.address}, rdx=${bufferSize}`,
          changedRegs: ['rax', 'rdi', 'rsi', 'rdx', 'rip'],
          highlightHeapId: bufBlock.id,
          textImmediateHighlight: true,
          dataBusTransfer: {
            from: 'User Space (libc read wrapper)',
            to: 'CPU Registers (rax, rdi, rsi, rdx)',
            label: `ABI prep: #0, fd=${fd}, count=${bufferSize}`,
            kind: 'immediate',
          },
        })
      ) {
        break;
      }

      // Stage 3: CPU hardware `syscall` — Ring 3 -> Ring 0
      syscallCount += 1;
      syscallsInThisCall += 1;
      regState.rcx = { hex: LIBC_AFTER_SYSCALL_ADDR, meaning: 'Saved User rip (return point)', role: 'saved' };
      regState.r11 = { hex: toHex64(0x246n), meaning: 'Saved User CPU flags', role: 'saved' };
      regState.rip = { hex: KERNEL_ENTRY_ADDR, meaning: 'Linux Kernel Entry (Ring 0)', role: 'control' };
      regState.rsp = { hex: KERNEL_RSP, meaning: 'Kernel Stack ptr', role: 'control' };

      if (
        !emit({
          callIndex,
          activeFd: fd,
          stageIndex: 3,
          isMacro: false,
          phase: 'cpu_syscall',
          title: `Stage 3 — Hardware SYSCALL #${syscallCount}: CPU switches Ring 3 -> Ring 0`,
          explanation: `CPU circuits execute the hardware \`syscall\` instruction atomically: (1) save the next User-Space instruction address (\`rip\`) into \`rcx\` so it remembers where to resume, (2) elevate security privilege from **Ring 3 (User Mode)** to **Ring 0 (Kernel Mode)**, and (3) jump straight into the protected Linux Kernel entry point.`,
          evalTip: {
            conceptTag: 'Hardware Ring Transition',
            question: 'What 3 atomic actions happen inside the CPU chip when `syscall` executes?',
            answer:
              '1) Saves User `rip` into `rcx` (and flags into `r11`). 2) Switches hardware privilege from Ring 3 to Ring 0. 3) Jumps `rip` to the protected Kernel entry address (`MSR_LSTAR`).',
          },
          isSyscallMarker: true,
          ring: 0,
          activeInstruction: 'Hardware SYSCALL :: Ring 3 (User) -> Ring 0 (Kernel)',
          changedRegs: ['rcx', 'r11', 'rip', 'rsp'],
          dataBusTransfer: {
            from: 'Ring 3 (User Mode)',
            to: 'Ring 0 (Linux Kernel Entry)',
            label: 'SYSCALL TRAP (CPL 3 -> 0)',
            kind: 'trap',
          },
        })
      ) {
        break;
      }

      // Stage 4a: sys_call_table dispatch
      regState.rip = { hex: KERNEL_SYS_READ_ADDR, meaning: 'Kernel sys_read (table[0])', role: 'control' };
      if (
        !emit({
          callIndex,
          activeFd: fd,
          stageIndex: 4,
          isMacro: false,
          phase: 'kernel_dispatch',
          title: `Stage 4 — Kernel looks up sys_call_table[rax=0] -> calls sys_read`,
          explanation: `Now running in Ring 0 with full hardware access, the Kernel reads \`rax\` (\`0\`) and uses it as an array index into \`sys_call_table\` (a Kernel table of function pointers). Index \`0\` resolves to the real Kernel read handler: \`sys_read\`.`,
          evalTip: {
            conceptTag: 'sys_call_table',
            question: 'How does the Kernel map `rax = 0` to `sys_read`?',
            answer:
              'The Kernel maintains an array of function pointers called `sys_call_table`. It indexes `sys_call_table[rax]` — slot `0` points directly to `sys_read`.',
          },
          ring: 0,
          activeInstruction: 'Dispatch sys_call_table[0] -> sys_read',
          changedRegs: ['rip'],
          activeSyscallIndex: 0,
        })
      ) {
        break;
      }

      // Stage 4b: Validate fd in fdtable & buffer pointer via access_ok
      const fileDesc = openFiles.get(fd);
      if (!fileDesc) {
        regState.rax = { hex: toSignedHex64(-9), meaning: '-9 (-EBADF: closed/bad fd)', role: 'return' };
        if (
          !emit({
            callIndex,
            activeFd: fd,
            stageIndex: 4,
            isMacro: false,
            phase: 'kernel_validate',
            title: `Stage 4 — Validation FAILED: fd=${fd} is not open -> Kernel sets rax = -9 (-EBADF)`,
            explanation: `\`sys_read\` checks \`rdi\` (\`fd=${fd}\`) in the process's Open File Table and finds \`NULL\` (closed or never opened). It refuses to read and writes error code \`-9\` (\`-EBADF\`) into \`rax\`.`,
            evalTip: {
              conceptTag: 'Kernel Error (-EBADF)',
              question: 'What does `sys_read` return in `rax` on a closed file descriptor?',
              answer:
                'The Kernel puts negative error code `-9` (`-EBADF`) in `rax`. Back in Ring 3, `libc` translates negative kernel errors into return value `-1` and stores `9` in `errno`.',
            },
            ring: 0,
            activeInstruction: `fdtable[${fd}] == NULL -> error -EBADF (-9)`,
            changedRegs: ['rax'],
            activeSyscallIndex: 0,
            lookupFd: fd,
            lookupStatus: 'ebadf',
            kernelErrno: -9,
            dataBusTransfer: {
              from: `Open File Table fd[${fd}] (NULL)`,
              to: 'rax = -9 (-EBADF)',
              label: 'Bad File Descriptor',
              kind: 'error',
            },
          })
        ) {
          break;
        }

        // Stage 6: sysret with error
        regState.rip = { hex: LIBC_AFTER_SYSCALL_ADDR, meaning: 'Resumed in libc (Ring 3)', role: 'control' };
        regState.rsp = { hex: USER_RSP, meaning: 'User Stack ptr', role: 'control' };
        bytesRead = -1;
        readError = true;
        stackBytesVal = '-1';

        if (
          !emit({
            callIndex,
            activeFd: fd,
            stageIndex: 6,
            isMacro: true,
            phase: 'cpu_sysret',
            title: `Stage 6 — SYSRET (Ring 0 -> Ring 3): libc sees -EBADF, sets errno & returns -1`,
            explanation: `\`sysret\` drops the CPU back to Ring 3 and restores \`rip\` from \`rcx\`. The \`libc\` wrapper sees \`rax = -9\`, sets \`errno = EBADF\`, and returns \`(ssize_t)-1\` to User Space.`,
            evalTip: {
              conceptTag: 'ssize_t vs size_t',
              question: 'Why does `read()` return `ssize_t` instead of `size_t`?',
              answer:
                '`ssize_t` is signed so it can distinguish `-1` (error), `0` (EOF), and `> 0` (bytes read). An unsigned `size_t` could never be `< 0`.',
            },
            ring: 3,
            activeInstruction: 'Hardware SYSRET -> errno=EBADF -> read() returns -1',
            changedRegs: ['rip', 'rsp'],
            changedStack: ['bytes_read'],
            errnoValue: 'EBADF (9)',
            dataBusTransfer: {
              from: 'Ring 0 (rax = -9)',
              to: 'Ring 3 (bytes_read = -1, errno = EBADF)',
              label: 'SYSRET ERROR',
              kind: 'error',
            },
          })
        ) {
          break;
        }
        break;
      }

      if (
        !emit({
          callIndex,
          activeFd: fd,
          stageIndex: 4,
          isMacro: false,
          phase: 'kernel_validate',
          title: `Stage 4 — Kernel validates fd=${fd} (f_pos=${fileDesc.fPos}) & checks buffer lies in User Space`,
          explanation: `\`sys_read\` confirms \`fd=${fd}\` is open in the Process File Table (resolving its Open File Description with current offset \`f_pos = ${fileDesc.fPos}\`) and verifies \`rsi\` (\`${bufBlock.address}\`) is a valid User-Space address — preventing a program from tricking Ring 0 into overwriting Kernel RAM.`,
          evalTip: {
            conceptTag: 'Memory Safety (access_ok)',
            question: 'Why must the Kernel verify the `buffer` pointer in `rsi` before copying bytes?',
            answer:
              'Ring 0 has permission to write anywhere in RAM. Checking `rsi < TASK_SIZE_MAX` stops a buggy or malicious User-Space process from making the Kernel overwrite itself.',
          },
          ring: 0,
          activeInstruction: `Verify fd[${fd}] -> struct file (f_pos=${fileDesc.fPos}) & User-Space ptr OK`,
          activeSyscallIndex: 0,
          lookupFd: fd,
          lookupStatus: 'valid',
          accessOkCheck: {
            status: 'pass',
            address: bufBlock.address,
            count: bufferSize,
            limit: TASK_SIZE_MAX,
          },
        })
      ) {
        break;
      }

      // Stage 5: SSD / Page Cache -> User Heap copy + f_pos advance + rax = bytes_read
      const remaining = fileDesc.content.length - fileDesc.fPos;
      const toCopy = Math.min(bufferSize, Math.max(0, remaining));
      const sliceStart = fileDesc.fPos;
      const chunk = fileDesc.content.slice(sliceStart, sliceStart + toCopy);

      let cacheEvent: OpenFileDesc['lastCacheEvent'] = 'eof';
      let transferKind: DataBusTransfer['kind'] = 'copy_to_user';
      let transferLabel = '';
      let ioTitle = '';
      let ioExplanation = '';

      if (toCopy === 0) {
        cacheEvent = 'eof';
        fileDesc.lastCacheEvent = 'eof';
        regState.rax = { hex: toHex64(0n), meaning: '0 bytes (EOF)', role: 'return' };
        ioTitle = `Stage 5 — End-of-File reached (f_pos = ${fileDesc.fPos}): 0 bytes copied, rax = 0`;
        ioExplanation = `The file's offset \`f_pos\` (${fileDesc.fPos}) has reached the end of the file (${fileDesc.content.length} B). Zero bytes are copied to User Heap, \`f_pos\` stays unchanged, and the Kernel places \`0\` in \`rax\`.`;
        transferLabel = 'EOF -> rax = 0';
      } else {
        const pageIdx = Math.floor(sliceStart / 4096);
        const wasCached = fileDesc.cachedPages.has(pageIdx);
        if (!wasCached) {
          fileDesc.cachedPages.add(pageIdx);
          ssdPageFetches += 1;
          cacheEvent = 'miss_ssd_fetch';
          transferKind = 'dma_disk';
          transferLabel = `SSD 4KB Page #${pageIdx} -> Page Cache -> User Heap (${toCopy} B)`;
        } else {
          pageCacheHits += 1;
          cacheEvent = 'hit_page_cache';
          transferKind = 'copy_to_user';
          transferLabel = `Page Cache HIT -> copy ${toCopy} B to Heap ${bufBlock.address}`;
        }
        fileDesc.lastCacheEvent = cacheEvent;

        for (let i = 0; i < Math.min(toCopy, MAX_DISPLAY_BYTES); i++) {
          const code = chunk.charCodeAt(i);
          bufBlock.bytes[i] = {
            index: i,
            byte: code,
            display: formatEscapedChar(code),
            hex: code.toString(16).padStart(2, '0'),
            role: code === 0x0a ? 'newline' : 'newly_copied',
          };
        }
        bufBlock.rawText = chunk;
        fileDesc.fPos += toCopy;
        bytesCopiedToUser += toCopy;
        regState.rax = { hex: toHex64(BigInt(toCopy)), meaning: `${toCopy} byte(s) copied`, role: 'return' };

        ioTitle =
          cacheEvent === 'miss_ssd_fetch'
            ? `Stage 5 — SSD -> Page Cache (4KB load) -> copy ${toCopy} B into User Heap; f_pos: ${sliceStart} -> ${fileDesc.fPos}`
            : `Stage 5 — Page Cache HIT -> copy ${toCopy} B into User Heap; f_pos: ${sliceStart} -> ${fileDesc.fPos}`;
        ioExplanation =
          cacheEvent === 'miss_ssd_fetch'
            ? `First access to 4 KB page #${pageIdx}: the Kernel loads it from **SSD** into **Kernel Page Cache RAM**, copies ${toCopy} raw byte(s) (${formatPreviewString(chunk)}) into User Heap \`${bufBlock.address}\` (notice NO \`'\\0'\` is added!), advances \`f_pos\` to \`${fileDesc.fPos}\`, and writes \`${toCopy}\` into \`rax\`.`
            : `4 KB page #${pageIdx} is already hot in **Kernel Page Cache RAM** (no slow SSD hit!). The Kernel copies ${toCopy} raw byte(s) (${formatPreviewString(chunk)}) directly into User Heap \`${bufBlock.address}\`, advances \`f_pos\` to \`${fileDesc.fPos}\`, and writes \`${toCopy}\` into \`rax\`.`;
      }

      if (
        !emit({
          callIndex,
          activeFd: fd,
          stageIndex: 5,
          isMacro: true,
          phase: 'kernel_io',
          title: ioTitle,
          explanation: ioExplanation,
          evalTip:
            cacheEvent === 'miss_ssd_fetch'
              ? {
                  conceptTag: 'SSD vs Page Cache',
                  question: 'Does every `read()` syscall physically read from the SSD?',
                  answer:
                    'No. The first read fetches a 4 KB page from SSD into Kernel Page Cache RAM. Later reads within that page hit RAM directly — though each `read()` still pays Ring 3 <-> 0 syscall cost.',
                }
              : {
                  conceptTag: 'Kernel File Offset (f_pos)',
                  question: 'How does the next `read()` know where to continue?',
                  answer:
                    'The Kernel increments `f_pos` inside the Open File Description (`struct file`). That offset lives in Kernel Space and advances automatically after every read.',
                },
          ring: 0,
          activeInstruction:
            toCopy > 0
              ? `Copy ${toCopy} B -> User Heap ${bufBlock.address}; f_pos=${fileDesc.fPos}; rax=${toCopy}`
              : 'EOF -> rax = 0',
          changedRegs: ['rax'],
          highlightHeapId: bufBlock.id,
          activeSyscallIndex: 0,
          lookupFd: fd,
          lookupStatus: 'valid',
          accessOkCheck: {
            status: 'pass',
            address: bufBlock.address,
            count: bufferSize,
            limit: TASK_SIZE_MAX,
          },
          activeSliceFd: fd,
          activeSliceStart: sliceStart,
          activeSliceLen: toCopy,
          dataBusTransfer: {
            from: cacheEvent === 'miss_ssd_fetch' ? 'SSD -> Kernel Page Cache' : 'Kernel Page Cache (RAM)',
            to: toCopy > 0 ? `User Heap ${bufBlock.address}` : 'rax = 0 (EOF)',
            label: transferLabel,
            kind: transferKind,
          },
        })
      ) {
        break;
      }

      // Stage 6: Hardware SYSRET — Ring 0 -> Ring 3
      bytesRead = toCopy;
      stackBytesVal = `${bytesRead}`;
      regState.rip = { hex: LIBC_AFTER_SYSCALL_ADDR, meaning: 'Restored User rip (libc)', role: 'control' };
      regState.rsp = { hex: USER_RSP, meaning: 'User Stack ptr', role: 'control' };

      bufBlock.bytes.forEach((cell) => {
        if (cell.role === 'newly_copied') cell.role = 'data';
      });

      if (
        !emit({
          callIndex,
          activeFd: fd,
          stageIndex: 6,
          isMacro: false,
          phase: 'cpu_sysret',
          title: `Stage 6 — Hardware SYSRET (Ring 0 -> Ring 3): read() returns ${bytesRead}`,
          explanation: `The Kernel executes \`sysret\`: the CPU switches back from **Ring 0** to **Ring 3 (User Mode)** and restores the saved User \`rip\` from \`rcx\`. \`libc\` reads \`rax\` (${bytesRead}) and returns it. Those bytes now sit directly in User Space RAM — inspectable at full speed with zero extra syscalls!`,
          evalTip: {
            conceptTag: 'SYSRET & User-Space Speed',
            question: 'How does the CPU know where to resume in User Space after `sys_read` finishes?',
            answer:
              '`sysret` lowers privilege back to Ring 3 and restores the User `rip` that `syscall` saved in `rcx`, landing right back inside `libc` with the result in `rax`.',
          },
          ring: 3,
          activeInstruction: `Hardware SYSRET :: Ring 0 -> Ring 3, bytes_read = ${bytesRead}`,
          changedRegs: ['rip', 'rsp'],
          changedStack: ['bytes_read'],
          highlightHeapId: bufBlock.id,
          dataBusTransfer: {
            from: 'Ring 0 (sysret)',
            to: `Ring 3 (bytes_read = ${bytesRead})`,
            label: `SYSRET (CPL 0 -> 3, rax=${bytesRead})`,
            kind: 'return',
          },
        })
      ) {
        break;
      }

      if (bytesRead === 0) break;

      // Stage 7a: Null-terminate buffer[bytes_read] = '\0'
      if (bytesRead < bufBlock.bytes.length) {
        bufBlock.bytes[bytesRead] = {
          index: bytesRead,
          byte: 0,
          display: '\\0',
          hex: '00',
          role: 'null',
        };
      }
      regState.rip = { hex: '0x0000000000401188', meaning: 'User Space RAM write', role: 'control' };

      if (
        !emit({
          callIndex,
          activeFd: fd,
          stageIndex: 7,
          isMacro: true,
          phase: 'user_heap',
          title: `Stage 7 — Write null terminator '\\0' at buffer[${bytesRead}]`,
          explanation: `Because the Kernel only copied ${bytesRead} raw byte(s), User Space writes \`0x00\` (\`'\\0'\`) at index \`${bytesRead}\` inside Heap \`${bufBlock.address}\` (using that extra \`+1\` slot!). Now \`buffer\` is a valid null-terminated string.`,
          evalTip: {
            conceptTag: 'Why Manual \\0 Matters',
            question: 'What goes wrong on a shorter second read if you forget to write `\\0` at index `bytes_read`?',
            answer:
              'If read #1 wrote 4 bytes ("Hell") and read #2 wrote 2 bytes ("o\\n"), indices [2..3] still hold stale bytes ("ll") from read #1 unless you terminate right at index 2!',
          },
          ring: 3,
          activeInstruction: `Write 0x00 ('\\0') at Heap ${bufBlock.address}[${bytesRead}]`,
          changedRegs: ['rip'],
          highlightHeapId: bufBlock.id,
        })
      ) {
        break;
      }

      // Stage 7b: Merge buffer into .bss static stash on Heap
      const prevStash = stashMap.get(stashKey) ?? { blockId: null, text: null };
      const joinedText = (prevStash.text ?? '') + chunk;
      const oldStashId = prevStash.blockId;
      const newStashBlock = allocHeap(
        joinedText.length + 1,
        mode === 'bonus' ? `stash[${fd}] (accumulated)` : 'stash (accumulated)',
        'stash',
        fd,
        joinedText,
        'data'
      );
      freeHeap(oldStashId);
      stashMap.set(stashKey, { blockId: newStashBlock.id, text: joinedText });

      if (
        !emit({
          callIndex,
          activeFd: fd,
          stageIndex: 7,
          isMacro: true,
          phase: 'user_heap',
          title: `Stage 7 — Append buffer into Heap stash -> ${formatPreviewString(joinedText)}`,
          explanation: oldStashId
            ? `Combines previous stash + new buffer into a fresh ${joinedText.length + 1}-byte Heap block at \`${newStashBlock.address}\`, frees the old Heap stash block (no leak!), and updates the \`.bss\` \`static\` pointer. Reading repeats ONLY if no \`'\\n'\` has appeared yet and EOF is not reached.`
            : `Copies the bytes into a ${joinedText.length + 1}-byte Heap block at \`${newStashBlock.address}\` (${formatPreviewString(joinedText)}) and stores its address in the \`.bss\` \`static\` pointer. Reading repeats ONLY if no \`'\\n'\` has appeared yet.`,
          evalTip: {
            conceptTag: 'Freeing Old Stash',
            question: 'What happens if you replace the `.bss` static pointer without freeing the previous Heap stash?',
            answer:
              'The old Heap block becomes unreachable forever (a Valgrind "definitely lost" memory leak on every read iteration).',
          },
          ring: 3,
          activeInstruction: `Append buffer -> new Heap stash ${newStashBlock.address}; update .bss ptr`,
          highlightHeapId: newStashBlock.id,
          changedBssKey: stashKey,
        })
      ) {
        break;
      }
    }

    if (truncated) break;

    // Error cleanup path
    if (readError) {
      freeHeap(bufBlock.id);
      const st = stashMap.get(stashKey);
      if (st?.blockId) freeHeap(st.blockId);
      stashMap.set(stashKey, { blockId: null, text: null });

      stackActive = false;
      stackFrameLabel = 'Caller (idle)';
      regState.rax = { hex: toHex64(0n), meaning: 'NULL (read error)', role: 'return' };
      returnedLines.push({ callIndex, fd, address: null, value: null, byteLength: 0, syscallsInCall: syscallsInThisCall });

      emit({
        callIndex,
        activeFd: fd,
        stageIndex: 8,
        isMacro: true,
        phase: 'return',
        title: `Stage 8 — Error cleanup: free temp buffer & stash, reset .bss to NULL -> return NULL`,
        explanation: `Because \`read()\` failed (\`-1\`), both the temporary \`buffer\` and any accumulated Heap stash are freed, the \`.bss\` static pointer is reset to \`NULL\` (no dangling pointer), the Stack frame closes, and \`NULL\` is returned with 0 leaks.`,
        evalTip: {
          conceptTag: 'Error Cleanup Contract',
          question: 'Why must `.bss` `stash` be BOTH freed AND reset to `NULL` on read error?',
          answer:
            'Freeing prevents a memory leak; resetting the static pointer to `NULL` prevents a future call from reading freed memory (use-after-free / double-free).',
        },
        isReturnMarker: true,
        ring: 3,
        activeInstruction: 'Free buffer & stash; .bss = NULL; return NULL',
        changedRegs: ['rax'],
        changedBssKey: stashKey,
        errnoValue: 'EBADF (9)',
      });
      if (dynamicUntilNull) break;
      continue;
    }

    // Stage 8a: Free temporary read buffer
    freeHeap(bufBlock.id);
    if (
      !emit({
        callIndex,
        activeFd: fd,
        stageIndex: 8,
        isMacro: true,
        phase: 'user_heap',
        title: `Stage 8 — Release temporary read buffer (${bufBlock.size} B at ${bufBlock.address})`,
        explanation: `A complete line (or EOF) is now sitting in our accumulated Heap stash. The temporary \`buffer\` container is no longer needed and is freed back to the Heap allocator immediately.`,
        evalTip: {
          conceptTag: 'Temp Buffer Lifetime',
          question: 'Why free the temporary `buffer` as soon as reading finishes?',
          answer:
            'Holding onto a large `BUFFER_SIZE` allocation after the line is ready wastes RAM until the process exits.',
        },
        ring: 3,
        activeInstruction: `Free temporary Heap buffer (${bufBlock.address})`,
        highlightHeapId: bufBlock.id,
      })
    ) {
      break;
    }

    // Empty stash at EOF -> return NULL
    const currentStash = stashMap.get(stashKey) ?? { blockId: null, text: null };
    if (!currentStash.text || currentStash.text.length === 0) {
      if (currentStash.blockId) freeHeap(currentStash.blockId);
      stashMap.set(stashKey, { blockId: null, text: null });

      stackActive = false;
      stackFrameLabel = 'Caller (idle)';
      regState.rax = { hex: toHex64(0n), meaning: 'NULL (EOF)', role: 'return' };
      returnedLines.push({ callIndex, fd, address: null, value: null, byteLength: 0, syscallsInCall: syscallsInThisCall });

      emit({
        callIndex,
        activeFd: fd,
        stageIndex: 8,
        isMacro: true,
        phase: 'return',
        title: `Stage 8 — Call #${callIndex} returns NULL (EOF reached, 0 leaks)`,
        explanation: `No bytes remain in the \`.bss\` stash and \`read()\` hit EOF (\`0\`). The Stack frame closes and \`NULL\` is returned to indicate all lines have been delivered.`,
        evalTip: {
          conceptTag: 'Clean EOF State',
          question: 'What is the state of Heap memory when EOF returns `NULL`?',
          answer:
            'Zero internal Heap bytes remain live: both `buffer` and `stash` are freed, and `.bss` holds `NULL`.',
        },
        isReturnMarker: true,
        ring: 3,
        activeInstruction: 'Stack popped -> return NULL (0 GNL leaks)',
        changedRegs: ['rax'],
        changedBssKey: stashKey,
      });

      if (dynamicUntilNull) break;
      continue;
    }

    // Stage 8b: Slice out the ready line into a new Heap block
    const nlIndex = currentStash.text.indexOf('\n');
    const lineText = nlIndex !== -1 ? currentStash.text.slice(0, nlIndex + 1) : currentStash.text;
    const leftoverText = nlIndex !== -1 ? currentStash.text.slice(nlIndex + 1) : '';

    const lineBlock = allocHeap(
      lineText.length + 1,
      `returned line #${callIndex} (fd=${fd})`,
      'returned_line',
      fd,
      lineText,
      'extracted'
    );
    stackLineVal = lineBlock.address;

    if (
      !emit({
        callIndex,
        activeFd: fd,
        stageIndex: 8,
        isMacro: true,
        phase: 'user_heap',
        title: `Stage 8 — Slice ready line into new Heap string: ${formatPreviewString(lineText)} at ${lineBlock.address}`,
        explanation:
          nlIndex !== -1
            ? `Allocates a dedicated ${lineText.length + 1}-byte Heap string containing every byte up to and including the first \`'\\n'\` (index ${nlIndex}), terminated by \`'\\0'\`.`
            : `File ended without \`'\\n'\`. Allocates a dedicated ${lineText.length + 1}-byte Heap string holding all ${lineText.length} final byte(s) terminated by \`'\\0'\`.`,
        evalTip: {
          conceptTag: 'Return Contract',
          question: 'Should the returned string include `\\n`?',
          answer:
            'Yes — always include the terminating `\\n`, except on the final line if the file itself does not end with `\\n`.',
        },
        ring: 3,
        activeInstruction: `Allocate Heap line (${lineText.length + 1} B) -> ${lineBlock.address}`,
        changedStack: ['line'],
        highlightHeapId: lineBlock.id,
      })
    ) {
      break;
    }

    // Stage 8c: Preserve leftovers after '\n' in Heap & point .bss static pointer at them
    const oldCombinedId = currentStash.blockId;
    if (leftoverText.length > 0) {
      const leftoverBlock = allocHeap(
        leftoverText.length + 1,
        mode === 'bonus' ? `stash[${fd}] (leftover)` : 'stash (leftover)',
        'stash',
        fd,
        leftoverText,
        'leftover'
      );
      freeHeap(oldCombinedId);
      stashMap.set(stashKey, { blockId: leftoverBlock.id, text: leftoverText });

      if (
        !emit({
          callIndex,
          activeFd: fd,
          stageIndex: 8,
          isMacro: true,
          phase: 'user_heap',
          title: `Stage 8 — Keep leftovers ${formatPreviewString(leftoverText)} in Heap & save address in .bss`,
          explanation: `Bytes after \`'\\n'\` cannot be pushed back into the Kernel. They are stored in a trimmed ${leftoverText.length + 1}-byte Heap block (\`${leftoverBlock.address}\`), the old combined stash is freed, and the \`.bss\` \`static\` pointer stores this address for the next call.`,
          evalTip: {
            conceptTag: 'Why Leftovers Must Stay in .bss -> Heap',
            question: 'Why not just rewind the file offset back to `\\n` instead of storing leftovers?',
            answer:
              '`lseek()` is forbidden AND fails (`ESPIPE`) on `stdin`, pipes, and sockets. Keeping leftovers in Heap via a `.bss` static pointer works on every file descriptor.',
          },
          ring: 3,
          activeInstruction: `Trim leftovers -> ${leftoverBlock.address}; update .bss ptr`,
          highlightHeapId: leftoverBlock.id,
          changedBssKey: stashKey,
        })
      ) {
        break;
      }
    } else {
      freeHeap(oldCombinedId);
      stashMap.set(stashKey, { blockId: null, text: null });

      if (
        !emit({
          callIndex,
          activeFd: fd,
          stageIndex: 8,
          isMacro: true,
          phase: 'user_heap',
          title: `Stage 8 — Zero leftover bytes: free old stash & reset .bss pointer to NULL`,
          explanation: `Nothing remained after the extracted line. The old combined stash block is freed and the \`.bss\` static pointer is reset to \`NULL\`.`,
          evalTip: {
            conceptTag: 'Clean Stash Reset',
            question: 'Why reset `.bss` to `NULL` instead of keeping an empty 1-byte string?',
            answer:
              'Freeing and setting to `NULL` immediately leaves 0 internal Heap bytes live once the last line is returned.',
          },
          ring: 3,
          activeInstruction: 'Free old stash; .bss static ptr = NULL',
          changedBssKey: stashKey,
        })
      ) {
        break;
      }
    }

    // Stage 8d: Return Heap address to caller & pop Stack frame
    lineBlock.status = 'returned_to_caller';
    stackActive = false;
    stackFrameLabel = 'Caller (idle)';
    regState.rax = { hex: toHex64(lineBlock.rawAddr), meaning: `Return ${lineBlock.address}`, role: 'return' };
    regState.rip = { hex: '0x0000000000401200', meaning: 'Returned to caller', role: 'control' };

    returnedLines.push({
      callIndex,
      fd,
      address: lineBlock.address,
      value: lineText,
      byteLength: lineText.length,
      syscallsInCall: syscallsInThisCall,
    });

    emit({
      callIndex,
      activeFd: fd,
      stageIndex: 8,
      isMacro: true,
      phase: 'return',
      title: `Call #${callIndex} returns ${formatPreviewString(lineText)} (${lineBlock.address}) — Stack frame destroyed`,
      explanation: `Returns the Heap address \`${lineBlock.address}\` via \`rax\` and pops the Stack frame (all local variables disappear). Ownership of the returned line transfers to the caller, while \`.bss\` preserves ${stashMap.get(stashKey)?.text ? `the pointer to leftovers ${formatPreviewString(stashMap.get(stashKey)?.text ?? null)}` : '`NULL`'} for the next call.`,
      evalTip: {
        conceptTag: 'Caller Ownership',
        question: 'Who frees the returned string?',
        answer:
          'The caller (`main`). `get_next_line` transfers ownership of the returned Heap string while guaranteeing all internal allocations (`buffer` and old `stash`) are freed.',
      },
      isReturnMarker: true,
      ring: 3,
      activeInstruction: `Return ${lineBlock.address} in rax; Stack frame destroyed`,
      changedRegs: ['rax', 'rip'],
      highlightHeapId: lineBlock.id,
    });
  }

  return {
    config,
    steps,
    truncated,
    totalCalls: callIndex,
  };
}
