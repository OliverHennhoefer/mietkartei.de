# mietkartei – Anwendung

Die Webanwendung von mietkartei.de, gebaut mit SvelteKit, Drizzle ORM und SQLite. Derselbe Code läuft auf zwei Wegen:

- **Selbst gehostet** mit Node.js oder als Docker-Container. Die Daten liegen in einer einzigen SQLite-Datei, hochgeladene Dokumente als Dateien daneben.
- **Gehostet** auf Cloudflare Workers mit einer D1-Datenbank und den Dokumenten in R2.

Welcher Weg gebaut wird, bestimmt die Umgebungsvariable `DEPLOY_TARGET` (`node` oder `cloudflare`, Standard ist `node`).

> [!IMPORTANT]
> Die Anmeldung ist neu. Betreibe die Anwendung deshalb vorerst nur auf deinem eigenen Rechner oder in einem geschützten Heimnetz.

## Anmeldung

Beim ersten Aufruf legst du ein Konto mit E-Mail-Adresse und Passwort an. Die erste Person übernimmt dabei alle Daten, die vorher schon eingegeben wurden. Danach ist die Registrierung geschlossen. Ist `REGISTRATION_EMAILS` gesetzt, können sich stattdessen nur die dort genannten E-Mail-Adressen registrieren. Auch dann übernimmt die erste Person alle vorhandenen Daten, jede weitere bekommt ein eigenes, leeres Konto.

Unter **Einstellungen → Mitverwalter** lädst du weitere Personen in dein Konto ein, auch wenn die Registrierung geschlossen ist. Sie bekommen eine E-Mail mit einem Link, der sieben Tage gilt. Mitverwalter bearbeiten alles außer Einladungen und Bankverbindungen und dürfen weder exportieren noch das Konto löschen; Vermieter ist nur, wer das Konto angelegt hat. Ein Konto verschickt höchstens 20 Einladungen am Tag.

Fünf falsche Passwörter in 15 Minuten sperren eine E-Mail-Adresse für 15 Minuten. Wer sein Passwort vergessen hat, fordert unter **Passwort vergessen?** einen Link an, der eine Stunde gilt; mehr als drei offene Links gibt es nicht. Eine neue E-Mail-Adresse gilt erst, wenn du den Link bestätigst, den mietkartei an sie schickt; die bisherige Adresse erfährt davon. Wie Mails verschickt werden, bestimmt `MAIL_TRANSPORT` (siehe unten); ohne Angabe stehen sie nur im Log des Servers. Unter **Einstellungen → Protokoll** siehst du, wer wann was geändert hat.

Unter **Einstellungen → Export** lädst du alle Daten deines Kontos als ZIP-Datei herunter: `export.json` mit allen Einträgen (ohne Passwörter) und die hochgeladenen Dokumente im Ordner `documents/`. Unter **Einstellungen → Konto** löschst du dein Konto endgültig, nachdem du dein Passwort noch einmal eingegeben hast. Dabei gehen alle Daten, Dokumente und die Zugänge der Mitverwalter verloren.

## Entwickeln

Voraussetzung ist Node.js 22.12 oder neuer.

```sh
cd app
npm ci
npm run dev
```

Die Anwendung läuft dann unter <http://localhost:5173>. Die Datenbank liegt in `data/mietkartei.db` und erhält beim Start automatisch alle Migrationen, hochgeladene Dokumente liegen in `data/documents`.

Mit `npm run dev:cloudflare` läuft die Entwicklungsumgebung stattdessen gegen eine lokale D1-Datenbank und einen lokalen R2-Bucket.

## Prüfen

```sh
npm run lint          # Prettier und ESLint
npm run check         # Typprüfung mit svelte-check
npm run test:unit     # Unit-Tests mit Vitest
npm run test:e2e      # End-to-End-Tests mit Playwright gegen einen Produktions-Build
DEPLOY_TARGET=cloudflare npm run test:e2e   # dieselben Tests in workerd mit lokaler D1
```

Vor den End-to-End-Tests installiert `npx playwright install chromium` einmalig den Browser. Der Testserver läuft auf Port 4173; mit `E2E_PORT` wählst du einen anderen, etwa um beide Ziele gleichzeitig in zwei Arbeitskopien zu testen.

Der Testserver startet mit `E2E=true`. Damit ist der Endpunkt `/api/e2e/seed` aktiv, über den ein Test anlegt, was er braucht, aber nicht selbst prüft, etwa einen Mietvertrag mit Objekt, Einheit und Mieter (siehe `e2e/seed.ts`). Mails speichert der Testserver mit `MAIL_TRANSPORT=outbox` in der Datenbank, die Tests lesen sie unter `/api/e2e/outbox`. Setze `E2E` nie in einer echten Installation.

## Datenbankschema ändern

Das Schema steht in `src/lib/server/db/schema.ts`. Nach einer Änderung erzeugt `npm run db:generate` eine neue SQL-Migration in `drizzle/`. Committe die Migration zusammen mit dem Schema; die CI prüft, dass beide zusammenpassen.

