import React from 'react';
import { CONCEPTS, ConceptId } from '../data/concepts';
import { InlineCodeText } from './InlineCodeText';

interface ConceptInspectorProps {
  selectedId: ConceptId;
  onSelectConcept: (id: ConceptId) => void;
}

const CATEGORY_CLASS: Record<string, string> = {
  Hardware: 'cat-hw',
  'User RAM': 'cat-user',
  'CPU & Syscall': 'cat-cpu',
  'Linux Kernel': 'cat-kernel',
};

export const ConceptInspector: React.FC<ConceptInspectorProps> = ({
  selectedId,
  onSelectConcept,
}) => {
  const c = CONCEPTS[selectedId];

  return (
    <aside className="concept-inspector" aria-label="Concept Explanation Panel">
      <div className="inspector-hint">
        <span>Click any box on the diagram to inspect it</span>
      </div>

      <div className="inspector-card">
        <div className="inspector-badges">
          <span className={`cat-pill ${CATEGORY_CLASS[c.category]}`}>{c.category}</span>
          <span className="loc-pill">{c.physicalLocation}</span>
        </div>

        <h2 className="inspector-title">{c.title}</h2>
        <p className="inspector-subtitle">{c.subtitle}</p>

        <div className="inspector-section">
          <div className="sec-label">1. What it physically IS</div>
          <p className="sec-text">
            <InlineCodeText text={c.whatItIs} />
          </p>
        </div>

        <div className="inspector-section">
          <div className="sec-label">2. Why it exists</div>
          <p className="sec-text">
            <InlineCodeText text={c.whyItExists} />
          </p>
        </div>

        <div className="inspector-section">
          <div className="sec-label">3. Exact role in get_next_line</div>
          <p className="sec-text">
            <InlineCodeText text={c.roleInGnl} />
          </p>
        </div>

        <div className="inspector-eval-box">
          <div className="sec-label" style={{ color: 'var(--ring0-ink)' }}>
            42 Eval Trap Question
          </div>
          <p className="eval-box-q">
            <InlineCodeText text={c.evalQuestion} />
          </p>
          <p className="eval-box-a">
            <InlineCodeText text={c.evalAnswer} />
          </p>
        </div>

        <div className="inspector-related">
          <div className="sec-label">Jump to connected concepts</div>
          <div className="related-pills">
            {c.related.map((relId) => (
              <button
                key={relId}
                type="button"
                className="related-btn"
                onClick={() => onSelectConcept(relId)}
              >
                {CONCEPTS[relId].title.split(' (')[0]} →
              </button>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
};
