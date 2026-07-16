import React from 'react';
import { cn } from './utils';

/**
 * WhatsApp-style inline text formatting, rendered as safe React nodes (never
 * dangerouslySetInnerHTML). Supports:
 *   *bold*   _italic_   ~strikethrough~   `monospace`
 *   http(s) links   and   @mentions (highlighted)
 * Non-nested by design — matches how people actually type in a chat.
 */
const TOKEN_RE = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|`[^`\n]+`|https?:\/\/[^\s]+|@[A-Za-z0-9_.]+)/g;

function parseInline(text, keyPrefix, mine) {
  const nodes = [];
  let last = 0;
  let i = 0;
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyPrefix}-${i}`;
    i += 1;
    if (tok.startsWith('*')) nodes.push(<strong key={key}>{tok.slice(1, -1)}</strong>);
    else if (tok.startsWith('_')) nodes.push(<em key={key}>{tok.slice(1, -1)}</em>);
    else if (tok.startsWith('~')) nodes.push(<del key={key}>{tok.slice(1, -1)}</del>);
    else if (tok.startsWith('`'))
      nodes.push(
        <code key={key} className={cn('rounded px-1 py-0.5 font-mono text-[0.85em]', mine ? 'bg-white/20' : 'bg-content/10')}>
          {tok.slice(1, -1)}
        </code>
      );
    else if (tok.startsWith('http'))
      nodes.push(
        <a key={key} href={tok} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:opacity-80">
          {tok}
        </a>
      );
    else if (tok.startsWith('@'))
      nodes.push(
        <span key={key} className={cn('font-semibold', mine ? 'text-white' : 'text-brand-500')}>
          {tok}
        </span>
      );
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Rich, formatted message text. `mine` tints links/mentions/code for the sender's bubble. */
export function Rich({ text, mine = false, className }) {
  if (!text) return null;
  const lines = String(text).split('\n');
  return (
    <p className={cn('whitespace-pre-wrap break-words leading-relaxed', className)}>
      {lines.map((line, idx) => (
        <React.Fragment key={idx}>
          {idx > 0 && <br />}
          {parseInline(line, `l${idx}`, mine)}
        </React.Fragment>
      ))}
    </p>
  );
}