Auf Node.js spielt die Anwendung neue Migrationen beim Start selbst ein. Für D1 übernimmt das `wrangler d1 migrations apply`.

Solange mietkartei.de in Entwicklung ist, müssen Migrationen keine bestehenden Daten erhalten. Es gibt keine Kompatibilitätsschichten, keine Nachträge für alte Zeilen und keine Rücksicht auf ältere Versionen; eine Migration darf Spalten umbenennen oder Tabellen neu anlegen, wenn das den Code einfacher macht.

Damit dieselben Abfragen auf SQLite und D1 funktionieren, laufen alle Datenbankzugriffe über Drizzle. D1 kennt keine interaktiven Transaktionen; Änderungen über mehrere Anweisungen laufen deshalb über `runBatch` aus `src/lib/server/db/batch.ts`, das auf D1 `db.batch` und auf SQLite eine Transaktion nutzt. D1 erlaubt außerdem höchstens 100 gebundene Parameter je Anweisung; lange Listen teilen `chunk`, `chunkIds` und `rowsPerStatement` auf.

## Mit Docker betreiben

Das Image wird im Stammverzeichnis des Repositorys gebaut, weil es die gemeinsamen Markendateien aus `assets/brand/` verwendet:

```sh
docker build -f app/Dockerfile -t mietkartei .
docker run -d --name mietkartei -p 3000:3000 \
  -v mietkartei-daten:/data \
  mietkartei
```

Die Anwendung ist dann unter <http://localhost:3000> erreichbar. Die Daten liegen im Volume `mietkartei-daten`, die Dokumente darin im Ordner `/data/documents`. Zum Sichern hältst du den Container mit `docker stop mietkartei` an und kopierst den Inhalt von `/data`. Im laufenden Betrieb ist eine Dateikopie nicht zuverlässig, weil SQLite einen Teil der Änderungen in `mietkartei.db-wal` zwischenspeichert.

| Variable              | Bedeutung                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Standard                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `ORIGIN`              | Öffentliche Adresse, unter der die Anwendung aufgerufen wird, etwa `https://mietkartei.example.de` hinter einem Reverse Proxy mit HTTPS. Ohne Angabe gilt `http` mit der aufgerufenen Adresse, zum Beispiel `http://localhost:3000` oder `http://192.168.1.5:3000`; Mails mit Links (Passwort zurücksetzen, Einladungen, neue E-Mail-Adresse) gibt es dann nur über `localhost`, weil der Link sonst einer fremden Adresse aus der Anfrage folgen könnte. | –                                    |
| `DATABASE_PATH`       | Pfad der SQLite-Datei                                                                                                                                                                                                                                                                                                                                                                                                                                     | `/data/mietkartei.db`                |
| `DATA_DIR`            | Ordner der hochgeladenen Dokumente                                                                                                                                                                                                                                                                                                                                                                                                                        | `/data/documents`                    |
| `REGISTRATION_EMAILS` | E-Mail-Adressen, durch Kommas getrennt, die sich registrieren dürfen. Ohne Angabe kann sich nur die erste Person registrieren.                                                                                                                                                                                                                                                                                                                            | –                                    |
| `MAIL_TRANSPORT`      | Wie Mails (Passwort zurücksetzen, Einladungen, neue E-Mail-Adresse) verschickt werden: `console` schreibt sie ins Log, `resend` verschickt sie über [Resend](https://resend.com) mit `MAIL_API_KEY` und `MAIL_FROM`. Ein anderer Wert hält die Anwendung an.                                                                                                                                                                                              | `console`                            |
| `MAIL_API_KEY`        | API-Schlüssel von Resend, nur für `MAIL_TRANSPORT=resend`                                                                                                                                                                                                                                                                                                                                                                                                 | –                                    |
| `MAIL_FROM`           | Absender der Mails, etwa `mietkartei <noreply@example.de>`; die Domain muss bei Resend bestätigt sein                                                                                                                                                                                                                                                                                                                                                     | `mietkartei <noreply@mietkartei.de>` |
| `PORT`                | Port des Servers                                                                                                                                                                                                                                                                                                                                                                                                                                          | `3000`                               |
| `BODY_SIZE_LIMIT`     | Größte erlaubte Anfrage, etwa für Dokumente bis 10 MB                                                                                                                                                                                                                                                                                                                                                                                                     | `12M`                                |
| `ADDRESS_HEADER`      | Header, aus dem hinter einem Reverse Proxy die Adresse der Besucher kommt, etwa `X-Forwarded-For` (dazu `XFF_DEPTH`, die Zahl der Proxys). Ohne Angabe zählt die Begrenzung auf 10 Anmelde-, Registrierungs- und Rücksetzversuche pro Minute für alle Besucher zusammen.                                                                                                                                                                                  | –                                    |

Ohne Docker startet `npm run build && npm start` denselben Server.
