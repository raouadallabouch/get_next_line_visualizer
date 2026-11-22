import React, { useEffect, useState } from 'react';
import { ConceptIndexDrawer } from './components/ConceptIndexDrawer';
import { ConceptInspector } from './components/ConceptInspector';
import { ConceptId } from './data/concepts';
import { LiveFlowDiagram } from './diagrams/LiveFlowDiagram';
import { MemoryMapDiagram } from './diagrams/MemoryMapDiagram';
import { SyscallKernelDiagram } from './diagrams/SyscallKernelDiagram';
import { SystemMapDiagram } from './diagrams/SystemMapDiagram';

type ChapterId = 1 | 2 | 3 | 4;

const CHAPTERS: { id: ChapterId; num: string; label: string; defaultConcept: ConceptId }[] = [
  { id: 1, num: '1', label: 'System Map', defaultConcept: 'ram' },
  { id: 2, num: '2', label: 'Memory Map', defaultConcept: 'buffer_size' },
  { id: 3, num: '3', label: 'Syscall & Kernel', defaultConcept: 'rings' },
  { id: 4, num: '4', label: 'Live GNL Flow', defaultConcept: 'bss' },
];

export const App: React.FC = () => {
  const [chapter, setChapter] = useState<ChapterId>(1);
  const [selectedConcept, setSelectedConcept] = useState<ConceptId>('ram');
  const [showGlossary, setShowGlossary] = useState(false);

  const switchChapter = (next: ChapterId) => {
    setChapter(next);
    const ch = CHAPTERS.find((c) => c.id === next);
    if (ch) setSelectedConcept(ch.defaultConcept);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowGlossary(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app-root">
      {/* Clean Single-Row Guided Navigation Bar */}
      <header className="nav-header">
        <div className="nav-brand">
          <h1 className="nav-title">get_next_line</h1>
          <span className="nav-sub">Visual Systems Mental Model</span>
        </div>

        <nav className="chapter-tabs" aria-label="Guided Visual Chapters">
          {CHAPTERS.map((ch) => (
            <button
              key={ch.id}
              id={`tab-chapter-${ch.id}`}
              type="button"
              className={`chapter-tab ${chapter === ch.id ? 'active' : ''}`}
              onClick={() => switchChapter(ch.id)}
            >
              <span className="chapter-num">{ch.num}</span>
              <span>{ch.label}</span>
            </button>
          ))}
        </nav>

        <button
          id="btn-open-glossary"
          type="button"
          className="ui-btn glossary-btn"
          onClick={() => setShowGlossary(true)}
        >
          All 20 Concepts
        </button>
      </header>

      {/* Main Two-Column Canvas: Interactive Diagram (Left) + Single-Concept Explainer (Right) */}
      <main className="workspace-layout">
        <section className="diagram-column">
          {chapter === 1 && (
            <SystemMapDiagram
              selectedId={selectedConcept}
              onSelectConcept={setSelectedConcept}
              onGoNextChapter={() => switchChapter(2)}
            />
          )}
          {chapter === 2 && (
            <MemoryMapDiagram
              selectedId={selectedConcept}
              onSelectConcept={setSelectedConcept}
              onGoPrevChapter={() => switchChapter(1)}
              onGoNextChapter={() => switchChapter(3)}
            />
          )}
          {chapter === 3 && (
            <SyscallKernelDiagram
              selectedId={selectedConcept}
              onSelectConcept={setSelectedConcept}
              onGoPrevChapter={() => switchChapter(2)}
              onGoNextChapter={() => switchChapter(4)}
            />
          )}
          {chapter === 4 && (
            <LiveFlowDiagram
              selectedId={selectedConcept}
              onSelectConcept={setSelectedConcept}
              onGoPrevChapter={() => switchChapter(3)}
            />
          )}
        </section>

        <ConceptInspector
          selectedId={selectedConcept}
          onSelectConcept={setSelectedConcept}
        />
      </main>

      {showGlossary && (
        <ConceptIndexDrawer
          selectedId={selectedConcept}
          onSelectConcept={setSelectedConcept}
          onClose={() => setShowGlossary(false)}
        />
      )}
    </div>
  );
};

export default App;
