import React from 'react';
import { TraceStep } from '../engine/types';

interface StagePipelineProps {
  step: TraceStep;
}

interface StageDef {
  index: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  shortNum: string;
  label: string;
  sub: string;
  ring: 3 | 0;
}

const STAGES: StageDef[] = [
  { index: 1, shortNum: '01', label: 'Heap buffer', sub: 'BUFFER_SIZE + 1', ring: 3 },
  { index: 2, shortNum: '02', label: '4 CPU Regs', sub: 'rax rdi rsi rdx', ring: 3 },
  { index: 3, shortNum: '03', label: 'SYSCALL', sub: 'Ring 3 -> 0', ring: 0 },
  { index: 4, shortNum: '04', label: 'Kernel Check', sub: 'table · fd · ptr', ring: 0 },
  { index: 5, shortNum: '05', label: 'SSD/Cache -> RAM', sub: 'copy · f_pos++', ring: 0 },
  { index: 6, shortNum: '06', label: 'SYSRET', sub: 'Ring 0 -> 3', ring: 3 },
  { index: 7, shortNum: '07', label: "'\\0' & Stash", sub: '.bss -> Heap', ring: 3 },
  { index: 8, shortNum: '08', label: 'Line & Leftover', sub: 'free(buf) · ret', ring: 3 },
];

export const StagePipeline: React.FC<StagePipelineProps> = ({ step }) => {
  const activeStage = step.stageIndex;
  const isError =
    step.kernel.lookupStatus === 'ebadf' ||
    step.cpu.errnoValue !== null ||
    step.cpu.dataBusTransfer?.kind === 'error';

  return (
    <nav className="pipeline-bar" aria-label="8-Stage Physical Execution Mental Model">
      <div className="pipeline-track">
        {STAGES.map((stage, idx) => {
          const isActive = activeStage === stage.index;
          const isPast = activeStage > stage.index;
          const stateClass = isActive
            ? isError
              ? 'active err'
              : stage.ring === 0
                ? 'active ring0'
                : 'active ring3'
            : isPast
              ? 'done'
              : '';

          return (
            <React.Fragment key={stage.index}>
              <div className={`pipeline-node ${stateClass}`}>
                <div className="pipeline-node-top">
                  <span className="pipeline-num">{stage.shortNum}</span>
                  <span className="pipeline-ring-tag">R{stage.ring}</span>
                </div>
                <div className="pipeline-label">{stage.label}</div>
                <div className="pipeline-sub">{stage.sub}</div>
              </div>
              {idx < STAGES.length - 1 && (
                <span className="pipeline-arrow" aria-hidden="true">
                  →
                </span>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </nav>
  );
};
