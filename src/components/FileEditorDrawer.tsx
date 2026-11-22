import React, { useState } from 'react';
import { SimulationConfig, VirtualFileConfig } from '../engine/types';

interface FileEditorDrawerProps {
  config: SimulationConfig;
  onApply: (files: VirtualFileConfig[], callSequence: number[]) => void;
  onClose: () => void;
}

export const FileEditorDrawer: React.FC<FileEditorDrawerProps> = ({
  config,
  onApply,
  onClose,
}) => {
  const [draftFiles, setDraftFiles] = useState<VirtualFileConfig[]>(() =>
    config.files.map((f) => ({ ...f }))
  );
  const [seqText, setSeqText] = useState<string>(() =>
    config.callSequence.length > 0 ? config.callSequence.join(', ') : ''
  );

  const updateFileContent = (idx: number, content: string) => {
    const capped = content.slice(0, 2048);
    setDraftFiles((prev) =>
      prev.map((f, i) => (i === idx ? { ...f, content: capped } : f))
    );
  };

  const appendNewline = (idx: number) => {
    setDraftFiles((prev) =>
      prev.map((f, i) => (i === idx ? { ...f, content: (f.content + '\n').slice(0, 2048) } : f))
    );
  };

  const handleSave = () => {
    const parsedSeq = seqText
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => parseInt(s, 10))
      .filter((n) => !Number.isNaN(n));

    onApply(draftFiles, parsedSeq);
    onClose();
  };

  return (
    <div className="drawer-backdrop" role="dialog" aria-modal="true" aria-label="Edit Input Files">
      <div className="drawer-panel">
        <div className="drawer-header">
          <h2 className="drawer-title">Virtual Backing File Editor (SSD)</h2>
          <button id="btn-close-file-editor" type="button" className="action-btn" onClick={onClose}>
            Close [Esc]
          </button>
        </div>

        <div className="drawer-body">
          <p style={{ margin: 0, color: 'var(--ink-secondary)', fontSize: '12px' }}>
            Edit the raw bytes stored on the backing file(s). Newlines are real <code>0x0a</code>{' '}
            (<code>\n</code>) bytes. Maximum 2,048 bytes per file to keep micro-step traces instant.
          </p>

          {draftFiles.map((file, idx) => {
            const nlCount = (file.content.match(/\n/g) ?? []).length;
            return (
              <div key={file.fd} className="panel-block">
                <div className="panel-head">
                  <span className="panel-head-title">
                    fd={file.fd} · {file.filename} {file.isOpen ? '(OPEN)' : '(CLOSED -> -EBADF)'}
                  </span>
                  <span className="panel-head-meta">
                    {file.content.length} B · {nlCount} \n
                  </span>
                </div>
                <div className="panel-content">
                  <textarea
                    id={`textarea-file-fd-${file.fd}`}
                    className="editor-textarea"
                    value={file.content}
                    disabled={!file.isOpen}
                    onChange={(e) => updateFileContent(idx, e.target.value)}
                    placeholder="Enter text here... (press Enter for \\n)"
                  />
                  {file.isOpen && (
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginTop: '6px',
                      }}
                    >
                      <button
                        type="button"
                        className="chip-btn"
                        onClick={() => appendNewline(idx)}
                      >
                        + Append \n (0x0a)
                      </button>
                      <button
                        type="button"
                        className="chip-btn"
                        onClick={() => updateFileContent(idx, '')}
                      >
                        Clear (Empty File)
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          <div className="panel-block">
            <div className="panel-head">
              <span className="panel-head-title">Custom Call Sequence (Optional)</span>
              <span className="panel-head-meta">Comma-separated FD list</span>
            </div>
            <div className="panel-content">
              <input
                id="input-call-sequence"
                type="text"
                className="select-input"
                style={{ width: '100%' }}
                value={seqText}
                onChange={(e) => setSeqText(e.target.value)}
                placeholder={
                  config.mode === 'bonus'
                    ? 'e.g. 3, 4, 3, 4, 3, 4'
                    : 'Leave blank to auto-read primary fd until NULL (or enter e.g. 3, 3, -1)'
                }
              />
              <p style={{ margin: '6px 0 0', fontSize: '11px', color: 'var(--ink-muted)' }}>
                Leave empty in Mandatory mode to automatically invoke <code>get_next_line(fd)</code>{' '}
                until it returns <code>NULL</code>. Try entering <code>-1</code> or <code>7</code> to
                trace error paths.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button type="button" className="action-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              id="btn-apply-file-edits"
              type="button"
              className="action-btn primary"
              onClick={handleSave}
            >
              Recompile Trace
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
