import {
  BssSlot,
  ByteCell,
  CompiledTrace,
  CpuState,
  DataBusTransfer,
  EvalTip,
  FdTableEntry,
  HeapBlock,
  KernelState,
  MemoryState,
  MetricsState,
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

  // Deterministic heap bump allocator
  let nextHeapAddr = HEAP_BASE;
  let blockSeq = 1;
  const heapBlocks: InternalHeapBlock[] = [];

  // Stash state by fd (in mandatory mode, always slot 0 representing single static char *stash)
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

  // Kernel open file descriptions
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

  // Live metrics
  let syscallCount = 0;
  let pageCacheHits = 0;
  let ssdPageFetches = 0;
  let bytesCopiedToUser = 0;
  let mallocCount = 0;
  let freeCount = 0;
  const returnedLines: ReturnedLineRecord[] = [];

  // Current CPU register state
  const regState: Record<RegisterEntry['name'], { hex: string; meaning: string; role: RegisterEntry['role'] }> = {
    rax: { hex: toHex64(0n), meaning: 'idle', role: 'return' },
    rdi: { hex: toHex64(0n), meaning: 'arg1 (fd)', role: 'arg' },
    rsi: { hex: toHex64(0n), meaning: 'arg2 (buffer*)', role: 'arg' },
    rdx: { hex: toHex64(0n), meaning: 'arg3 (BUFFER_SIZE)', role: 'arg' },
    rip: { hex: '0x0000000000401120', meaning: 'main() -> ready', role: 'control' },
    rcx: { hex: toHex64(0n), meaning: 'saved user rip', role: 'saved' },
    r11: { hex: toHex64(0x246n), meaning: 'rflags (IF=1)', role: 'saved' },
    rsp: { hex: USER_RSP, meaning: 'User Stack ptr', role: 'control' },
  };

  // Current stack frame state
  let stackActive = false;
  let stackFrameLabel = 'main()';
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
    // Align chunk to 16 bytes + 16-byte simulated malloc metadata header
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
          name: 'stash',
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
        name: `stash[${fdKey}]`,
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
      {
        fd: 0,
        label: 'stdin (tty)',
        structFileAddr: '0xffff88810a100000',
        isActiveLookup: lookupFd === 0,
        isOpen: true,
      },
      {
        fd: 1,
        label: 'stdout (tty)',
        structFileAddr: '0xffff88810a100200',
        isActiveLookup: lookupFd === 1,
        isOpen: true,
      },
      {
        fd: 2,
        label: 'stderr (tty)',
        structFileAddr: '0xffff88810a100400',
        isActiveLookup: lookupFd === 2,
        isOpen: true,
      },
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
    isMacro: boolean;
    phase: StepPhase;
    title: string;
    explanation: string;
    evalTip: EvalTip;
    cLine: number;
    asmSection: TraceStep['asmSection'];
    asmLine: number | null;
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
          {
            name: 'fd',
            type: 'int',
            address: '0x7fffffffde3c',
            value: stackFdVal,
            note: 'parameter',
            changed: changedStackSet.has('fd'),
          },
          {
            name: 'buffer',
            type: 'char *',
            address: '0x7fffffffde30',
            value: stackBufVal,
            note: '8B ptr -> Heap',
            changed: changedStackSet.has('buffer'),
          },
          {
            name: 'bytes_read',
            type: 'ssize_t',
            address: '0x7fffffffde28',
            value: stackBytesVal,
            note: 'signed return',
            changed: changedStackSet.has('bytes_read'),
          },
          {
            name: 'line',
            type: 'char *',
            address: '0x7fffffffde20',
            value: stackLineVal,
            note: 'return ptr -> Heap',
            changed: changedStackSet.has('line'),
          },
        ]
      : [];

    const liveGnlHeapBytes = heapBlocks
      .filter((b) => b.status === 'live')
      .reduce((acc, b) => acc + b.size, 0);
    const callerOwnedBytes = heapBlocks
      .filter((b) => b.status === 'returned_to_caller')
      .reduce((acc, b) => acc + b.size, 0);

    const cpu: CpuState = {
      ring: p.ring,
      registers,
      activeInstruction: p.activeInstruction,
      dataBusTransfer: p.dataBusTransfer ?? null,
      errnoValue: p.errnoValue ?? null,
    };

    const memory: MemoryState = {
      stackActive,
      stackFrameLabel,
      stackSlots,
      heapBlocks: cloneHeapBlocks(heapBlocks, p.highlightHeapId ?? null),
      bssSlots: buildBssSlots(p.changedBssKey ?? null),
      textImmediateHighlight: p.textImmediateHighlight ?? false,
      bufferSize,
    };

    const kernel: KernelState = {
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
    };

    const metrics: MetricsState = {
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
    };

    steps.push({
      id: steps.length,
      callIndex: p.callIndex,
      activeFd: p.activeFd,
      isMacro: p.isMacro,
      phase: p.phase,
      title: p.title,
      explanation: p.explanation,
      evalTip: p.evalTip,
      cLine: p.cLine,
      asmSection: p.asmSection,
      asmLine: p.asmLine,
      isSyscallMarker: p.isSyscallMarker ?? false,
      isReturnMarker: p.isReturnMarker ?? false,
      cpu,
      memory,
      kernel,
      metrics,
    });

    return true;
  };

  // Initial Step 0: ELF binary loaded, before first get_next_line call
  emit({
    callIndex: 0,
    activeFd: config.callSequence[0] ?? config.files[0]?.fd ?? 3,
    isMacro: true,
    phase: 'program_start',
    title: `Process loaded — BUFFER_SIZE=${bufferSize} baked in .text, .bss zero-initialized`,
    explanation: `Before get_next_line() is called: the preprocessor already substituted BUFFER_SIZE (${bufferSize}) as an immediate integer inside .text machine instructions (0 bytes of data RAM). The OS ELF loader zero-initialized the static pointer in .bss to NULL and populated the kernel fdtable for open file(s).`,
    evalTip: {
      conceptTag: 'BUFFER_SIZE vs buffer',
      question: 'Does BUFFER_SIZE occupy memory in RAM at runtime?',
      answer:
        'No. BUFFER_SIZE is a compile-time preprocessor constant baked into CPU instructions in .text (e.g. `mov edx, 0x4`). Only `buffer` (from `malloc(BUFFER_SIZE + 1)`) allocates physical Heap RAM.',
    },
    cLine: 3,
    asmSection: 'gnl_text',
    asmLine: 1,
    ring: 3,
    activeInstruction: 'ELF entry -> main()',
    textImmediateHighlight: true,
  });

  // Determine sequence of get_next_line(fd) calls to simulate
  const plannedCalls: number[] = [];
  if (config.callSequence.length > 0) {
    plannedCalls.push(...config.callSequence);
  } else {
    const primaryFd = config.files[0]?.fd ?? 3;
    // Dynamically keep calling until NULL (handled in loop below)
    plannedCalls.push(primaryFd);
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

    // 1. Enter get_next_line(fd)
    stackActive = true;
    stackFrameLabel = `get_next_line(fd=${fd}) [Call #${callIndex}]`;
    stackFdVal = `${fd}`;
    stackBufVal = '<uninit>';
    stackBytesVal = '<uninit>';
    stackLineVal = '<uninit>';
    regState.rdi = { hex: toSignedHex64(fd), meaning: `fd = ${fd}`, role: 'arg' };
    regState.rip = { hex: '0x0000000000401120', meaning: 'get_next_line() prologue', role: 'control' };
    regState.rsp = { hex: USER_RSP, meaning: 'GNL Stack Frame', role: 'control' };

    const stashKey = getStashKey(fd);
    if (!stashMap.has(stashKey) && fd >= 0) {
      stashMap.set(stashKey, { blockId: null, text: null });
    }
    const existingStash = stashMap.get(stashKey)?.text ?? null;

    if (
      !emit({
        callIndex,
        activeFd: fd,
        isMacro: true,
        phase: 'user_c',
        title: `Call #${callIndex}: get_next_line(fd=${fd}) — Stack frame created`,
        explanation:
          existingStash !== null
            ? `New Stack frame pushed for Call #${callIndex}. Local variables are uninitialized, but the static pointer in .bss survived from the previous call and still points to ${formatPreviewString(existingStash)} on the Heap.`
            : `New Stack frame pushed for Call #${callIndex} in Ring 3 (User Mode). The static pointer in .bss is currently NULL.`,
        evalTip: {
          conceptTag: 'Stack vs .bss Lifetime',
          question: 'Why does `stash` survive across calls while `buffer` and `bytes_read` disappear?',
          answer:
            '`buffer` and `bytes_read` live on the Stack frame, which is popped on `ret`. `static char *stash` lives in the `.bss` segment for the entire process lifetime.',
        },
        cLine: 1,
        asmSection: 'gnl_text',
        asmLine: 1,
        ring: 3,
        activeInstruction: `call get_next_line(${fd})`,
        changedRegs: ['rdi', 'rip', 'rsp'],
        changedStack: ['fd', 'buffer', 'bytes_read', 'line'],
      })
    ) {
      break;
    }

    // 2. Guard check
    if (fd < 0 || bufferSize <= 0 || (mode === 'bonus' && fd >= 1024)) {
      stackActive = false;
      stackFrameLabel = 'main()';
      regState.rax = { hex: toHex64(0n), meaning: 'NULL (guard failed)', role: 'return' };
      returnedLines.push({
        callIndex,
        fd,
        address: null,
        value: null,
        byteLength: 0,
        syscallsInCall: 0,
      });
      emit({
        callIndex,
        activeFd: fd,
        isMacro: true,
        phase: 'return',
        title: `Guard failed (fd=${fd}, BUFFER_SIZE=${bufferSize}) — returns NULL immediately`,
        explanation:
          'Defensive check rejects invalid fd or non-positive BUFFER_SIZE before touching malloc() or issuing any syscall.',
        evalTip: {
          conceptTag: 'Defensive Guard',
          question: 'What if someone compiles with -D BUFFER_SIZE=0 or calls get_next_line(-1)?',
          answer:
            'Checking `fd < 0 || BUFFER_SIZE <= 0` up front prevents invalid `malloc` sizes and avoids wasting a syscall.',
        },
        cLine: 9,
        asmSection: 'gnl_text',
        asmLine: null,
        isReturnMarker: true,
        ring: 3,
        activeInstruction: 'xor eax, eax; ret',
        changedRegs: ['rax'],
      });
      if (dynamicUntilNull) break;
      continue;
    }

    // 3. malloc(BUFFER_SIZE + 1)
    const bufBlock = allocHeap(
      bufferSize + 1,
      `buffer (BUFFER_SIZE+1 = ${bufferSize + 1} B)`,
      'buffer',
      fd
    );
    stackBufVal = bufBlock.address;
    stackBytesVal = '1';
    regState.rdi = {
      hex: toHex64(BigInt(bufferSize + 1)),
      meaning: `BUFFER_SIZE + 1 (${bufferSize + 1})`,
      role: 'arg',
    };
    regState.rax = {
      hex: toHex64(bufBlock.rawAddr),
      meaning: `malloc() -> ${bufBlock.address}`,
      role: 'return',
    };
    regState.rip = { hex: '0x000000000040114d', meaning: 'malloc(BUFFER_SIZE + 1)', role: 'control' };

    if (
      !emit({
        callIndex,
        activeFd: fd,
        isMacro: true,
        phase: 'user_heap',
        title: `Heap allocation: buffer = malloc(${bufferSize + 1}) -> ${bufBlock.address}`,
        explanation: `The CPU reads immediate ${bufferSize + 1} from .text and allocates a contiguous ${bufferSize + 1}-byte container on the Heap (${bufferSize} bytes for raw kernel data + 1 extra byte for '\\0'). Stack local \`buffer\` stores its 8-byte base address.`,
        evalTip: {
          conceptTag: 'Heap & +1 Null Byte',
          question: 'Why malloc(BUFFER_SIZE + 1) on the Heap instead of char buffer[BUFFER_SIZE + 1] on the Stack?',
          answer:
            'Two reasons: (1) `read()` never adds `\\0`, so the +1 byte prevents a 1-byte overflow; (2) huge `-D BUFFER_SIZE=10000000` overflows the 8 MB Linux Stack (SIGSEGV), whereas Heap `malloc()` handles it safely.',
        },
        cLine: 10,
        asmSection: 'gnl_text',
        asmLine: 2,
        ring: 3,
        activeInstruction: `mov edi, 0x${(bufferSize + 1).toString(16)}; call malloc`,
        changedRegs: ['rdi', 'rax', 'rip'],
        changedStack: ['buffer', 'bytes_read'],
        highlightHeapId: bufBlock.id,
        textImmediateHighlight: true,
        dataBusTransfer: {
          from: `.text immediate (${bufferSize + 1})`,
          to: `Heap ${bufBlock.address}`,
          label: `malloc(${bufferSize + 1} B)`,
          kind: 'immediate',
        },
      })
    ) {
      break;
    }

    // 4. While loop: read until '\n' in stash or EOF (bytes_read == 0)
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
        isMacro: true,
        phase: 'user_c',
        title: `Stash already contains '\\n' — skipping read() loop (0 syscalls!)`,
        explanation: `ft_strchr(${mode === 'bonus' ? `stash[${fd}]` : 'stash'}, '\\n') found a newline already sitting in User Space Heap RAM from an earlier read(). No Ring 3 -> Ring 0 syscall is needed for Call #${callIndex}!`,
        evalTip: {
          conceptTag: 'Zero-Syscall Reuse',
          question: 'Why did Call #' + callIndex + ' perform 0 syscalls?',
          answer:
            'Because a previous read() fetched more than one line into `buffer` and saved the remainder in `.bss` `stash`. Scanning User-Space RAM is orders of magnitude faster than trapping into Ring 0.',
        },
        cLine: 13,
        asmSection: 'gnl_text',
        asmLine: null,
        ring: 3,
        activeInstruction: "ft_strchr(stash, '\\n') != NULL -> skip loop",
      });
    }

    while (!stashHasNewline() && bytesRead > 0 && !truncated) {
      // Micro A: libc read() wrapper prepares x86-64 ABI registers
      regState.rax = { hex: toHex64(0n), meaning: '__NR_read (syscall #0)', role: 'syscall_num' };
      regState.rdi = { hex: toSignedHex64(fd), meaning: `arg1: fd = ${fd}`, role: 'arg' };
      regState.rsi = {
        hex: toHex64(bufBlock.rawAddr),
        meaning: `arg2: buffer = ${bufBlock.address}`,
        role: 'arg',
      };
      regState.rdx = {
        hex: toHex64(BigInt(bufferSize)),
        meaning: `arg3: BUFFER_SIZE = ${bufferSize}`,
        role: 'arg',
      };
      regState.rip = { hex: LIBC_READ_ADDR, meaning: 'libc read() wrapper', role: 'control' };

      if (
        !emit({
          callIndex,
          activeFd: fd,
          isMacro: false,
          phase: 'libc_prep',
          title: `libc read() loads x86-64 syscall ABI registers (still Ring 3)`,
          explanation: `read() is NOT the kernel — it is a tiny User-Space libc wrapper. Following the Linux x86-64 ABI, it loads rax=0 (__NR_read), rdi=${fd} (fd), rsi=${bufBlock.address} (Heap buffer), and rdx=${bufferSize} (immediate from .text).`,
          evalTip: {
            conceptTag: 'x86-64 Syscall ABI',
            question: 'Which 4 CPU registers pass arguments to Linux sys_read on x86-64?',
            answer:
              'rax = 0 (syscall number for read), rdi = fd, rsi = user buffer pointer, rdx = count (BUFFER_SIZE). The CPU is still in Ring 3 until the `syscall` instruction executes.',
          },
          cLine: 15,
          asmSection: 'libc_read',
          asmLine: 7,
          ring: 3,
          activeInstruction: `mov eax, 0; mov edi, ${fd}; mov rsi, buf; mov edx, ${bufferSize}`,
          changedRegs: ['rax', 'rdi', 'rsi', 'rdx', 'rip'],
          highlightHeapId: bufBlock.id,
          textImmediateHighlight: true,
          dataBusTransfer: {
            from: '.text immediate + Stack',
            to: 'CPU Registers (rax, rdi, rsi, rdx)',
            label: `rax=0, rdi=${fd}, rdx=${bufferSize}`,
            kind: 'immediate',
          },
        })
      ) {
        break;
      }

      // Micro B: CPU executes `syscall` instruction — Ring 3 -> Ring 0
      syscallCount += 1;
      syscallsInThisCall += 1;
      regState.rcx = {
        hex: LIBC_AFTER_SYSCALL_ADDR,
        meaning: 'HW-saved User rip (libc+7)',
        role: 'saved',
      };
      regState.r11 = { hex: toHex64(0x246n), meaning: 'HW-saved User rflags', role: 'saved' };
      regState.rip = {
        hex: KERNEL_ENTRY_ADDR,
        meaning: 'entry_SYSCALL_64 (MSR_LSTAR)',
        role: 'control',
      };
      regState.rsp = { hex: KERNEL_RSP, meaning: 'Kernel Stack ptr', role: 'control' };

      if (
        !emit({
          callIndex,
          activeFd: fd,
          isMacro: false,
          phase: 'cpu_syscall',
          title: `CPU executes SYSCALL #${syscallCount}: hardware switch Ring 3 -> Ring 0`,
          explanation: `In one atomic hardware operation, the CPU saves User rip (${LIBC_AFTER_SYSCALL_ADDR}) into rcx, saves rflags into r11, elevates privilege from Ring 3 (User Mode) to Ring 0 (Kernel Mode), and jumps rip to protected Kernel entry_SYSCALL_64.`,
          evalTip: {
            conceptTag: 'Privilege Ring Transition',
            question: 'What happens inside the CPU chip at the exact moment `syscall` executes?',
            answer:
              '1) Saves next user `rip` into `rcx` (and `rflags` into `r11`). 2) Switches hardware CPL from Ring 3 to Ring 0. 3) Jumps `rip` to `MSR_LSTAR` (`entry_SYSCALL_64`) in Kernel Space.',
          },
          cLine: 15,
          asmSection: 'libc_read',
          asmLine: 8,
          isSyscallMarker: true,
          ring: 0,
          activeInstruction: 'syscall  ; Ring 3 -> Ring 0',
          changedRegs: ['rcx', 'r11', 'rip', 'rsp'],
          dataBusTransfer: {
            from: 'Ring 3 (libc read)',
            to: 'Ring 0 (entry_SYSCALL_64)',
            label: 'SYSCALL TRAP (CPL 3 -> 0)',
            kind: 'trap',
          },
        })
      ) {
        break;
      }

      // Micro C: Kernel dispatches sys_call_table[rax]
      regState.rip = {
        hex: KERNEL_SYS_READ_ADDR,
        meaning: '__x64_sys_read (table[0])',
        role: 'control',
      };
      if (
        !emit({
          callIndex,
          activeFd: fd,
          isMacro: false,
          phase: 'kernel_dispatch',
          title: `Kernel indexes sys_call_table[rax=0] -> __x64_sys_read()`,
          explanation: `Now executing in Ring 0, the Linux Kernel reads rax (0) and uses it as an array index into sys_call_table (an array of kernel function pointers), invoking __x64_sys_read(rdi=${fd}, rsi=${bufBlock.address}, rdx=${bufferSize}).`,
          evalTip: {
            conceptTag: 'sys_call_table',
            question: 'How does the Linux Kernel know which function to run after `syscall`?',
            answer:
              'It uses the syscall number in `rax` (0 for read, 1 for write, 2 for open, 3 for close) to index `sys_call_table[rax]` and call the matching kernel handler (`__x64_sys_read`).',
          },
          cLine: 15,
          asmSection: 'kernel_entry',
          asmLine: 12,
          ring: 0,
          activeInstruction: 'call *sys_call_table(,%rax,8)  ; [0] -> sys_read',
          changedRegs: ['rip'],
          activeSyscallIndex: 0,
        })
      ) {
        break;
      }

      // Micro D: Kernel validates fd in fdtable & buffer pointer via access_ok()
      const fileDesc = openFiles.get(fd);
      if (!fileDesc) {
        // -EBADF error path
        regState.rax = {
          hex: toSignedHex64(-9),
          meaning: '-9 (-EBADF: Bad file descriptor)',
          role: 'return',
        };
        if (
          !emit({
            callIndex,
            activeFd: fd,
            isMacro: false,
            phase: 'kernel_validate',
            title: `Kernel fdget(${fd}) FAILED -> -EBADF (-9) written to rax`,
            explanation: `sys_read looks up fd=${fd} in the process fdtable and finds NULL (closed or never opened). It aborts I/O immediately and places -9 (-EBADF) in rax to signal failure back to User Space.`,
            evalTip: {
              conceptTag: 'Kernel Validation (-EBADF)',
              question: 'What does sys_read actually return in `rax` on a bad file descriptor?',
              answer:
                'The Linux Kernel returns a negative error code (`-EBADF` = `-9`) in `rax`. The `libc` wrapper later detects `rax` in `[-4095, -1]`, stores `9` into `errno`, and returns `-1` to C code.',
            },
            cLine: 15,
            asmSection: 'kernel_entry',
            asmLine: 13,
            ring: 0,
            activeInstruction: `fdget(${fd}) == NULL -> mov rax, -9`,
            changedRegs: ['rax'],
            activeSyscallIndex: 0,
            lookupFd: fd,
            lookupStatus: 'ebadf',
            kernelErrno: -9,
            dataBusTransfer: {
              from: `fdtable[${fd}] (NULL)`,
              to: 'rax = -9 (-EBADF)',
              label: 'Invalid FD error',
              kind: 'error',
            },
          })
        ) {
          break;
        }

        // sysret back with error
        regState.rip = {
          hex: LIBC_AFTER_SYSCALL_ADDR,
          meaning: 'libc read() post-syscall',
          role: 'control',
        };
        regState.rsp = { hex: USER_RSP, meaning: 'User Stack ptr', role: 'control' };
        bytesRead = -1;
        readError = true;
        stackBytesVal = '-1';

        if (
          !emit({
            callIndex,
            activeFd: fd,
            isMacro: true,
            phase: 'cpu_sysret',
            title: `SYSRET (Ring 0 -> Ring 3): libc converts rax=-9 into errno=EBADF & returns -1`,
            explanation: `sysretq drops privilege back to Ring 3 and restores rip from rcx. The libc read() wrapper sees rax = -9 (-EBADF), sets thread-local errno = 9 (EBADF), and returns (ssize_t)-1 to get_next_line().`,
            evalTip: {
              conceptTag: 'ssize_t & errno',
              question: 'Why must `bytes_read` be declared `ssize_t` instead of `size_t`?',
              answer:
                '`size_t` is unsigned, so checking `bytes_read == -1` or `< 0` would never trigger (wrapping to SIZE_MAX). `ssize_t` is signed specifically to represent `-1` error, `0` EOF, and `> 0` byte count.',
            },
            cLine: 16,
            asmSection: 'libc_read',
            asmLine: 9,
            ring: 3,
            activeInstruction: 'sysretq -> errno=EBADF -> return -1',
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

      // Valid fd: show fdtable lookup + access_ok(rsi, rdx)
      if (
        !emit({
          callIndex,
          activeFd: fd,
          isMacro: false,
          phase: 'kernel_validate',
          title: `Kernel validates fd=${fd} -> struct file (f_pos=${fileDesc.fPos}) & access_ok(buffer)`,
          explanation: `sys_read resolves fdtable[${fd}] to Open File Description ${fileDesc.structFileAddr} (current offset f_pos=${fileDesc.fPos}) and verifies access_ok(${bufBlock.address}, ${bufferSize}) < TASK_SIZE_MAX so User Space cannot trick Ring 0 into overwriting Kernel RAM.`,
          evalTip: {
            conceptTag: 'access_ok() Security Check',
            question: 'Why must the kernel validate the `buffer` pointer in `rsi` before writing bytes?',
            answer:
              'Ring 0 can write to any RAM address. Without `access_ok()`, a program could pass a Kernel Space address in `rsi` and trick `sys_read` into overwriting Kernel memory.',
          },
          cLine: 15,
          asmSection: 'kernel_entry',
          asmLine: 13,
          ring: 0,
          activeInstruction: `fdget(${fd}) OK; access_ok(${bufBlock.address}, ${bufferSize}) PASS`,
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

      // Micro E (also Macro step!): Page Cache / SSD fetch + copy_to_user() + f_pos advance
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
        regState.rax = { hex: toHex64(0n), meaning: '0 bytes (EOF reached)', role: 'return' };
        ioTitle = `Kernel read(): f_pos (${fileDesc.fPos}) == file size (${fileDesc.content.length}) -> EOF (rax = 0)`;
        ioExplanation = `Open File Description ${fileDesc.structFileAddr} has reached End-Of-File. Zero bytes are copied to User Heap, f_pos stays at ${fileDesc.fPos}, and rax is set to 0.`;
        transferLabel = 'EOF -> rax = 0';
      } else {
        const pageIdx = Math.floor(sliceStart / 4096);
        const wasCached = fileDesc.cachedPages.has(pageIdx);
        if (!wasCached) {
          fileDesc.cachedPages.add(pageIdx);
          ssdPageFetches += 1;
          cacheEvent = 'miss_ssd_fetch';
          transferKind = 'dma_disk';
          transferLabel = `SSD 4KB Page #${pageIdx} -> Page Cache -> copy_to_user(${toCopy} B)`;
        } else {
          pageCacheHits += 1;
          cacheEvent = 'hit_page_cache';
          transferKind = 'copy_to_user';
          transferLabel = `Page Cache HIT -> copy_to_user(${toCopy} B) -> ${bufBlock.address}`;
        }
        fileDesc.lastCacheEvent = cacheEvent;

        // Populate buffer bytes in Heap (leaving index toCopy untouched until C adds '\0'!)
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
        regState.rax = {
          hex: toHex64(BigInt(toCopy)),
          meaning: `${toCopy} byte(s) copied`,
          role: 'return',
        };

        ioTitle =
          cacheEvent === 'miss_ssd_fetch'
            ? `SSD -> Page Cache (4KB miss) -> copy_to_user(${toCopy} B); f_pos: ${sliceStart} -> ${fileDesc.fPos}`
            : `Page Cache HIT -> copy_to_user(${toCopy} B) to Heap; f_pos: ${sliceStart} -> ${fileDesc.fPos}`;
        ioExplanation =
          cacheEvent === 'miss_ssd_fetch'
            ? `Page #${pageIdx} was not yet in Kernel Page Cache RAM, so the kernel fetched a 4 KB page from SSD into Page Cache, copied ${toCopy} raw byte(s) (${formatPreviewString(chunk)}) into User Heap ${bufBlock.address} (without '\\0'), advanced f_pos to ${fileDesc.fPos}, and set rax = ${toCopy}.`
            : `Page #${pageIdx} is already hot in Kernel Page Cache RAM (no SSD I/O!). Kernel copies ${toCopy} raw byte(s) (${formatPreviewString(chunk)}) directly into User Heap ${bufBlock.address}, advances f_pos to ${fileDesc.fPos}, and sets rax = ${toCopy}.`;
      }

      if (
        !emit({
          callIndex,
          activeFd: fd,
          isMacro: true,
          phase: 'kernel_io',
          title: ioTitle,
          explanation: ioExplanation,
          evalTip:
            cacheEvent === 'miss_ssd_fetch'
              ? {
                  conceptTag: 'Page Cache vs SSD',
                  question: 'Why did the first read fetch from SSD while subsequent reads hit Page Cache?',
                  answer:
                    'Linux caches 4 KB file pages in Kernel Space RAM (Page Cache). Once loaded, later `read()` syscalls avoid slow disk I/O — though they still pay Ring 3 <-> Ring 0 syscall overhead.',
                }
              : {
                  conceptTag: 'File Offset (f_pos)',
                  question: 'How does the next read() know not to re-read the same bytes?',
                  answer:
                    'The kernel atomically updates `struct file -> f_pos += bytes_read` inside Kernel Space. That offset belongs to the Open File Description, completely independent of User Space variables.',
                },
          cLine: 15,
          asmSection: 'kernel_entry',
          asmLine: 13,
          isSyscallMarker: false,
          ring: 0,
          activeInstruction:
            toCopy > 0
              ? `copy_to_user(${bufBlock.address}, page_cache+${sliceStart}, ${toCopy}); f_pos=${fileDesc.fPos}`
              : 'EOF: mov rax, 0',
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
            from: cacheEvent === 'miss_ssd_fetch' ? 'SSD -> Kernel Page Cache' : 'Kernel Page Cache',
            to: toCopy > 0 ? `User Heap ${bufBlock.address}` : 'rax = 0 (EOF)',
            label: transferLabel,
            kind: transferKind,
          },
        })
      ) {
        break;
      }

      // Micro F: sysretq — Ring 0 -> Ring 3, libc returns ssize_t
      bytesRead = toCopy;
      stackBytesVal = `${bytesRead}`;
      regState.rip = {
        hex: LIBC_AFTER_SYSCALL_ADDR,
        meaning: 'libc read() -> return to GNL',
        role: 'control',
      };
      regState.rsp = { hex: USER_RSP, meaning: 'User Stack ptr', role: 'control' };

      // Downgrade newly_copied cells to normal data now that kernel copy is done
      bufBlock.bytes.forEach((cell) => {
        if (cell.role === 'newly_copied') cell.role = 'data';
      });

      if (
        !emit({
          callIndex,
          activeFd: fd,
          isMacro: false,
          phase: 'cpu_sysret',
          title: `SYSRET (Ring 0 -> Ring 3): read() returns bytes_read = ${bytesRead}`,
          explanation: `The kernel executes sysretq: the CPU drops back to Ring 3 (User Mode) and restores User rip from rcx. libc read() reads rax (${bytesRead}) and returns it to get_next_line() as ssize_t. Your C code can now scan buffer in RAM at full speed with zero extra syscalls.`,
          evalTip: {
            conceptTag: 'sysret & User-Space Speed',
            question: 'What does `sysret` restore so execution resumes inside your program?',
            answer:
              '`sysretq` lowers CPL from Ring 0 back to Ring 3 and loads `rip <- rcx` (and `rflags <- r11`), landing right after the `syscall` instruction in `libc` with the return value in `rax`.',
          },
          cLine: 15,
          asmSection: 'kernel_entry',
          asmLine: 14,
          ring: 3,
          activeInstruction: `sysretq  ; Ring 0 -> Ring 3, rax = ${bytesRead}`,
          changedRegs: ['rip', 'rsp'],
          changedStack: ['bytes_read'],
          highlightHeapId: bufBlock.id,
          dataBusTransfer: {
            from: 'Ring 0 (sysretq)',
            to: `Ring 3 (bytes_read = ${bytesRead})`,
            label: `SYSRET (CPL 0 -> 3, rax=${bytesRead})`,
            kind: 'return',
          },
        })
      ) {
        break;
      }

      if (bytesRead === 0) {
        // EOF reached, break out of read loop cleanly
        break;
      }

      // 5. buffer[bytes_read] = '\0'
      if (bytesRead < bufBlock.bytes.length) {
        bufBlock.bytes[bytesRead] = {
          index: bytesRead,
          byte: 0,
          display: '\\0',
          hex: '00',
          role: 'null',
        };
      }
      regState.rip = { hex: '0x0000000000401188', meaning: "buffer[bytes_read] = '\\0'", role: 'control' };

      if (
        !emit({
          callIndex,
          activeFd: fd,
          isMacro: true,
          phase: 'user_heap',
          title: `Null-terminate: buffer[${bytesRead}] = '\\0'`,
          explanation: `Because read() copied raw bytes without terminating them, get_next_line explicitly writes 0x00 ('\\0') at index ${bytesRead} in Heap ${bufBlock.address}. This makes buffer a valid C string ready for ft_strjoin().`,
          evalTip: {
            conceptTag: 'Manual Null Termination',
            question: 'What happens if you forget `buffer[bytes_read] = \'\\0\'` on the second read()?',
            answer:
              'If read #1 returned 4 bytes ("Hell") and read #2 returned 2 bytes ("o\\n"), bytes [2..3] still hold stale "ll" (or uninitialized garbage on read #1), corrupting `ft_strjoin`!',
          },
          cLine: 18,
          asmSection: 'gnl_text',
          asmLine: null,
          ring: 3,
          activeInstruction: `mov BYTE PTR [buffer + ${bytesRead}], 0x0`,
          changedRegs: ['rip'],
          highlightHeapId: bufBlock.id,
        })
      ) {
        break;
      }

      // 6. stash = ft_strjoin_free(stash, buffer)
      const prevStash = stashMap.get(stashKey) ?? { blockId: null, text: null };
      const joinedText = (prevStash.text ?? '') + chunk;
      const oldStashId = prevStash.blockId;
      const newStashBlock = allocHeap(
        joinedText.length + 1,
        mode === 'bonus' ? `stash[${fd}] (joined)` : 'stash (joined)',
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
          isMacro: true,
          phase: 'user_heap',
          title: `Join into .bss ${mode === 'bonus' ? `stash[${fd}]` : 'stash'} -> ${formatPreviewString(joinedText)}`,
          explanation: oldStashId
            ? `ft_strjoin_free allocates a new ${joinedText.length + 1}-byte Heap block at ${newStashBlock.address}, copies old stash + buffer, frees the old stash block (preventing leaks!), and updates the .bss pointer.`
            : `ft_strjoin_free allocates a ${joinedText.length + 1}-byte Heap block at ${newStashBlock.address} holding ${formatPreviewString(joinedText)} and stores its address in the .bss static pointer.`,
          evalTip: {
            conceptTag: 'Leak-Free Join',
            question: 'Why must ft_strjoin free the previous `stash` pointer?',
            answer:
              'Overwriting `stash = ft_strjoin(stash, buffer)` without freeing the old Heap allocation orphans the previous block forever (a Valgrind "definitely lost" leak on every loop iteration).',
          },
          cLine: 19,
          asmSection: 'gnl_text',
          asmLine: null,
          ring: 3,
          activeInstruction: 'stash = ft_strjoin_free(stash, buffer)',
          highlightHeapId: newStashBlock.id,
          changedBssKey: stashKey,
        })
      ) {
        break;
      }
    }

    if (truncated) break;

    // Handle read() == -1 error cleanup
    if (readError) {
      freeHeap(bufBlock.id);
      const st = stashMap.get(stashKey);
      if (st?.blockId) freeHeap(st.blockId);
      stashMap.set(stashKey, { blockId: null, text: null });

      stackActive = false;
      stackFrameLabel = 'main()';
      regState.rax = { hex: toHex64(0n), meaning: 'NULL (read error)', role: 'return' };
      returnedLines.push({
        callIndex,
        fd,
        address: null,
        value: null,
        byteLength: 0,
        syscallsInCall: syscallsInThisCall,
      });

      emit({
        callIndex,
        activeFd: fd,
        isMacro: true,
        phase: 'return',
        title: `Error cleanup: free(buffer), free(stash), stash = NULL -> return NULL`,
        explanation: `On read() == -1, get_next_line frees BOTH the temporary buffer AND any accumulated stash in .bss (setting it to NULL so future calls don't dereference a dangling pointer), then returns NULL with 0 leaks.`,
        evalTip: {
          conceptTag: 'Error Leak Prevention',
          question: 'Why also free and NULL-out `stash` when read() returns -1?',
          answer:
            'If a previous chunk succeeded and a later read() fails, leaving `stash` unfreed leaks memory, and freeing it without setting `stash = NULL` creates a use-after-free / double-free bug!',
        },
        cLine: 17,
        asmSection: 'gnl_text',
        asmLine: null,
        isReturnMarker: true,
        ring: 3,
        activeInstruction: 'free(buffer); free(stash); return NULL',
        changedRegs: ['rax'],
        changedBssKey: stashKey,
        errnoValue: 'EBADF (9)',
      });
      if (dynamicUntilNull) break;
      continue;
    }

    // 7. free(buffer) after loop finishes
    freeHeap(bufBlock.id);
    if (
      !emit({
        callIndex,
        activeFd: fd,
        isMacro: true,
        phase: 'user_heap',
        title: `Loop done: free(buffer) releases ${bufBlock.size} B at ${bufBlock.address}`,
        explanation: `Either a '\\n' is now inside ${mode === 'bonus' ? `stash[${fd}]` : 'stash'} or EOF (bytes_read == 0) was reached. The temporary read buffer is no longer needed and is immediately freed back to the Heap allocator.`,
        evalTip: {
          conceptTag: 'Temporary Buffer Lifecycle',
          question: 'Why allocate and free `buffer` per call instead of keeping it static?',
          answer:
            'Keeping a huge `BUFFER_SIZE` buffer permanently allocated would hold RAM until process exit. Freeing `buffer` once the line is ready keeps resident Heap usage minimal.',
        },
        cLine: 21,
        asmSection: 'gnl_text',
        asmLine: null,
        ring: 3,
        activeInstruction: `free(${bufBlock.address})`,
        highlightHeapId: bufBlock.id,
      })
    ) {
      break;
    }

    // 8. Check if stash is empty / NULL (EOF with nothing left to return)
    const currentStash = stashMap.get(stashKey) ?? { blockId: null, text: null };
    if (!currentStash.text || currentStash.text.length === 0) {
      if (currentStash.blockId) freeHeap(currentStash.blockId);
      stashMap.set(stashKey, { blockId: null, text: null });

      stackActive = false;
      stackFrameLabel = 'main()';
      regState.rax = { hex: toHex64(0n), meaning: 'NULL (EOF)', role: 'return' };
      returnedLines.push({
        callIndex,
        fd,
        address: null,
        value: null,
        byteLength: 0,
        syscallsInCall: syscallsInThisCall,
      });

      emit({
        callIndex,
        activeFd: fd,
        isMacro: true,
        phase: 'return',
        title: `Call #${callIndex} returns NULL — EOF reached, 0 GNL leaks`,
        explanation: `Nothing remains in .bss ${mode === 'bonus' ? `stash[${fd}]` : 'stash'} and read() returned 0 (EOF). The Stack frame is popped and get_next_line(fd=${fd}) returns NULL to signal end of stream.`,
        evalTip: {
          conceptTag: 'Clean EOF Termination',
          question: 'How do we guarantee 0 leaks when EOF is reached?',
          answer:
            'Every internal block (`buffer` and `stash`) has been freed and `.bss` `stash` is `NULL`. Only the returned lines handed to `main()` remain (for the caller to `free()`).',
        },
        cLine: 23,
        asmSection: 'gnl_text',
        asmLine: null,
        isReturnMarker: true,
        ring: 3,
        activeInstruction: 'xor eax, eax; ret  ; return NULL',
        changedRegs: ['rax'],
        changedBssKey: stashKey,
      });

      if (dynamicUntilNull) break;
      continue;
    }

    // 9. Extract line up to and including first '\n' (or all remaining bytes on EOF)
    const nlIndex = currentStash.text.indexOf('\n');
    const lineText =
      nlIndex !== -1 ? currentStash.text.slice(0, nlIndex + 1) : currentStash.text;
    const leftoverText =
      nlIndex !== -1 ? currentStash.text.slice(nlIndex + 1) : '';

    const lineBlock = allocHeap(
      lineText.length + 1,
      `line #${callIndex} (fd=${fd})`,
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
        isMacro: true,
        phase: 'user_heap',
        title: `Extract line: malloc(${lineText.length + 1}) -> ${formatPreviewString(lineText)} at ${lineBlock.address}`,
        explanation:
          nlIndex !== -1
            ? `Found '\\n' at stash index ${nlIndex}. Allocates a dedicated ${lineText.length + 1}-byte Heap string containing bytes [0..${nlIndex}] (including '\\n') plus '\\0'.`
            : `No '\\n' found before EOF. Allocates a dedicated ${lineText.length + 1}-byte Heap string containing all ${lineText.length} remaining byte(s) plus '\\0'.`,
        evalTip: {
          conceptTag: 'Line Extraction Contract',
          question: 'Should the returned string include the trailing `\\n`?',
          answer:
            'Yes — 42 subject rule: the returned line MUST include the terminating `\\n` character, EXCEPT when the end of the file is reached and the file does not end with `\\n`.',
        },
        cLine: 24,
        asmSection: 'gnl_text',
        asmLine: null,
        ring: 3,
        activeInstruction: `line = ft_extract_line(stash) -> ${lineBlock.address}`,
        changedStack: ['line'],
        highlightHeapId: lineBlock.id,
      })
    ) {
      break;
    }

    // 10. Trim stash: keep leftovers after '\n' in Heap & update .bss pointer (or free & NULL)
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
          isMacro: true,
          phase: 'user_heap',
          title: `Trim stash: save leftover ${formatPreviewString(leftoverText)} in .bss -> ${leftoverBlock.address}`,
          explanation: `Allocates a ${leftoverText.length + 1}-byte Heap block for the leftover bytes after '\\n', frees the old combined stash block, and updates .bss ${mode === 'bonus' ? `stash[${fd}]` : 'stash'} to point to ${leftoverBlock.address} for the next call.`,
          evalTip: {
            conceptTag: 'Preserving Leftovers',
            question: 'What happens to the bytes read past `\\n`?',
            answer:
              'They cannot be put back into the kernel (we cannot `lseek()`). Instead, they are trimmed into a fresh Heap block whose address is stored in the `.bss` static pointer for the next `get_next_line()` call.',
          },
          cLine: 25,
          asmSection: 'gnl_text',
          asmLine: null,
          ring: 3,
          activeInstruction: `stash = ft_trim_stash(stash) -> ${leftoverBlock.address}`,
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
          isMacro: true,
          phase: 'user_heap',
          title: `Trim stash: no leftover bytes -> free(stash) & set .bss pointer = NULL`,
          explanation: `Nothing remained after the extracted line. The old stash block is freed and the .bss pointer is reset to NULL so zero internal Heap bytes remain live.`,
          evalTip: {
            conceptTag: 'Zero Leftover Cleanup',
            question: 'Why set `stash = NULL` instead of leaving an empty "" allocation?',
            answer:
              'Freeing and setting `stash = NULL` immediately guarantees 0 bytes still reachable if the caller finishes right after the final line (and prevents dangling pointers).',
          },
          cLine: 25,
          asmSection: 'gnl_text',
          asmLine: null,
          ring: 3,
          activeInstruction: 'free(stash); stash = NULL',
          changedBssKey: stashKey,
        })
      ) {
        break;
      }
    }

    // 11. return (line)
    lineBlock.status = 'returned_to_caller';
    stackActive = false;
    stackFrameLabel = 'main()';
    regState.rax = {
      hex: toHex64(lineBlock.rawAddr),
      meaning: `return ${lineBlock.address} (${formatPreviewString(lineText, 14)})`,
      role: 'return',
    };
    regState.rip = { hex: '0x0000000000401200', meaning: 'returned to main()', role: 'control' };

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
      isMacro: true,
      phase: 'return',
      title: `Call #${callIndex} returns ${formatPreviewString(lineText)} (${lineBlock.address})`,
      explanation: `get_next_line(fd=${fd}) returns ${lineBlock.address} in rax and pops its Stack frame (local variables vanish). Ownership of the returned Heap line transfers to main(), while .bss ${mode === 'bonus' ? `stash[${fd}]` : 'stash'} persists ${stashMap.get(stashKey)?.text ? `pointing to ${formatPreviewString(stashMap.get(stashKey)?.text ?? null)}` : 'as NULL'}.`,
      evalTip: {
        conceptTag: 'Ownership & Return Contract',
        question: 'Who is responsible for calling free() on the returned string?',
        answer:
          'The caller (`main()`). `get_next_line` transfers Heap ownership of `line` to the caller via `rax`, while keeping internal cleanup of `buffer` and old `stash` completely leak-free.',
      },
      cLine: 26,
      asmSection: 'gnl_text',
      asmLine: null,
      isReturnMarker: true,
      ring: 3,
      activeInstruction: `mov rax, ${lineBlock.address}; ret`,
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
