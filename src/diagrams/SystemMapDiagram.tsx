import React, { useState } from 'react';
import { ConceptId } from '../data/concepts';

interface SystemMapDiagramProps {
  selectedId: ConceptId;
  onSelectConcept: (id: ConceptId) => void;
  onGoNextChapter: () => void;
}

type JourneyStep = 0 | 1 | 2 | 3 | 4 | 5;

const JOURNEY_STEPS: { id: JourneyStep; label: string; caption: string; focus: ConceptId }[] = [
  {
    id: 0,
    label: 'Full Map',
    caption: 'Start here: This is the entire computer involved in get_next_line. Click any box to learn what it physically is.',
    focus: 'ram',
  },
  {
    id: 1,
    label: '1. Prepare',
    caption: 'User Space allocates `buffer` on the Heap (`BUFFER_SIZE + 1`). `libc read()` loads 4 CPU registers (`rax, rdi, rsi, rdx`).',
    focus: 'libc_read',
  },
  {
    id: 2,
    label: '2. SYSCALL',
    caption: 'CPU hardware executes `syscall`: saves `rip` into `rcx`, flips Privilege Ring 3 → Ring 0, and enters the Linux Kernel.',
    focus: 'syscall',
  },
  {
    id: 3,
    label: '3. Lookup',
    caption: 'Kernel uses `rax=0` in `sys_call_table` to call `sys_read`, then follows `fdtable` → `struct file` (`f_pos`) → `inode`.',
    focus: 'inode',
  },
  {
    id: 4,
    label: '4. Copy Data',
    caption: 'Kernel loads a 4 KB block from SSD into Page Cache RAM (if cold), validates `buffer`, copies raw bytes into User Heap, and updates `f_pos`.',
    focus: 'page_cache',
  },
  {
    id: 5,
    label: '5. Return',
    caption: 'CPU executes `sysret` (Ring 0 → Ring 3). User Space writes `\\0`, joins into `.bss` static stash, frees `buffer`, and returns one line.',
    focus: 'bss',
  },
];

