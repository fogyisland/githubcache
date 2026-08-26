import type { ReactElement } from 'react';

interface Step {
  number: string;
  title: string;
  body: string;
  diagram: ReactElement;
}

const steps: Step[] = [
  {
    number: '01',
    title: 'You submit owner/repo',
    body:
      'A simple form on the homepage, or a single GET to /api/v1/repos/{owner}/{name} from anywhere.',
    diagram: (
      <svg viewBox="0 0 200 80" width="100%" height="80" aria-hidden="true">
        <rect x="4" y="14" width="120" height="52" rx="6" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <text x="14" y="34" fontFamily="ui-monospace, monospace" fontSize="11" fill="currentColor">torvalds</text>
        <line x1="14" y1="42" x2="116" y2="42" stroke="currentColor" strokeWidth="0.6" />
        <text x="14" y="58" fontFamily="ui-monospace, monospace" fontSize="11" fill="currentColor">linux</text>
        <path d="M128 40 L160 40" stroke="currentColor" strokeWidth="1.2" />
        <path d="M156 36 L160 40 L156 44" stroke="currentColor" strokeWidth="1.2" fill="none" />
        <rect x="164" y="28" width="32" height="24" rx="3" fill="currentColor" opacity="0.18" />
      </svg>
    ),
  },
  {
    number: '02',
    title: 'Cache hit or live fetch',
    body:
      'If the row is fresh, you get it back in milliseconds. Otherwise we call GitHub, write to MySQL, and return the same shape.',
    diagram: (
      <svg viewBox="0 0 200 80" width="100%" height="80" aria-hidden="true">
        <ellipse cx="100" cy="40" rx="78" ry="22" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <text x="56" y="44" fontFamily="ui-monospace, monospace" fontSize="11" fill="currentColor">cache</text>
        <text x="118" y="44" fontFamily="ui-monospace, monospace" fontSize="11" fill="currentColor">GitHub</text>
        <line x1="22" y1="40" x2="36" y2="40" stroke="currentColor" strokeWidth="1.2" />
        <line x1="164" y1="40" x2="178" y2="40" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    ),
  },
  {
    number: '03',
    title: 'JSON response',
    body:
      'The same fields the GitHub REST API returns — id, full_name, stargazers_count, language, default_branch, plus a recursive tree node.',
    diagram: (
      <svg viewBox="0 0 200 80" width="100%" height="80" aria-hidden="true">
        <rect x="4" y="8" width="192" height="64" rx="4" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <text x="12" y="24" fontFamily="ui-monospace, monospace" fontSize="10" fill="currentColor">"id": 2325298,</text>
        <text x="12" y="38" fontFamily="ui-monospace, monospace" fontSize="10" fill="currentColor">"stargazers_count": 172900,</text>
        <text x="12" y="52" fontFamily="ui-monospace, monospace" fontSize="10" fill="currentColor">"language": "C",</text>
        <text x="12" y="66" fontFamily="ui-monospace, monospace" fontSize="10" fill="currentColor">"node": { '{ ... }' }</text>
      </svg>
    ),
  },
];

export function HowItWorks(): ReactElement {
  return (
    <section className="ghc-how-it-works" data-testid="ghc-how-it-works">
      <div className="ghc-section-eyebrow">How it works</div>
      <h2 className="ghc-section-heading">Three steps from request to JSON.</h2>
      <ol className="ghc-how-steps">
        {steps.map((s) => (
          <li key={s.number} className="ghc-how-step">
            <div className="ghc-how-step-number">{s.number}</div>
            <h3 className="ghc-how-step-title">{s.title}</h3>
            <p className="ghc-how-step-body">{s.body}</p>
            <div className="ghc-how-step-diagram">{s.diagram}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}