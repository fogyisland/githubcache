'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { submitDbConfig } from '../_actions/submit-db-config';

interface FormState {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

const DEFAULTS: FormState = {
  host: 'localhost',
  port: '3306',
  user: 'root',
  password: '',
  database: 'githubcache',
};

/**
 * DB config form (M28.bug12 — /init wizard step 1).
 *
 * useTransition lets us show a pending state during the server action
 * without blocking input. The action returns { ok, error? } so we can
 * surface the MySQL error verbatim (it usually has the most useful info:
 * "Access denied", "Unknown host", "Connection refused", ...).
 */
export function DbConfigForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onChange<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const port = Number(form.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError('端口必须是 1-65535 的整数');
      return;
    }
    startTransition(async () => {
      const result = await submitDbConfig({
        host: form.host.trim(),
        port,
        user: form.user.trim(),
        password: form.password,
        database: form.database.trim(),
      });
      if (result.ok) {
        router.push('/init/admin');
      } else {
        setError(result.error ?? '连接失败');
      }
    });
  }

  return (
    <form className="ghc-init-form" onSubmit={onSubmit} noValidate>
      <label className="ghc-init-field">
        <span>主机</span>
        <input
          type="text"
          value={form.host}
          onChange={(e) => onChange('host', e.target.value)}
          required
          autoComplete="off"
          autoFocus
        />
      </label>
      <label className="ghc-init-field">
        <span>端口</span>
        <input
          type="number"
          min={1}
          max={65535}
          value={form.port}
          onChange={(e) => onChange('port', e.target.value)}
          required
          autoComplete="off"
        />
      </label>
      <label className="ghc-init-field">
        <span>用户名</span>
        <input
          type="text"
          value={form.user}
          onChange={(e) => onChange('user', e.target.value)}
          required
          autoComplete="off"
        />
      </label>
      <label className="ghc-init-field">
        <span>密码</span>
        <input
          type="password"
          value={form.password}
          onChange={(e) => onChange('password', e.target.value)}
          autoComplete="off"
        />
      </label>
      <label className="ghc-init-field">
        <span>数据库名</span>
        <input
          type="text"
          value={form.database}
          onChange={(e) => onChange('database', e.target.value)}
          required
          pattern="[a-zA-Z0-9_]+"
          autoComplete="off"
        />
        <small>不存在会自动创建</small>
      </label>
      {error && <div className="ghc-init-error">{error}</div>}
      <div className="ghc-init-actions">
        <button type="submit" className="ghc-btn-primary" disabled={pending}>
          {pending ? '测试连接中…' : '测试连接并保存'}
        </button>
      </div>
    </form>
  );
}