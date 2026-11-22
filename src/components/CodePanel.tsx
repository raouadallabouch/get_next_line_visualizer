import React, { useState } from 'react';
import { getAsmLines, getCSourceLines } from '../engine/codeTemplates';
import { formatPreviewString } from '../engine/compiler';
import { Mode, TraceStep } from '../engine/types';

interface CodePanelProps {
  step: TraceStep;
  mode: Mode;
  bufferSize: number;
}

export const CodePanel: React.FC<CodePanelProps> = ({ step, mode, bufferSize }) => {
  const [codeTab, setCodeTab] = useState<'both' | 'c' | 'asm'>('both');
  const cLines = getCSourceLines(mode);
  const asmLines = getAsmLines(bufferSize);

  const renderAsmSection = (
    section: 'gnl_text' | 'libc_read' | 'kernel_entry',
    title: string,
    isRing0 = false
  ) => {
    const rows = asmLines.filter((a) => a.section === section);
    return (
      <div key={section}>
        <div className={`asm-section-label ${isRing0 ? 'ring0' : ''}`}>{title}</div>
        {rows.map((row) => {
          const isActive = step.asmLine === row.num;
          return (
            <div
              key={row.num}
              className={`asm-row ${isActive ? 'active' : ''} ${isActive && isRing0 ? 'ring0' : ''}`}
            >
              <span className="asm-addr">{row.addr}</span>
              <div>
                <span className="asm-ins">{row.instruction}</span>
                <span className="asm-ann">; {row.annotation}</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <section className="schematic-col" aria-label="Source Code and Machine Disassembly">
      <div className="col-header">
        <h3 className="col-title">1. Code &amp; .text Binary</h3>
        <div className="segmented" role="group" aria-label="Code View Selector">
          <button
            id="btn-code-both"
            type="button"
            className={codeTab === 'both' ? 'active' : ''}
            onClick={() => setCodeTab('both')}
          >
            Split
          </button>
          <button
            id="btn-code-c"
            type="button"
            className={codeTab === 'c' ? 'active' : ''}
            onClick={() => setCodeTab('c')}
          >
            C
          </button>
          <button
            id="btn-code-asm"
            type="button"
            className={codeTab === 'asm' ? 'active' : ''}
            onClick={() => setCodeTab('asm')}
          >
            x86-64
          </button>
        </div>
      </div>

      <div className="col-body">
        {(codeTab === 'both' || codeTab === 'c') && (
          <div className="panel-block ring3-accent">
            <div className="panel-head">
              <span className="panel-head-title">
                {mode === 'bonus' ? 'get_next_line_bonus.c' : 'get_next_line.c'}
              </span>
              <span className="panel-head-meta">-D BUFFER_SIZE={bufferSize}</span>
            </div>
            <div className="code-list" style={{ padding: '4px 0' }}>
              {cLines.map((line) => {
                const isActive = step.cLine === line.num;
                const isKernelLine = isActive && step.cpu.ring === 0;
                return (
                  <div
                    key={line.num}
                    className={`code-row ${isActive ? 'active' : ''} ${isKernelLine ? 'kernel' : ''}`}
                  >
                    <span className="code-lnum">{line.num}</span>
                    <span>
                      {line.text}
                      {line.comment && <span className="code-comment">  {line.comment}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {(codeTab === 'both' || codeTab === 'asm') && (
          <div className="panel-block">
            <div className="panel-head">
              <span className="panel-head-title">x86-64 Machine Code (.text / libc / Ring 0)</span>
              <span className="panel-head-meta">Intel Syntax</span>
            </div>
            <div>
              {renderAsmSection('gnl_text', '.text :: get_next_line (Ring 3 — BUFFER_SIZE as immediate)')}
              {renderAsmSection('libc_read', 'libc.so :: read() wrapper (Ring 3 -> syscall trap)')}
              {renderAsmSection('kernel_entry', 'vmlinux :: entry_SYSCALL_64 -> sys_read (Ring 0)', true)}
            </div>
          </div>
        )}

        <div className="panel-block">
          <div className="panel-head">
            <span className="panel-head-title">Caller Return Log — main()</span>
            <span className="panel-head-meta">
              {step.metrics.returnedLines.length} return(s)
            </span>
          </div>
          <div className="panel-content" style={{ padding: '4px 6px' }}>
            {step.metrics.returnedLines.length === 0 ? (
              <div className="mono" style={{ fontSize: '11px', color: 'var(--ink-muted)', padding: '6px 2px' }}>
                No get_next_line() calls have returned yet. Step forward to trace Call #1.
              </div>
            ) : (
              <table className="output-table">
                <thead>
                  <tr>
                    <th>Call</th>
                    <th>FD</th>
                    <th>Returned String</th>
                    <th>Heap Addr</th>
                    <th>Syscalls</th>
                  </tr>
                </thead>
                <tbody>
                  {step.metrics.returnedLines.map((rec) => (
                    <tr key={`${rec.callIndex}-${rec.fd}`}>
                      <td>#{rec.callIndex}</td>
                      <td>{rec.fd}</td>
                      <td>
                        {rec.value === null ? (
                          <span className="output-null">NULL</span>
                        ) : (
                          <span className="output-str">{formatPreviewString(rec.value, 20)}</span>
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
