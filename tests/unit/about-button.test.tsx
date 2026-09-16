// @vitest-environment happy-dom
/**
 * M32.7.7-a — About button (admin utility bar)
 *
 * Renders an info icon trigger in the admin utility bar; clicking opens a
 * native <dialog> that surfaces the GitHub repo URL, author name, and
 * current version. Clicking the dialog's close button closes the dialog.
 *
 * Test style: render via react-dom/client + act(); read DOM directly.
 * We patch HTMLDialogElement.showModal / .close because happy-dom does
 * not implement them natively.
 */
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { AboutButton } from '@/app/admin/_components/about-button';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => {
    const dict: Record<string, Record<string, string>> = {
      'admin.shell.about': {
        triggerLabel: 'About this app',
        title: 'About githubcache',
        repoLabel: 'GitHub repository',
        authorLabel: 'Author',
        close: 'Close',
      },
    };
    return (key: string) => dict[ns]?.[key] ?? key;
  },
}));

function patchDialog(): void {
  const proto = HTMLDialogElement.prototype as unknown as {
    showModal: () => void;
    close: () => void;
  };
  proto.showModal = function showModal(this: HTMLDialogElement): void {
    this.open = true;
  };
  proto.close = function close(this: HTMLDialogElement): void {
    this.open = false;
  };
}
patchDialog();

describe('AboutButton', () => {
  // Test fixtures matching the real package.json shape.
  const props = {
    version: '0.1.0',
    repoUrl: 'https://github.com/fogyisland/githubcache.git',
    authorName: 'fogyisland',
    authorUrl: 'https://github.com/fogyisland',
  };

  it('renders a trigger button with the i18n label', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      createRoot(container).render(<AboutButton {...props} />);
    });

    const trigger = document.querySelector(
      'button.ghc-admin-about-trigger',
    ) as HTMLButtonElement | null;
    expect(trigger, 'trigger button must render').toBeTruthy();
    expect(trigger!.getAttribute('aria-label')).toBe('About this app');
    expect(trigger!.getAttribute('title')).toBe('About this app');
  });

  it('opens a dialog on click and shows repo + author + version', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      createRoot(container).render(<AboutButton {...props} />);
    });

    const trigger = document.querySelector(
      'button.ghc-admin-about-trigger',
    ) as HTMLButtonElement | null;
    expect(trigger).toBeTruthy();
    act(() => {
      trigger!.click();
    });

    const dialog = document.querySelector(
      'dialog.ghc-admin-about-dialog',
    ) as HTMLDialogElement | null;
    expect(dialog, 'about dialog must be in the DOM').toBeTruthy();
    expect(dialog!.open, 'dialog must be open after click').toBe(true);

    // Heading
    const heading = dialog!.querySelector('h3');
    expect(heading?.textContent).toBe('About githubcache');

    // Repo link — exact match against package.json repository.url
    const repoLink = dialog!.querySelector(
      'a.ghc-admin-about-repo-link',
    ) as HTMLAnchorElement | null;
    expect(repoLink, 'repo link must render').toBeTruthy();
    expect(repoLink!.getAttribute('href')).toBe(
      'https://github.com/fogyisland/githubcache.git',
    );
    expect(repoLink!.textContent).toContain(
      'github.com/fogyisland/githubcache',
    );

    // Author link to profile
    const authorLink = dialog!.querySelector(
      'a.ghc-admin-about-author-link',
    ) as HTMLAnchorElement | null;
    expect(authorLink, 'author link must render').toBeTruthy();
    expect(authorLink!.textContent).toContain('fogyisland');
    expect(authorLink!.getAttribute('href')).toBe('https://github.com/fogyisland');

    // Version
    const version = dialog!.querySelector('.ghc-admin-about-version');
    expect(version?.textContent).toBe('v0.1.0');
  });

  it('close button hides the dialog', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      createRoot(container).render(<AboutButton {...props} />);
    });

    const trigger = document.querySelector(
      'button.ghc-admin-about-trigger',
    ) as HTMLButtonElement | null;
    act(() => {
      trigger!.click();
    });

    const dialog = document.querySelector(
      'dialog.ghc-admin-about-dialog',
    ) as HTMLDialogElement | null;
    expect(dialog!.open).toBe(true);

    const closeBtn = dialog!.querySelector(
      'button.ghc-admin-about-close',
    ) as HTMLButtonElement | null;
    expect(closeBtn, 'close button must render').toBeTruthy();
    act(() => {
      closeBtn!.click();
    });
    expect(dialog!.open).toBe(false);
  });
});