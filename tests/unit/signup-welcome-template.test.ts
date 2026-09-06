import { describe, expect, it } from 'vitest';
import { signupWelcomeTemplate } from '@/lib/email/templates/signup-welcome';

describe('signup-welcome email template', () => {
  const user = { email: 'alice@example.com' } as const;

  it('returns subject + html + text with the site name and user email', () => {
    const tpl = signupWelcomeTemplate({
      user,
      loginUrl: 'https://cache.example.com/login',
      siteName: 'Test Site',
    });
    expect(tpl.subject).toContain('Welcome');
    expect(tpl.subject).toContain('Test Site');
    expect(tpl.html).toContain(user.email);
    expect(tpl.html).toContain('https://cache.example.com/login');
    expect(tpl.text).toContain(user.email);
    expect(tpl.text).toContain('/account/keys');
  });

  it('escapes HTML special characters in the email and siteName', () => {
    const tpl = signupWelcomeTemplate({
      user: { email: '<script>alert(1)</script>@x.test' } as never,
      loginUrl: 'https://cache.example.com/login?q=1&r=2',
      siteName: '<b>Cool & Co</b>',
    });
    expect(tpl.html).not.toContain('<script>');
    expect(tpl.html).toContain('&lt;script&gt;');
    expect(tpl.html).toContain('Cool &amp; Co');
    // text version preserves the literal for human reading
    expect(tpl.text).toContain('<script>');
  });

  it('includes the login URL in both html and text', () => {
    const url = 'http://localhost:5002/login';
    const tpl = signupWelcomeTemplate({ user, loginUrl: url });
    expect(tpl.html).toContain(url);
    expect(tpl.text).toContain(url);
  });
});
