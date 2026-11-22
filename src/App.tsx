import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CodePanel } from './components/CodePanel';
import { EvalCompendiumDrawer } from './components/EvalCompendiumDrawer';
import { FileEditorDrawer } from './components/FileEditorDrawer';
import { HardwareKernelPanel } from './components/HardwareKernelPanel';
import { MemoryPanel } from './components/MemoryPanel';
import { StepNarrative } from './components/StepNarrative';
import { TopBar } from './components/TopBar';
import { TransportBar } from './components/TransportBar';
import { compileTrace } from './engine/compiler';
import { getPresetById } from './engine/presets';
import { Granularity, Mode, SimulationConfig, VirtualFileConfig } from './engine/types';

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

export const App: React.FC = () => {
  const [config, setConfig] = useState<SimulationConfig>(() => presetToConfig('standard'));
  const [granularity, setGranularity] = useState<Granularity>('micro');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(800);
  const [showFileEditor, setShowFileEditor] = useState(false);
  const [showEvalDrawer, setShowEvalDrawer] = useState(false);

  const compiled = useMemo(() => compileTrace(config), [config]);

  const visibleSteps = useMemo(() => {
    if (granularity === 'micro') return compiled.steps;
    return compiled.steps.filter((s) => s.isMacro);
  }, [compiled.steps, granularity]);

  const safeIdx = Math.min(currentIdx, Math.max(0, visibleSteps.length - 1));
  const currentStep = visibleSteps[safeIdx] ?? compiled.steps[0];

  const handleGranularityChange = useCallback(
    (nextGran: Granularity) => {
      if (nextGran === granularity) return;
      const activeStepId = currentStep?.id ?? 0;
      const nextList =
        nextGran === 'micro' ? compiled.steps : compiled.steps.filter((s) => s.isMacro);
      let closest = 0;
      for (let i = 0; i < nextList.length; i++) {
        if (nextList[i].id <= activeStepId) {
          closest = i;
        } else {
          break;
        }
      }
      setGranularity(nextGran);
      setCurrentIdx(closest);
    },
    [granularity, currentStep, compiled.steps]
  );

  const resetTrace = useCallback(() => {
    setIsPlaying(false);
    setCurrentIdx(0);
  }, []);

  const handlePresetSelect = useCallback((presetId: string) => {
    setIsPlaying(false);
    setConfig(presetToConfig(presetId));
    setCurrentIdx(0);
  }, []);

  const handleModeChange = useCallback((mode: Mode) => {
    setIsPlaying(false);
    if (mode === 'bonus') {
      setConfig(presetToConfig('bonus_multi_fd'));
    } else {
      setConfig(presetToConfig('standard'));
    }
    setCurrentIdx(0);
  }, []);

  const handleBufferSizeChange = useCallback((size: number) => {
    setIsPlaying(false);
    setConfig((prev) => ({
      ...prev,
      bufferSize: size,
    }));
    setCurrentIdx(0);
  }, []);

  const handleApplyFileEdits = useCallback(
    (files: VirtualFileConfig[], callSequence: number[]) => {
      setIsPlaying(false);
      setConfig((prev) => ({
        ...prev,
        files,
        callSequence,
        presetId: 'custom',
      }));
      setCurrentIdx(0);
    },
    []
  );

  const stepForward = useCallback(() => {
    setCurrentIdx((idx) => Math.min(visibleSteps.length - 1, idx + 1));
  }, [visibleSteps.length]);

  const stepBack = useCallback(() => {
    setIsPlaying(false);
    setCurrentIdx((idx) => Math.max(0, idx - 1));
  }, []);

  const togglePlay = useCallback(() => {
    setIsPlaying((playing) => {
      if (!playing && safeIdx >= visibleSteps.length - 1) {
        setCurrentIdx(0);
      }
      return !playing;
    });
  }, [safeIdx, visibleSteps.length]);

  const nextSyscall = useCallback(() => {
    setIsPlaying(false);
    for (let i = safeIdx + 1; i < visibleSteps.length; i++) {
      const st = visibleSteps[i];
      if (st.isSyscallMarker || st.phase === 'kernel_io') {
        setCurrentIdx(i);
        return;
      }
    }
    setCurrentIdx(visibleSteps.length - 1);
  }, [safeIdx, visibleSteps]);

  const nextCall = useCallback(() => {
    setIsPlaying(false);
    const curCall = currentStep.callIndex;
    for (let i = safeIdx + 1; i < visibleSteps.length; i++) {
      if (visibleSteps[i].callIndex > curCall) {
        setCurrentIdx(i);
        return;
      }
    }
    setCurrentIdx(visibleSteps.length - 1);
  }, [safeIdx, visibleSteps, currentStep.callIndex]);

  const prevCall = useCallback(() => {
    setIsPlaying(false);
    const curCall = currentStep.callIndex;
    // If already mid-call, jump to start of current call; if at start, jump to previous call
    const startOfCurrent = visibleSteps.findIndex((s) => s.callIndex === curCall);
    if (safeIdx > startOfCurrent && startOfCurrent >= 0) {
      setCurrentIdx(startOfCurrent);
      return;
    }
    const targetCall = Math.max(0, curCall - 1);
    const startOfPrev = visibleSteps.findIndex((s) => s.callIndex === targetCall);
    setCurrentIdx(Math.max(0, startOfPrev));
  }, [safeIdx, visibleSteps, currentStep.callIndex]);

  // Playback interval
  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setCurrentIdx((idx) => {
        if (idx >= visibleSteps.length - 1) {
          setIsPlaying(false);
          return idx;
        }
        return idx + 1;
      });
    }, speedMs);
    return () => window.clearInterval(timer);
  }, [isPlaying, speedMs, visibleSteps.length]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowFileEditor(false);
        setShowEvalDrawer(false);
        return;
      }

      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (showFileEditor || showEvalDrawer) return;

      if (e.key === 'ArrowRight' || e.key === 'l') {
        e.preventDefault();
        setIsPlaying(false);
        stepForward();
      } else if (e.key === 'ArrowLeft' || e.key === 'h') {
        e.preventDefault();
        stepBack();
      } else if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        nextSyscall();
      } else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        nextCall();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        resetTrace();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        handleGranularityChange(granularity === 'micro' ? 'macro' : 'micro');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    showFileEditor,
    showEvalDrawer,
    stepForward,
    stepBack,
    togglePlay,
    nextSyscall,
    nextCall,
    resetTrace,
    handleGranularityChange,
    granularity,
  ]);

  return (
    <div className="app-shell">
      <TopBar
        config={config}
        granularity={granularity}
        onModeChange={handleModeChange}
        onPresetSelect={handlePresetSelect}
        onBufferSizeChange={handleBufferSizeChange}
        onGranularityChange={handleGranularityChange}
        onOpenFileEditor={() => setShowFileEditor(true)}
        onOpenEvalDrawer={() => setShowEvalDrawer(true)}
      />

      <TransportBar
        visibleSteps={visibleSteps}
        currentIdx={safeIdx}
        currentStep={currentStep}
        isPlaying={isPlaying}
        speedMs={speedMs}
        onReset={resetTrace}
        onPrevCall={prevCall}
        onStepBack={stepBack}
        onTogglePlay={togglePlay}
        onStepForward={stepForward}
        onNextSyscall={nextSyscall}
        onNextCall={nextCall}
        onScrub={(idx) => {
          setIsPlaying(false);
          setCurrentIdx(idx);
        }}
        onSpeedChange={setSpeedMs}
      />

      <StepNarrative step={currentStep} truncated={compiled.truncated} />

      <main className="schematic-grid">
        <CodePanel step={currentStep} mode={config.mode} bufferSize={config.bufferSize} />
        <MemoryPanel step={currentStep} />
        <HardwareKernelPanel step={currentStep} />
      </main>

      <footer className="footer-bar">
        <span>
          Shortcuts: <span className="kbd">←</span>/<span className="kbd">→</span> Step ·{' '}
          <span className="kbd">Space</span> Play · <span className="kbd">S</span> Next Syscall ·{' '}
          <span className="kbd">C</span> Next Call · <span className="kbd">M</span> Micro/Macro ·{' '}
          <span className="kbd">R</span> Reset
        </span>
        <span>
          Timeline ticks: <strong style={{ color: 'var(--ring0-ink)' }}>Top Ochre</strong> = SYSCALL ·{' '}
          <strong style={{ color: 'var(--ok-ink)' }}>Bottom Green</strong> = GNL Return
        </span>
      </footer>

      {showFileEditor && (
        <FileEditorDrawer
          config={config}
          onApply={handleApplyFileEdits}
          onClose={() => setShowFileEditor(false)}
        />
      )}

      {showEvalDrawer && (
        <EvalCompendiumDrawer
          onLoadDemoPreset={handlePresetSelect}
          onClose={() => setShowEvalDrawer(false)}
        />
      )}
    </div>
  );
};

export default App;
