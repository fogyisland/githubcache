'use client';

import { useState, type ReactElement } from 'react';
import { useTranslations } from 'next-intl';

interface CopyButtonProps {
  text: string;
  label?: string;
}

export function CopyButton({ text, label }: CopyButtonProps): ReactElement {
  const t = useTranslations('docs.copyButton');
  const fallbackLabel = label ?? t('copy');
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
      aria-label={fallbackLabel}
    >
      {copied ? t('copied') : fallbackLabel}
    </button>
  );
}
