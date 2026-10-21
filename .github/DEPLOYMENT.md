# Deploying to Cloudflare

The homepage and the documentation live in the same repository and are deployed by a shared workflow in the GitHub environment **production**. Both sites are served by two static Cloudflare Workers. Zensical still builds the documentation; GitHub Pages is no longer needed.

| Address | Worker | GitHub environment | Configuration | Output |
| --- | --- | --- | --- | --- |
| `https://mietkartei.de/` | `mietkartei-de` | `production` | `website/wrangler.toml` | `dist/homepage/` |
| `https://docs.mietkartei.de/` | `mietkartei-de-docs` | `production` | `docs/wrangler.toml` | `site/` |
| `https://app.mietkartei.de/` | `mietkartei-app` | `production` | `app/wrangler.jsonc` | `app/.svelte-kit/cloudflare/` |

The two sites are static. The app is the SvelteKit application with a D1 database and is deployed by its own workflow, see [Deploying the app](#deploying-the-app).

## One-time setup

Complete these steps before merging the migration. Repository changes alone do not switch the existing Cloudflare and GitHub settings.

### 1. Create Cloudflare access for GitHub

1. In Cloudflare, open the API token management and start from **Edit Cloudflare Workers**. For these two static Workers, **Account → Workers Scripts → Edit**, **Account → Account Settings → Read**, **Zone → Workers Routes → Edit** and **Zone → Zone → Read** are sufficient. Restrict the resources to the account in use and the zone **mietkartei.de**. Additional permissions for KV, R2, Containers or Cloudflare Pages are not required.
2. Create the token without an expiry date. Cloudflare shows the generated secret value only once; the freely chosen token name is not a credential.
3. In the repository, open **Settings → Secrets and variables → Actions → New repository secret** and store `CLOUDFLARE_ACCOUNT_ID` with the Cloudflare account ID. The account ID is shown in the Cloudflare account overview and in the dashboard URL.
4. Then store the generated token value from step 2 as the environment secret `CLOUDFLARE_API_TOKEN` in **production**. The token value never belongs in source code, logs or pull request descriptions.

The values belong in GitHub Secrets. Cloudflare's guide describes [tokens and GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/). No further tokens, interactive sign-in in the workflow or additional GitHub tokens are required.

### 2. Set up the GitHub environment

Open **Settings → Environments** and set up **production**. Under **Deployment branches and tags**, choose **Selected branches and tags** and allow only the branch **main**; tags stay excluded. Open **Add environment secret** and store the generated token value as `CLOUDFLARE_API_TOKEN`. The account ID comes from the repository secret in step 1. This makes the deployment token available only to jobs that use the protected environment **production**.

When migrating from **website-production** and **documentation**, **production** including its secret and branch rule must exist before the merge. GitHub does not show stored secret values again; use the original token value. After the merge, check that both deployment jobs in **production** succeed. The previous environments, including **github-pages**, can then be removed. Deleting an environment also deletes its secrets and protection rules.

The required check **Check websites** builds the homepage and the documentation when relevant files change.

### 3. Turn off automatic Cloudflare builds

The existing homepage Worker must be named **mietkartei-de**; the Wrangler configuration uses this name. Open the Worker under **Workers & Pages → Settings → Builds** and turn off the automatic production and preview builds of the previous Git integration, or disconnect the build connection to the repository. The existing Worker and its domain stay in place.

GitHub Actions now handles builds and deployments. The extra workflow that imported Workers Builds checks is no longer needed, because the deployment jobs use their GitHub environments directly. The new documentation Worker does not need a Cloudflare Git integration.

### 4. Switch the documentation domain and deploy

1. Make sure the check on the migration pull request has passed and both secrets are set up.
2. In **Cloudflare → mietkartei.de → DNS → Records**, remove only the previous record **CNAME docs → oliverhennhoefer.github.io**. The root domain stays unchanged.
3. Merge the pull request into **main**. Under **Actions → Websites**, the first run builds and deploys both sites. Wrangler updates **mietkartei-de**, creates **mietkartei-de-docs** and registers `docs.mietkartei.de` as its custom domain.
4. Under **Workers & Pages → mietkartei-de-docs → Settings → Domains & Routes**, check that the custom domain exists and its certificate is active. Then open `https://docs.mietkartei.de/` and check the page, logos and links. The `workers.dev` address printed by Wrangler also lets you check the documentation Worker directly.
5. Once the documentation works through Cloudflare including HTTPS, remove the custom domain in the GitHub Pages settings and stop publishing the previous Pages site. You can then delete the old **github-pages** environment if you like.

An existing CNAME prevents registering a Cloudflare custom domain. Cloudflare then takes over DNS and the certificate; do not create a new CNAME pointing to `workers.dev`. The documentation domain may be briefly unreachable during the switch. Details are in [Cloudflare's guide to custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

## Ongoing deployment

The workflow [websites.yml](workflows/websites.yml) runs for pull requests and after a push to `main`. It detects the changed files and only builds or deploys the affected site:

| Change | Homepage | Documentation |
| --- | --- | --- |
| `website/**`, `scripts/build_homepage.py` | Yes | No |
| `docs/**`, `zensical.toml`, `scripts/prepare_docs_assets.py` | No | Yes |
| `assets/brand/**`, `.github/workflows/websites.yml` | Yes | Yes |
| Other files | No | No |

Deleted files and both sides of a rename are taken into account. The required check runs for every pull request; changes unrelated to the websites need no build. Pull requests deploy nothing and receive no Cloudflare secrets. After the merge, the checked output of the same workflow run is deployed. Production runs on the same branch are processed one after another in full; up to 100 runs can wait without displacing a run that was already waiting. Within one run, the two deployment jobs can run in parallel. For pull requests, a new run still replaces an outdated check.

For a full redeploy, choose **Actions → Websites → Run workflow → Branch: main**. The manual run builds and deploys both sites. On other branches it only checks the builds.

## Failures and rolling back to the previous hosting

Missing secrets or insufficient token permissions make the respective deployment job fail. A failure on one site does not prevent deploying the other, as long as the shared build check passed. Re-run the failed job after fixing the cause, or start the workflow on `main` again.

If the domain does not point to Cloudflare yet, first check that the old `docs` CNAME was removed and the custom domain was registered. To roll back to GitHub Pages, remove the custom domain from the documentation Worker and restore the previous CNAME with **DNS only** as well as the GitHub Pages domain. The previous Pages deployment stays available until the switch succeeds; future Pages deployments would also require restoring the earlier workflow.

## Deploying the app

The job **Deploy app** in [app.yml](workflows/app.yml) runs after every push to `main` that changes `app/**`, once lint, type check, unit tests and both end-to-end runs have passed. Uploaded documents are kept in the R2 bucket `mietkartei-documents`. The job builds the cloudflare target, applies new D1 migrations with `wrangler d1 migrations apply DB --remote` and then runs `wrangler deploy`. Migrations only add to the schema, so the previous version keeps working between the two steps. Pull requests and releases deploy nothing. For a redeploy without a change, choose **Actions → App → Run workflow → Branch: main**.

The hosted app sets `OPEN_REGISTRATION=true` in `app/wrangler.jsonc`, so everyone who signs up gets an own, empty account.

### One-time setup

Complete these steps before merging the pull request that adds the job.

1. **Create the database.** In Cloudflare, open **Storage & Databases → D1 → Create database**, name it `mietkartei` and choose the location **Jurisdiction: European Union**. Alternatively run `npx wrangler d1 create mietkartei --jurisdiction eu` in `app/`. Enter the database ID shown afterwards as `database_id` in `app/wrangler.jsonc`. The ID is not a secret.
2. **Extend the token.** Edit the existing API token from step 1 above and add **Account → D1 → Edit**. The other permissions already cover the Worker and its custom domain.
3. **Check the Workers plan.** Hashing a password takes roughly 30 to 60 ms of CPU time, more than the 10 ms per request of the Workers Free plan, so sign-in and registration need **Workers Paid** (USD 5 per month).
4. **Merge and check.** After the merge, check under **Actions → App** that **Deploy app** succeeds. Wrangler creates the Worker `mietkartei-app` and registers `app.mietkartei.de` as its custom domain. Then open `https://app.mietkartei.de/` and register.

### Document storage

Complete these steps before merging the pull request that adds the R2 binding to `app/wrangler.jsonc`; without the bucket, `wrangler deploy` fails.

1. **Create the bucket.** In Cloudflare, open **Storage & Databases → R2 → Create bucket**, name it `mietkartei-documents` and choose the location **Jurisdiction: European Union**. Alternatively run `npx wrangler r2 bucket create mietkartei-documents --jurisdiction eu` in `app/`. The binding names the jurisdiction, so the bucket must be the EU one.
2. **Extend the token.** Edit the API token and add **Account → Workers R2 Storage → Edit**.
