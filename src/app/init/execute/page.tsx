import { FinalizeClient } from './finalize-client';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ error?: string }>;
}

/**
 * /init/execute — Step 3: live checklist (M28.bug17).
 *
 * The FinalizeClient island chains three subtasks:
 *   1. run prisma migrate deploy (creates schema)
 *   2. create admin user (reads stash cookie)
 *   3. lock the wizard (sets ghc_setup_done cookie, redirects to /login)
 *
 * Each row shows pending / running / ok / error as the subtask progresses.
 */
export default async function InitExecutePage({ searchParams }: PageProps) {
  const params = await searchParams;
  return (
    <main className="ghc-init">
      <header className="ghc-init-header">
        <span className="ghc-init-step">第 3 / 3 步</span>
        <h1>应用数据库迁移</h1>
        <p className="ghc-init-lede">
          最后一步：依次完成下列步骤。每项完成后会打勾，所有步骤成功后会自动跳转到登录页。
        </p>
      </header>
      <FinalizeClient initialError={params.error} />
    </main>
  );
}