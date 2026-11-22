import React from 'react';
import { TraceStep } from '../engine/types';
import { InlineCodeText } from './InlineCodeText';

interface StepNarrativeProps {
  step: TraceStep;
  truncated: boolean;
}

const PHASE_LABELS: Record<TraceStep['phase'], string> = {
  program_start: 'ELF LOADED',
  user_c: 'USER SPACE · C',
  libc_prep: 'LIBC WRAPPER · ABI',
  cpu_syscall: 'HW TRAP · SYSCALL',
  kernel_dispatch: 'RING 0 · DISPATCH',
  kernel_validate: 'RING 0 · VALIDATE',
  kernel_io: 'RING 0 · VFS I/O',
  cpu_sysret: 'HW RETURN · SYSRET',
  user_heap: 'USER SPACE · HEAP',
  return: 'FUNCTION RETURN',
};

export const StepNarrative: React.FC<StepNarrativeProps> = ({ step, truncated }) => {
  const isError =
    step.kernel.lookupStatus === 'ebadf' ||
    step.cpu.errnoValue !== null ||
    step.cpu.dataBusTransfer?.kind === 'error';

  const ringClass = isError
    ? 'err'
    : step.phase === 'return'
      ? 'ok'
      : step.cpu.ring === 0
        ? 'ring0'
        : 'ring3';

  return (
    <section className="narrative-strip" aria-label="Current Step Explanation and Eval Note">
      <div className="narrative-main">
        <div className="narrative-meta">
          <span className={`phase-tag ${ringClass}`}>{PHASE_LABELS[step.phase]}</span>
          <span className="phase-tag">
            {step.callIndex === 0 ? 'PRE-CALL' : `CALL #${step.callIndex} · fd=${step.activeFd}`}
          </span>
          <span className="mono" style={{ fontSize: '11px', color: 'var(--ink-muted)' }}>
            {step.cpu.activeInstruction}
          </span>
          {truncated && (
            <span className="phase-tag err">Trace capped at 2,500 steps</span>
          )}
        </div>
        <h2 className="narrative-title">{step.title}</h2>
        <p className="narrative-body">
          <InlineCodeText text={step.explanation} />
        </p>
      </div>

      <aside className="eval-callout" aria-label="42 Evaluation Defense Note">
        <div className="eval-callout-head">
          <span className="eval-kicker">42 Eval Defense Note</span>
          <span className="eval-concept-chip">{step.evalTip.conceptTag}</span>
        </div>
        <p className="eval-q">
          <InlineCodeText text={step.evalTip.question} />
        </p>
        <p className="eval-a">
          <InlineCodeText text={step.evalTip.answer} />
        </p>
      </aside>
    </section>
  );
};
