'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { submitAdminConfig } from '../_actions/submit-admin-config';

const DEFAULT_EMAIL = 'admin@example.com';

export function AdminForm() {
  const router = useRouter();
  const [email, setEmail] = useState(DEFAULT_EMAIL);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('密码至少 8 个字符');
      return;
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    startTransition(async () => {
      const result = await submitAdminConfig({
        email: email.trim().toLowerCase(),
        password,
      });
      if (result.ok) {
        router.push('/init/execute');
      } else {
        setError(result.error ?? '创建失败');
      }
    });
  }

  return (
    <form className="ghc-init-form" onSubmit={onSubmit} noValidate>
      <label className="ghc-init-field">
        <span>邮箱</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          autoFocus
        />
      </label>
      <label className="ghc-init-field">
        <span>密码</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
        />
        <small>≥ 8 个字符</small>
      </label>
      <label className="ghc-init-field">
        <span>再次输入密码</span>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
        />
      </label>
      {error && <div className="ghc-init-error">{error}</div>}
      <div className="ghc-init-actions">
        <button type="submit" className="ghc-btn-primary" disabled={pending}>
          {pending ? '创建中…' : '创建管理员并继续'}
        </button>
      </div>
    </form>
  );
}