export const SystemMapDiagram: React.FC<SystemMapDiagramProps> = ({
  selectedId,
  onSelectConcept,
  onGoNextChapter,
}) => {
  const [journey, setJourney] = useState<JourneyStep>(0);

  const isHighlighted = (nodes: JourneyStep[]): boolean =>
    journey === 0 || nodes.includes(journey);

  const nodeOpacity = (steps: JourneyStep[]): number => (isHighlighted(steps) ? 1 : 0.32);

  const selectNode = (id: ConceptId) => {
    onSelectConcept(id);
  };

  const handleJourneyClick = (step: (typeof JOURNEY_STEPS)[number]) => {
    setJourney(step.id);
    onSelectConcept(step.focus);
  };

  const activeCaption = JOURNEY_STEPS[journey].caption;

  return (
    <div className="diagram-stage">
      <div className="stage-header">
        <div>
          <span className="stage-kicker">Step 1 of 4 · System Context Diagram</span>
          <h2 className="stage-title">The Big Picture: Every Piece of Hardware &amp; OS Inside get_next_line</h2>
        </div>
        <button type="button" className="ui-btn primary" onClick={onGoNextChapter}>
          Next: 2. Memory Map →
        </button>
      </div>

      {/* Interactive Guided Path Stepper */}
      <div className="journey-bar" role="group" aria-label="Highlight data flow stage">
        {JOURNEY_STEPS.map((st) => (
          <button
            key={st.id}
            id={`btn-map-step-${st.id}`}
            type="button"
            className={`journey-pill ${journey === st.id ? 'active' : ''}`}
            onClick={() => handleJourneyClick(st)}
          >
            {st.label}
          </button>
        ))}
      </div>

      <p className="stage-caption">{activeCaption}</p>

      {/* Main Vector Architecture Diagram */}
      <div className="svg-frame">
        <svg
          viewBox="0 0 960 540"
          className="diagram-svg"
          role="img"
          aria-label="Interactive architecture diagram showing User Space RAM, CPU Registers and Privilege Rings, Linux Kernel Tables, Page Cache, and SSD"
        >
          <defs>
            <marker id="arr-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#2563EB" />
            </marker>
            <marker id="arr-amber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#D97706" />
            </marker>
            <marker id="arr-green" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#16A34A" />
            </marker>
            <marker id="arr-slate" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#475569" />
            </marker>
          </defs>

          {/* ================= ZONE 1: USER SPACE RAM (LEFT) ================= */}
          <g
            className={`svg-zone ${selectedId === 'user_space' ? 'selected' : ''}`}
            onClick={() => selectNode('user_space')}
          >
            <rect x="18" y="20" width="290" height="500" rx="14" fill="#EFF6FF" stroke="#93C5FD" strokeWidth="2" strokeDasharray="7 5" />
            <text x="34" y="45" className="svg-zone-title" fill="#1D4ED8">USER SPACE RAM (RING 3)</text>
            <text x="34" y="61" className="svg-zone-sub" fill="#3B82F6">Restricted · Cannot touch SSD or Kernel</text>
          </g>

          {/* .text block */}
          <g
            className={`svg-node ${selectedId === 'buffer_size' || selectedId === 'text_segment' ? 'selected' : ''}`}
            opacity={nodeOpacity([1])}
            onClick={(e) => { e.stopPropagation(); selectNode('buffer_size'); }}
          >
            <rect x="36" y="78" width="254" height="66" rx="10" fill="#FFFFFF" stroke="#60A5FA" strokeWidth="1.8" />
            <text x="50" y="102" className="svg-node-title">.text  (Machine Code)</text>
            <text x="50" y="120" className="svg-node-sub">BUFFER_SIZE baked as number (0 B data RAM)</text>
            <rect x="218" y="88" width="60" height="20" rx="5" fill="#DBEAFE" />
            <text x="248" y="102" textAnchor="middle" className="svg-badge-text" fill="#1D4ED8">READ-ONLY</text>
          </g>

          {/* Heap block */}
          <g
            className={`svg-node ${selectedId === 'buffer' || selectedId === 'heap' ? 'selected' : ''}`}
            opacity={nodeOpacity([1, 4, 5])}
            onClick={(e) => { e.stopPropagation(); selectNode('buffer'); }}
          >
            <rect x="36" y="162" width="254" height="96" rx="10" fill="#FFFFFF" stroke="#2563EB" strokeWidth="2" />
            <text x="50" y="186" className="svg-node-title">Heap RAM  (Dynamic Containers)</text>
            <rect x="50" y="198" width="114" height="46" rx="7" fill="#F0FDF4" stroke="#86EFAC" strokeWidth="1.5" />
            <text x="107" y="217" textAnchor="middle" className="svg-mini-title" fill="#15803D">buffer</text>
            <text x="107" y="233" textAnchor="middle" className="svg-mini-sub" fill="#166534">BUFFER_SIZE + 1</text>

            <rect x="174" y="198" width="102" height="46" rx="7" fill="#EFF6FF" stroke="#93C5FD" strokeWidth="1.5" />
            <text x="225" y="217" textAnchor="middle" className="svg-mini-title" fill="#1D4ED8">stash &amp; line</text>
            <text x="225" y="233" textAnchor="middle" className="svg-mini-sub" fill="#1E40AF">saved text</text>
          </g>

          {/* .bss static block */}
          <g
            className={`svg-node ${selectedId === 'bss' ? 'selected' : ''}`}
            opacity={nodeOpacity([5])}
            onClick={(e) => { e.stopPropagation(); selectNode('bss'); }}
          >
            <rect x="36" y="276" width="122" height="72" rx="10" fill="#FFFFFF" stroke="#60A5FA" strokeWidth="1.8" />
            <text x="48" y="300" className="svg-node-title">.bss Static</text>
            <text x="48" y="317" className="svg-node-sub">stash pointer</text>
            <text x="48" y="333" className="svg-mini-sub" fill="#15803D">Survives calls!</text>
          </g>

          {/* Stack block */}
          <g
            className={`svg-node ${selectedId === 'stack' ? 'selected' : ''}`}
            opacity={nodeOpacity([1, 5])}
            onClick={(e) => { e.stopPropagation(); selectNode('stack'); }}
          >
            <rect x="168" y="276" width="122" height="72" rx="10" fill="#FFFFFF" stroke="#94A3B8" strokeWidth="1.6" />
            <text x="180" y="300" className="svg-node-title">Stack Frame</text>
            <text x="180" y="317" className="svg-node-sub">local variables</text>
            <text x="180" y="333" className="svg-mini-sub" fill="#B91C1C">Wiped on return</text>
          </g>

          {/* libc read() wrapper */}
          <g
            className={`svg-node ${selectedId === 'libc_read' ? 'selected' : ''}`}
            opacity={nodeOpacity([1, 2, 5])}
            onClick={(e) => { e.stopPropagation(); selectNode('libc_read'); }}
          >
            <rect x="36" y="392" width="254" height="104" rx="10" fill="#FFFFFF" stroke="#2563EB" strokeWidth="2" />
            <text x="50" y="418" className="svg-node-title">libc  read()  Wrapper</text>
            <text x="50" y="437" className="svg-node-sub">Not the Kernel! Just prepares the</text>
            <text x="50" y="453" className="svg-node-sub">4 CPU registers according to the ABI</text>
            <text x="50" y="476" className="svg-mono-pill" fill="#1D4ED8">read(fd, buffer, BUFFER_SIZE)</text>
          </g>

          {/* .bss -> Heap pointer arrow */}
          <path
            d="M 97 276 C 97 260, 210 272, 225 258"
            fill="none"
            stroke="#2563EB"
            strokeWidth="1.8"
            strokeDasharray="4 3"
            markerEnd="url(#arr-blue)"
            opacity={nodeOpacity([5])}
          />

          {/* ================= ZONE 2: CPU CHIP (CENTER) ================= */}
          <g
            className={`svg-zone ${selectedId === 'cpu' ? 'selected' : ''}`}
            onClick={() => selectNode('cpu')}
          >
            <rect x="342" y="138" width="208" height="320" rx="16" fill="#F8FAFC" stroke="#334155" strokeWidth="2.2" />
            <text x="446" y="166" textAnchor="middle" className="svg-zone-title" fill="#0F172A">CPU CHIP</text>
            <text x="446" y="182" textAnchor="middle" className="svg-zone-sub" fill="#475569">Silicon Execution &amp; Security</text>
          </g>

          {/* CPU Registers */}
          <g
            className={`svg-node ${selectedId === 'registers' ? 'selected' : ''}`}
            opacity={nodeOpacity([1, 2, 4, 5])}
            onClick={(e) => { e.stopPropagation(); selectNode('registers'); }}
          >
            <rect x="358" y="198" width="176" height="122" rx="10" fill="#FFFFFF" stroke="#475569" strokeWidth="1.8" />
            <text x="446" y="218" textAnchor="middle" className="svg-node-title">CPU Registers</text>
            <text x="368" y="240" className="svg-reg-line">rax = 0 (read / count)</text>
            <text x="368" y="258" className="svg-reg-line">rdi = fd (which file)</text>
            <text x="368" y="276" className="svg-reg-line">rsi = buffer* (where)</text>
            <text x="368" y="294" className="svg-reg-line">rdx = BUFFER_SIZE</text>
            <text x="368" y="311" className="svg-reg-line" fill="#2563EB">rip / rcx = bookmark</text>
          </g>

          {/* Privilege Ring Gate */}
          <g
            className={`svg-node ${selectedId === 'rings' || selectedId === 'syscall' ? 'selected' : ''}`}
            opacity={nodeOpacity([2, 5])}
            onClick={(e) => { e.stopPropagation(); selectNode('syscall'); }}
          >
            <rect x="358" y="338" width="176" height="102" rx="10" fill="#FFFBEB" stroke="#D97706" strokeWidth="2" />
            <text x="446" y="362" textAnchor="middle" className="svg-node-title" fill="#92400E">Privilege Ring Gate</text>
            <rect x="370" y="373" width="68" height="24" rx="6" fill="#DBEAFE" stroke="#3B82F6" />
            <text x="404" y="389" textAnchor="middle" className="svg-badge-text" fill="#1D4ED8">RING 3</text>
            <text x="446" y="389" textAnchor="middle" className="svg-node-title" fill="#B45309">⇄</text>
            <rect x="454" y="373" width="68" height="24" rx="6" fill="#FEF3C7" stroke="#D97706" />
            <text x="488" y="389" textAnchor="middle" className="svg-badge-text" fill="#92400E">RING 0</text>
            <text x="446" y="421" textAnchor="middle" className="svg-mini-sub" fill="#92400E">syscall (in) · sysret (out)</text>
          </g>

          {/* ================= ZONE 3: KERNEL SPACE (RIGHT) ================= */}
          <g
            className={`svg-zone ${selectedId === 'kernel_space' ? 'selected' : ''}`}
            onClick={() => selectNode('kernel_space')}
          >
            <rect x="596" y="20" width="346" height="398" rx="14" fill="#FFFBEB" stroke="#F59E0B" strokeWidth="2" strokeDasharray="7 5" />
            <text x="614" y="45" className="svg-zone-title" fill="#B45309">LINUX KERNEL SPACE (RING 0)</text>
            <text x="614" y="61" className="svg-zone-sub" fill="#B45309">Full Hardware Access · Protected from User Space</text>
          </g>

          {/* sys_call_table */}
          <g
            className={`svg-node ${selectedId === 'syscall_table' ? 'selected' : ''}`}
            opacity={nodeOpacity([2, 3])}
            onClick={(e) => { e.stopPropagation(); selectNode('syscall_table'); }}
          >
            <rect x="612" y="76" width="314" height="58" rx="10" fill="#FFFFFF" stroke="#D97706" strokeWidth="1.8" />
            <text x="626" y="100" className="svg-node-title">sys_call_table  (Directory)</text>
            <text x="626" y="119" className="svg-node-sub">[0] → sys_read  ·  [1] → sys_write  ·  [2] → sys_open</text>
          </g>

          {/* 3-Box Kernel File Lookup Chain: fdtable -> struct file -> inode */}
          <g
            className={`svg-node ${selectedId === 'fdtable' ? 'selected' : ''}`}
            opacity={nodeOpacity([3])}
            onClick={(e) => { e.stopPropagation(); selectNode('fdtable'); }}
          >
            <rect x="612" y="158" width="92" height="84" rx="9" fill="#FFFFFF" stroke="#D97706" strokeWidth="1.8" />
            <text x="658" y="182" textAnchor="middle" className="svg-mini-title">fdtable</text>
            <text x="658" y="200" textAnchor="middle" className="svg-mini-sub">Process table</text>
            <text x="658" y="220" textAnchor="middle" className="svg-mono-pill" fill="#B45309">fd[3] →</text>
          </g>

          <path d="M 704 200 L 720 200" stroke="#D97706" strokeWidth="2" markerEnd="url(#arr-amber)" opacity={nodeOpacity([3])} />

          <g
            className={`svg-node ${selectedId === 'struct_file' ? 'selected' : ''}`}
            opacity={nodeOpacity([3, 4])}
            onClick={(e) => { e.stopPropagation(); selectNode('struct_file'); }}
          >
            <rect x="722" y="158" width="100" height="84" rx="9" fill="#FFFFFF" stroke="#D97706" strokeWidth="1.8" />
            <text x="772" y="182" textAnchor="middle" className="svg-mini-title">struct file</text>
            <text x="772" y="200" textAnchor="middle" className="svg-mini-sub">Open File Table</text>
            <text x="772" y="220" textAnchor="middle" className="svg-mono-pill" fill="#B45309">f_pos = 0</text>
          </g>

          <path d="M 822 200 L 838 200" stroke="#D97706" strokeWidth="2" markerEnd="url(#arr-amber)" opacity={nodeOpacity([3])} />

          <g
            className={`svg-node ${selectedId === 'inode' ? 'selected' : ''}`}
            opacity={nodeOpacity([3, 4])}
            onClick={(e) => { e.stopPropagation(); selectNode('inode'); }}
          >
            <rect x="840" y="158" width="86" height="84" rx="9" fill="#FFFFFF" stroke="#D97706" strokeWidth="1.8" />
            <text x="883" y="182" textAnchor="middle" className="svg-mini-title">inode</text>
            <text x="883" y="200" textAnchor="middle" className="svg-mini-sub">File ID &amp;</text>
            <text x="883" y="216" textAnchor="middle" className="svg-mini-sub">size / blocks</text>
          </g>

          {/* Kernel Page Cache */}
          <g
            className={`svg-node ${selectedId === 'page_cache' ? 'selected' : ''}`}
            opacity={nodeOpacity([4])}
            onClick={(e) => { e.stopPropagation(); selectNode('page_cache'); }}
          >
            <rect x="612" y="274" width="314" height="122" rx="10" fill="#F0FDF4" stroke="#16A34A" strokeWidth="2" />
            <text x="628" y="300" className="svg-node-title" fill="#166534">Kernel Page Cache  (RAM Cache)</text>
            <text x="628" y="319" className="svg-node-sub" fill="#166534">Caches 4 KB chunks from SSD in fast RAM</text>
            <rect x="628" y="334" width="282" height="46" rx="7" fill="#FFFFFF" stroke="#86EFAC" />
            <text x="769" y="355" textAnchor="middle" className="svg-mono-pill" fill="#15803D">H e l l o \n 4 2 ! \n E O F</text>
            <text x="769" y="372" textAnchor="middle" className="svg-mini-sub" fill="#166534">Validates User Space ptr, then copies bytes</text>
          </g>

          {/* ================= ZONE 4: SSD STORAGE (BOTTOM RIGHT) ================= */}
          <g
            className={`svg-node ${selectedId === 'ssd' ? 'selected' : ''}`}
            opacity={nodeOpacity([4])}
            onClick={() => selectNode('ssd')}
          >
            <rect x="612" y="446" width="314" height="74" rx="12" fill="#FEF2F2" stroke="#DC2626" strokeWidth="2" />
            <text x="628" y="473" className="svg-node-title" fill="#991B1B">SSD / Disk Storage  (Hardware)</text>
            <text x="628" y="493" className="svg-node-sub" fill="#991B1B">Permanent raw file bytes (no \0 on disk)</text>
            <text x="628" y="509" className="svg-mini-sub" fill="#B91C1C">Slow! Loaded in 4 KB pages on first read</text>
          </g>

          {/* ================= DATA & CONTROL FLOW ARROWS ================= */}
          {/* 1. libc -> CPU Registers */}
          <path
            d="M 290 440 C 320 440, 322 260, 356 260"
            fill="none"
            stroke="#2563EB"
            strokeWidth="2.4"
            markerEnd="url(#arr-blue)"
            opacity={nodeOpacity([1])}
          />
          <rect x="292" y="352" width="52" height="19" rx="4" fill="#EFF6FF" stroke="#93C5FD" opacity={nodeOpacity([1])} />
          <text x="318" y="365" textAnchor="middle" className="svg-arrow-label" fill="#1D4ED8" opacity={nodeOpacity([1])}>1. Regs</text>

          {/* 2. CPU Gate -> sys_call_table (SYSCALL) */}
          <path
            d="M 534 378 C 570 378, 566 105, 610 105"
            fill="none"
            stroke="#D97706"
            strokeWidth="2.6"
            markerEnd="url(#arr-amber)"
            opacity={nodeOpacity([2])}
          />
          <rect x="539" y="138" width="66" height="20" rx="4" fill="#FFFBEB" stroke="#F59E0B" opacity={nodeOpacity([2])} />
          <text x="572" y="152" textAnchor="middle" className="svg-arrow-label" fill="#B45309" opacity={nodeOpacity([2])}>2. syscall</text>

          {/* 3. sys_call_table -> fdtable */}
          <path
            d="M 658 134 L 658 156"
            fill="none"
            stroke="#D97706"
            strokeWidth="2.2"
            markerEnd="url(#arr-amber)"
            opacity={nodeOpacity([3])}
          />

          {/* 3b. inode -> Page Cache */}
          <path
            d="M 883 242 L 883 272"
            fill="none"
            stroke="#D97706"
            strokeWidth="2.2"
            markerEnd="url(#arr-amber)"
            opacity={nodeOpacity([3, 4])}
          />

          {/* 4a. SSD -> Page Cache */}
          <path
            d="M 769 446 L 769 398"
            fill="none"
            stroke="#DC2626"
            strokeWidth="2.4"
            markerEnd="url(#arr-green)"
            opacity={nodeOpacity([4])}
          />
          <rect x="778" y="411" width="128" height="20" rx="4" fill="#FFFFFF" stroke="#FCA5A5" opacity={nodeOpacity([4])} />
          <text x="842" y="425" textAnchor="middle" className="svg-arrow-label" fill="#991B1B" opacity={nodeOpacity([4])}>4 KB page on miss</text>

          {/* 4b. Page Cache -> User Heap buffer (copy_to_user) */}
          <path
            d="M 612 330 C 572 330, 566 96, 446 96 C 340 96, 336 218, 292 218"
            fill="none"
            stroke="#16A34A"
            strokeWidth="2.8"
            strokeDasharray="6 4"
            markerEnd="url(#arr-green)"
            opacity={nodeOpacity([4])}
          />
          <rect x="372" y="84" width="148" height="22" rx="5" fill="#F0FDF4" stroke="#86EFAC" opacity={nodeOpacity([4])} />
          <text x="446" y="99" textAnchor="middle" className="svg-arrow-label" fill="#15803D" opacity={nodeOpacity([4])}>4. Copy bytes → Heap</text>

          {/* 5. CPU Gate -> libc (SYSRET) */}
          <path
            d="M 358 416 C 328 416, 326 472, 292 472"
            fill="none"
            stroke="#2563EB"
            strokeWidth="2.4"
            markerEnd="url(#arr-blue)"
            opacity={nodeOpacity([5])}
          />
          <rect x="296" y="476" width="60" height="19" rx="4" fill="#EFF6FF" stroke="#93C5FD" opacity={nodeOpacity([5])} />
          <text x="326" y="489" textAnchor="middle" className="svg-arrow-label" fill="#1D4ED8" opacity={nodeOpacity([5])}>5. sysret</text>
        </svg>
      </div>
    </div>
  );
};
