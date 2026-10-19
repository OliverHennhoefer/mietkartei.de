# Öffentliche Startseite pflegen

Die statische Baustellenseite unter `https://mietkartei.de/` stellt das Projekt kurz vor und verlinkt auf die Dokumentation. Sie besteht aus HTML und CSS. Geist, Wortmarken und Favicon werden aus den gemeinsamen Markenressourcen übernommen; die Seite benötigt kein JavaScript.

## Vorschau

Führe die folgenden Befehle im Stammverzeichnis mit Python 3 aus:

```sh
python3 scripts/build_homepage.py
python3 -m http.server 8002 --bind 127.0.0.1 --directory dist/homepage
```

Öffne anschließend [http://127.0.0.1:8002](http://127.0.0.1:8002). Nach Änderungen erzeugst du die Ausgabe erneut. Prüfe die Darstellung auf kleinen Bildschirmen und die Verweise zur Dokumentation.

## Dateien

| Pfad | Aufgabe |
| --- | --- |
| `website/index.html` | Öffentliche deutsche Startseite |
| `website/impressum/index.html` | Impressum mit Platzhaltern für Anbieter- und Kontaktdaten |
| `website/styles.css` | Darstellung, einschließlich heller und dunkler Farben |
| `website/assets/house-blueprint.svg` | Dekorative Hauszeichnung für die Startseite |
| `website/_headers` | HTTP-Antwortheader für Cloudflare |
| `website/robots.txt` | Angaben für Suchmaschinen |
| `website/wrangler.toml` | Cloudflare-Worker und benutzerdefinierte Domain |
| `scripts/build_homepage.py` | Erzeugt die öffentliche Ausgabe mit gemeinsamen Ressourcen |
| `.github/workflows/startseite-deployment.yml` | Übernimmt Cloudflare-Buildergebnisse in GitHubs Deployment-Verlauf |
| `dist/homepage/` | Erzeugte Ausgabe; wird nicht eingecheckt |

Der Build übernimmt nur die aufgeführten öffentlichen Dateien, die Hauszeichnung, die beiden Wortmarken, die zwei Geist-Varianten mit invertiertem „kartei“, das Favicon sowie die Originalschrift mit ihrer OFL-Lizenz. Die Schrift und die Marken-SVGs werden in `assets/brand/` gepflegt. Der Startseitenkopf zeigt derzeit die hervorgehobene Gestaltungsvariante aus `assets/brand/variants/`. Seitenspezifische Illustrationen liegen in `website/assets/`.

Das Impressum ist unter `/impressum/` erreichbar. Ersetze die Angaben in eckigen Klammern durch die tatsächlichen Anbieter- und Kontaktdaten und entferne nicht zutreffende optionale Angaben.

## Veröffentlichung

Cloudflare liefert die Seite als statische Assets des Workers **mietkartei-startseite** aus. Die benutzerdefinierte Domain ist `mietkartei.de`. Die Dokumentation bleibt unabhängig davon auf GitHub Pages unter `docs.mietkartei.de`.

Cloudflare Workers Builds ist mit dem Repository verbunden und veröffentlicht den Produktionszweig `main` automatisch. Die Konfiguration verwendet das Repository-Stammverzeichnis, den Build-Befehl `python3 scripts/build_homepage.py` und den Deploy-Befehl `npx wrangler@4 deploy --config website/wrangler.toml`.

Für eine manuelle Veröffentlichung mit einem bereits angemeldeten Wrangler:

```sh
python3 scripts/build_homepage.py
npx wrangler@4 deploy --config website/wrangler.toml
```

## Deployment-Verlauf in GitHub

Der Workflow **Startseiten-Deployment erfassen** übernimmt abgeschlossene Checks mit dem Namen `Workers Builds: mietkartei-startseite` von der GitHub-App `cloudflare-workers-and-pages` (App-ID `85455`). Er prüft über die Check-Suite, dass der Build aus `main` stammt, und erfasst dessen tatsächlichen Commit, Ergebnis und Cloudflare-Protokoll unter **website-production** mit der Zieladresse `https://mietkartei.de`.

Der Workflow startet bei `check_run.completed`. Zusätzlich wartet er nach einem Push auf `main` bis knapp fünf Minuten auf das Cloudflare-Ergebnis, weil GitHub bestimmte `check_run`-Ereignisse zur Vermeidung von Rekursion unterdrückt. Wiederholte Ereignisse verwenden für denselben Check dieselbe Deployment-ID. Vorschau-Builds aus anderen Zweigen sowie übersprungene oder neutrale Checks erzeugen keinen Eintrag.

Die Erfassung verwendet ausschließlich das automatisch bereitgestellte `GITHUB_TOKEN` mit `checks: read` und `deployments: write`. Sie liest das Buildergebnis und schreibt GitHub-Metadaten; Cloudflare führt weiterhin die tatsächliche Bereitstellung aus. Die Dokumentation wird unabhängig davon durch den Workflow **Dokumentation** in der Umgebung **github-pages** veröffentlicht.

Sobald die Workflow-Datei in `main` liegt, wird der nächste Produktionsbuild automatisch erfasst. Einen bereits abgeschlossenen Build des aktuellen `main` kannst du unter **Actions → Startseiten-Deployment erfassen → Run workflow** übernehmen. Falls ein Build länger dauert und die Wartezeit überschritten wird, starte die Erfassung nach seinem Abschluss erneut. Manuelle Wrangler-Deployments außerhalb von Workers Builds liefern keinen solchen Check und werden nicht automatisch übernommen.
