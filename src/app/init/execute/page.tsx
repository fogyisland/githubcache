import { FinalizeClient } from './finalize-client';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ error?: string }>;
}

/**
 * /init/execute — Step 3: run prisma migrate deploy, lock the wizard.
 *
 * The finalize-setup server action (called by FinalizeClient) sets the
 * ghc_setup_done=1 cookie on success and redirects to /login. On error,
 * the action returns the message and we surface it for retry.
 */
export default async function InitExecutePage({ searchParams }: PageProps) {
  const params = await searchParams;
  return (
    <main className="ghc-init">
      <header className="ghc-init-header">
        <span className="ghc-init-step">第 3 / 3 步</span>
        <h1>应用数据库迁移</h1>
        <p className="ghc-init-lede">
          最后一步：运行 Prisma 迁移创建所有数据表，然后锁定 /init 页面，
          引导您前往登录页。
        </p>
      </header>
      <FinalizeClient initialError={params.error} />
    </main>
  );
}