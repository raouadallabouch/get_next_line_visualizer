import { describe, expect, it } from 'vitest';
import { compileTrace } from './compiler';
import { getPresetById, SCENARIO_PRESETS } from './presets';
import { SimulationConfig } from './types';

function runPreset(id: string) {
  const p = getPresetById(id);
  const cfg: SimulationConfig = {
    mode: p.mode,
    bufferSize: p.bufferSize,
    files: p.files,
    callSequence: p.callSequence,
    presetId: p.id,
  };
  return compileTrace(cfg);
}

describe('get_next_line deterministic trace compiler', () => {
  it('returns identical lines across BUFFER_SIZE=1, 4, 42, 1024 with 0 GNL leaks', () => {
    const content = 'Hello\n42!\nEOF';
    const expected = ['Hello\n', '42!\n', 'EOF', null];

    for (const bs of [1, 4, 42, 1024]) {
      const trace = compileTrace({
        mode: 'mandatory',
        bufferSize: bs,
        files: [{ fd: 3, filename: 'test.txt', content, isOpen: true }],
        callSequence: [],
        presetId: 'custom',
      });

      const lastStep = trace.steps[trace.steps.length - 1];
      const values = lastStep.metrics.returnedLines.map((r) => r.value);
      expect(values).toEqual(expected);
      expect(lastStep.metrics.liveGnlHeapBytes).toBe(0);
      expect(lastStep.metrics.gnlLeakBytes).toBe(0);
    }
  });

  it('proves BUFFER_SIZE=42 uses fewer syscalls than BUFFER_SIZE=1 and skips syscalls on buffered calls', () => {
    const trace1 = runPreset('bs1_storm');
    const trace42 = runPreset('large_buffer');

    const last1 = trace1.steps[trace1.steps.length - 1];
    const last42 = trace42.steps[trace42.steps.length - 1];

    // "Hi!\nGo" with BS=1: Call #1 reads H,i,!,\n (4), Call #2 reads G,o,EOF (3), Call #3 reads EOF (1) = 8 syscalls
    expect(last1.metrics.syscallCount).toBe(8);
    expect(last1.metrics.ssdPageFetches).toBe(1);
    expect(last1.metrics.pageCacheHits).toBe(5);

    // "Line 1\nLine 2\nLine 3\n" with BS=42: 1 read gets whole file, calls 2 & 3 use 0 syscalls, call 4 gets EOF
    expect(last42.metrics.returnedLines.map((r) => r.value)).toEqual([
      'Line 1\n',
      'Line 2\n',
      'Line 3\n',
      null,
    ]);
    expect(last42.metrics.returnedLines[1].syscallsInCall).toBe(0);
    expect(last42.metrics.returnedLines[2].syscallsInCall).toBe(0);
    expect(last42.metrics.liveGnlHeapBytes).toBe(0);
  });

  it('enforces exact x86-64 CPU register and privilege ring invariants across syscall and sysret', () => {
    const trace = runPreset('standard');

    const syscallStepIdx = trace.steps.findIndex((s) => s.phase === 'cpu_syscall');
    expect(syscallStepIdx).toBeGreaterThan(0);

    const prepStep = trace.steps[syscallStepIdx - 1];
    expect(prepStep.phase).toBe('libc_prep');
    expect(prepStep.cpu.ring).toBe(3);

    const reg = (step: typeof prepStep, name: string) =>
      step.cpu.registers.find((r) => r.name === name)!;

    expect(reg(prepStep, 'rax').hex).toBe('0x0000000000000000'); // __NR_read
    expect(reg(prepStep, 'rdi').hex).toBe('0x0000000000000003'); // fd = 3
    expect(reg(prepStep, 'rdx').hex).toBe('0x0000000000000004'); // BUFFER_SIZE = 4

    const trapStep = trace.steps[syscallStepIdx];
    expect(trapStep.cpu.ring).toBe(0);
    expect(reg(trapStep, 'rip').hex).toBe('0xffffffff81c00000'); // entry_SYSCALL_64
    expect(reg(trapStep, 'rcx').hex).toBe('0x00007ffff7ea1207'); // saved user rip

    const sysretStep = trace.steps.find((s, i) => i > syscallStepIdx && s.phase === 'cpu_sysret')!;
    expect(sysretStep.cpu.ring).toBe(3);
    expect(reg(sysretStep, 'rip').hex).toBe('0x00007ffff7ea1207'); // restored user rip
    expect(reg(sysretStep, 'rax').hex).toBe('0x0000000000000004'); // 4 bytes read
  });

  it('handles empty file, consecutive newlines, and no trailing newline with 0 leaks', () => {
    const empty = runPreset('empty_file');
    const emptyLast = empty.steps[empty.steps.length - 1];
    expect(emptyLast.metrics.returnedLines.map((r) => r.value)).toEqual([null]);
    expect(emptyLast.metrics.liveGnlHeapBytes).toBe(0);

    const blanks = runPreset('consecutive_nl');
    const blanksLast = blanks.steps[blanks.steps.length - 1];
    expect(blanksLast.metrics.returnedLines.map((r) => r.value)).toEqual(['\n', '\n', '\n', null]);
    expect(blanksLast.metrics.liveGnlHeapBytes).toBe(0);

    const noNl = runPreset('no_trailing_nl');
    const noNlLast = noNl.steps[noNl.steps.length - 1];
    expect(noNlLast.metrics.returnedLines.map((r) => r.value)).toEqual([
      'First\n',
      'LastLine',
      null,
    ]);
    expect(noNlLast.metrics.liveGnlHeapBytes).toBe(0);
  });

  it('traces closed fd -> kernel -EBADF (-9) -> libc -1 -> clean free & NULL return', () => {
    const trace = runPreset('invalid_fd');
    const ebadfStep = trace.steps.find((s) => s.kernel.lookupStatus === 'ebadf');
    expect(ebadfStep).toBeDefined();
    expect(ebadfStep!.kernel.kernelErrno).toBe(-9);
    expect(ebadfStep!.cpu.ring).toBe(0);

    const last = trace.steps[trace.steps.length - 1];
    expect(last.metrics.returnedLines.map((r) => r.value)).toEqual([null]);
    expect(last.metrics.liveGnlHeapBytes).toBe(0);
    expect(last.cpu.errnoValue).toBe('EBADF (9)');
  });

  it('isolates multiple open FDs in 42 Bonus mode with independent f_pos and .bss stash[fd]', () => {
    const trace = runPreset('bonus_multi_fd');
    const last = trace.steps[trace.steps.length - 1];

    expect(last.metrics.returnedLines.map((r) => ({ fd: r.fd, value: r.value }))).toEqual([
      { fd: 3, value: 'A1-hi\n' },
      { fd: 4, value: 'B1\n' },
      { fd: 3, value: 'A2-ok\n' },
      { fd: 4, value: 'B2-end' },
      { fd: 3, value: null },
      { fd: 4, value: null },
    ]);
    expect(last.metrics.liveGnlHeapBytes).toBe(0);
  });

  it('compiles all built-in presets cleanly without truncation', () => {
    for (const preset of SCENARIO_PRESETS) {
      const trace = runPreset(preset.id);
      expect(trace.truncated).toBe(false);
      expect(trace.steps.length).toBeGreaterThan(2);
    }
  });
});
