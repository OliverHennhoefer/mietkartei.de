# Self-hosting the app on a small server

This guide runs the app as a Docker container on a small VPS, for example a netcup VPS piko next to other containers. The app needs one Node process and one SQLite file; at idle it uses roughly 100 MB of RAM.

The app has a basic email and password login, but no password reset or protection against repeated sign-in attempts yet. Until it has those, keep it reachable only through a private network such as Tailscale, never on a public port. The first person to register takes over the existing data; registration closes after that. With `REGISTRATION_EMAILS` set, only the listed addresses can register instead, each through a link mailed to it (so set up mail and `ORIGIN` first); the first of them still takes over the existing data, every later one gets an empty account.

## How it fits together

| Part | Where | Credentials |
| --- | --- | --- |
| Image build | GitHub Actions, job **Publish image** in [app.yml](workflows/app.yml), after every push to `main` with passing checks | Built-in `GITHUB_TOKEN`, nothing to set up |
| Image | `ghcr.io/oliverhennhoefer/mietkartei`: `latest` and `sha-<first 7 characters of the commit>` from `main`; `1.2.3` and `1.2` from a published release `v1.2.3`. [registry-cleanup.yml](workflows/registry-cleanup.yml) keeps only the ten newest `sha-*` tags | Public package: none |
| Deployment | Started by hand from a laptop with SSH access to the server | The laptop's existing SSH key; it never leaves the laptop |
| Data | Docker volume `mietkartei-data` on the server | – |

GitHub never receives SSH access to the server. The server is never built on, so a small machine is enough.

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

## Backups

All data is in `/data/mietkartei.db` inside the volume, uploaded documents are files in `/data/documents`. A plain file copy of a running database is not reliable, so make a consistent snapshot with SQLite's `VACUUM INTO` and copy it off the server:

```sh
docker --context mietkartei exec mietkartei-app-1 node -e "
  const fs = require('node:fs');
  fs.rmSync('/data/backup.db', { force: true });
  require('better-sqlite3')('/data/mietkartei.db').exec(\"VACUUM INTO '/data/backup.db'\");
"
docker --context mietkartei cp mietkartei-app-1:/data/backup.db ./mietkartei-$(date +%F).db
docker --context mietkartei cp mietkartei-app-1:/data/documents ./mietkartei-documents-$(date +%F)
```

The compose file sets the project name `mietkartei`, so the container is called `mietkartei-app-1`. To restore, stop the container, copy the backup into the volume as `mietkartei.db` and the documents as `documents`, remove `mietkartei.db-wal` and `mietkartei.db-shm` if present, and start it again.
