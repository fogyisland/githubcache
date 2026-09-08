import { AdminForm } from './admin-form';

export const dynamic = 'force-dynamic';

/**
 * /init/admin — Step 2: bootstrap the first admin user.
 *
 * Prisma is required (we already wrote DATABASE_URL in step 1). If the
 * form is submitted but DB is unreachable, the server action returns an
 * error and the form shows it inline.
 */
export default function InitAdminPage() {
  return (
    <main className="ghc-init">
      <header className="ghc-init-header">
        <span className="ghc-init-step">第 2 / 3 步</span>
        <h1>创建管理员账号</h1>
        <p className="ghc-init-lede">
          数据库连接成功。下一步创建一个管理员账号，用于访问
          <code>/admin</code> 控制面板和审批 API key 请求。
        </p>
      </header>
      <AdminForm />
    </main>
  );
}