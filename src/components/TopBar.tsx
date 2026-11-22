import React from 'react';
import { SCENARIO_PRESETS } from '../engine/presets';
import { Granularity, Mode, SimulationConfig } from '../engine/types';

interface TopBarProps {
  config: SimulationConfig;
  granularity: Granularity;
  onModeChange: (mode: Mode) => void;
  onPresetSelect: (presetId: string) => void;
  onBufferSizeChange: (size: number) => void;
  onGranularityChange: (g: Granularity) => void;
  onOpenFileEditor: () => void;
  onOpenEvalDrawer: () => void;
}

const BS_CHIPS = [1, 4, 8, 16, 42, 1024];

export const TopBar: React.FC<TopBarProps> = ({
  config,
  granularity,
  onModeChange,
  onPresetSelect,
  onBufferSizeChange,
  onGranularityChange,
  onOpenFileEditor,
  onOpenEvalDrawer,
}) => {
  return (
    <header className="top-bar">
      <div className="brand-block">
        <h1 className="brand-title">get_next_line(fd)</h1>
        <span className="brand-sub">x86-64 · VFS · RAM</span>
      </div>

      <div className="control-group">
        <div className="segmented" role="group" aria-label="42 Subject Mode">
          <button
            id="btn-mode-mandatory"
            type="button"
            className={config.mode === 'mandatory' ? 'active' : ''}
            onClick={() => onModeChange('mandatory')}
          >
            Mandatory
          </button>
          <button
            id="btn-mode-bonus"
            type="button"
            className={config.mode === 'bonus' ? 'active' : ''}
            onClick={() => onModeChange('bonus')}
          >
            Bonus (Multi-FD)
          </button>
        </div>

        <select
          id="select-scenario-preset"
          className="select-input"
          value={config.presetId}
          onChange={(e) => onPresetSelect(e.target.value)}
          aria-label="Scenario preset"
        >
          {SCENARIO_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.shortLabel}
            </option>
          ))}
          {config.presetId === 'custom' && <option value="custom">Custom Input</option>}
        </select>

        <span className="control-label">BS=</span>
        <div className="bs-chips" role="group" aria-label="BUFFER_SIZE quick values">
          {BS_CHIPS.map((bs) => (
            <button
              key={bs}
              id={`btn-bs-${bs}`}
              type="button"
              className={`chip-btn ${config.bufferSize === bs ? 'active' : ''}`}
              onClick={() => onBufferSizeChange(bs)}
            >
              {bs}
            </button>
          ))}
          <input
            id="input-buffer-size"
            type="number"
            min={0}
            max={10000000}
            className="num-input"
            value={config.bufferSize}
            onChange={(e) => {
              const parsed = parseInt(e.target.value, 10);
              if (!Number.isNaN(parsed) && parsed >= 0) {
                onBufferSizeChange(Math.min(10000000, parsed));
              }
            }}
            aria-label="Custom BUFFER_SIZE"
          />
        </div>
      </div>

      <div className="control-group">
        <div className="segmented" role="group" aria-label="Trace Granularity">
          <button
            id="btn-gran-micro"
            type="button"
            className={granularity === 'micro' ? 'active' : ''}
            onClick={() => onGranularityChange('micro')}
            title="Every CPU register load, syscall trap, sys_call_table lookup, Page Cache & sysret"
          >
            Micro (CPU+Kernel)
          </button>
          <button
            id="btn-gran-macro"
            type="button"
            className={granularity === 'macro' ? 'active' : ''}
            onClick={() => onGranularityChange('macro')}
            title="C-level memory & read() milestones"
          >
            Macro (C)
          </button>
        </div>

        <button
          id="btn-open-file-editor"
          type="button"
          className="action-btn"
          onClick={onOpenFileEditor}
        >
          Edit Files
        </button>
        <button
          id="btn-open-eval-qa"
          type="button"
          className="action-btn eval-btn"
          onClick={onOpenEvalDrawer}
        >
          Eval Q&amp;A (13)
        </button>
      </div>
    </header>
  );
};
