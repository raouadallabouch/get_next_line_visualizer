import React, { useState } from 'react';
import { ConceptId } from '../data/concepts';

interface SyscallKernelDiagramProps {
  selectedId: ConceptId;
  onSelectConcept: (id: ConceptId) => void;
  onGoPrevChapter: () => void;
  onGoNextChapter: () => void;
}

type ScenarioMode = 'cold_read' | 'cache_hit' | 'ebadf';
type BeatIndex = 1 | 2 | 3 | 4 | 5 | 6;

const BEATS: { id: BeatIndex; label: string; concept: ConceptId }[] = [
  { id: 1, label: '1. Load 4 Regs', concept: 'registers' },
  { id: 2, label: '2. SYSCALL (3→0)', concept: 'syscall' },
  { id: 3, label: '3. Syscall Table', concept: 'syscall_table' },
  { id: 4, label: '4. fd → file → inode', concept: 'inode' },
  { id: 5, label: '5. Verify & Copy', concept: 'page_cache' },
  { id: 6, label: '6. SYSRET (0→3)', concept: 'libc_read' },
];

export const SyscallKernelDiagram: React.FC<SyscallKernelDiagramProps> = ({
  selectedId,
  onSelectConcept,
  onGoPrevChapter,
  onGoNextChapter,
}) => {
  const [beat, setBeat] = useState<BeatIndex>(1);
  const [scenario, setScenario] = useState<ScenarioMode>('cold_read');

  const isEbadf = scenario === 'ebadf';
  const isCacheHit = scenario === 'cache_hit';
  const fdVal = isEbadf ? 7 : 3;
  const fPosBefore = isCacheHit ? 4 : 0;
  const fPosAfter = isCacheHit ? 8 : 4;
  const isRing0 = beat >= 2 && beat <= 5;

  const getCaption = (): string => {
    if (beat === 1) {
      return `Still in Ring 3: libc read() loads 4 CPU registers — rax=0 (read), rdi=${fdVal} (fd), rsi=buffer addr, rdx=4 (BUFFER_SIZE).`;
    }
    if (beat === 2) {
      return 'Hardware SYSCALL fires: CPU saves User rip into rcx, flips Privilege Ring 3 → Ring 0, and jumps straight to the Linux Kernel entry gate.';
    }
    if (beat === 3) {
      return 'Now in Ring 0: Kernel reads rax (0) and indexes sys_call_table[0] → calls the real sys_read handler.';
    }
    if (beat === 4) {
      return isEbadf
        ? 'Kernel looks up fd[7] in the Process fdtable and finds NULL (closed)! No struct file or inode exists — Kernel writes -9 (-EBADF) into rax.'
        : `Kernel follows the 3-table chain: fdtable[3] → struct file (f_pos=${fPosBefore}) → inode #142080 (size=13 B, disk block map).`;
    }
    if (beat === 5) {
      if (isEbadf) {
        return 'Error path: Because fd=7 failed validation, zero bytes are read or copied. rax holds -9 (-EBADF) ready to return.';
      }
      return isCacheHit
        ? `Kernel verifies rsi is safely inside User Space, gets a Page Cache HIT (no SSD trip!), copies 4 bytes into Heap buffer, updates f_pos ${fPosBefore}→${fPosAfter}, and sets rax=4.`
        : `Kernel verifies rsi is safely inside User Space, loads 4 KB from SSD into Page Cache (miss), copies 4 bytes ("Hell") into Heap buffer, updates f_pos 0→4, and sets rax=4.`;
    }
    return isEbadf
      ? 'Hardware SYSRET flips Ring 0 → Ring 3 and restores rip from rcx. libc sees rax=-9 (-EBADF), sets errno=EBADF, and returns -1 to User Space!'
      : 'Hardware SYSRET flips Ring 0 → Ring 3 and restores rip from rcx. libc returns rax (4 bytes) to User Space — now your program scans RAM at full speed!';
  };

  const raxText =
    beat <= 3
      ? '0 (read)'
      : isEbadf
        ? '-9 (-EBADF)'
        : beat >= 5
          ? '4 (bytes)'
          : '0 (read)';

  const ripText =
    beat === 1
      ? 'libc read()'
      : beat === 2
        ? 'Kernel Entry'
        : beat <= 5
          ? 'sys_read()'
          : 'libc (resumed)';

  const rcxText = beat === 1 ? '(idle)' : 'saved libc rip';

  const selectBeat = (b: BeatIndex) => {
    setBeat(b);
    const found = BEATS.find((x) => x.id === b);
    if (found) onSelectConcept(found.concept);
  };

  return (
    <div className="diagram-stage">
      <div className="stage-header">
        <div>
          <span className="stage-kicker">Step 3 of 4 · Concentric Privilege Rings &amp; Kernel Pointer Chain</span>
          <h2 className="stage-title">Inside One read(): Ring 3 → Ring 0, Registers, sys_call_table &amp; fd → file → inode</h2>
        </div>
        <div className="stage-nav-btns">
          <button type="button" className="ui-btn" onClick={onGoPrevChapter}>
            ← 2. Memory Map
          </button>
          <button type="button" className="ui-btn primary" onClick={onGoNextChapter}>
            Next: 4. Live GNL Flow →
          </button>
        </div>
      </div>

      {/* Scenario Switcher + Beat Stepper */}
      <div className="interactive-toolbar">
        <div className="tool-group">
          <span className="tool-label">Case:</span>
          <button
            id="btn-sys-cold"
            type="button"
            className={`pill-btn ${scenario === 'cold_read' ? 'active' : ''}`}
            onClick={() => { setScenario('cold_read'); setBeat(1); }}
          >
            1st Read (SSD → Cache)
          </button>
          <button
            id="btn-sys-hit"
            type="button"
            className={`pill-btn ${scenario === 'cache_hit' ? 'active' : ''}`}
            onClick={() => { setScenario('cache_hit'); setBeat(5); onSelectConcept('page_cache'); }}
          >
            2nd Read (Cache HIT)
          </button>
          <button
            id="btn-sys-ebadf"
            type="button"
            className={`pill-btn warn ${scenario === 'ebadf' ? 'active' : ''}`}
            onClick={() => { setScenario('ebadf'); setBeat(4); onSelectConcept('fdtable'); }}
          >
            Closed FD (fd=7 → -EBADF)
          </button>
        </div>

        <div className="tool-group">
          <button
            id="btn-beat-prev"
            type="button"
            className="ui-btn"
            disabled={beat === 1}
            onClick={() => selectBeat((beat - 1) as BeatIndex)}
          >
            ← Prev
          </button>
          <button
            id="btn-beat-next"
            type="button"
            className="ui-btn primary"
            disabled={beat === 6}
            onClick={() => selectBeat((beat + 1) as BeatIndex)}
          >
            Next Beat →
          </button>
        </div>
      </div>

      <div className="journey-bar">
        {BEATS.map((b) => (
          <button
            key={b.id}
            id={`btn-beat-${b.id}`}
            type="button"
            className={`journey-pill ${beat === b.id ? 'active' : ''}`}
            onClick={() => selectBeat(b.id)}
          >
            {b.label}
          </button>
        ))}
      </div>

      <p className="stage-caption">{getCaption()}</p>

      <div className="svg-frame">
        <svg
          viewBox="0 0 960 540"
          className="diagram-svg"
          role="img"
          aria-label="Concentric CPU privilege rings diagram alongside Linux kernel sys_call_table, fdtable, struct file, inode, Page Cache, and SSD chain"
        >
          <defs>
            <marker id="k-arr-amber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#D97706" />
            </marker>
            <marker id="k-arr-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#2563EB" />
            </marker>
            <marker id="k-arr-green" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#16A34A" />
            </marker>
            <marker id="k-arr-red" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#DC2626" />
            </marker>
          </defs>

          {/* ================= LEFT: CONCENTRIC PRIVILEGE RINGS ================= */}
          <rect x="16" y="16" width="336" height="508" rx="14" fill="#FFFFFF" stroke="#CBD5E1" strokeWidth="1.8" />
          <text x="184" y="42" textAnchor="middle" className="svg-zone-title" fill="#0F172A">
            CPU PRIVILEGE RINGS &amp; REGISTERS
          </text>

          {/* Outer Circle: Ring 3 (User Mode) */}
          <g
            className={`svg-node ${selectedId === 'rings' ? 'selected' : ''}`}
            onClick={() => onSelectConcept('rings')}
          >
            <circle
              cx="184"
              cy="182"
              r="122"
              fill={isRing0 ? '#F8FAFC' : '#EFF6FF'}
              stroke={isRing0 ? '#93C5FD' : '#2563EB'}
              strokeWidth={isRing0 ? '2' : '3'}
            />
            <text x="184" y="84" textAnchor="middle" className="svg-node-title" fill="#1D4ED8">
              RING 3 · USER MODE
            </text>
            <text x="184" y="100" textAnchor="middle" className="svg-mini-sub" fill="#3B82F6">
              Restricted (libc &amp; your program)
            </text>

            {/* Hardware wall ring */}
            <circle
              cx="184"
              cy="192"
              r="72"
              fill={isRing0 ? '#FEF3C7' : '#FFFBEB'}
              stroke={isRing0 ? '#D97706' : '#F59E0B'}
              strokeWidth={isRing0 ? '3.2' : '2'}
              strokeDasharray={isRing0 ? undefined : '6 4'}
            />
            <text x="184" y="176" textAnchor="middle" className="svg-node-title" fill="#92400E">
              RING 0
            </text>
            <text x="184" y="193" textAnchor="middle" className="svg-mini-title" fill="#B45309">
              KERNEL MODE
            </text>
            <text x="184" y="210" textAnchor="middle" className="svg-mini-sub" fill="#92400E">
              Full RAM + SSD
            </text>
          </g>

          {/* Active CPU Execution Marker inside concentric rings */}
          <g
            transform={
              beat === 1
                ? 'translate(184, 276)'
                : beat === 2
                  ? 'translate(184, 238)'
                  : beat <= 5
                    ? 'translate(184, 235)'
                    : 'translate(184, 276)'
            }
          >
            <rect
              x="-62"
              y="-14"
              width="124"
              height="26"
              rx="13"
              fill={isEbadf && beat >= 4 ? '#DC2626' : isRing0 ? '#B45309' : '#1D4ED8'}
            />
            <text x="0" y="3" textAnchor="middle" className="svg-badge-text" fill="#FFFFFF">
              {beat === 2
                ? '▲ SYSCALL IN'
                : beat === 6
                  ? '▼ SYSRET OUT'
                  : isRing0
                    ? '● CPU IN RING 0'
                    : '● CPU IN RING 3'}
            </text>
          </g>

          {/* 6 CPU Register Boxes underneath concentric rings */}
          <g
            className={`svg-node ${selectedId === 'registers' ? 'selected' : ''}`}
            onClick={() => onSelectConcept('registers')}
          >
            <text x="34" y="330" className="svg-mini-title" fill="#334155">CPU REGISTERS (THE ABI DROP-BOX)</text>

            {[
              { name: 'rax', val: raxText, active: beat === 1 || beat >= 4 },
              { name: 'rdi', val: `fd = ${fdVal}`, active: beat === 1 || beat === 4 },
              { name: 'rsi', val: '0x55a4… (buf)', active: beat === 1 || beat === 5 },
              { name: 'rdx', val: '4 (BS)', active: beat === 1 || beat === 5 },
              { name: 'rip', val: ripText, active: beat === 2 || beat === 3 || beat === 6 },
              { name: 'rcx', val: rcxText, active: beat === 2 || beat === 6 },
            ].map((reg, idx) => {
              const col = idx % 2;
              const row = Math.floor(idx / 2);
              const x = 32 + col * 156;
              const y = 342 + row * 56;
              return (
                <g key={reg.name} transform={`translate(${x}, ${y})`}>
                  <rect
                    width="148"
                    height="46"
                    rx="8"
                    fill={reg.active ? (isRing0 ? '#FFFBEB' : '#EFF6FF') : '#F8FAFC'}
                    stroke={reg.active ? (isRing0 ? '#D97706' : '#2563EB') : '#CBD5E1'}
                    strokeWidth={reg.active ? '2' : '1.4'}
                  />
                  <text x="10" y="18" className="svg-mini-title" fill={reg.active ? (isRing0 ? '#B45309' : '#1D4ED8') : '#475569'}>
                    {reg.name}
                  </text>
                  <text x="10" y="36" className="svg-mono-pill" fill="#0F172A">
                    {reg.val}
                  </text>
                </g>
              );
            })}
          </g>

          {/* ================= RIGHT: LINUX KERNEL LOOKUP & DATA FLOW ================= */}
          <rect x="372" y="16" width="572" height="508" rx="14" fill="#FFFBEB" stroke="#F59E0B" strokeWidth="2" strokeDasharray="7 5" />
          <text x="392" y="42" className="svg-zone-title" fill="#B45309">
            INSIDE LINUX KERNEL (RING 0) · 3-TABLE FILE ARCHITECTURE
          </text>

          {/* Step 3: sys_call_table */}
          <g
            className={`svg-node ${selectedId === 'syscall_table' ? 'selected' : ''}`}
            opacity={beat >= 3 ? 1 : 0.45}
            onClick={() => onSelectConcept('syscall_table')}
          >
            <rect x="392" y="58" width="532" height="68" rx="10" fill="#FFFFFF" stroke={beat === 3 ? '#D97706' : '#FCD34D'} strokeWidth={beat === 3 ? '2.6' : '1.8'} />
            <text x="408" y="81" className="svg-node-title">sys_call_table  (Indexed by rax = 0)</text>
            <g transform="translate(408, 91)">
              <rect width="124" height="24" rx="5" fill="#FEF3C7" stroke="#D97706" strokeWidth="1.6" />
              <text x="62" y="16" textAnchor="middle" className="svg-mono-pill" fill="#92400E">[0] sys_read ✓</text>

              <rect x="134" width="118" height="24" rx="5" fill="#F8FAFC" stroke="#E2E8F0" />
              <text x="193" y="16" textAnchor="middle" className="svg-mini-sub">[1] sys_write</text>

              <rect x="262" width="114" height="24" rx="5" fill="#F8FAFC" stroke="#E2E8F0" />
              <text x="319" y="16" textAnchor="middle" className="svg-mini-sub">[2] sys_open</text>

              <rect x="386" width="114" height="24" rx="5" fill="#F8FAFC" stroke="#E2E8F0" />
              <text x="443" y="16" textAnchor="middle" className="svg-mini-sub">[3] sys_close</text>
            </g>
          </g>

          {/* Arrow down from sys_call_table to fdtable */}
          <path d="M 472 126 L 472 156" stroke="#D97706" strokeWidth="2.2" markerEnd="url(#k-arr-amber)" opacity={beat >= 4 ? 1 : 0.35} />

          {/* Step 4: The 3-Table File Pointer Chain */}
          {/* Box A: Process fdtable */}
          <g
            className={`svg-node ${selectedId === 'fdtable' ? 'selected' : ''}`}
            opacity={beat >= 4 ? 1 : 0.45}
            onClick={() => onSelectConcept('fdtable')}
          >
            <rect
              x="392"
              y="158"
              width="156"
              height="128"
              rx="10"
              fill="#FFFFFF"
              stroke={isEbadf && beat >= 4 ? '#DC2626' : beat === 4 ? '#D97706' : '#CBD5E1'}
              strokeWidth={beat === 4 ? '2.5' : '1.8'}
            />
            <text x="404" y="179" className="svg-mini-title">1. Process fdtable</text>
            <text x="404" y="194" className="svg-mini-sub">Per-process slots</text>
            <text x="404" y="216" className="svg-mono-pill" fill="#64748B">fd[0] stdin</text>
            <text x="404" y="233" className="svg-mono-pill" fill="#64748B">fd[1] stdout</text>
            <rect x="400" y="242" width="140" height="22" rx="4" fill={isEbadf ? '#FEF2F2' : '#FEF3C7'} stroke={isEbadf ? '#DC2626' : '#D97706'} />
            <text x="408" y="257" className="svg-mono-pill" fill={isEbadf ? '#B91C1C' : '#92400E'}>
              {isEbadf ? 'fd[7] → NULL ✗' : 'fd[3] → ptr ✓'}
            </text>
          </g>

          {/* Arrow fdtable -> struct file */}
          <path
            d="M 548 252 L 578 252"
            stroke={isEbadf ? '#DC2626' : '#D97706'}
            strokeWidth="2.4"
            strokeDasharray={isEbadf ? '4 3' : undefined}
            markerEnd={isEbadf ? 'url(#k-arr-red)' : 'url(#k-arr-amber)'}
            opacity={beat >= 4 ? 1 : 0.35}
          />

          {/* Box B: System Open File Table (struct file) */}
          <g
            className={`svg-node ${selectedId === 'struct_file' ? 'selected' : ''}`}
            opacity={isEbadf ? 0.3 : beat >= 4 ? 1 : 0.45}
            onClick={() => onSelectConcept('struct_file')}
          >
            <rect
              x="580"
              y="158"
              width="166"
              height="128"
              rx="10"
              fill="#FFFFFF"
              stroke={beat === 4 || beat === 5 ? '#D97706' : '#CBD5E1'}
              strokeWidth={beat === 4 ? '2.5' : '1.8'}
            />
            <text x="592" y="179" className="svg-mini-title">2. Open File Table</text>
            <text x="592" y="194" className="svg-mini-sub">struct file (session)</text>
            <rect x="592" y="206" width="142" height="32" rx="6" fill="#EFF6FF" stroke="#93C5FD" />
            <text x="663" y="226" textAnchor="middle" className="svg-mono-pill" fill="#1D4ED8">
              f_pos: {beat >= 5 && !isEbadf ? `${fPosBefore} → ${fPosAfter}` : `${fPosBefore}`}
            </text>
            <text x="592" y="256" className="svg-mini-sub">mode: FMODE_READ</text>
            <text x="592" y="272" className="svg-mini-sub" fill="#B45309">f_inode → #142080</text>
          </g>

          {/* Arrow struct file -> inode */}
          <path
            d="M 746 252 L 774 252"
            stroke="#D97706"
            strokeWidth="2.4"
            markerEnd="url(#k-arr-amber)"
            opacity={isEbadf ? 0.25 : beat >= 4 ? 1 : 0.35}
          />

          {/* Box C: inode */}
          <g
            className={`svg-node ${selectedId === 'inode' ? 'selected' : ''}`}
            opacity={isEbadf ? 0.3 : beat >= 4 ? 1 : 0.45}
            onClick={() => onSelectConcept('inode')}
          >
            <rect
              x="776"
              y="158"
              width="148"
              height="128"
              rx="10"
              fill="#FFFFFF"
              stroke={beat === 4 ? '#D97706' : '#CBD5E1'}
              strokeWidth={beat === 4 ? '2.5' : '1.8'}
            />
            <text x="788" y="179" className="svg-mini-title">3. inode #142080</text>
            <text x="788" y="194" className="svg-mini-sub">True File Identity</text>
            <text x="788" y="218" className="svg-mini-sub">• i_size = 13 bytes</text>
            <text x="788" y="236" className="svg-mini-sub">• permissions: rw-r--</text>
            <text x="788" y="254" className="svg-mini-sub">• owner + timestamps</text>
            <text x="788" y="272" className="svg-mini-title" fill="#15803D">• SSD block map ↓</text>
          </g>

          {/* Step 5: Security Diamond (access_ok) + Page Cache + SSD */}
          {/* Security Diamond */}
          <g
            className={`svg-node ${selectedId === 'user_space' ? 'selected' : ''}`}
            opacity={isEbadf ? 0.3 : beat >= 5 ? 1 : 0.45}
            onClick={() => onSelectConcept('user_space')}
          >
            <polygon
              points="478,320 564,376 478,432 392,376"
              fill={beat >= 5 && !isEbadf ? '#F0FDF4' : '#FFFFFF'}
              stroke={beat >= 5 && !isEbadf ? '#16A34A' : '#94A3B8'}
              strokeWidth="2"
            />
            <text x="478" y="366" textAnchor="middle" className="svg-mini-title" fill="#0F172A">access_ok?</text>
            <text x="478" y="382" textAnchor="middle" className="svg-mini-sub">Is rsi safely in</text>
            <text x="478" y="397" textAnchor="middle" className="svg-mini-sub">User Space?</text>
            {beat >= 5 && !isEbadf && (
              <text x="478" y="416" textAnchor="middle" className="svg-badge-text" fill="#15803D">YES ✓</text>
            )}
          </g>

          {/* Page Cache Box */}
          <g
            className={`svg-node ${selectedId === 'page_cache' ? 'selected' : ''}`}
            opacity={isEbadf ? 0.3 : beat >= 5 ? 1 : 0.45}
            onClick={() => onSelectConcept('page_cache')}
          >
            <rect
              x="592"
              y="314"
              width="332"
              height="96"
              rx="10"
              fill={beat >= 5 && !isEbadf ? '#F0FDF4' : '#FFFFFF'}
              stroke={beat >= 5 && !isEbadf ? '#16A34A' : '#CBD5E1'}
              strokeWidth="2"
            />
            <text x="608" y="338" className="svg-node-title" fill="#166534">Page Cache (4 KB RAM)</text>
            <rect x="786" y="321" width="126" height="22" rx="5" fill={isCacheHit ? '#DCFCE7' : '#FEF3C7'} stroke={isCacheHit ? '#16A34A' : '#D97706'} />
            <text x="849" y="336" textAnchor="middle" className="svg-badge-text" fill={isCacheHit ? '#15803D' : '#92400E'}>
              {isCacheHit ? 'CACHE HIT (RAM)' : 'CACHE MISS (SSD)'}
            </text>
            <text x="608" y="364" className="svg-mono-pill" fill="#0F172A">
              {isCacheHit ? 'Slice [4..8]: "o\\n42" → User Heap' : 'Slice [0..4]: "Hell" → User Heap'}
            </text>
            <text x="608" y="388" className="svg-mini-sub" fill="#166534">
              {isCacheHit ? 'Zero disk I/O! Copied straight from Kernel RAM.' : 'Fetched 4 KB block once; future reads hit RAM.'}
            </text>
          </g>

          {/* Arrow inode -> Page Cache */}
          <path d="M 850 286 L 850 312" stroke="#D97706" strokeWidth="2.2" markerEnd="url(#k-arr-amber)" opacity={isEbadf ? 0.25 : beat >= 5 ? 1 : 0.35} />

          {/* Arrow Page Cache -> access_ok -> User Space */}
          <path d="M 592 376 L 566 376" stroke="#16A34A" strokeWidth="2.4" markerEnd="url(#k-arr-green)" opacity={isEbadf ? 0.25 : beat >= 5 ? 1 : 0.35} />

          {/* SSD Backing Storage */}
          <g
            className={`svg-node ${selectedId === 'ssd' ? 'selected' : ''}`}
            opacity={isEbadf || isCacheHit ? 0.35 : beat >= 5 ? 1 : 0.45}
            onClick={() => onSelectConcept('ssd')}
          >
            <rect x="592" y="438" width="332" height="68" rx="10" fill="#FEF2F2" stroke="#DC2626" strokeWidth="2" />
            <text x="608" y="464" className="svg-node-title" fill="#991B1B">SSD / Physical Disk</text>
            <text x="608" y="485" className="svg-mini-sub" fill="#991B1B">
              {isCacheHit ? 'Skipped on Read #2! Data is already hot in Page Cache.' : 'Slow disk read loads 4 KB page into Page Cache ↑'}
            </text>
          </g>

          {/* Arrow SSD -> Page Cache */}
          {!isCacheHit && (
            <path d="M 758 438 L 758 412" stroke="#DC2626" strokeWidth="2.4" markerEnd="url(#k-arr-red)" opacity={isEbadf ? 0.2 : beat >= 5 ? 1 : 0.35} />
          )}

          {/* Error Banner overlay if EBADF */}
          {isEbadf && beat >= 4 && (
            <g>
              <rect x="392" y="446" width="182" height="58" rx="9" fill="#FEF2F2" stroke="#DC2626" strokeWidth="2" />
              <text x="483" y="470" textAnchor="middle" className="svg-mini-title" fill="#B91C1C">ABORT: -EBADF (-9)</text>
              <text x="483" y="488" textAnchor="middle" className="svg-mini-sub" fill="#991B1B">libc converts to -1</text>
            </g>
          )}
        </svg>
      </div>
    </div>
  );
};
