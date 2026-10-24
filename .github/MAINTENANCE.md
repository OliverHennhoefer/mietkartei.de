# GitHub templates and project maintenance

## Enabling the templates

GitHub uses the issue and pull request templates from the default branch `main`. Once these files are merged, the four issue forms and the pull request template are available there. The supported locations are described in [GitHub's documentation on templates](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/about-issue-and-pull-request-templates).

| File | Purpose |
| --- | --- |
| `ISSUE_TEMPLATE/01-fehler.yml` | Bug reports with steps to reproduce |
| `ISSUE_TEMPLATE/02-funktionswunsch.yml` | Feature requests with problem and desired outcome |
| `ISSUE_TEMPLATE/03-dokumentation.yml` | Reports of missing or unclear documentation |
| `ISSUE_TEMPLATE/04-frage.yml` | Questions about usage, setup and contributing |
| `ISSUE_TEMPLATE/config.yml` | Form chooser and confidential reporting channels |
| `PULL_REQUEST_TEMPLATE.md` | Description, verification and notes for a contribution |
| `CODEOWNERS` | Review ownership |
| `labels.json` | German labels and their descriptions |
| `workflows/labels.yml` | Creates and updates the labels |
| `workflows/websites.yml` | Checks and deploys homepage and documentation |
| `workflows/scorecard.yml` | Rates the repository's security practices with OpenSSF Scorecard |
| `HOMEPAGE.md` | Preview, build and deployment of the homepage |
| `DOCUMENTATION.md` | Preview, build and deployment of the documentation |
| `DEPLOYMENT.md` | Cloudflare access, domains and hosting migration |
| `dependabot.yml` | Weekly dependency update proposals |
| `release.yml` | Categories for automatically generated release notes |
| `RELEASE_TEMPLATE.md` | Template for a release description, used manually |

[CONTRIBUTING.md](../CONTRIBUTING.md), [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md), [SECURITY.md](../SECURITY.md) and [SUPPORT.md](../SUPPORT.md) describe contributing, conduct, security reports and support.

## Languages

Everything close to code is written in English: code, comments, commits, pull requests, reviews, CI messages, workflow names and the maintainer guides in `.github/`. Everything aimed at users and the community is written in German: the app, website, user documentation, README, CONTRIBUTING, code of conduct, support and security policy, issue forms, labels and release notes.

## Managing labels

Change names, colors and descriptions in [labels.json](labels.json). The workflow "Sync labels" ([labels.yml](workflows/labels.yml)) runs on `main` when this configuration or the workflow itself changes. It can also be started manually under "Actions". GitHub Actions must be enabled in the repository.

The workflow creates missing labels and updates differing entries. Other labels are not deleted. It uses the repository token provided by GitHub and needs read access to contents and write access to issues. The action it uses is pinned to a specific commit.

Keep label names used in the issue forms or in `release.yml` consistent with the configuration. Use "guter einstieg" for well-scoped tasks and "hilfe gesucht" when help is explicitly welcome.

## Keeping GitHub Actions up to date

[dependabot.yml](dependabot.yml) checks the listed dependencies for new versions on Mondays at 07:00 in the Europe/Berlin time zone and opens pull requests when needed. The proposals are labeled "abhängigkeiten" and "wartung". The supported options are listed in the [Dependabot documentation](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference).

Before merging such changes, check them for new permissions and effects on the workflow. Keep the actions in use pinned to specific commit IDs.

## Supply-chain and security checks

`app/.npmrc` sets `ignore-scripts=true`, so no package runs code while it is installed. The native parts the app needs (better-sqlite3, esbuild, workerd) ship prebuilt binaries. A new dependency that only works with its install script needs a deliberate exception, not a change of this setting.

The **Lint, type check and unit tests** job of [app.yml](workflows/app.yml) fails on any advisory for a production dependency, on high or critical advisories for dev tooling, and on packages whose registry signature does not verify. It also refuses an `E2E` variable in `app/wrangler.jsonc`, which would open the seeding routes in production. In the deploy job only the two wrangler steps receive the Cloudflare token.

These repository settings complement the workflow (Settings → Code security):

- Secret scanning with push protection
- Code scanning with CodeQL in the default setup
- Dependabot alerts and Dependabot security updates
- Private vulnerability reporting, as a second channel next to the email address in [SECURITY.md](../SECURITY.md)

[scorecard.yml](workflows/scorecard.yml) runs [OpenSSF Scorecard](https://github.com/ossf/scorecard) after every push to `main`, on Mondays and when branch protection changes. It uploads its findings to code scanning (Security → Code scanning) and publishes the score to the public Scorecard API, which the badge at `https://api.scorecard.dev/projects/github.com/OliverHennhoefer/mietkartei.de/badge` reads. The results are public as soon as the workflow runs.

## Deploying the websites

The workflow [websites.yml](workflows/websites.yml) reports the required check **Check websites** for every pull request. It checks changed files for whitespace errors and builds the affected websites. Changes to the shared brand assets or the workflow file affect both sites. Before the Zensical build, the selected symbols, wordmark combinations and favicon are copied from the shared brand assets.

After relevant changes on `main`, the workflow deploys the homepage and the documentation as separate Cloudflare Workers in the shared GitHub environment **production**. The environment holds the deployment token and the restriction to `main`. A manual run on `main` deploys both sites. The [deployment guide](DEPLOYMENT.md) describes secrets, domains and the migration from GitHub Pages and Cloudflare Workers Builds. The [documentation guide](DOCUMENTATION.md) describes the local preview and the Zensical build.

## Protecting the default branch

Pull requests are required for `main`, including for administrators. With the current single maintainer, no additional approval is required. Before merging, the check "Check websites" must pass against the current state of `main`, and all review conversations must be resolved. GitHub Actions is set as the source of the required check. Direct pushes, force pushes and deleting `main` stay blocked.

The required check runs on every pull request without a path filter, so contributions without website changes are not blocked by a missing status. Application tests will be added together with the application code.

## Publishing a release

Release notes are aimed at users and self-hosters and are therefore written in German.

1. Review the changes planned for the release and their state on the default branch.
2. Label the pull requests accordingly. In particular, mark breaking changes and security fixes.
3. Set `version` in [app/package.json](../app/package.json) (and `npm install` for the lockfile) to the new version without the leading `v`, and merge that change. The app shows it at the bottom of its sidebar, linked to the releases.
4. Create a release draft on GitHub with the intended tag and the correct commit.
5. If needed, copy the [release template](RELEASE_TEMPLATE.md) into the description. GitHub does not insert this file into the release form automatically.
6. Generate the release notes and review them. `release.yml` sorts the entries into German categories; "Weitere Änderungen" collects contributions without a matching category. The behavior is described in [GitHub's documentation on release notes](https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes).
7. Add required upgrade steps and known limitations. Update the supported versions in [SECURITY.md](../SECURITY.md) if needed.
8. Publish the release after a final review.

When changing the confidential reporting channel, keep [SECURITY.md](../SECURITY.md) and [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) consistent.
