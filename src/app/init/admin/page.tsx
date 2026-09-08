import { AdminForm } from './admin-form';

export const dynamic = 'force-dynamic';

/**
 * /init/admin — Step 2: stash the bootstrap admin credentials in a cookie.
 *
 * M28.bug14: this step does NOT touch the database OR .env. The email +
 * bcrypt hash are stashed in a short-lived HTTP-only cookie
 * (`ghc_init_admin`, scoped to /init, 10-min max-age). Step 3 reads
 * the cookie, runs `prisma migrate deploy`, creates the user, and
 * deletes the cookie.
 *
 * Splitting it this way avoids the chicken-and-egg of "create user"
 * requiring a schema that doesn't exist yet (because migrate deploy
 * hasn't run) — and keeps .env free of temporary wizard keys.
 */
export default function InitAdminPage() {
  return (
    <main className="ghc-init">
      <header className="ghc-init-header">
        <span className="ghc-init-step">第 2 / 3 步</span>
        <h1>创建管理员账号</h1>
        <p className="ghc-init-lede">
          数据库连接已配置。设置第一个管理员账号——邮箱和密码会临时保存到会话 cookie，
          在下一步执行数据库迁移后自动写入用户表（cookie 随后清除）。
        </p>
      </header>
      <AdminForm />
    </main>
  );
}