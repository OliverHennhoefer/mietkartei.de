# mietkartei – Anwendung

Die Webanwendung von mietkartei.de, gebaut mit SvelteKit, Drizzle ORM und SQLite. Derselbe Code läuft auf zwei Wegen:

- **Selbst gehostet** mit Node.js oder als Docker-Container. Die Daten liegen in einer einzigen SQLite-Datei.
- **Gehostet** auf Cloudflare Workers mit einer D1-Datenbank.

Welcher Weg gebaut wird, bestimmt die Umgebungsvariable `DEPLOY_TARGET` (`node` oder `cloudflare`, Standard ist `node`).

> [!IMPORTANT]
> Die Anwendung hat noch keine Anmeldung. Alle Daten gehören zu einem Standardkonto, und jede Person, die die Adresse erreicht, kann sie sehen und ändern. Betreibe sie deshalb vorerst nur auf deinem eigenen Rechner oder in einem geschützten Heimnetz.

## Entwickeln

Voraussetzung ist Node.js 22.12 oder neuer.

```sh
cd app
npm ci
npm run dev
```

Die Anwendung läuft dann unter <http://localhost:5173>. Die Datenbank liegt in `data/mietkartei.db` und erhält beim Start automatisch alle Migrationen.

Mit `npm run dev:cloudflare` läuft die Entwicklungsumgebung stattdessen gegen eine lokale D1-Datenbank.

## Prüfen

```sh
npm run lint          # Prettier und ESLint
npm run check         # Typprüfung mit svelte-check
npm run test:unit     # Unit-Tests mit Vitest
npm run test:e2e      # End-to-End-Tests mit Playwright gegen einen Produktions-Build
DEPLOY_TARGET=cloudflare npm run test:e2e   # dieselben Tests in workerd mit lokaler D1
```

Vor den End-to-End-Tests installiert `npx playwright install chromium` einmalig den Browser.

## Datenbankschema ändern

Das Schema steht in `src/lib/server/db/schema.ts`. Nach einer Änderung erzeugt `npm run db:generate` eine neue SQL-Migration in `drizzle/`. Committe die Migration zusammen mit dem Schema; die CI prüft, dass beide zusammenpassen.

Auf Node.js spielt die Anwendung neue Migrationen beim Start selbst ein. Für D1 übernimmt das `wrangler d1 migrations apply`.

Damit dieselben Abfragen auf SQLite und D1 funktionieren, laufen alle Datenbankzugriffe über Drizzle. D1 kennt keine interaktiven Transaktionen; Änderungen über mehrere Anweisungen nutzen deshalb `db.batch`.

## Mit Docker betreiben

Das Image wird im Stammverzeichnis des Repositorys gebaut, weil es die gemeinsamen Markendateien aus `assets/brand/` verwendet:

```sh
docker build -f app/Dockerfile -t mietkartei .
docker run -d --name mietkartei -p 3000:3000 \
  -e ORIGIN=http://localhost:3000 \
  -v mietkartei-daten:/data \
  mietkartei
```

Die Anwendung ist dann unter <http://localhost:3000> erreichbar. Die Daten liegen im Volume `mietkartei-daten`. Zum Sichern hältst du den Container mit `docker stop mietkartei` an und kopierst den Inhalt von `/data`. Im laufenden Betrieb ist eine Dateikopie nicht zuverlässig, weil SQLite einen Teil der Änderungen in `mietkartei.db-wal` zwischenspeichert.

| Variable        | Bedeutung                                                                                                                                                                    | Standard              |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `ORIGIN`        | Öffentliche Adresse, unter der die Anwendung aufgerufen wird. Ohne Angabe nimmt SvelteKit `https` und den `Host`-Header an; Formulare über reines `http` schlagen dann fehl. | –                     |
| `DATABASE_PATH` | Pfad der SQLite-Datei                                                                                                                                                        | `/data/mietkartei.db` |
| `PORT`          | Port des Servers                                                                                                                                                             | `3000`                |

Ohne Docker startet `npm run build && npm start` denselben Server.
