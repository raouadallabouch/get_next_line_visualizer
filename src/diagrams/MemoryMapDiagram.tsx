import React, { useState } from 'react';
import { ConceptId } from '../data/concepts';

interface MemoryMapDiagramProps {
  selectedId: ConceptId;
  onSelectConcept: (id: ConceptId) => void;
  onGoPrevChapter: () => void;
  onGoNextChapter: () => void;
}

export const MemoryMapDiagram: React.FC<MemoryMapDiagramProps> = ({
  selectedId,
  onSelectConcept,
  onGoPrevChapter,
  onGoNextChapter,
}) => {
  const [bufferSize, setBufferSize] = useState<number>(4);
  const [callState, setCallState] = useState<'during' | 'after_return'>('during');

  const isHuge = bufferSize >= 1000000;
  const visibleSlots = Math.min(bufferSize, 8);
  const sampleChars = ['H', 'e', 'l', 'l', 'o', '\\n', '4', '2'];

  return (
    <div className="diagram-stage">
      <div className="stage-header">
        <div>
          <span className="stage-kicker">Step 2 of 4 · Virtual Memory Map &amp; Contrast Diagram</span>
          <h2 className="stage-title">RAM Anatomy: BUFFER_SIZE vs buffer, and Why .bss Survives When Stack Dies</h2>
        </div>
        <div className="stage-nav-btns">
          <button type="button" className="ui-btn" onClick={onGoPrevChapter}>
            ← 1. System Map
          </button>
          <button type="button" className="ui-btn primary" onClick={onGoNextChapter}>
            Next: 3. Syscall &amp; Kernel →
          </button>
        </div>
      </div>

      {/* Interactive Controls */}
      <div className="interactive-toolbar">
        <div className="tool-group">
          <span className="tool-label">Try BUFFER_SIZE:</span>
          {[1, 4, 8, 42, 10000000].map((v) => (
            <button
              key={v}
              id={`btn-mem-bs-${v}`}
              type="button"
              className={`pill-btn ${bufferSize === v ? 'active' : ''} ${v >= 1000000 ? 'warn' : ''}`}
              onClick={() => {
                setBufferSize(v);
                onSelectConcept(v >= 1000000 ? 'stack' : 'buffer');
              }}
            >
              {v === 10000000 ? '10 MB (Stack Crash Test)' : v}
            </button>
          ))}
        </div>

        <div className="tool-group">
          <span className="tool-label">Lifecycle:</span>
          <button
            id="btn-mem-during"
            type="button"
            className={`pill-btn ${callState === 'during' ? 'active' : ''}`}
            onClick={() => {
              setCallState('during');
              onSelectConcept('stack');
            }}
          >
            During Call
          </button>
          <button
            id="btn-mem-after"
            type="button"
            className={`pill-btn ${callState === 'after_return' ? 'active' : ''}`}
            onClick={() => {
              setCallState('after_return');
              onSelectConcept('bss');
            }}
          >
            After Function Returns
          </button>
        </div>
      </div>

      <p className="stage-caption">
        {isHuge
          ? 'At BUFFER_SIZE = 10,000,000 (10 MB): a local array on the ~8 MB Linux Stack immediately crashes (SIGSEGV). Only Heap allocation survives!'
          : callState === 'after_return'
            ? 'Watch what happens on return: the entire Stack frame disappears, temp buffer is freed, yet the static pointer in .bss stays alive pointing to Heap leftovers!'
            : 'Click any RAM region on the tower (left) or the expanded zoom diagrams (right) to understand what physically lives there.'}
      </p>

      <div className="svg-frame">
        <svg
          viewBox="0 0 960 552"
          className="diagram-svg"
          role="img"
          aria-label="Virtual RAM memory tower comparing Kernel Space, Stack, Heap, .bss, and .text alongside BUFFER_SIZE versus buffer visual anatomy"
        >
          <defs>
            <marker id="m-arr-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#2563EB" />
            </marker>
            <marker id="m-arr-green" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#16A34A" />
            </marker>
            <marker id="m-arr-slate" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#64748B" />
            </marker>
          </defs>

          {/* ================= LEFT: VIRTUAL MEMORY TOWER ================= */}
          <text x="175" y="28" textAnchor="middle" className="svg-zone-title" fill="#0F172A">
            VIRTUAL RAM MAP (ONE PROCESS)
          </text>
          <text x="40" y="54" className="svg-addr-tag">High Address</text>
          <text x="40" y="538" className="svg-addr-tag">Low Address</text>

          {/* Kernel Space (Top locked zone) */}
          <g
            className={`svg-node ${selectedId === 'kernel_space' ? 'selected' : ''}`}
            onClick={() => onSelectConcept('kernel_space')}
          >
            <rect x="40" y="64" width="270" height="62" rx="10" fill="#FFFBEB" stroke="#F59E0B" strokeWidth="2" />
            <text x="175" y="90" textAnchor="middle" className="svg-node-title" fill="#B45309">KERNEL SPACE (Ring 0 Only)</text>
            <text x="175" y="109" textAnchor="middle" className="svg-mini-sub" fill="#92400E">Locked! fdtable · struct file · Page Cache</text>
          </g>

          {/* User Space Wall Line */}
          <line x1="28" y1="138" x2="322" y2="138" stroke="#DC2626" strokeWidth="2" strokeDasharray="6 4" />
          <rect x="108" y="128" width="134" height="18" rx="4" fill="#FEF2F2" stroke="#FCA5A5" />
          <text x="175" y="140" textAnchor="middle" className="svg-badge-text" fill="#B91C1C">RING 3 / RING 0 WALL</text>

          {/* Stack */}
          <g
            className={`svg-node ${selectedId === 'stack' ? 'selected' : ''}`}
            onClick={() => onSelectConcept('stack')}
          >
            <rect
              x="40"
              y="156"
              width="270"
              height="82"
              rx="10"
              fill={isHuge ? '#FEF2F2' : callState === 'after_return' ? '#F8FAFC' : '#EFF6FF'}
              stroke={isHuge ? '#DC2626' : callState === 'after_return' ? '#CBD5E1' : '#3B82F6'}
              strokeWidth="2"
              strokeDasharray={callState === 'after_return' ? '6 4' : undefined}
            />
            <text x="56" y="180" className="svg-node-title" fill={isHuge ? '#B91C1C' : '#0F172A'}>
              STACK  (grows ↓ · ~8 MB max)
            </text>
            {isHuge ? (
              <>
                <text x="56" y="200" className="svg-mini-title" fill="#B91C1C">OVERFLOW! 10 MB &gt; 8 MB Stack</text>
                <text x="56" y="218" className="svg-mini-sub" fill="#991B1B">Never put BUFFER_SIZE array on Stack!</text>
              </>
            ) : callState === 'after_return' ? (
              <>
                <text x="56" y="201" className="svg-mini-title" fill="#64748B">FRAME POPPED &amp; WIPED!</text>
                <text x="56" y="219" className="svg-mini-sub" fill="#64748B">Local fd, buffer*, bytes_read are gone</text>
              </>
            ) : (
              <>
                <text x="56" y="200" className="svg-node-sub">Local frame: fd, buffer*, bytes_read</text>
                <text x="56" y="218" className="svg-mini-sub" fill="#2563EB">Alive ONLY while function is running</text>
              </>
            )}
          </g>

          {/* Gap dots */}
          <text x="175" y="258" textAnchor="middle" className="svg-mini-sub" fill="#94A3B8">↕  free virtual address space  ↕</text>

          {/* Heap */}
          <g
            className={`svg-node ${selectedId === 'heap' || selectedId === 'buffer' ? 'selected' : ''}`}
            onClick={() => onSelectConcept('heap')}
          >
            <rect x="40" y="270" width="270" height="96" rx="10" fill="#F0FDF4" stroke="#16A34A" strokeWidth="2" />
            <text x="56" y="294" className="svg-node-title" fill="#166534">HEAP  (grows ↑ · Dynamic RAM)</text>
            {callState === 'during' ? (
              <>
                <rect x="54" y="305" width="114" height="46" rx="6" fill="#FFFFFF" stroke="#22C55E" strokeWidth="1.5" />
                <text x="111" y="324" textAnchor="middle" className="svg-mini-title" fill="#15803D">temp buffer</text>
                <text x="111" y="340" textAnchor="middle" className="svg-mini-sub" fill="#166534">{(bufferSize + 1).toLocaleString()} B</text>

                <rect x="178" y="305" width="118" height="46" rx="6" fill="#EFF6FF" stroke="#60A5FA" strokeWidth="1.5" />
                <text x="237" y="324" textAnchor="middle" className="svg-mini-title" fill="#1D4ED8">stash bytes</text>
                <text x="237" y="340" textAnchor="middle" className="svg-mini-sub" fill="#1E40AF">"Hello\n42!"</text>
              </>
            ) : (
              <>
                <rect x="54" y="305" width="114" height="46" rx="6" fill="#FEF2F2" stroke="#FCA5A5" strokeDasharray="4 3" />
                <text x="111" y="324" textAnchor="middle" className="svg-mini-title" fill="#B91C1C">buffer FREED</text>
                <text x="111" y="340" textAnchor="middle" className="svg-mini-sub" fill="#991B1B">returned to OS</text>

                <rect x="178" y="305" width="118" height="46" rx="6" fill="#DBEAFE" stroke="#2563EB" strokeWidth="2" />
                <text x="237" y="324" textAnchor="middle" className="svg-mini-title" fill="#1D4ED8">leftover: "42!"</text>
                <text x="237" y="340" textAnchor="middle" className="svg-mini-sub" fill="#1E40AF">STILL ALIVE!</text>
              </>
            )}
          </g>

          {/* .bss Static Memory */}
          <g
            className={`svg-node ${selectedId === 'bss' ? 'selected' : ''}`}
            onClick={() => onSelectConcept('bss')}
          >
            <rect x="40" y="384" width="270" height="60" rx="10" fill="#EFF6FF" stroke="#2563EB" strokeWidth="2" />
            <text x="56" y="408" className="svg-node-title" fill="#1D4ED8">.bss  (Static Memory · Forever)</text>
            <text x="56" y="427" className="svg-node-sub" fill="#1E40AF">static stash* ──▶ points up to Heap</text>
          </g>

          {/* Curved pointer arrow from .bss UP to Heap leftover */}
          <path
            d="M 310 414 C 350 414, 350 328, 300 328"
            fill="none"
            stroke="#2563EB"
            strokeWidth="2.4"
            markerEnd="url(#m-arr-blue)"
          />

          {/* .text Segment */}
          <g
            className={`svg-node ${selectedId === 'text_segment' || selectedId === 'buffer_size' ? 'selected' : ''}`}
            onClick={() => onSelectConcept('text_segment')}
          >
            <rect x="40" y="458" width="270" height="58" rx="10" fill="#F8FAFC" stroke="#475569" strokeWidth="2" />
            <text x="56" y="482" className="svg-node-title">.text  (Machine Instructions)</text>
            <text x="56" y="501" className="svg-node-sub">BUFFER_SIZE = {bufferSize.toLocaleString()} baked inside code</text>
          </g>

          {/* ================= RIGHT TOP: BUFFER_SIZE vs buffer COMPARISON ================= */}
          <rect x="374" y="20" width="566" height="252" rx="14" fill="#FFFFFF" stroke="#CBD5E1" strokeWidth="1.8" />
          <text x="394" y="46" className="svg-zone-title" fill="#0F172A">
            ZOOM 1 · THE #1 MENTAL DISTINCTION: BUFFER_SIZE ≠ buffer
          </text>

          {/* Left side of comparison: BUFFER_SIZE */}
          <g
            className={`svg-node ${selectedId === 'buffer_size' ? 'selected' : ''}`}
            onClick={() => onSelectConcept('buffer_size')}
          >
            <rect x="394" y="64" width="212" height="186" rx="12" fill="#F8FAFC" stroke="#64748B" strokeWidth="1.8" />
            <rect x="410" y="78" width="108" height="20" rx="5" fill="#E2E8F0" />
            <text x="464" y="92" textAnchor="middle" className="svg-badge-text" fill="#334155">JUST A NUMBER</text>
            <text x="410" y="124" className="svg-big-word" fill="#0F172A">BUFFER_SIZE</text>
            <text x="410" y="156" className="svg-hero-num" fill="#2563EB">
              = {bufferSize.toLocaleString()}
            </text>
            <text x="410" y="184" className="svg-node-sub">• Preprocessor macro</text>
            <text x="410" y="202" className="svg-node-sub">• Baked into .text binary</text>
            <text x="410" y="220" className="svg-mini-title" fill="#15803D">• Uses 0 bytes of data RAM</text>
          </g>

          {/* Arrow between BUFFER_SIZE and buffer */}
          <path d="M 610 156 L 656 156" stroke="#2563EB" strokeWidth="2.6" markerEnd="url(#m-arr-blue)" />
          <text x="633" y="144" textAnchor="middle" className="svg-mini-sub" fill="#2563EB">sizes</text>

          {/* Right side of comparison: physical buffer */}
          <g
            className={`svg-node ${selectedId === 'buffer' ? 'selected' : ''}`}
            onClick={() => onSelectConcept('buffer')}
          >
            <rect x="660" y="64" width="260" height="186" rx="12" fill="#F0FDF4" stroke="#16A34A" strokeWidth="2" />
            <rect x="676" y="78" width="136" height="20" rx="5" fill="#DCFCE7" />
            <text x="744" y="92" textAnchor="middle" className="svg-badge-text" fill="#15803D">REAL RAM CONTAINER</text>
            <text x="676" y="124" className="svg-big-word" fill="#166534">buffer</text>
            <text x="676" y="144" className="svg-mini-sub" fill="#166534">
              {(bufferSize + 1).toLocaleString()} real bytes on Heap (+1 for \0)
            </text>

            {/* Visual physical byte cells */}
            <g transform="translate(676, 158)">
              {Array.from({ length: visibleSlots }).map((_, i) => (
                <g key={i} transform={`translate(${i * 23}, 0)`}>
                  <rect width="21" height="34" rx="4" fill="#FFFFFF" stroke="#22C55E" strokeWidth="1.5" />
                  <text x="10.5" y="13" textAnchor="middle" className="svg-cell-idx">{i}</text>
                  <text x="10.5" y="27" textAnchor="middle" className="svg-cell-ch">{sampleChars[i] ?? '·'}</text>
                </g>
              ))}
              {bufferSize > 8 && (
                <g transform={`translate(${visibleSlots * 23}, 0)`}>
                  <rect width="24" height="34" rx="4" fill="#ECFDF5" stroke="#86EFAC" strokeDasharray="3 2" />
                  <text x="12" y="22" textAnchor="middle" className="svg-cell-ch" fill="#166534">…</text>
                </g>
              )}
              {/* The +1 null terminator cell */}
              <g transform={`translate(${visibleSlots * 23 + (bufferSize > 8 ? 26 : 4)}, 0)`}>
                <rect width="26" height="34" rx="4" fill="#FEF2F2" stroke="#DC2626" strokeWidth="1.8" />
                <text x="13" y="13" textAnchor="middle" className="svg-cell-idx" fill="#B91C1C">+1</text>
                <text x="13" y="27" textAnchor="middle" className="svg-cell-ch" fill="#DC2626">\0</text>
              </g>
            </g>

            <text x="676" y="216" className="svg-mini-sub" fill="#166534">• Kernel copies raw bytes here</text>
            <text x="676" y="233" className="svg-mini-title" fill="#B91C1C">• Extra +1 byte holds manual '\0'</text>
          </g>

          {/* ================= RIGHT BOTTOM: .BSS POINTER -> HEAP LEFTOVERS ================= */}
          <rect x="374" y="290" width="566" height="226" rx="14" fill="#FFFFFF" stroke="#CBD5E1" strokeWidth="1.8" />
          <text x="394" y="316" className="svg-zone-title" fill="#0F172A">
            ZOOM 2 · HOW LEFTOVERS SURVIVE BETWEEN CALLS (.bss → Heap)
          </text>

          {/* .bss pointer box */}
          <g
            className={`svg-node ${selectedId === 'bss' ? 'selected' : ''}`}
            onClick={() => onSelectConcept('bss')}
          >
            <rect x="394" y="338" width="194" height="106" rx="11" fill="#EFF6FF" stroke="#2563EB" strokeWidth="2" />
            <text x="410" y="362" className="svg-node-title" fill="#1D4ED8">.bss  (8-byte pointer)</text>
            <rect x="410" y="376" width="162" height="32" rx="6" fill="#FFFFFF" stroke="#93C5FD" />
            <text x="491" y="397" textAnchor="middle" className="svg-mono-pill" fill="#1D4ED8">0x55a4c2a01320</text>
            <text x="410" y="429" className="svg-mini-sub" fill="#1E40AF">Never wiped until exit</text>
          </g>

          {/* Pointer arrow */}
          <path d="M 588 392 L 664 392" stroke="#2563EB" strokeWidth="2.8" markerEnd="url(#m-arr-blue)" />
          <text x="626" y="381" textAnchor="middle" className="svg-arrow-label" fill="#1D4ED8">points to</text>

          {/* Heap leftover box */}
          <g
            className={`svg-node ${selectedId === 'heap' ? 'selected' : ''}`}
            onClick={() => onSelectConcept('heap')}
          >
            <rect x="668" y="338" width="252" height="106" rx="11" fill="#F0FDF4" stroke="#16A34A" strokeWidth="2" />
            <text x="684" y="362" className="svg-node-title" fill="#166534">Heap  (0x55a4c2a01320)</text>
            <g transform="translate(684, 376)">
              {['4', '2', '!', '\\0'].map((ch, i) => (
                <g key={i} transform={`translate(${i * 42}, 0)`}>
                  <rect
                    width="36"
                    height="34"
                    rx="5"
                    fill={ch === '\\0' ? '#FEF2F2' : '#FFFFFF'}
                    stroke={ch === '\\0' ? '#DC2626' : '#22C55E'}
                    strokeWidth="1.6"
                  />
                  <text x="18" y="22" textAnchor="middle" className="svg-cell-ch" fill={ch === '\\0' ? '#DC2626' : '#0F172A'}>
                    {ch}
                  </text>
                </g>
              ))}
            </g>
            <text x="684" y="429" className="svg-mini-sub" fill="#166534">Leftover characters wait for Call #2!</text>
          </g>

          {/* Key takeaway footer banner inside Zoom 2 */}
          <rect x="394" y="460" width="526" height="40" rx="8" fill="#F8FAFC" stroke="#E2E8F0" />
          <text x="410" y="484" className="svg-node-sub" fill="#334155">
            Key Eval Rule: The <tspan fontWeight="700" fill="#1D4ED8">pointer address</tspan> lives in <tspan fontWeight="700">.bss</tspan> — the <tspan fontWeight="700" fill="#15803D">text characters</tspan> live on the <tspan fontWeight="700">Heap</tspan>.
          </text>
        </svg>
      </div>
    </div>
  );
};
