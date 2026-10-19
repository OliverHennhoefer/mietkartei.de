# Self-hosting the app on a small server

This guide runs the app as a Docker container on a small VPS, for example a netcup VPS piko next to other containers. The app needs one Node process and one SQLite file; at idle it uses roughly 100 MB of RAM.

The app has a basic email and password login, but no password reset or protection against repeated sign-in attempts yet. Until it has those, keep it reachable only through a private network such as Tailscale, never on a public port. The first person to register takes over the existing data; registration closes after that unless `OPEN_REGISTRATION=true`.

## How it fits together

| Part | Where | Credentials |
| --- | --- | --- |
| Image build | GitHub Actions, job **Publish image** in [app.yml](workflows/app.yml), after every push to `main` with passing checks | Built-in `GITHUB_TOKEN`, nothing to set up |
| Image | `ghcr.io/oliverhennhoefer/mietkartei`: `latest` and `sha-<first 7 characters of the commit>` from `main`; `1.2.3` and `1.2` from a published release `v1.2.3` | Public package: none |
| Deployment | By hand from a laptop with SSH access to the server, or automatically after every push to `main` (optional, see [Automatic updates](#automatic-updates-over-tailscale)) | By hand: the laptop's existing SSH key. Automatic: a Tailscale OAuth client in the GitHub environment **vps** |
| Data | Docker volume `mietkartei-data` on the server | – |

GitHub never receives an SSH key. The optional automatic updates reach the server only through Tailscale SSH, limited by the tailnet policy to one user on one machine. The server is never built on, so a small machine is enough.

## One-time setup

### 1. Make the image public

After the first successful **Publish image** run, open the repository on GitHub, then **Packages → mietkartei → Package settings → Change visibility → Public**. New packages start private. A public image needs no `docker login` on the server.

To keep the image private instead, create a classic personal access token with only `read:packages` and run `docker login ghcr.io -u <github-user>` once on the laptop. Registry credentials are sent by the Docker client, so a login on the server does not help pulls started from the laptop.

### 2. Install Tailscale on the server and the laptop

Install Tailscale on both machines and sign in to the same tailnet. Note the server's Tailscale address (`tailscale ip -4`, starts with `100.`). The free Personal plan is sufficient.

### 3. Create a Docker context on the laptop

The server already has Docker. On the laptop, point a Docker context at it over SSH:

```sh
docker context create mietkartei --docker "host=ssh://<user>@<server>"
docker --context mietkartei ps
```

The second command must list the server's containers. The SSH user needs access to the Docker socket on the server.

## Deploying and updating

From a checkout of this repository on the laptop:

```sh
export MIETKARTEI_BIND=100.x.y.z   # the server's Tailscale address
docker --context mietkartei compose -f app/compose.yml pull
docker --context mietkartei compose -f app/compose.yml up -d
```

[compose.yml](../app/compose.yml) is read on the laptop and the container runs on the server. Without `MIETKARTEI_BIND` the port is bound to `127.0.0.1` on the server and is not reachable at all. The app is then available at `http://100.x.y.z:3000` from every device in the tailnet. To pin a version, set `MIETKARTEI_TAG` to a release such as `0.1` (receives patch releases) or `0.1.0`, or to a commit tag such as `sha-c3fd874`; to roll back, set it to an older tag and run `up -d` again.

Migrations run when the container starts. The app needs no secrets so far. Settings that come later belong in an `environment:` entry in the compose file, or, for secrets, in a file on the server with mode `600` passed as `env_file`; never in the repository.

## Automatic updates over Tailscale

The job **Deploy to VPS** in [app.yml](workflows/app.yml) updates the server after every push to `main` that publishes a new image. The runner joins the tailnet with the tag `tag:ci`, copies `app/compose.yml` to `/opt/mietkartei/` and runs `docker compose pull` and `up -d --wait` there as the user `deploy`, pinned to the commit's image `sha-<commit>`. It leaves the tailnet when the job ends. The job stays off until the repository variable `VPS_HOST` exists.

Anyone who can run workflows on `main` can then run Docker commands on the server, which is equivalent to root. Keep the environment **vps** restricted to `main`.

### 1. Prepare the server

```sh
sudo useradd --create-home --groups docker deploy
sudo mkdir -p /opt/mietkartei && sudo chown deploy: /opt/mietkartei
echo "MIETKARTEI_BIND=$(tailscale ip -4)" | sudo -u deploy tee /opt/mietkartei/.env
sudo tailscale set --ssh
```

`tailscale set --ssh` lets Tailscale answer SSH connections that arrive over the tailnet; the server's normal SSH daemon is unaffected. The compose file sets the project name `mietkartei`, so the job takes over the container and the volume `mietkartei-data` started from the laptop.

### 2. Allow the runner in the tailnet policy

In the Tailscale admin console, open **Access controls** and add a tag for the server and one for CI, a grant to the server's SSH port and an SSH rule for the user `deploy`. Then apply `tag:server` to the server under **Machines → … → Edit ACL tags**.

```json
"tagOwners": {
  "tag:ci": ["autogroup:admin"],
  "tag:server": ["autogroup:admin"]
},
"grants": [
  { "src": ["tag:ci"], "dst": ["tag:server"], "ip": ["tcp:22"] }
],
"ssh": [
  { "action": "accept", "src": ["tag:ci"], "dst": ["tag:server"], "users": ["deploy"] }
]
```

Keep your existing rules; these entries are additions. Your own devices keep their access as long as the existing rules cover tagged machines.

### 3. Create the OAuth client

Under **Settings → OAuth clients → Generate OAuth client**, choose the scope **Auth Keys: Write** with the tag `tag:ci`. Tailscale shows the secret only once.

### 4. Configure GitHub

1. **Settings → Environments → New environment** `vps`. Under **Deployment branches and tags**, allow only `main`.
2. In **vps**, add the environment secrets `TS_OAUTH_CLIENT_ID` and `TS_OAUTH_SECRET` from step 3.
3. Under **Settings → Secrets and variables → Actions → Variables**, add the repository variable `VPS_HOST` with the server's MagicDNS name (for example `netcup`) or its Tailscale address.

The next push to `main` that changes the app runs the job. To try it right away, choose **Actions → App → Run workflow** on `main`.

## Backups

All data is in `/data/mietkartei.db` inside the volume. A plain file copy of a running database is not reliable, so make a consistent snapshot with SQLite's `VACUUM INTO` and copy it off the server:

```sh
docker --context mietkartei exec mietkartei-app-1 node -e "
  const fs = require('node:fs');
  fs.rmSync('/data/backup.db', { force: true });
  require('better-sqlite3')('/data/mietkartei.db').exec(\"VACUUM INTO '/data/backup.db'\");
"
docker --context mietkartei cp mietkartei-app-1:/data/backup.db ./mietkartei-$(date +%F).db
```

The compose file sets the project name `mietkartei`, so the container is called `mietkartei-app-1`. To restore, stop the container, copy the backup into the volume as `mietkartei.db`, remove `mietkartei.db-wal` and `mietkartei.db-shm` if present, and start it again.
