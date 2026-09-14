import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TerminalFrame } from '@/app/admin/github-tokens/_components/terminal-frame';

describe('TerminalFrame', () => {
  it('renders the title with the count and applies the terminal frame class', () => {
    const html = renderToStaticMarkup(
      <TerminalFrame title="github.tokens" count={3}>
        <p>hello</p>
      </TerminalFrame>,
    );
    expect(html).toContain('class="ghc-term-frame"');
    expect(html).toContain('github.tokens');
    expect(html).toContain('·');
    expect(html).toContain('3');
    expect(html).toContain('<p>hello</p>');
  });

  it('renders the title in upper-case via CSS, not by altering text', () => {
    const html = renderToStaticMarkup(
      <TerminalFrame title="github.tokens" count={0}>
        <></>
      </TerminalFrame>,
    );
    // CSS uppercases visually; the markup keeps the original casing.
    expect(html).toContain('github.tokens');
  });
});
