import React from 'react';

interface InlineCodeTextProps {
  text: string;
}

/** Renders backtick spans as monospace inline code and **bold** spans as strong text. */
export const InlineCodeText: React.FC<InlineCodeTextProps> = ({ text }) => {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, idx) => {
        if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
          return (
            <code key={idx} className="inline-code">
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
          return <strong key={idx}>{part.slice(2, -2)}</strong>;
        }
        return <React.Fragment key={idx}>{part}</React.Fragment>;
      })}
    </>
  );
};
