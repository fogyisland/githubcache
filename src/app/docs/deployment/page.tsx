import type { ReactElement } from 'react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

/**
 * /docs/deployment — environment & operations guide (M26.x).
 *
 * Sits next to /docs/development in the docs sidebar but serves a
 * different audience:
 *   - development: run it locally, fork it, send a PR
 *   - deployment:  env vars, prod hardening, rollout, monitoring
 *
 * Content is i18n-driven; the page reads from `docs.deployment.*` and
 * renders a structured walk-through: prerequisites → env vars →
 * first boot → SMTP setup → GitHub tokens → production hardening →
 * rollouts. Each section uses .ghc-doc-h2 to match the rest of the
 * docs surface.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('docs.deployment.meta');
  return { title: t('title'), description: t('description') };
}

export default async function DeploymentPage(): Promise<ReactElement> {
  const t = await getTranslations('docs.deployment');

  return (
    <article className="ghc-doc-endpoint">
      <p className="ghc-eyebrow">{t('eyebrow')}</p>
      <h1 className="ghc-doc-h1">{t('heading')}</h1>
      <p className="ghc-doc-lede">{t('lede')}</p>

      <Section title={t('prereq.heading')}>
        <ul className="ghc-doc-list">
          <li>{t('prereq.node')}</li>
          <li>{t('prereq.mysql')}</li>
          <li>{t('prereq.reverseProxy')}</li>
          <li>{t('prereq.smtp')}</li>
        </ul>
      </Section>

      <Section title={t('env.heading')}>
        <p>{t('env.intro')}</p>
        <div className="ghc-doc-table-wrap">
          <table className="ghc-doc-table">
            <thead>
              <tr>
                <th scope="col">{t('env.col.var')}</th>
                <th scope="col">{t('env.col.required')}</th>
                <th scope="col">{t('env.col.default')}</th>
                <th scope="col">{t('env.col.notes')}</th>
              </tr>
            </thead>
            <tbody>
              <EnvRow var="DATABASE_URL" required="yes" default="—" notes={t('env.notes.databaseUrl')} />
              <EnvRow var="SESSION_SECRET" required="yes" default="—" notes={t('env.notes.sessionSecret')} />
              <EnvRow var="PORT" required="no" default="5002" notes={t('env.notes.port')} />
              <EnvRow var="NODE_ENV" required="no" default="development" notes={t('env.notes.nodeEnv')} />
              <EnvRow var="LOG_LEVEL" required="no" default="info" notes={t('env.notes.logLevel')} />
              <EnvRow var="SCHEDULER_TICK_MS" required="no" default="60000" notes={t('env.notes.schedulerTick')} />
              <EnvRow var="SCHEDULER_BATCH_SIZE" required="no" default="5" notes={t('env.notes.schedulerBatch')} />
              <EnvRow var="PUBLIC_LOOKUP_RATE_PER_MIN" required="no" default="30" notes={t('env.notes.publicLookup')} />
              <EnvRow var="PUBLIC_REPO_RATE_PER_HOUR" required="no" default="50000" notes={t('env.notes.publicRepo')} />
              <EnvRow var="SIGNUP_RATE_PER_HOUR" required="no" default="50000" notes={t('env.notes.signupRate')} />
              <EnvRow var="GIT_COMMIT" required="no" default="unknown" notes={t('env.notes.gitCommit')} />
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={t('firstBoot.heading')}>
        <ol className="ghc-doc-list">
          <li>
            <code>npm ci --omit=dev</code> &mdash; {t('firstBoot.install')}
          </li>
          <li>
            <code>npx prisma migrate deploy</code> &mdash; {t('firstBoot.migrate')}
          </li>
          <li>
            <code>npm run build</code> &mdash; {t('firstBoot.build')}
          </li>
          <li>
            <code>npm run start:server</code> &mdash; {t('firstBoot.start')}
          </li>
        </ol>
        <p>{t('firstBoot.note')}</p>
      </Section>

      <Section title={t('smtp.heading')}>
        <p>{t('smtp.intro')}</p>
        <ol className="ghc-doc-list">
          <li>{t('smtp.step1')}</li>
          <li>{t('smtp.step2')}</li>
          <li>{t('smtp.step3')}</li>
        </ol>
      </Section>

      <Section title={t('tokens.heading')}>
        <p>{t('tokens.intro')}</p>
        <ol className="ghc-doc-list">
          <li>{t('tokens.step1')}</li>
          <li>{t('tokens.step2')}</li>
          <li>{t('tokens.step3')}</li>
        </ol>
        <p>{t('tokens.note')}</p>
      </Section>

      <Section title={t('prod.heading')}>
        <ul className="ghc-doc-list">
          <li>{t('prod.processManager')}</li>
          <li>{t('prod.reverseProxy')}</li>
          <li>{t('prod.https')}</li>
          <li>{t('prod.logs')}</li>
          <li>{t('prod.backups')}</li>
          <li>{t('prod.scaling')}</li>
        </ul>
      </Section>

      <Section title={t('rollout.heading')}>
        <p>{t('rollout.intro')}</p>
        <ol className="ghc-doc-list">
          <li>{t('rollout.step1')}</li>
          <li>{t('rollout.step2')}</li>
          <li>{t('rollout.step3')}</li>
        </ol>
        <p>{t('rollout.rollback')}</p>
      </Section>

      <Section title={t('monitor.heading')}>
        <p>{t('monitor.intro')}</p>
        <ul className="ghc-doc-list">
          <li>
            <a href="/status">{t('monitor.publicStatus')}</a> &mdash; {t('monitor.publicStatusBody')}
          </li>
          <li>
            <a href="/admin/audit">{t('monitor.auditLog')}</a> &mdash; {t('monitor.auditBody')}
          </li>
          <li>
            <a href="/admin/api/v1/queries">{t('monitor.queries')}</a> &mdash; {t('monitor.queriesBody')}
          </li>
        </ul>
      </Section>
    </article>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): ReactElement {
  return (
    <section className="ghc-doc-section">
      <h2 className="ghc-doc-h2">{title}</h2>
      {children}
    </section>
  );
}

function EnvRow({
  var: varName,
  required,
  default: defaultVal,
  notes,
}: {
  var: string;
  required: 'yes' | 'no';
  default: string;
  notes: string;
}): ReactElement {
  return (
    <tr>
      <td>
        <code>{varName}</code>
      </td>
      <td>{required}</td>
      <td>
        <code>{defaultVal}</code>
      </td>
      <td>{notes}</td>
    </tr>
  );
}
