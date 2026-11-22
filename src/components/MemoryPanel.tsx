import React, { useState } from 'react';
import { formatPreviewString } from '../engine/compiler';
import { HeapBlock, TraceStep } from '../engine/types';

interface MemoryPanelProps {
  step: TraceStep;
}

export const MemoryPanel: React.FC<MemoryPanelProps> = ({ step }) => {
  const [showFreed, setShowFreed] = useState(true);
  const { memory, metrics } = step;

  const visibleHeapBlocks = showFreed
    ? memory.heapBlocks
    : memory.heapBlocks.filter((b) => b.status !== 'freed');

  const renderHeapBlock = (blk: HeapBlock) => {
    const statusClass =
      blk.status === 'freed'
        ? 'freed'
        : blk.status === 'returned_to_caller'
          ? 'returned'
          : '';
    const statusLabel =
      blk.status === 'freed'
        ? 'FREED'
        : blk.status === 'returned_to_caller'
          ? 'RETURNED TO CALLER'
          : 'LIVE';

    return (
      <div
        key={blk.id}
        className={`heap-block ${statusClass} ${blk.highlight ? 'highlight' : ''}`}
      >
        <div className="heap-block-head">
          <span>
            <span className="heap-addr">{blk.address}</span>{' '}
            <span style={{ color: 'var(--ink-secondary)' }}>{blk.label}</span>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: 'var(--ink-muted)' }}>{blk.size} B</span>
            <span className={`heap-status-pill ${statusClass || 'live'}`}>
              {statusLabel}
            </span>
          </span>
        </div>

        <div className="byte-grid" aria-label={`Bytes in ${blk.label}`}>
          {blk.bytes.map((cell) => (
            <div
              key={cell.index}
              className={`byte-cell role-${cell.role}`}
              title={`offset [${cell.index}] | char: ${cell.display} | hex: 0x${cell.hex} | role: ${cell.role}`}
            >
              <span className="b-idx">{cell.index}</span>
              <span className="b-char">{cell.display}</span>
              <span className="b-hex">{cell.hex}</span>
            </div>
          ))}
          {blk.hiddenUninitCount > 0 && (
            <span className="byte-folded">
              … +{blk.hiddenUninitCount.toLocaleString()} uninit B (total {blk.size.toLocaleString()} B) …
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <section className="schematic-col" aria-label="User Space Memory Architecture">
      <div className="col-header">
        <h3 className="col-title">USER SPACE — Virtual Memory (Ring 3)</h3>
        <span className="col-addr-hint">Restricted Mode · 0x0040… → 0x7fff…</span>
      </div>

      <div className="col-body">
        {/* PHYSICAL DISTINCTION: BUFFER_SIZE (.text) vs buffer (Heap) */}
        <div className="panel-block ring3-accent">
          <div className="panel-head">
            <span className="panel-head-title">Physical Distinction: BUFFER_SIZE (.text) vs buffer (Heap)</span>
            <span className="panel-head-meta">Compile-Time vs Runtime RAM</span>
          </div>
          <div className="panel-content">
            <div className="text-contrast-box">
              <div className={`contrast-cell ${memory.textImmediateHighlight ? 'highlighted' : ''}`}>
                <span className="contrast-label">BUFFER_SIZE — Baked in .text (0x00401120)</span>
                <div>
                  <strong>{memory.bufferSize}</strong> (0x{memory.bufferSize.toString(16)}) · <strong>0 B data RAM</strong>
                </div>
                <div style={{ fontSize: '10.5px', color: 'var(--ink-secondary)', marginTop: '2px' }}>
                  Preprocessor number embedded directly inside CPU machine instructions as a capacity limit.
                </div>
              </div>
              <div className="contrast-cell">
                <span className="contrast-label">buffer — Physical Container in Heap RAM</span>
                <div>
                  <strong>{memory.bufferSize + 1} B</strong> ({memory.bufferSize} data + 1 for <code>'\0'</code>)
                </div>
                <div style={{ fontSize: '10.5px', color: 'var(--ink-secondary)', marginTop: '2px' }}>
                  Real contiguous RAM slots whose address is handed to the Kernel in register <code>rsi</code>.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* HEAP SEGMENT — Main Physical Byte Containers */}
        <div className="panel-block">
          <div className="panel-head">
            <span className="panel-head-title">Heap RAM (Dynamic Byte Containers)</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <label
                className="mono"
                style={{ fontSize: '10px', color: 'var(--ink-secondary)', cursor: 'pointer' }}
              >
                <input
                  id="checkbox-show-freed"
                  type="checkbox"
                  checked={showFreed}
                  onChange={(e) => setShowFreed(e.target.checked)}
                  style={{ verticalAlign: 'middle', marginRight: '4px' }}
                />
                Show freed blocks
              </label>
              <span className="panel-head-meta">0x55a4c2a012a0+</span>
            </span>
          </div>
          <div className="panel-content">
            <div className="heap-stats-row">
              <span>
                Allocations: <strong>{metrics.mallocCount}</strong>
              </span>
              <span>
                Freed: <strong>{metrics.freeCount}</strong>
              </span>
              <span>
                Live Internal: <strong>{metrics.liveGnlHeapBytes} B</strong>
              </span>
              <span>
                Handed to Caller: <strong>{metrics.callerOwnedBytes} B</strong>
              </span>
            </div>

            {visibleHeapBlocks.length === 0 ? (
              <div
                className="mono"
                style={{ fontSize: '11px', color: 'var(--ink-muted)', padding: '8px 2px' }}
              >
                Heap is empty. <code>BUFFER_SIZE</code> ({memory.bufferSize}) uses 0 bytes of Heap RAM until the temporary <code>buffer</code> container is allocated.
              </div>
            ) : (
              <div className="heap-list">{visibleHeapBlocks.map(renderHeapBlock)}</div>
            )}
          </div>
        </div>

        {/* .BSS STATIC SEGMENT & STACK SIDE-BY-SIDE CONTRAST */}
        <div className="mem-split-row">
          {/* .BSS STATIC SEGMENT */}
          <div className="panel-block ring3-accent">
            <div className="panel-head">
              <span className="panel-head-title">.bss Static Memory (Persists)</span>
              <span className="panel-head-meta">0x00404040</span>
            </div>
            <div className="panel-content">
              <table className="mem-table">
                <thead>
                  <tr>
                    <th>Pointer</th>
                    <th>Points To (Heap)</th>
                    <th>Leftovers</th>
                  </tr>
                </thead>
                <tbody>
                  {memory.bssSlots.map((slot) => (
                    <tr key={slot.name} className={slot.changed ? 'mem-row-changed' : ''}>
                      <td>
                        <strong>{slot.name}</strong>
                      </td>
                      <td>
                        {slot.pointsTo ? (
                          <span className="ptr-link">-&gt; {slot.pointsTo}</span>
                        ) : (
                          <span className="ptr-null">0x0 (NULL)</span>
                        )}
                      </td>
                      <td>{slot.preview}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* CALL STACK (TEMPORARY) */}
          <div className="panel-block">
            <div className="panel-head">
              <span className="panel-head-title">Call Stack (Destroyed on Return)</span>
              <span className="panel-head-meta">0x7fffffffde40</span>
            </div>
            <div className="panel-content">
              {memory.stackActive ? (
                <table className="mem-table">
                  <thead>
                    <tr>
                      <th>Local Slot</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {memory.stackSlots.map((slot) => (
                      <tr key={slot.name} className={slot.changed ? 'mem-row-changed' : ''}>
                        <td>
                          <strong>{slot.name}</strong>{' '}
                          <span style={{ color: 'var(--ink-muted)' }}>({slot.type})</span>
                        </td>
                        <td>
                          {slot.value.startsWith('0x') ? (
                            <span className="ptr-link">{slot.value}</span>
                          ) : (
                            slot.value
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="stack-popped-note">
                  Frame popped — local slots vanished on return. Only <strong>.bss</strong> &amp; <strong>Heap</strong> survive between calls.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RETURNED LINES STREAM */}
        <div className="panel-block">
          <div className="panel-head">
            <span className="panel-head-title">Returned Lines (Delivered to Caller)</span>
            <span className="panel-head-meta">{metrics.returnedLines.length} call(s) completed</span>
          </div>
          <div className="panel-content" style={{ padding: '5px 8px' }}>
            {metrics.returnedLines.length === 0 ? (
              <div className="mono" style={{ fontSize: '11px', color: 'var(--ink-muted)', padding: '4px 0' }}>
                No calls completed yet. Step through Stages 01 → 08 to watch Call #1 deliver its line.
              </div>
            ) : (
              <table className="output-table">
                <thead>
                  <tr>
                    <th>Call</th>
                    <th>FD</th>
                    <th>Returned String (Heap)</th>
                    <th>Address</th>
                    <th>Syscalls Used</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.returnedLines.map((rec) => (
                    <tr key={`${rec.callIndex}-${rec.fd}`}>
                      <td>#{rec.callIndex}</td>
                      <td>{rec.fd}</td>
                      <td>
                        {rec.value === null ? (
                          <span className="output-null">NULL</span>
                        ) : (
                          <span className="output-str">{formatPreviewString(rec.value, 28)}</span>
                        )}
                      </td>
                      <td>{rec.address ?? '0x0'}</td>
                      <td>{rec.syscallsInCall}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
