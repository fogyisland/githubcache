import { DbConfigForm } from './db-config-form';

export const dynamic = 'force-dynamic';

/**
 * /init/db — Step 1: collect MySQL credentials.
 *
 * Server-component shell that just embeds the client form. The form's
 * server action handles the test-connection → write-.env → redirect-to-/init/admin
 * sequence, so this page itself does no I/O.
 */
export default function InitDbPage() {
  return (
    <main className="ghc-init">
      <header className="ghc-init-header">
        <span className="ghc-init-step">第 1 / 3 步</span>
        <h1>数据库连接</h1>
        <p className="ghc-init-lede">
          配置 MySQL 连接信息。系统会用这些信息连接数据库（如不存在会自动创建），
          然后保存到 <code>.env</code> 文件。
        </p>
      </header>
      <DbConfigForm />
    </main>
  );
}