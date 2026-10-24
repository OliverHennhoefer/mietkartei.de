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

The job **Deploy app** in [app.yml](workflows/app.yml) runs after every push to `main` that changes `app/**`, once lint, type check, unit tests and both end-to-end runs have passed. Uploaded documents are kept in the R2 bucket `mietkartei-documents`. The job builds the cloudflare target, applies new D1 migrations with `wrangler d1 migrations apply DB --remote` and then runs `wrangler deploy`. While the app is in development, a migration may change or drop existing data, and the previous version can fail for the moments between the two steps. Pull requests and releases deploy nothing. For a redeploy without a change, choose **Actions → App → Run workflow → Branch: main**.

Registration on the hosted app is closed: only the addresses in the Worker secret `REGISTRATION_EMAILS` (comma-separated) can create an account, each once, and only through the link mailed to the address, so knowing a listed address is not enough. Without the secret nobody can, not even into an empty database. To let yourself or someone else in, run `npx wrangler secret put REGISTRATION_EMAILS` in `app/` and enter the addresses, or add the secret under **Workers & Pages → mietkartei-app → Settings → Variables and Secrets** as type **Secret**. The sign-in page links to no registration; open `https://app.mietkartei.de/registrieren` directly.

### One-time setup

Complete these steps before merging the pull request that adds the job.

1. **Create the database.** In Cloudflare, open **Storage & Databases → D1 → Create database**, name it `mietkartei` and choose the location **Jurisdiction: European Union**. Alternatively run `npx wrangler d1 create mietkartei --jurisdiction eu` in `app/`. Enter the database ID shown afterwards as `database_id` in `app/wrangler.jsonc`. The ID is not a secret.
2. **Extend the token.** Edit the existing API token from step 1 above and add **Account → D1 → Edit**. The other permissions already cover the Worker and its custom domain.
3. **Check the Workers plan.** Hashing a password takes roughly 30 to 60 ms of CPU time, more than the 10 ms per request of the Workers Free plan, so sign-in and registration need **Workers Paid** (USD 5 per month).
4. **Merge and check.** After the merge, check under **Actions → App** that **Deploy app** succeeds. Wrangler creates the Worker `mietkartei-app` and registers `app.mietkartei.de` as its custom domain. Then set `REGISTRATION_EMAILS` as described above and register at `https://app.mietkartei.de/registrieren`.

### Document storage

Complete these steps before merging the pull request that adds the R2 binding to `app/wrangler.jsonc`; without the bucket, `wrangler deploy` fails.

1. **Create the bucket.** In Cloudflare, open **Storage & Databases → R2 → Create bucket**, name it `mietkartei-documents` and choose the location **Jurisdiction: European Union**. Alternatively run `npx wrangler r2 bucket create mietkartei-documents --jurisdiction eu` in `app/`. The binding names the jurisdiction, so the bucket must be the EU one.
2. **Extend the token.** Edit the API token and add **Account → Workers R2 Storage → Edit**.

### Public demo

After the app, the same job deploys the demo at `demo.mietkartei.de`: the same build with the `demo` environment of `app/wrangler.jsonc`, as the Worker `mietkartei-demo` with its own D1 database `mietkartei-demo`, its own R2 bucket `mietkartei-demo-documents` and `DEMO=true`. Visitors start a throwaway account with the demo data at `/demo`; demo accounts are deleted 24 hours after they were created, whenever someone starts a new demo. Mails stay in the database and are never sent. The job creates the bucket when it is missing; the database was created by hand and its ID is in `app/wrangler.jsonc`. A failed demo deploy does not affect the app, which deployed before it.

### Bot check on registration (Cloudflare Turnstile)

The registration form shows a Turnstile check once both keys are configured; without them it has none.

1. In Cloudflare, open **Turnstile → Add widget**, name it `mietkartei-app`, add the hostname `app.mietkartei.de` and choose the widget mode **Managed**.
2. Enter the site key as `TURNSTILE_SITE_KEY` under `vars` in `app/wrangler.jsonc`. The site key is public.
3. Store the secret key as a Worker secret: run `npx wrangler secret put TURNSTILE_SECRET_KEY` in `app/` and paste the key, or add it under **Workers & Pages → mietkartei-app → Settings → Variables and Secrets** as type **Secret**.
4. After the next deploy, open `https://app.mietkartei.de/registrieren` in a private window and check that the widget appears.

### Mails (Resend)

