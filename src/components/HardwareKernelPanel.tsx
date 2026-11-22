import React from 'react';
import { formatEscapedChar } from '../engine/compiler';
import { OpenFileDesc, TraceStep } from '../engine/types';

interface HardwareKernelPanelProps {
  step: TraceStep;
}

const SYSCALL_TABLE_SLICE = [
  { idx: 0, name: '__x64_sys_read', addr: '0xffffffff813a4190' },
  { idx: 1, name: '__x64_sys_write', addr: '0xffffffff813a42b0' },
  { idx: 2, name: '__x64_sys_open', addr: '0xffffffff813a1040' },
  { idx: 3, name: '__x64_sys_close', addr: '0xffffffff813a1580' },
];

export const HardwareKernelPanel: React.FC<HardwareKernelPanelProps> = ({ step }) => {
  const { cpu, kernel } = step;
  const isRing0 = cpu.ring === 0;

  const barrierClass =
    step.phase === 'cpu_syscall' || isRing0
      ? kernel.lookupStatus === 'ebadf'
        ? 'active-error'
        : 'active-trap'
      : step.phase === 'cpu_sysret'
        ? cpu.errnoValue
          ? 'active-error'
          : 'active-return'
        : '';

  const barrierLabel =
    step.phase === 'cpu_syscall'
      ? 'SYSCALL TRAP ACTIVE :: CPL Ring 3 -> Ring 0 (Hardware Gate Open)'
      : step.phase === 'cpu_sysret'
        ? 'SYSRET ACTIVE :: CPL Ring 0 -> Ring 3 (Restoring User rip <- rcx)'
        : isRing0
          ? 'EXECUTING IN RING 0 (KERNEL MODE) :: Full Hardware & RAM Access'
          : 'HARDWARE PRIVILEGE BARRIER :: Ring 3 Blocked From SSD & Kernel RAM';

  const renderOpenFile = (of: OpenFileDesc) => {
    const cacheBadgeClass =
      of.lastCacheEvent === 'miss_ssd_fetch'
        ? 'miss'
        : of.lastCacheEvent === 'hit_page_cache'
          ? 'hit'
          : '';
    const cacheBadgeText =
      of.lastCacheEvent === 'miss_ssd_fetch'
        ? 'SSD -> Page Cache (4KB MISS)'
        : of.lastCacheEvent === 'hit_page_cache'
          ? 'Page Cache HIT (RAM)'
          : of.lastCacheEvent === 'eof'
            ? 'EOF (0 bytes left)'
            : of.cachedPages.length > 0
              ? `Page #${of.cachedPages.join(',')} Cached`
              : 'Page Cache Cold (On SSD)';

    const chars = Array.from(of.content);

    return (
      <div key={of.fd} className="open-file-card">
        <div className="open-file-meta">
          <span>
            <strong>fd={of.fd}</strong> · <span>{of.filename}</span> ·{' '}
            <span style={{ color: 'var(--ink-muted)' }}>struct file {of.structFileAddr}</span>
          </span>
          <span className={`cache-badge ${cacheBadgeClass}`}>{cacheBadgeText}</span>
        </div>

        <div
          className="mono"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px',
            fontSize: '10.5px',
            color: 'var(--ink-secondary)',
            marginBottom: '6px',
          }}
        >
          <span>
            f_pos = <strong style={{ color: 'var(--ink-primary)' }}>{of.fPos}</strong> / {of.content.length} B
          </span>
          <span>inode = {of.inode}</span>
          <span>mode = {of.fMode}</span>
        </div>

        <div className="file-tape" aria-label={`Backing file bytes for ${of.filename}`}>
          {chars.length === 0 ? (
            <span className="tape-eof at-eof">EMPTY FILE (0 B) · EOF at f_pos=0</span>
          ) : (
            <>
              {chars.slice(0, 96).map((ch, idx) => {
                const code = ch.charCodeAt(0);
                const isCopying =
                  of.activeSliceStart !== null &&
                  idx >= of.activeSliceStart &&
                  idx < of.activeSliceStart + of.activeSliceLen;
                const isConsumed = !isCopying && idx < of.fPos;
                const isCursor = idx === of.fPos;

                return (
                  <div
                    key={idx}
                    className={`tape-cell ${isCopying ? 'copying' : isConsumed ? 'consumed' : ''} ${
                      isCursor ? 'fpos-cursor' : ''
                    }`}
                    title={`file offset [${idx}] | char: ${formatEscapedChar(code)} | 0x${code
                      .toString(16)
                      .padStart(2, '0')}`}
                  >
                    <span className="t-idx">{idx}</span>
                    <span>{formatEscapedChar(code)}</span>
                  </div>
                );
              })}
              {chars.length > 96 && (
                <span className="tape-eof">+{chars.length - 96} more B</span>
              )}
              <span className={`tape-eof ${of.fPos >= of.content.length ? 'at-eof' : ''}`}>
                EOF{of.fPos >= of.content.length ? ' <- f_pos' : ''}
              </span>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <section className="schematic-col" aria-label="CPU Hardware Registers and Linux Kernel Internals">
      <div className="col-header">
        <h3 className="col-title">3. CPU Hardware &amp; Linux Kernel</h3>
        <span className="col-addr-hint">x86-64 ABI · Ring 0 (0xffff…)</span>
      </div>

      <div className="col-body">
        {/* CPU CHIP & REGISTER FILE */}
        <div className={`panel-block ${isRing0 ? 'ring0-accent' : 'ring3-accent'}`}>
          <div className={`ring-banner ${isRing0 ? 'ring0' : 'ring3'}`}>
            <span>
              CPU PRIVILEGE: <strong>RING {cpu.ring}</strong> ({isRing0 ? 'KERNEL MODE' : 'USER MODE'})
            </span>
            <span>
              {cpu.errnoValue ? `errno = ${cpu.errnoValue}` : isRing0 ? 'CPL = 00b' : 'CPL = 11b'}
            </span>
          </div>

          <div className="panel-content" style={{ padding: '6px 8px' }}>
            <table className="reg-table" aria-label="x86-64 CPU Registers">
              <thead>
                <tr>
                  <th>Reg</th>
                  <th>64-bit Value (Hex)</th>
                  <th>ABI / Hardware Meaning</th>
                </tr>
              </thead>
              <tbody>
                {cpu.registers.map((reg) => (
                  <tr
                    key={reg.name}
                    className={
                      reg.changed ? `reg-row-changed ${isRing0 ? 'ring0' : ''}` : ''
                    }
                  >
                    <td className="reg-name">{reg.name}</td>
                    <td className="reg-hex">{reg.hex}</td>
                    <td className="reg-meaning">{reg.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {cpu.dataBusTransfer && (
              <div className={`databus-strip kind-${cpu.dataBusTransfer.kind}`}>
                <span>
                  <strong>{cpu.dataBusTransfer.from}</strong> -&gt;{' '}
                  <strong>{cpu.dataBusTransfer.to}</strong>
                </span>
                <span>[{cpu.dataBusTransfer.label}]</span>
              </div>
            )}
          </div>
        </div>

        {/* HARDWARE PRIVILEGE BARRIER */}
        <div className={`privilege-barrier ${barrierClass}`}>
          <span>{barrierLabel}</span>
          <span>MSR_LSTAR</span>
        </div>

        {/* LINUX KERNEL SPACE (RING 0) */}
        <div className="panel-block ring0-accent">
          <div className="panel-head">
            <span className="panel-head-title">Linux Kernel Space (Ring 0 — VFS &amp; Page Cache)</span>
            <span className="panel-head-meta">0xffff800000000000+</span>
          </div>

          <div className="panel-content">
            <div className="kernel-subgrid">
              {/* sys_call_table */}
              <div className="kernel-subbox">
                <div className="subbox-title">sys_call_table[rax]</div>
                {SYSCALL_TABLE_SLICE.map((entry) => (
                  <div
                    key={entry.idx}
                    className={`syscall-row ${kernel.activeSyscallIndex === entry.idx ? 'active' : ''}`}
                  >
                    <span>
                      [{entry.idx}] {entry.name}
                    </span>
                  </div>
                ))}
              </div>

              {/* Process fdtable */}
              <div className="kernel-subbox">
                <div className="subbox-title">task_struct -&gt; files -&gt; fdtable</div>
                {kernel.fdTable.map((row) => {
                  const rowCls =
                    row.isActiveLookup && kernel.lookupStatus === 'valid'
                      ? 'active-valid'
                      : row.isActiveLookup && kernel.lookupStatus === 'ebadf'
                        ? 'active-ebadf'
                        : '';
                  return (
                    <div key={row.fd} className={`fd-row ${rowCls}`}>
                      <span>
                        fd[{row.fd}] {row.label}
                      </span>
                      <span style={{ color: rowCls ? 'inherit' : 'var(--ink-muted)' }}>
                        {row.structFileAddr ? row.structFileAddr.slice(-6) : 'NULL'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* access_ok() Security Verification */}
            <div className={`access-ok-bar ${kernel.accessOkCheck.status === 'pass' ? 'pass' : ''}`}>
              <span>
                <strong>access_ok(rsi, rdx):</strong>{' '}
                {kernel.accessOkCheck.status === 'pass'
                  ? `${kernel.accessOkCheck.address} + ${kernel.accessOkCheck.count} B < ${kernel.accessOkCheck.limit} (User Space OK)`
                  : 'Checks buffer pointer lies strictly in User Space before copy_to_user()'}
              </span>
              <strong>
                {kernel.accessOkCheck.status === 'pass'
                  ? 'PASS'
                  : kernel.lookupStatus === 'ebadf'
                    ? '-EBADF'
                    : 'IDLE'}
              </strong>
            </div>

            {/* Open File Descriptions + Page Cache / SSD Tape */}
            <div>
              <div className="subbox-title" style={{ marginBottom: '5px' }}>
                Open File Description (struct file) · Kernel Page Cache · SSD Backing File
              </div>
              {kernel.openFiles.map(renderOpenFile)}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
