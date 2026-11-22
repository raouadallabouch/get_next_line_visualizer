import React from 'react';

interface InlineCodeTextProps {
  text: string;
}

/** Renders backtick-delimited spans as crisp monospace inline code tags. */
export const InlineCodeText: React.FC<InlineCodeTextProps> = ({ text }) => {
  const parts = text.split(/(`[^`]+`)/g);
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
        return <React.Fragment key={idx}>{part}</React.Fragment>;
      })}
    </>
  );
};