The app sends password reset links, invitations and the confirmation of a new email address through [Resend](https://resend.com). `MAIL_TRANSPORT=resend` and the sender `MAIL_FROM=noreply@mietkartei.de` are plain `vars` in `app/wrangler.jsonc`; the API key is a Worker secret. The Worker refuses `MAIL_TRANSPORT=console`, which would write the links into its logs. Until the key is set, inviting someone or changing an email address fails with an error page, and reset links are not sent: the reset form answers as always, because its answer must not tell which addresses have an account, and the Worker log names the failure.

1. In Resend, open **Domains → Add Domain**, enter `mietkartei.de` and choose the region **Ireland (eu-west-1)**. Add the DNS records Resend shows in the Cloudflare DNS of `mietkartei.de` and wait until Resend marks the domain as verified.
2. Open **API Keys → Create API Key**, name it `mietkartei-app`, choose the permission **Sending access** and restrict it to the domain `mietkartei.de`. Resend shows the key only once.
3. Store the key as a Worker secret: run `npx wrangler secret put MAIL_API_KEY` in `app/` and paste the key, or add it under **Workers & Pages → mietkartei-app → Settings → Variables and Secrets** as type **Secret**.
4. After the next deploy, request a reset link for your own address at `https://app.mietkartei.de/passwort-vergessen` and check that the mail arrives.

Links in mails point to the host Cloudflare routed the request to, so the hosted app needs no `ORIGIN`.

### Consumer price index (Destatis)

Index rent proposals need the Verbraucherpreisindex. The app fetches it from the GENESIS web service of Destatis (table 61111-0002, base year 2020 = 100) into one table shared by all accounts, at most every six hours, when someone opens the VPI settings or the Miethöhe tab of a lease. GENESIS has no guest access, so the app needs the API token of a free GENESIS account. Without it the app has no VPI values and refuses index proposals.

1. Register at [genesis.destatis.de](https://genesis.destatis.de) and sign in.
2. Open **Webservice-Schnittstelle (API)**, which GENESIS shows to signed-in users, and copy the API token.
3. Store it as a Worker secret: run `npx wrangler secret put GENESIS_API_TOKEN` in `app/` and paste the token, or add it under **Workers & Pages → mietkartei-app → Settings → Variables and Secrets** as type **Secret**. For index proposals in the demo, add the same secret to `mietkartei-demo` (`npx wrangler secret put GENESIS_API_TOKEN --env demo`).
4. After the next deploy, open `https://app.mietkartei.de/einstellungen/vpi`. The table fills within seconds; a failed fetch is shown on the page with the answer of Destatis and retried 30 minutes later.

The page names Destatis as the source with the Datenlizenz Deutschland – Namensnennung – Version 2.0, as the license requires.

### Subscription (Stripe)

The hosted app charges a monthly subscription through Stripe Checkout and the Stripe Customer Portal. Every account has a 30-day trial; once it ends, `BILLING_REQUIRED` decides whether an account without a running subscription can only read. The app shows nothing about billing until both `STRIPE_SECRET_KEY` and `STRIPE_PRICE_ID` are set, so it can be deployed before Stripe is ready. Set everything up in **test mode** first (the toggle in the Stripe dashboard); live mode repeats the same steps with live keys.

1. **Product and price.** In Stripe, open **Product catalog → Add product**, name it `mietkartei` and add one **recurring** price, **monthly**, in **EUR**, with the amount decided for the subscription and the tax behavior **inclusive** if the amount includes VAT. Do not add a trial to the price: the app passes the rest of the 30-day trial to Checkout. The app reads the amount from Stripe for the subscription page, so a new amount needs a new price, not a code change. Note the price ID (`price_…`).
2. **Customer Portal.** Open **Settings → Billing → Customer portal** and allow customers to update their payment methods, view their invoice history and cancel their subscription. Leave switching plans off; there is only one price. Fill in the business information with the links to the privacy policy and terms, and save.
3. **Webhook.** Open **Developers → Webhooks → Add endpoint** with the URL `https://app.mietkartei.de/api/webhooks/stripe` and the events `checkout.session.completed`, `customer.subscription.updated` and `customer.subscription.deleted`. Other events are only recorded and change nothing. Note the signing secret (`whsec_…`).
4. **API key.** Open **Developers → API keys → Create restricted key**, name it `mietkartei-app` and grant **Write** on Customers, Checkout Sessions, Customer portal and Subscriptions and **Read** on Prices; everything else stays **None**. The standard secret key works too, but can do far more than the app needs. Stripe shows the key only once.
5. **Secrets.** In `app/`, run `npx wrangler secret put STRIPE_SECRET_KEY` and paste the key from step 4, then `npx wrangler secret put STRIPE_WEBHOOK_SECRET` and paste the signing secret from step 3. Alternatively add both under **Workers & Pages → mietkartei-app → Settings → Variables and Secrets** as type **Secret**. Never put either into `app/wrangler.jsonc`.
6. **Price ID.** Enter the price ID from step 1 as `STRIPE_PRICE_ID` under `vars` in `app/wrangler.jsonc`. The price ID is not a secret. This switches the subscription on with the next deploy.
7. **Check.** After the deploy, open `https://app.mietkartei.de/abo`, choose **Abo abschließen** and pay with the test card `4242 4242 4242 4242`. Under **Developers → Webhooks**, the deliveries to the endpoint must answer 200, and the page must show the subscription as **Aktiv**. **Abo verwalten** opens the Customer Portal.
8. **Read-only after the trial.** Add `"BILLING_REQUIRED": "true"` under `vars` only when accounts without a subscription should become read-only after their trial. Without it the app only shows a notice. Reading, the export, signing out, changing the name, email address or password and deleting the account always work.

Deleting an account cancels every subscription of its Stripe customer first. If Stripe does not answer, the account is not deleted and the owner is asked to try again.

Checkout and the Customer Portal send the owner back to the host Cloudflare routed the request to, so the hosted app needs no `ORIGIN` for them either. The app keeps the id of every webhook event it processed for 30 days, well past Stripe's three days of retries, and then deletes it. An account has one Checkout session at a time: opening Checkout again reuses the open one. Should a second subscription reach the webhook all the same while the first still bills, the app cancels the second at once and notes it in the account's change log; a payment already taken for it has to be refunded in the Stripe dashboard.
