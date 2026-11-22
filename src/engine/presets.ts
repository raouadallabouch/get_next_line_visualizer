import { ScenarioPreset } from './types';

export const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    id: 'standard',
    name: 'Standard Multi-Line (BUFFER_SIZE=4)',
    shortLabel: 'Standard (BS=4)',
    description:
      'Classic 42 case: partial chunks across newlines, stash accumulation, leftover preservation in .bss across calls.',
    mode: 'mandatory',
    bufferSize: 4,
    files: [
      {
        fd: 3,
        filename: 'notes.txt',
        content: 'Hello\n42!\nEOF',
        isOpen: true,
      },
    ],
    callSequence: [],
  },
  {
    id: 'bs1_storm',
    name: 'Syscall Storm (BUFFER_SIZE=1)',
    shortLabel: 'BS=1 Syscall Storm',
    description:
      'Every single byte requires a Ring 3 -> Ring 0 syscall trap, showing why Page Cache hits still pay CPU transition cost.',
    mode: 'mandatory',
    bufferSize: 1,
    files: [
      {
        fd: 3,
        filename: 'tiny.txt',
        content: 'Hi!\nGo',
        isOpen: true,
      },
    ],
    callSequence: [],
  },
  {
    id: 'large_buffer',
    name: 'Large Buffer (BUFFER_SIZE=42)',
    shortLabel: 'Large BS=42 (0-syscall calls)',
    description:
      'One read() loads the entire file; calls #2 and #3 return directly from .bss stash in pure User Space with 0 syscalls.',
    mode: 'mandatory',
    bufferSize: 42,
    files: [
      {
        fd: 3,
        filename: 'multi.txt',
        content: 'Line 1\nLine 2\nLine 3\n',
        isOpen: true,
      },
    ],
    callSequence: [],
  },
  {
    id: 'no_trailing_nl',
    name: 'No Trailing Newline',
    shortLabel: 'No Trailing \\n',
    description:
      'Last line hits EOF (read returns 0) without encountering \\n. GNL returns the remaining stash, then NULL on the next call.',
    mode: 'mandatory',
    bufferSize: 5,
    files: [
      {
        fd: 3,
        filename: 'no_nl.txt',
        content: 'First\nLastLine',
        isOpen: true,
      },
    ],
    callSequence: [],
  },
  {
    id: 'consecutive_nl',
    name: 'Consecutive Newlines (\\n\\n\\n)',
    shortLabel: 'Empty Lines \\n\\n\\n',
    description:
      'Tests slicing at index 0: each call must return a Heap-allocated "\\n" (2 bytes: 0x0a, 0x00) without skipping lines.',
    mode: 'mandatory',
    bufferSize: 4,
    files: [
      {
        fd: 3,
        filename: 'blanks.txt',
        content: '\n\n\n',
        isOpen: true,
      },
    ],
    callSequence: [],
  },
  {
    id: 'empty_file',
    name: 'Empty File (0 Bytes)',
    shortLabel: 'Empty File',
    description:
      'Immediate EOF on first read() (rax = 0). Buffer must be freed cleanly and NULL returned with 0 leaks.',
    mode: 'mandatory',
    bufferSize: 8,
    files: [
      {
        fd: 3,
        filename: 'empty.txt',
        content: '',
        isOpen: true,
      },
    ],
    callSequence: [],
  },
  {
    id: 'invalid_fd',
    name: 'Invalid / Closed FD (-EBADF)',
    shortLabel: 'Closed FD (-EBADF)',
    description:
      'Calls read() on closed fd=7: kernel fdget(7) fails, returns -9 (-EBADF) in rax, libc returns -1, GNL frees buffer & stash.',
    mode: 'mandatory',
    bufferSize: 8,
    files: [
      {
        fd: 3,
        filename: 'open.txt',
        content: 'unused\n',
        isOpen: true,
      },
      {
        fd: 7,
        filename: '(closed)',
        content: '',
        isOpen: false,
      },
    ],
    callSequence: [7],
  },
  {
    id: 'bonus_multi_fd',
    name: '42 Bonus: Interleaved fd=3 & fd=4',
    shortLabel: 'Bonus: Multi-FD',
    description:
      'Alternates get_next_line(3) and get_next_line(4): independent kernel struct file f_pos offsets and .bss stash[3] / stash[4].',
    mode: 'bonus',
    bufferSize: 6,
    files: [
      {
        fd: 3,
        filename: 'alpha.txt',
        content: 'A1-hi\nA2-ok\n',
        isOpen: true,
      },
      {
        fd: 4,
        filename: 'beta.txt',
        content: 'B1\nB2-end',
        isOpen: true,
      },
    ],
    callSequence: [3, 4, 3, 4, 3, 4],
  },
];

export function getPresetById(id: string): ScenarioPreset {
  return SCENARIO_PRESETS.find((p) => p.id === id) ?? SCENARIO_PRESETS[0];
}
