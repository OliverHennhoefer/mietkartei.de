# mietkartei – Anwendung

Die Webanwendung von mietkartei.de, gebaut mit SvelteKit, Drizzle ORM und SQLite. Derselbe Code läuft auf zwei Wegen:

- **Selbst gehostet** mit Node.js oder als Docker-Container. Die Daten liegen in einer einzigen SQLite-Datei.
- **Gehostet** auf Cloudflare Workers mit einer D1-Datenbank.

Welcher Weg gebaut wird, bestimmt die Umgebungsvariable `DEPLOY_TARGET` (`node` oder `cloudflare`, Standard ist `node`).

> [!IMPORTANT]
> Dieser Stand ist ein Prototyp und nicht für echte Daten gedacht. Betreibe ihn nur auf deinem eigenen Rechner oder in einem geschützten Heimnetz.

## Prototyp

Dieser Stand ist ein Prototyp, der die ganze Anwendung in einem Stück zeigt: Objekte, Mieter, Mietverträge, Mietkonto, Bankabgleich, Kaution, Miethöhe mit Index- und Staffelmiete, Betriebskosten mit Abrechnung, CO₂-Aufteilung, Dokumente, Aufgaben und Fristen, Datenübernahme, Mitverwalter, Export und das Abo. Er wird nicht als Ganzes übernommen, sondern in kleinen Schritten. Die Entwurfsentscheidungen und Annahmen stehen in [PROTOTYPE.md](PROTOTYPE.md).

Am schnellsten probierst du ihn so aus: Konto anlegen, dann unter **Einstellungen → Konto** auf **Demodaten anlegen** klicken. Das geht, solange dein Konto noch kein Objekt hat.

Diese Umgebungsvariablen kommen im Prototyp dazu (alle optional):

| Variable                                                        | Wofür                                                                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `MAIL_TRANSPORT`                                                | `console` (Standard) schreibt Mails ins Log, `resend` verschickt sie über Resend mit `MAIL_API_KEY` und `MAIL_FROM` |
| `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` | schalten das Abo der gehosteten Variante ein; im Prototyp nur mit Testschlüsseln (`sk_test_…`)                      |
| `BILLING_REQUIRED`                                              | `true` sperrt das Konto nach der Testphase ohne Abo                                                                 |
| `DATA_DIR`                                                      | Ablage der Dokumente bei Node.js (Standard: neben der Datenbank)                                                    |

Ohne Stripe-Variablen gibt es kein Abo; eine selbst gehostete Installation sieht davon nichts.

## Anmeldung

Beim ersten Aufruf legst du ein Konto mit E-Mail-Adresse und Passwort an. Die erste Person übernimmt dabei alle Daten, die vorher schon eingegeben wurden. Danach ist die Registrierung geschlossen, außer `OPEN_REGISTRATION` ist auf `true` gesetzt; dann bekommt jede neue Person ein eigenes, leeres Konto. Das ist für die gehostete Variante gedacht.

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
  -v mietkartei-daten:/data \
  mietkartei
```

Die Anwendung ist dann unter <http://localhost:3000> erreichbar. Die Daten liegen im Volume `mietkartei-daten`. Zum Sichern hältst du den Container mit `docker stop mietkartei` an und kopierst den Inhalt von `/data`. Im laufenden Betrieb ist eine Dateikopie nicht zuverlässig, weil SQLite einen Teil der Änderungen in `mietkartei.db-wal` zwischenspeichert.

| Variable            | Bedeutung                                                                                                                                                                                                                                                           | Standard              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `ORIGIN`            | Öffentliche Adresse, unter der die Anwendung aufgerufen wird, etwa `https://mietkartei.example.de` hinter einem Reverse Proxy mit HTTPS. Ohne Angabe gilt `http` mit der aufgerufenen Adresse, zum Beispiel `http://localhost:3000` oder `http://192.168.1.5:3000`. | –                     |
| `DATABASE_PATH`     | Pfad der SQLite-Datei                                                                                                                                                                                                                                               | `/data/mietkartei.db` |
| `OPEN_REGISTRATION` | `true` erlaubt allen, ein neues Konto anzulegen. Sonst kann sich nur die erste Person registrieren.                                                                                                                                                                 | –                     |
| `PORT`              | Port des Servers                                                                                                                                                                                                                                                    | `3000`                |

Ohne Docker startet `npm run build && npm start` denselben Server.
