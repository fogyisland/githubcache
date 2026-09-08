import { AdminForm } from './admin-form';

export const dynamic = 'force-dynamic';

/**
 * /init/admin — Step 2: stash the bootstrap admin credentials.
 *
 * M28.bug13: this step does NOT touch the database. The email + bcrypt
 * hash are written into .env as INIT_ADMIN_EMAIL / INIT_ADMIN_PASSWORD_HASH.
 * Step 3 runs `prisma migrate deploy` to create the schema, then reads
 * the stash back, creates the user, and strips the temp keys.
 *
 * Splitting it this way avoids the chicken-and-egg of "create user"
 * requiring a schema that doesn't exist yet (because migrate deploy
 * hasn't run).
 */
export default function InitAdminPage() {
  return (
    <main className="ghc-init">
      <header className="ghc-init-header">
        <span className="ghc-init-step">第 2 / 3 步</span>
        <h1>创建管理员账号</h1>
        <p className="ghc-init-lede">
          数据库连接已配置。设置第一个管理员账号——邮箱和密码会暂存到 <code>.env</code>，
 *          在下一步执行数据库迁移后自动写入用户表。
        </p>
      </header>
      <AdminForm />
    </main>
  );
}