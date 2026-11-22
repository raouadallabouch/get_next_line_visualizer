import React from 'react';
import { TraceStep } from '../engine/types';

interface TransportBarProps {
  visibleSteps: TraceStep[];
  currentIdx: number;
  currentStep: TraceStep;
  isPlaying: boolean;
  speedMs: number;
  onReset: () => void;
  onPrevCall: () => void;
  onStepBack: () => void;
  onTogglePlay: () => void;
  onStepForward: () => void;
  onNextSyscall: () => void;
  onNextCall: () => void;
  onScrub: (idx: number) => void;
  onSpeedChange: (ms: number) => void;
}

export const TransportBar: React.FC<TransportBarProps> = ({
  visibleSteps,
  currentIdx,
  currentStep,
  isPlaying,
  speedMs,
  onReset,
  onPrevCall,
  onStepBack,
  onTogglePlay,
  onStepForward,
  onNextSyscall,
  onNextCall,
  onScrub,
  onSpeedChange,
}) => {
  const maxIdx = Math.max(0, visibleSteps.length - 1);
  const { cpu, metrics } = currentStep;
  const isFinalStep = currentIdx === maxIdx;

  return (
    <section className="transport-bar" aria-label="Execution Controls and Telemetry">
      <div className="transport-controls">
        <button
          id="btn-reset"
          type="button"
          className="action-btn"
          onClick={onReset}
          disabled={currentIdx === 0}
          title="Reset to step 0 (R)"
        >
          |&lt;
        </button>
        <button
          id="btn-prev-call"
          type="button"
          className="action-btn"
          onClick={onPrevCall}
          disabled={currentIdx === 0}
          title="Previous get_next_line() call"
        >
          &lt;&lt; Call
        </button>
        <button
          id="btn-step-back"
          type="button"
          className="action-btn"
          onClick={onStepBack}
          disabled={currentIdx === 0}
          title="Step backward (Left Arrow)"
        >
          &lt; Back
        </button>
        <button
          id="btn-play-pause"
          type="button"
          className="action-btn primary"
          onClick={onTogglePlay}
          title="Play / Pause (Space)"
        >
          {isPlaying ? 'Pause' : isFinalStep ? 'Replay' : 'Play'}
        </button>
        <button
          id="btn-step-forward"
          type="button"
          className="action-btn"
          onClick={onStepForward}
          disabled={isFinalStep}
          title="Step forward (Right Arrow)"
        >
          Step &gt;
        </button>
        <button
          id="btn-next-syscall"
          type="button"
          className="action-btn"
          onClick={onNextSyscall}
          disabled={isFinalStep}
          title="Jump to next syscall / kernel read (S)"
        >
          Syscall &gt;
        </button>
        <button
          id="btn-next-call"
          type="button"
          className="action-btn"
          onClick={onNextCall}
          disabled={isFinalStep}
          title="Jump to next get_next_line() call (C)"
        >
          Call &gt;&gt;
        </button>

        <select
          id="select-playback-speed"
          className="select-input"
          value={speedMs}
          onChange={(e) => onSpeedChange(Number(e.target.value))}
          aria-label="Playback speed"
        >
          <option value={1400}>0.5x</option>
          <option value={800}>1.0x</option>
          <option value={420}>2.0x</option>
          <option value={180}>4.0x</option>
        </select>
      </div>

      <div className="scrubber-wrap">
        <div className="scrubber-track-box">
          <div className="scrubber-markers" aria-hidden="true">
            {maxIdx > 0 &&
              visibleSteps.map((st, idx) => {
                if (!st.isSyscallMarker && !st.isReturnMarker) return null;
                const pct = (idx / maxIdx) * 100;
                return (
                  <span
                    key={st.id}
                    className={`scrubber-tick ${st.isSyscallMarker ? 'syscall' : 'ret'}`}
                    style={{ left: `${pct}%` }}
                  />
                );
              })}
          </div>
          <input
            id="range-step-scrubber"
            type="range"
            className="scrubber-range"
            min={0}
            max={maxIdx}
            value={currentIdx}
            onChange={(e) => onScrub(Number(e.target.value))}
            aria-label="Execution step timeline"
          />
        </div>
        <span className="step-counter">
          STEP {currentIdx + 1}/{visibleSteps.length}
        </span>
      </div>

      <div className="telemetry-strip">
        <span className={`metric-badge ${cpu.ring === 0 ? 'ring0' : 'ring3'}`}>
          CPL <strong>Ring {cpu.ring}</strong> ({cpu.ring === 0 ? 'Kernel' : 'User'})
        </span>
        <span className="metric-badge">
          Syscalls <strong>{metrics.syscallCount}</strong>
        </span>
        <span className="metric-badge">
          Cache <strong>{metrics.ssdPageFetches}</strong> SSD / <strong>{metrics.pageCacheHits}</strong> Hit
        </span>
        <span
          className={`metric-badge ${isFinalStep && metrics.liveGnlHeapBytes === 0 ? 'ok' : ''}`}
          title="Internal GNL heap bytes currently live (buffer + .bss stash). Should reach 0 B at EOF/error."
        >
          GNL Heap <strong>{metrics.liveGnlHeapBytes} B</strong>
          {isFinalStep && metrics.liveGnlHeapBytes === 0 ? ' (0 Leaks)' : ''}
        </span>
      </div>
    </section>
  );
};
