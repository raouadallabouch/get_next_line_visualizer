export type Mode = 'mandatory' | 'bonus';
export type Granularity = 'micro' | 'macro';

export type StepPhase =
  | 'program_start'
  | 'user_c'
  | 'libc_prep'
  | 'cpu_syscall'
  | 'kernel_dispatch'
  | 'kernel_validate'
  | 'kernel_io'
  | 'cpu_sysret'
  | 'user_heap'
  | 'return';

export interface VirtualFileConfig {
  fd: number;
  filename: string;
  content: string;
  isOpen: boolean;
}

export interface SimulationConfig {
  mode: Mode;
  bufferSize: number;
  files: VirtualFileConfig[];
  /** Sequence of fd arguments passed to get_next_line(fd). If empty, reads active fd(s) until NULL. */
  callSequence: number[];
  presetId: string;
}

export interface RegisterEntry {
  name: 'rax' | 'rdi' | 'rsi' | 'rdx' | 'rip' | 'rcx' | 'r11' | 'rsp';
  hex: string;
  meaning: string;
  changed: boolean;
  role: 'syscall_num' | 'arg' | 'return' | 'control' | 'saved';
}

export interface DataBusTransfer {
  from: string;
  to: string;
  label: string;
  kind: 'trap' | 'return' | 'dma_disk' | 'copy_to_user' | 'immediate' | 'error';
}

export interface CpuState {
  ring: 3 | 0;
  registers: RegisterEntry[];
  activeInstruction: string;
  dataBusTransfer: DataBusTransfer | null;
  errnoValue: string | null;
}

export interface ByteCell {
  index: number;
  byte: number | null;
  display: string;
  hex: string;
  role: 'data' | 'newline' | 'null' | 'uninit' | 'newly_copied' | 'extracted' | 'leftover';
}

export interface HeapBlock {
  id: string;
  address: string;
  size: number;
  label: string;
  kind: 'buffer' | 'stash' | 'returned_line';
  ownerFd: number;
  status: 'live' | 'freed' | 'returned_to_caller';
  bytes: ByteCell[];
  hiddenUninitCount: number;
  allocatedAtStep: number;
  freedAtStep: number | null;
  highlight: boolean;
}

export interface StackSlot {
  name: string;
  type: string;
  address: string;
  value: string;
  note: string;
  changed: boolean;
}

export interface BssSlot {
  name: string;
  fd: number;
  address: string;
  pointsTo: string | null;
  preview: string;
  changed: boolean;
}

export interface MemoryState {
  stackActive: boolean;
  stackFrameLabel: string;
  stackSlots: StackSlot[];
  heapBlocks: HeapBlock[];
  bssSlots: BssSlot[];
  textImmediateHighlight: boolean;
  bufferSize: number;
}

export interface OpenFileDesc {
  fd: number;
  structFileAddr: string;
  inode: number;
  filename: string;
  content: string;
  fPos: number;
  activeSliceStart: number | null;
  activeSliceLen: number;
  fMode: string;
  cachedPages: number[];
  lastCacheEvent: 'idle' | 'miss_ssd_fetch' | 'hit_page_cache' | 'eof';
}

export interface FdTableEntry {
  fd: number;
  label: string;
  structFileAddr: string | null;
  isActiveLookup: boolean;
  isOpen: boolean;
}

export interface KernelState {
  activeSyscallIndex: number | null;
  fdTable: FdTableEntry[];
  openFiles: OpenFileDesc[];
  lookupFd: number | null;
  lookupStatus: 'idle' | 'valid' | 'ebadf';
  accessOkCheck: {
    status: 'idle' | 'pass' | 'fail';
    address: string;
    count: number;
    limit: string;
  };
  kernelErrno: number | null;
}

export interface ReturnedLineRecord {
  callIndex: number;
  fd: number;
  address: string | null;
  value: string | null;
  byteLength: number;
  syscallsInCall: number;
}

export interface MetricsState {
  syscallCount: number;
  pageCacheHits: number;
  ssdPageFetches: number;
  bytesCopiedToUser: number;
  mallocCount: number;
  freeCount: number;
  liveGnlHeapBytes: number;
  callerOwnedBytes: number;
  gnlLeakBytes: number;
  returnedLines: ReturnedLineRecord[];
}

export interface EvalTip {
  conceptTag: string;
  question: string;
  answer: string;
}

export interface TraceStep {
  id: number;
  callIndex: number;
  activeFd: number;
  /** Physical mental-model stage index: 0=Ready, 1..8=Active cycle stage */
  stageIndex: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  /** True if this step appears in Macro mode as well as Micro mode */
  isMacro: boolean;
  phase: StepPhase;
  title: string;
  explanation: string;
  evalTip: EvalTip;
  isSyscallMarker: boolean;
  isReturnMarker: boolean;
  cpu: CpuState;
  memory: MemoryState;
  kernel: KernelState;
  metrics: MetricsState;
}

export interface CompiledTrace {
  config: SimulationConfig;
  steps: TraceStep[];
  truncated: boolean;
  totalCalls: number;
}

export interface ScenarioPreset {
  id: string;
  name: string;
  shortLabel: string;
  description: string;
  mode: Mode;
  bufferSize: number;
  files: VirtualFileConfig[];
  callSequence: number[];
}

export interface EvalQuestionItem {
  id: string;
  category: 'Memory' | 'CPU & Syscall' | 'Kernel & VFS' | '42 Edge Cases';
  question: string;
  answer: string;
  keyTakeaway: string;
  demoPresetId: string;
}
