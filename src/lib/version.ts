import packageJson from '../../package.json';

/**
 * M32.7.7-a — Single source of truth for the build's version + project
 * metadata (GitHub repo URL, author name + profile URL).
 *
 * Read from package.json at build time (Next.js inlines the JSON).
 *
 * Lives in src/lib/ (not src/app/) because it's server-only — a client
 * component that imports this would pull the entire package.json into
 * the browser bundle. The pattern is: server-side component reads here
 * and passes the four strings down as props to a `'use client'`
 * component. See `src/app/admin/_components/about-button.tsx`.
 *
 * Exported as a small object so callers can't accidentally mutate the
 * inlined values (and so JSDoc on the type is preserved at the import
 * site).
 */
export interface ProjectMetadata {
  version: string;
  repoUrl: string;
  authorName: string;
  authorUrl: string;
}

const author = packageJson.author as { name: string; url: string };
const repository = packageJson.repository as { url: string };

export const PROJECT_METADATA: ProjectMetadata = {
  version: packageJson.version,
  repoUrl: repository.url,
  authorName: author.name,
  authorUrl: author.url,
};