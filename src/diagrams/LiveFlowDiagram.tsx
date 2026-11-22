import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ConceptId } from '../data/concepts';
import { compileTrace, formatEscapedChar, formatPreviewString } from '../engine/compiler';
import { getPresetById, SCENARIO_PRESETS } from '../engine/presets';
import { SimulationConfig, TraceStep, VirtualFileConfig } from '../engine/types';
import { FileEditorDrawer } from '../components/FileEditorDrawer';

interface LiveFlowDiagramProps {
  selectedId: ConceptId;
  onSelectConcept: (id: ConceptId) => void;
  onGoPrevChapter: () => void;
}

function presetToConfig(presetId: string): SimulationConfig {
  const p = getPresetById(presetId);
  return {
    mode: p.mode,
    bufferSize: p.bufferSize,
    files: p.files.map((f) => ({ ...f })),
    callSequence: [...p.callSequence],
    presetId: p.id,
  };
}

type FlowNodeId =
  | 'start'
  | 'alloc_buf'
  | 'check_nl'
  | 'read_syscall'
  | 'check_bytes'
  | 'join_stash'
  | 'free_buf'
  | 'slice_return'
  | 'ret_null';

function getActiveFlowNode(step: TraceStep): FlowNodeId {
  if (step.phase === 'program_start') return 'start';
  if (step.stageIndex === 1 && step.phase === 'user_c') return 'start';
  if (step.stageIndex === 1 && step.phase === 'user_heap') return 'alloc_buf';
  if (step.stageIndex === 7 && step.phase === 'user_c') return 'check_nl';
  if (step.stageIndex >= 2 && step.stageIndex <= 5) return 'read_syscall';
  if (step.stageIndex === 6) return 'check_bytes';
  if (step.stageIndex === 7) return 'join_stash';
  if (step.stageIndex === 8 && step.phase === 'user_heap' && step.title.includes('Release temporary')) {
    return 'free_buf';
  }
  if (step.phase === 'return' && step.title.includes('NULL')) return 'ret_null';
  return 'slice_return';
}

