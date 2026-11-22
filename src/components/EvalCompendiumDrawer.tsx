import React, { useState } from 'react';
import { EVAL_QUESTIONS } from '../engine/evalKnowledge';
import { EvalQuestionItem } from '../engine/types';
import { InlineCodeText } from './InlineCodeText';

interface EvalCompendiumDrawerProps {
  onLoadDemoPreset: (presetId: string) => void;
  onClose: () => void;
}

const CATEGORIES: ('All' | EvalQuestionItem['category'])[] = [
  'All',
  'Memory',
  'CPU & Syscall',
  'Kernel & VFS',
  '42 Edge Cases',
];

export const EvalCompendiumDrawer: React.FC<EvalCompendiumDrawerProps> = ({
  onLoadDemoPreset,
  onClose,
}) => {
  const [category, setCategory] = useState<'All' | EvalQuestionItem['category']>('All');
  const [query, setQuery] = useState('');

  const filtered = EVAL_QUESTIONS.filter((item) => {
    if (category !== 'All' && item.category !== category) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      item.question.toLowerCase().includes(q) ||
      item.answer.toLowerCase().includes(q) ||
      item.keyTakeaway.toLowerCase().includes(q)
    );
  });

  return (
    <div
      className="drawer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="42 Evaluation Defense Compendium"
    >
      <div className="drawer-panel">
        <div className="drawer-header">
          <h2 className="drawer-title">42 Eval Defense Compendium ({EVAL_QUESTIONS.length} Topics)</h2>
          <button id="btn-close-eval-qa" type="button" className="action-btn" onClick={onClose}>
            Close [Esc]
          </button>
        </div>

        <div className="drawer-body">
          <input
            id="input-eval-search"
            type="text"
            className="select-input"
            style={{ width: '100%' }}
            placeholder="Filter questions (e.g. .bss, access_ok, ulimit, lseek, EBADF, Page Cache)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <div className="eval-filter-row">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`chip-btn ${category === cat ? 'active' : ''}`}
                onClick={() => setCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          {filtered.map((item) => (
            <article key={item.id} className="eval-card">
              <div className="eval-card-cat">{item.category}</div>
              <h3 className="eval-card-q">
                <InlineCodeText text={item.question} />
              </h3>
              <p className="eval-card-a">
                <InlineCodeText text={item.answer} />
              </p>
              <div className="eval-card-footer">
                <span className="eval-takeaway">
                  TL;DR: <InlineCodeText text={item.keyTakeaway} />
                </span>
                <button
                  type="button"
                  className="action-btn"
                  onClick={() => {
                    onLoadDemoPreset(item.demoPresetId);
                    onClose();
                  }}
                >
                  Load Proof Scenario -&gt;
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
};
