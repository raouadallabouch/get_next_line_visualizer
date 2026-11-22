import React, { useState } from 'react';
import { CONCEPT_LIST, ConceptEntry, ConceptId } from '../data/concepts';
import { InlineCodeText } from './InlineCodeText';

interface ConceptIndexDrawerProps {
  selectedId: ConceptId;
  onSelectConcept: (id: ConceptId) => void;
  onClose: () => void;
}

const CATEGORIES: ('All' | ConceptEntry['category'])[] = [
  'All',
  'Hardware',
  'User RAM',
  'CPU & Syscall',
  'Linux Kernel',
];

export const ConceptIndexDrawer: React.FC<ConceptIndexDrawerProps> = ({
  selectedId,
  onSelectConcept,
  onClose,
}) => {
  const [cat, setCat] = useState<'All' | ConceptEntry['category']>('All');
  const [search, setSearch] = useState('');

  const items = CONCEPT_LIST.filter((item) => {
    if (cat !== 'All' && item.category !== cat) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      item.title.toLowerCase().includes(q) ||
      item.whatItIs.toLowerCase().includes(q) ||
      item.evalQuestion.toLowerCase().includes(q)
    );
  });

  return (
    <div className="drawer-backdrop" role="dialog" aria-modal="true" aria-label="Concept Glossary">
      <div className="drawer-panel">
        <div className="drawer-header">
          <h2 className="drawer-title">All 20 Core Systems Concepts</h2>
          <button id="btn-close-glossary" type="button" className="ui-btn" onClick={onClose}>
            Close [Esc]
          </button>
        </div>
        <div className="drawer-body">
          <input
            id="input-glossary-search"
            type="text"
            className="text-input"
            placeholder="Search any concept: inode, bss, syscall, fdtable, Page Cache, Ring 0..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="chip-row">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                className={`pill-btn ${cat === c ? 'active' : ''}`}
                onClick={() => setCat(c)}
              >
                {c}
              </button>
            ))}
          </div>

          <div className="glossary-list">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`glossary-card ${selectedId === item.id ? 'selected' : ''}`}
                onClick={() => {
                  onSelectConcept(item.id);
                  onClose();
                }}
              >
                <div className="glossary-card-top">
                  <strong>{item.title}</strong>
                  <span className="glossary-cat">{item.category}</span>
                </div>
                <div className="glossary-card-sub">
                  <InlineCodeText text={item.whatItIs} />
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