export const LiveFlowDiagram: React.FC<LiveFlowDiagramProps> = ({
  selectedId,
  onSelectConcept,
  onGoPrevChapter,
}) => {
  const [config, setConfig] = useState<SimulationConfig>(() => presetToConfig('standard'));
  const [stepIdx, setStepIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showFileEditor, setShowFileEditor] = useState(false);

  const compiled = useMemo(() => compileTrace(config), [config]);
  const steps = compiled.steps;
  const safeIdx = Math.min(stepIdx, Math.max(0, steps.length - 1));
  const step = steps[safeIdx];
  const activeFlow = getActiveFlowNode(step);

  const reset = useCallback(() => {
    setIsPlaying(false);
    setStepIdx(0);
  }, []);

  const handlePreset = (id: string) => {
    setIsPlaying(false);
    setConfig(presetToConfig(id));
    setStepIdx(0);
  };

  const handleBufferSize = (bs: number) => {
    setIsPlaying(false);
    setConfig((prev) => ({ ...prev, bufferSize: bs }));
    setStepIdx(0);
  };

  const handleFileSave = (files: VirtualFileConfig[], callSequence: number[]) => {
    setIsPlaying(false);
    setConfig((prev) => ({ ...prev, files, callSequence, presetId: 'custom' }));
    setStepIdx(0);
  };

  useEffect(() => {
    if (!isPlaying) return;
    const t = window.setInterval(() => {
      setStepIdx((cur) => {
        if (cur >= steps.length - 1) {
          setIsPlaying(false);
          return cur;
        }
        return cur + 1;
      });
    }, 850);
    return () => window.clearInterval(t);
  }, [isPlaying, steps.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || showFileEditor) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setIsPlaying(false);
        setStepIdx((i) => Math.min(steps.length - 1, i + 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIsPlaying(false);
        setStepIdx((i) => Math.max(0, i - 1));
      } else if (e.key === ' ') {
        e.preventDefault();
        setIsPlaying((p) => {
          if (!p && safeIdx >= steps.length - 1) setStepIdx(0);
          return !p;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [steps.length, safeIdx, showFileEditor]);

  const activeBufferBlock = step.memory.heapBlocks.find(
    (b) => b.kind === 'buffer' && b.status === 'live'
  );
  const activeStashBlocks = step.memory.bssSlots;
  const activeFile =
    step.kernel.openFiles.find((f) => f.fd === step.activeFd) ?? step.kernel.openFiles[0];
  const isRing0 = step.cpu.ring === 0;
  const isError = step.kernel.lookupStatus === 'ebadf' || step.cpu.errnoValue !== null;

  const nodeStyle = (id: FlowNodeId, ring0Node = false) => {
    const active = activeFlow === id;
    if (!active) {
      return { fill: '#FFFFFF', stroke: '#CBD5E1', sw: 1.6, text: '#334155' };
    }
    if (isError) {
      return { fill: '#FEF2F2', stroke: '#DC2626', sw: 2.6, text: '#991B1B' };
    }
    if (ring0Node) {
      return { fill: '#FFFBEB', stroke: '#D97706', sw: 2.6, text: '#92400E' };
    }
    if (id === 'slice_return') {
      return { fill: '#F0FDF4', stroke: '#16A34A', sw: 2.6, text: '#166534' };
    }
    return { fill: '#EFF6FF', stroke: '#2563EB', sw: 2.6, text: '#1D4ED8' };
  };

  const regVal = (name: string) =>
    step.cpu.registers.find((r) => r.name === name)?.meaning ?? '—';

  return (
    <div className="diagram-stage">
      <div className="stage-header">
        <div>
          <span className="stage-kicker">Step 4 of 4 · Decision Flowchart &amp; Live Data-Flow Machine</span>
          <h2 className="stage-title">Watch Real Bytes Travel From SSD → Kernel → CPU → Heap → Returned Lines</h2>
        </div>
        <div className="stage-nav-btns">
          <button type="button" className="ui-btn" onClick={onGoPrevChapter}>
            ← 3. Syscall &amp; Kernel
          </button>
          <button
            id="btn-open-file-editor"
            type="button"
            className="ui-btn"
            onClick={() => setShowFileEditor(true)}
          >
            Edit File Text
          </button>
        </div>
      </div>

      {/* Minimal, clean controls */}
      <div className="interactive-toolbar">
        <div className="tool-group">
          <select
            id="select-live-preset"
            className="select-box"
            value={config.presetId}
            onChange={(e) => handlePreset(e.target.value)}
            aria-label="Choose scenario"
          >
            {SCENARIO_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.shortLabel}
              </option>
            ))}
            {config.presetId === 'custom' && <option value="custom">Custom File</option>}
          </select>

          <span className="tool-label">BUFFER_SIZE:</span>
          {[1, 4, 8, 42].map((bs) => (
            <button
              key={bs}
              type="button"
              className={`pill-btn ${config.bufferSize === bs ? 'active' : ''}`}
              onClick={() => handleBufferSize(bs)}
            >
              {bs}
            </button>
          ))}
        </div>

        <div className="tool-group">
          <button id="btn-live-reset" type="button" className="ui-btn" onClick={reset} disabled={safeIdx === 0}>
            Reset
          </button>
          <button
            id="btn-live-back"
            type="button"
            className="ui-btn"
            disabled={safeIdx === 0}
            onClick={() => { setIsPlaying(false); setStepIdx((i) => Math.max(0, i - 1)); }}
          >
            ← Back
          </button>
          <button
            id="btn-live-play"
            type="button"
            className="ui-btn primary"
            onClick={() => {
              if (!isPlaying && safeIdx >= steps.length - 1) setStepIdx(0);
              setIsPlaying((p) => !p);
            }}
          >
            {isPlaying ? 'Pause' : safeIdx >= steps.length - 1 ? 'Replay' : 'Play ▶'}
          </button>
          <button
            id="btn-live-next"
            type="button"
            className="ui-btn"
            disabled={safeIdx >= steps.length - 1}
            onClick={() => { setIsPlaying(false); setStepIdx((i) => Math.min(steps.length - 1, i + 1)); }}
          >
            Next →
          </button>
          <span className="step-pill">
            Step {safeIdx + 1}/{steps.length} · Syscalls: {step.metrics.syscallCount}
          </span>
        </div>
      </div>

      {/* Live 1-sentence plain-English caption */}
      <p className={`stage-caption ${isRing0 ? 'ring0-cap' : ''} ${isError ? 'err-cap' : ''}`}>
        <strong>{step.callIndex === 0 ? 'Ready:' : `Call #${step.callIndex} (fd=${step.activeFd}):`}</strong>{' '}
        {step.title}
      </p>

      {/* ============ DIAGRAM A: DECISION FLOWCHART (OVALS, BOXES, DIAMONDS) ============ */}
      <div className="svg-frame" style={{ marginBottom: '12px' }}>
        <svg
          viewBox="0 0 960 218"
          className="diagram-svg"
          role="img"
          aria-label="Decision flowchart of the get_next_line algorithm logic"
        >
          <defs>
            <marker id="f-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#64748B" />
            </marker>
            <marker id="f-arr-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#2563EB" />
            </marker>
            <marker id="f-arr-green" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#16A34A" />
            </marker>
          </defs>

          <text x="16" y="20" className="svg-mini-title" fill="#64748B">
            LOGIC FLOWCHART · WHERE WE ARE RIGHT NOW
          </text>

          {/* 1. Start Oval */}
          {(() => {
            const s = nodeStyle('start');
            return (
              <g className="svg-node" onClick={() => onSelectConcept('stack')}>
                <rect x="14" y="64" width="84" height="42" rx="21" fill={s.fill} stroke={s.stroke} strokeWidth={s.sw} />
                <text x="56" y="83" textAnchor="middle" className="svg-mini-title" fill={s.text}>Start Call</text>
                <text x="56" y="97" textAnchor="middle" className="svg-mini-sub">fd={step.activeFd}</text>
              </g>
            );
          })()}

          <path d="M 98 85 L 118 85" stroke="#64748B" strokeWidth="1.8" markerEnd="url(#f-arr)" />

          {/* 2. Allocate buffer */}
          {(() => {
            const s = nodeStyle('alloc_buf');
            return (
              <g className="svg-node" onClick={() => onSelectConcept('buffer')}>
                <rect x="120" y="58" width="112" height="54" rx="8" fill={s.fill} stroke={s.stroke} strokeWidth={s.sw} />
                <text x="176" y="81" textAnchor="middle" className="svg-mini-title" fill={s.text}>Alloc buffer</text>
                <text x="176" y="98" textAnchor="middle" className="svg-mini-sub">Heap: BS + 1</text>
              </g>
            );
          })()}

          <path d="M 232 85 L 254 85" stroke="#64748B" strokeWidth="1.8" markerEnd="url(#f-arr)" />

          {/* 3. Decision Diamond: Stash already has \n? */}
          {(() => {
            const s = nodeStyle('check_nl');
            return (
              <g className="svg-node" onClick={() => onSelectConcept('bss')}>
                <polygon points="316,42 376,85 316,128 256,85" fill={s.fill} stroke={s.stroke} strokeWidth={s.sw} />
                <text x="316" y="81" textAnchor="middle" className="svg-mini-title" fill={s.text}>Stash has</text>
                <text x="316" y="96" textAnchor="middle" className="svg-mini-title" fill={s.text}>'\n'?</text>
              </g>
            );
          })()}

          {/* YES bypass arrow over the top directly to Free buffer! */}
          <path d="M 316 42 L 316 24 L 690 24 L 690 56" fill="none" stroke="#16A34A" strokeWidth="2" markerEnd="url(#f-arr-green)" />
          <text x="498" y="19" textAnchor="middle" className="svg-badge-text" fill="#15803D">YES → Skip read() (0 syscalls!)</text>

          {/* NO arrow down-right into SYSCALL read() */}
          <path d="M 376 85 L 406 85" stroke="#64748B" strokeWidth="1.8" markerEnd="url(#f-arr)" />
          <text x="391" y="78" textAnchor="middle" className="svg-badge-text" fill="#B45309">NO</text>

          {/* 4. SYSCALL read() */}
          {(() => {
            const s = nodeStyle('read_syscall', true);
            return (
              <g className="svg-node" onClick={() => onSelectConcept('syscall')}>
                <rect x="408" y="56" width="114" height="58" rx="8" fill={s.fill} stroke={s.stroke} strokeWidth={s.sw} />
                <text x="465" y="79" textAnchor="middle" className="svg-mini-title" fill={s.text}>SYSCALL read</text>
                <text x="465" y="96" textAnchor="middle" className="svg-mini-sub">Ring 3 → 0 → 3</text>
              </g>
            );
          })()}

          <path d="M 522 85 L 542 85" stroke="#64748B" strokeWidth="1.8" markerEnd="url(#f-arr)" />

          {/* 5. Decision Diamond: Got bytes > 0? */}
          {(() => {
            const s = nodeStyle('check_bytes');
            return (
              <g className="svg-node" onClick={() => onSelectConcept('libc_read')}>
                <polygon points="590,46 636,85 590,124 544,85" fill={s.fill} stroke={s.stroke} strokeWidth={s.sw} />
                <text x="590" y="82" textAnchor="middle" className="svg-mini-title" fill={s.text}>bytes</text>
                <text x="590" y="97" textAnchor="middle" className="svg-mini-title" fill={s.text}>&gt; 0?</text>
              </g>
            );
          })()}

          {/* YES down into Write \0 & Join Stash -> loops back to Check \n */}
          <path d="M 590 124 L 590 144" stroke="#2563EB" strokeWidth="2" markerEnd="url(#f-arr-blue)" />
          <text x="606" y="137" className="svg-badge-text" fill="#1D4ED8">YES</text>

          {(() => {
            const s = nodeStyle('join_stash');
            return (
              <g className="svg-node" onClick={() => onSelectConcept('bss')}>
                <rect x="414" y="146" width="212" height="46" rx="8" fill={s.fill} stroke={s.stroke} strokeWidth={s.sw} />
                <text x="520" y="166" textAnchor="middle" className="svg-mini-title" fill={s.text}>Write '\0' &amp; Append to Stash</text>
                <text x="520" y="182" textAnchor="middle" className="svg-mini-sub">Pure User-Space RAM</text>
              </g>
            );
          })()}

          {/* Loop back arrow from Join Stash to Stash has \n? */}
          <path d="M 414 169 L 316 169 L 316 130" fill="none" stroke="#2563EB" strokeWidth="2" markerEnd="url(#f-arr-blue)" />
          <text x="364" y="162" textAnchor="middle" className="svg-badge-text" fill="#1D4ED8">repeat loop</text>

          {/* NO (EOF / -1) arrow to Free buffer */}
          <path d="M 636 85 L 656 85" stroke="#64748B" strokeWidth="1.8" markerEnd="url(#f-arr)" />
          <text x="646" y="76" textAnchor="middle" className="svg-badge-text" fill="#64748B">0/-1</text>

          {/* 6. Free temp buffer */}
          {(() => {
            const s = nodeStyle('free_buf');
            return (
              <g className="svg-node" onClick={() => onSelectConcept('heap')}>
                <rect x="658" y="58" width="94" height="54" rx="8" fill={s.fill} stroke={s.stroke} strokeWidth={s.sw} />
                <text x="705" y="81" textAnchor="middle" className="svg-mini-title" fill={s.text}>Free temp</text>
                <text x="705" y="98" textAnchor="middle" className="svg-mini-sub">buffer</text>
              </g>
            );
          })()}

          <path d="M 752 85 L 774 85" stroke="#64748B" strokeWidth="1.8" markerEnd="url(#f-arr)" />

          {/* 7. Slice Line & Keep Leftover OR Return NULL */}
          {(() => {
            const s = nodeStyle('slice_return');
            return (
              <g className="svg-node" onClick={() => onSelectConcept('heap')}>
                <rect x="776" y="48" width="168" height="68" rx="14" fill={s.fill} stroke={s.stroke} strokeWidth={s.sw} />
                <text x="860" y="72" textAnchor="middle" className="svg-mini-title" fill={s.text}>Slice Line → Return</text>
                <text x="860" y="90" textAnchor="middle" className="svg-mini-sub">Keep leftovers in .bss</text>
                <text x="860" y="106" textAnchor="middle" className="svg-mini-sub" fill="#15803D">Pop Stack Frame</text>
              </g>
            );
          })()}

          {/* Branch down to Return NULL */}
          <path d="M 705 112 L 705 169 L 774 169" fill="none" stroke="#64748B" strokeWidth="1.8" strokeDasharray="4 3" markerEnd="url(#f-arr)" />
          {(() => {
            const s = nodeStyle('ret_null');
            return (
              <g className="svg-node" onClick={() => onSelectConcept('struct_file')}>
                <rect x="776" y="146" width="168" height="44" rx="22" fill={s.fill} stroke={s.stroke} strokeWidth={s.sw} />
                <text x="860" y="167" textAnchor="middle" className="svg-mini-title" fill={s.text}>Return NULL</text>
                <text x="860" y="182" textAnchor="middle" className="svg-mini-sub">EOF or Error · 0 leaks</text>
              </g>
            );
          })()}
        </svg>
      </div>

      {/* ============ DIAGRAM B: LIVE SPATIAL MACHINE (SSD -> KERNEL -> CPU -> HEAP -> OUTPUT) ============ */}
      <div className="svg-frame">
        <svg
          viewBox="0 0 960 310"
          className="diagram-svg"
          role="img"
          aria-label="Live hardware and memory diagram showing current file bytes, CPU privilege ring and registers, Heap buffer, .bss static stash, and returned lines"
        >
          <defs>
            <marker id="l-arr-amber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#D97706" />
            </marker>
            <marker id="l-arr-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#2563EB" />
            </marker>
            <marker id="l-arr-green" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#16A34A" />
            </marker>
          </defs>

          {/* STATION 1: KERNEL FILE / PAGE CACHE / SSD TAPE (LEFT) */}
          <g
            className={`svg-node ${selectedId === 'page_cache' || selectedId === 'struct_file' ? 'selected' : ''}`}
            onClick={() => onSelectConcept('struct_file')}
          >
            <rect x="16" y="16" width="268" height="278" rx="12" fill="#FFFBEB" stroke="#F59E0B" strokeWidth="2" />
            <text x="30" y="40" className="svg-mini-title" fill="#B45309">KERNEL · OPEN FILE &amp; PAGE CACHE</text>

            {step.kernel.openFiles.map((of, fileIdx) => {
              const yOff = 54 + fileIdx * 112;
              const chars = Array.from(of.content).slice(0, 14);
              return (
                <g key={of.fd} transform={`translate(28, ${yOff})`}>
                  <rect width="244" height="98" rx="8" fill="#FFFFFF" stroke={of.fd === step.activeFd ? '#D97706' : '#E2E8F0'} strokeWidth={of.fd === step.activeFd ? 2 : 1.2} />
                  <text x="10" y="19" className="svg-mini-title" fill="#0F172A">
                    fd={of.fd} ({of.filename}) · f_pos={of.fPos}
                  </text>
                  <text x="10" y="34" className="svg-mini-sub" fill={of.lastCacheEvent === 'hit_page_cache' ? '#15803D' : '#B45309'}>
                    {of.lastCacheEvent === 'miss_ssd_fetch'
                      ? 'SSD → Page Cache (4KB loaded)'
                      : of.lastCacheEvent === 'hit_page_cache'
                        ? 'Page Cache HIT (RAM)'
                        : of.lastCacheEvent === 'eof'
                          ? 'EOF reached'
                          : 'Waiting on SSD'}
                  </text>
                  <g transform="translate(8, 46)">
                    {chars.length === 0 ? (
                      <text x="4" y="20" className="svg-mini-sub">(Empty file · 0 bytes)</text>
                    ) : (
                      chars.map((ch, idx) => {
                        const code = ch.charCodeAt(0);
                        const copying =
                          of.activeSliceStart !== null &&
                          idx >= of.activeSliceStart &&
                          idx < of.activeSliceStart + of.activeSliceLen;
                        const consumed = !copying && idx < of.fPos;
                        const col = idx % 8;
                        const row = Math.floor(idx / 8);
                        return (
                          <g key={idx} transform={`translate(${col * 28}, ${row * 24})`}>
                            <rect
                              width="25"
                              height="21"
                              rx="3"
                              fill={copying ? '#FEF3C7' : consumed ? '#F1F5F9' : '#FFFFFF'}
                              stroke={copying ? '#D97706' : idx === of.fPos ? '#0F172A' : '#CBD5E1'}
                              strokeWidth={idx === of.fPos ? 2 : 1.2}
                            />
                            <text x="12.5" y="14" textAnchor="middle" className="svg-cell-ch" fill={consumed ? '#94A3B8' : '#0F172A'}>
                              {formatEscapedChar(code)}
                            </text>
                          </g>
                        );
                      })
                    )}
                  </g>
                </g>
              );
            })}

            {step.kernel.lookupStatus === 'ebadf' && (
              <rect x="28" y="182" width="244" height="44" rx="8" fill="#FEF2F2" stroke="#DC2626" strokeWidth="2" />
            )}
            {step.kernel.lookupStatus === 'ebadf' && (
              <text x="150" y="209" textAnchor="middle" className="svg-mini-title" fill="#B91C1C">
                fd={step.activeFd} CLOSED → -EBADF (-9)
              </text>
            )}
          </g>

          {/* ARROW: Kernel <-> CPU */}
          <path
            d="M 284 150 L 316 150"
            stroke={isRing0 ? '#D97706' : '#94A3B8'}
            strokeWidth={isRing0 ? 3 : 1.8}
            markerEnd="url(#l-arr-amber)"
          />

          {/* STATION 2: CPU PRIVILEGE RING & REGISTERS (MIDDLE-LEFT) */}
          <g
            className={`svg-node ${selectedId === 'cpu' || selectedId === 'registers' ? 'selected' : ''}`}
            onClick={() => onSelectConcept('registers')}
          >
            <rect
              x="318"
              y="16"
              width="206"
              height="278"
              rx="12"
              fill={isRing0 ? '#FFFBEB' : '#F8FAFC'}
              stroke={isRing0 ? '#D97706' : '#334155'}
              strokeWidth="2"
            />
            <text x="421" y="40" textAnchor="middle" className="svg-mini-title" fill="#0F172A">
              CPU HARDWARE
            </text>

            <rect
              x="338"
              y="52"
              width="166"
              height="32"
              rx="16"
              fill={isRing0 ? '#D97706' : '#1D4ED8'}
            />
            <text x="421" y="72" textAnchor="middle" className="svg-badge-text" fill="#FFFFFF">
              {isRing0 ? 'RING 0 · KERNEL MODE' : 'RING 3 · USER MODE'}
            </text>

            {[
              { k: 'rax', v: regVal('rax') },
              { k: 'rdi', v: regVal('rdi') },
              { k: 'rsi', v: regVal('rsi') },
              { k: 'rdx', v: regVal('rdx') },
            ].map((r, i) => (
              <g key={r.k} transform={`translate(332, ${98 + i * 44})`}>
                <rect width="178" height="36" rx="6" fill="#FFFFFF" stroke="#CBD5E1" />
                <text x="10" y="15" className="svg-mini-title" fill="#1D4ED8">{r.k}</text>
                <text x="10" y="30" className="svg-mini-sub" fill="#334155">{r.v.slice(0, 26)}</text>
              </g>
            ))}
          </g>

          {/* ARROW: CPU -> User Space Heap */}
          <path
            d="M 524 150 L 556 150"
            stroke="#2563EB"
            strokeWidth="2.4"
            markerEnd="url(#l-arr-blue)"
          />

          {/* STATION 3: USER SPACE HEAP buffer + .bss STASH (MIDDLE-RIGHT) */}
          <g
            className={`svg-node ${selectedId === 'buffer' || selectedId === 'bss' ? 'selected' : ''}`}
            onClick={() => onSelectConcept('buffer')}
          >
            <rect x="558" y="16" width="218" height="278" rx="12" fill="#EFF6FF" stroke="#3B82F6" strokeWidth="2" />
            <text x="572" y="40" className="svg-mini-title" fill="#1D4ED8">USER SPACE RAM (HEAP + .bss)</text>

            {/* Live Heap buffer */}
            <rect x="570" y="52" width="194" height="96" rx="8" fill="#FFFFFF" stroke={activeBufferBlock ? '#16A34A' : '#CBD5E1'} strokeWidth="1.8" />
            <text x="580" y="70" className="svg-mini-title" fill="#166534">
              Temp buffer ({config.bufferSize + 1} B)
            </text>
            {activeBufferBlock ? (
              <g transform="translate(580, 80)">
                {activeBufferBlock.bytes.slice(0, 6).map((cell, i) => (
                  <g key={cell.index} transform={`translate(${i * 29}, 0)`}>
                    <rect
                      width="26"
                      height="32"
                      rx="4"
                      fill={cell.role === 'null' ? '#FEF2F2' : cell.role === 'newly_copied' ? '#FEF3C7' : cell.role === 'newline' ? '#DBEAFE' : '#F8FAFC'}
                      stroke={cell.role === 'null' ? '#DC2626' : cell.role === 'newly_copied' ? '#D97706' : '#94A3B8'}
                      strokeWidth="1.4"
                    />
                    <text x="13" y="13" textAnchor="middle" className="svg-cell-idx">{cell.index}</text>
                    <text x="13" y="26" textAnchor="middle" className="svg-cell-ch">{cell.display}</text>
                  </g>
                ))}
                {activeBufferBlock.size > 6 && (
                  <text x="0" y="50" className="svg-mini-sub">+{activeBufferBlock.size - 6} more slots</text>
                )}
              </g>
            ) : (
              <text x="580" y="106" className="svg-mini-sub" fill="#64748B">
                Not allocated / Freed (0 B live)
              </text>
            )}

            {/* .bss static stash */}
            <g onClick={(e) => { e.stopPropagation(); onSelectConcept('bss'); }}>
              <rect x="570" y="162" width="194" height="118" rx="8" fill="#FFFFFF" stroke="#2563EB" strokeWidth="1.8" />
              <text x="580" y="182" className="svg-mini-title" fill="#1D4ED8">.bss static → Heap stash</text>
              {activeStashBlocks.map((slot, idx) => (
                <g key={slot.name} transform={`translate(580, ${194 + idx * 38})`}>
                  <rect width="174" height="32" rx="5" fill={slot.pointsTo ? '#DBEAFE' : '#F8FAFC'} stroke={slot.pointsTo ? '#2563EB' : '#CBD5E1'} />
                  <text x="8" y="14" className="svg-cell-idx" fill="#1D4ED8">{slot.name}</text>
                  <text x="8" y="27" className="svg-mono-pill" fill="#0F172A">
                    {slot.preview}
                  </text>
                </g>
              ))}
            </g>
          </g>

          {/* ARROW: User Space -> Returned Lines */}
          <path d="M 776 150 L 798 150" stroke="#16A34A" strokeWidth="2.4" markerEnd="url(#l-arr-green)" />

          {/* STATION 4: RETURNED LINES TRAY (FAR RIGHT) */}
          <g className="svg-node" onClick={() => onSelectConcept('heap')}>
            <rect x="800" y="16" width="144" height="278" rx="12" fill="#F0FDF4" stroke="#16A34A" strokeWidth="2" />
            <text x="872" y="40" textAnchor="middle" className="svg-mini-title" fill="#15803D">RETURNED LINES</text>

            {step.metrics.returnedLines.length === 0 ? (
              <text x="872" y="138" textAnchor="middle" className="svg-mini-sub" fill="#64748B">
                Press Play or Next →
              </text>
            ) : (
              step.metrics.returnedLines.slice(0, 6).map((rec, i) => (
                <g key={`${rec.callIndex}-${rec.fd}`} transform={`translate(812, ${54 + i * 36})`}>
                  <rect
                    width="120"
                    height="29"
                    rx="6"
                    fill={rec.value === null ? '#FEF2F2' : '#FFFFFF'}
                    stroke={rec.value === null ? '#DC2626' : '#16A34A'}
                    strokeWidth="1.5"
                  />
                  <text x="60" y="19" textAnchor="middle" className="svg-mono-pill" fill={rec.value === null ? '#B91C1C' : '#15803D'}>
                    #{rec.callIndex}: {rec.value === null ? 'NULL' : formatPreviewString(rec.value, 10)}
                  </text>
                </g>
              ))
            )}

            <rect x="812" y="254" width="120" height="26" rx="6" fill="#FFFFFF" stroke="#86EFAC" />
            <text x="872" y="271" textAnchor="middle" className="svg-badge-text" fill="#15803D">
              GNL Heap: {step.metrics.liveGnlHeapBytes} B
            </text>
          </g>
        </svg>
      </div>

      {activeFile && step.metrics.liveGnlHeapBytes === 0 && safeIdx === steps.length - 1 && (
        <div className="done-banner">
          Done! Delivered {step.metrics.returnedLines.length} return(s) using {step.metrics.syscallCount} syscall(s) ({step.metrics.ssdPageFetches} SSD load, {step.metrics.pageCacheHits} Page Cache hits) with 0 internal memory leaks.
        </div>
      )}

      {showFileEditor && (
        <FileEditorDrawer
          config={config}
          onApply={handleFileSave}
          onClose={() => setShowFileEditor(false)}
        />
      )}
    </div>
  );
};
