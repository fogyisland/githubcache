'use client';

import { useState, useCallback } from 'react';

/**
 * Small client-side "copy to clipboard" affordance for curl examples.
 *
 * No new deps — uses native `navigator.clipboard.writeText`. The button
 * shows a transient "Copied" label for ~1.5s after success; falls back
 * silently if the Clipboard API is unavailable (older browsers, http://,
 * missing permissions). Server components render the curl `<pre>` and
 * pass the command string down to this island.
 */
interface Props {
  text: string;
  label: string;
  copiedLabel: string;
}

export function CopyButton({ text, label, copiedLabel }: Props): React.ReactElement {
  const [copied, setCopied] = useState(false);

  const onClick = useCallback(async (): Promise<void> => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard write blocked — leave button label as-is */
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={onClick}
      className="ghc-getstarted-copy-btn"
      aria-label={label}
    >
      {copied ? copiedLabel : label}
    </button>
  );
}