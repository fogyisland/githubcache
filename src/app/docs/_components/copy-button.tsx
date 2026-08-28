'use client';

import { useState, type ReactElement } from 'react';

interface CopyButtonProps {
  text: string;
  label?: string;
}

export function CopyButton({ text, label = 'Copy' }: CopyButtonProps): ReactElement {
  const [copied, setCopied] = useState(false);
  async function handleClick() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API blocked (insecure context, etc.) — silent failure.
    }
  }
  return (
    <button
      type="button"
      className="ghc-doc-copy"
      onClick={handleClick}
      aria-label={label}
    >
      {copied ? 'Copied!' : label}
    </button>
  );
}
