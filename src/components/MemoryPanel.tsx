import React, { useState } from 'react';
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

  // Show newest / most relevant blocks near top or chronological order (chronological mirrors low->high heap growth!)
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
          ? 'CALLER OWNED'
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
    <section className="schematic-col" aria-label="User Space Virtual Memory Layout">
      <div className="col-header">
        <h3 className="col-title">2. Virtual Memory (User Space RAM)</h3>
        <span className="col-addr-hint">High 0x7fff… ↓ Low 0x0040…</span>
      </div>

      <div className="col-body">
        {/* STACK SEGMENT */}
        <div className="panel-block ring3-accent">
          <div className="panel-head">
            <span className="panel-head-title">Stack Segment (LIFO Frame — Auto Lifetime)</span>
            <span className="panel-head-meta">0x7fffffffde40</span>
          </div>
          <div className="panel-content">
            {memory.stackActive ? (
              <table className="mem-table">
                <thead>
                  <tr>
                    <th>Local Var</th>
                    <th>Type</th>
                    <th>Stack Addr</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {memory.stackSlots.map((slot) => (
                    <tr key={slot.name} className={slot.changed ? 'mem-row-changed' : ''}>
                      <td>
                        <strong>{slot.name}</strong>
                      </td>
                      <td style={{ color: 'var(--ink-muted)' }}>{slot.type}</td>
                      <td style={{ color: 'var(--ink-muted)' }}>{slot.address}</td>
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
                get_next_line() Stack frame popped — local variables (fd, buffer*, bytes_read, line*) are destroyed on <strong>ret</strong>. Only <strong>.bss</strong> and <strong>Heap</strong> survive between calls.
              </div>
            )}
          </div>
        </div>

        {/* HEAP SEGMENT */}
        <div className="panel-block">
          <div className="panel-head">
            <span className="panel-head-title">Heap Segment (malloc / free)</span>
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
                Show freed tombstones
              </label>
              <span className="panel-head-meta">0x55a4c2a012a0+</span>
            </span>
          </div>
          <div className="panel-content">
            <div className="heap-stats-row">
              <span>
                malloc: <strong>{metrics.mallocCount}</strong>
              </span>
              <span>
                free: <strong>{metrics.freeCount}</strong>
              </span>
              <span>
                GNL Live: <strong>{metrics.liveGnlHeapBytes} B</strong>
              </span>
              <span>
                Returned (main): <strong>{metrics.callerOwnedBytes} B</strong>
              </span>
            </div>

            {visibleHeapBlocks.length === 0 ? (
              <div
                className="mono"
                style={{ fontSize: '11px', color: 'var(--ink-muted)', padding: '6px 2px' }}
              >
                No Heap allocations yet. BUFFER_SIZE ({memory.bufferSize}) has not allocated any RAM until malloc(BUFFER_SIZE + 1) runs.
              </div>
            ) : (
              <div className="heap-list">{visibleHeapBlocks.map(renderHeapBlock)}</div>
            )}
          </div>
        </div>

        {/* .BSS STATIC SEGMENT */}
        <div className="panel-block ring3-accent">
          <div className="panel-head">
            <span className="panel-head-title">.bss Segment (Static Memory — Process Lifetime)</span>
            <span className="panel-head-meta">0x00404040</span>
          </div>
          <div className="panel-content">
            <table className="mem-table">
              <thead>
                <tr>
                  <th>Static Pointer</th>
                  <th>.bss Addr</th>
                  <th>Points To (Heap)</th>
                  <th>Target Preview</th>
                </tr>
              </thead>
              <tbody>
                {memory.bssSlots.map((slot) => (
                  <tr key={slot.name} className={slot.changed ? 'mem-row-changed' : ''}>
                    <td>
                      <strong>{slot.name}</strong>
                    </td>
                    <td style={{ color: 'var(--ink-muted)' }}>{slot.address}</td>
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

        {/* .TEXT SEGMENT — BUFFER_SIZE vs buffer physical distinction */}
        <div className="panel-block">
          <div className="panel-head">
            <span className="panel-head-title">.text Segment (Read-Only Machine Code)</span>
            <span className="panel-head-meta">0x00401120</span>
          </div>
          <div className="panel-content">
            <div className="text-contrast-box">
              <div className={`contrast-cell ${memory.textImmediateHighlight ? 'highlighted' : ''}`}>
                <span className="contrast-label">BUFFER_SIZE (Macro Constant)</span>
                <div>
                  <strong>{memory.bufferSize}</strong> (0x{memory.bufferSize.toString(16)})
                </div>
                <div style={{ fontSize: '10px', color: 'var(--ink-secondary)', marginTop: '2px' }}>
                  0 B data RAM — immediate operand inside <code>mov edx, 0x{memory.bufferSize.toString(16)}</code>
                </div>
              </div>
              <div className="contrast-cell">
                <span className="contrast-label">buffer (Physical Container)</span>
                <div>
                  <strong>{memory.bufferSize + 1} B</strong> on Heap
                </div>
                <div style={{ fontSize: '10px', color: 'var(--ink-secondary)', marginTop: '2px' }}>
                  Allocated via <code>malloc(BUFFER_SIZE + 1)</code>; +1 reserved for manual <code>'\0'</code>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
