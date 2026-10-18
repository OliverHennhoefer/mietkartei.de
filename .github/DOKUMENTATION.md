# Dokumentation pflegen

Die öffentliche Dokumentation wird mit [Zensical](https://zensical.org/docs/) aus `docs/` erzeugt. Die Zieladresse ist `https://docs.mietkartei.de/`. Die Seite beginnt mit einer einzelnen deutschen Baustellenseite; vollständige Anleitungen folgen mit der Anwendung.

## Vorschau und Build

Sobald `zensical.toml` und `docs/requirements.txt` eingerichtet sind, führe die folgenden Befehle im Stammverzeichnis mit Python 3.12 aus:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r docs/requirements.txt
python scripts/prepare_docs_assets.py
zensical serve
```

Unter Windows aktivierst du die Umgebung in PowerShell mit `.venv\Scripts\Activate.ps1`. Die Vorschau ist unter [http://127.0.0.1:8000](http://127.0.0.1:8000) erreichbar. Mit `Ctrl+C` beendest du den Server.

Vor dem Einreichen prüfst du die vollständige Ausgabe:

```sh
python scripts/prepare_docs_assets.py
zensical build --clean --strict
```

Warnungen, etwa ungültige interne Verweise, lassen den Build fehlschlagen. Die erzeugten Dateien in `site/` und `docs/assets/brand/` sowie die lokale Umgebung werden nicht eingecheckt. Prüfe außerdem die Darstellung auf kleinen Bildschirmen sowie in heller und dunkler Darstellung.

Nach Änderungen an den Originalen in `assets/brand/` führst du `python scripts/prepare_docs_assets.py` erneut aus. Eine laufende Vorschau übernimmt die aktualisierten Kopien automatisch. Das Skript arbeitet mit der Python-Standardbibliothek und benötigt keine symbolischen Links.

## Dateien

| Pfad | Aufgabe |
| --- | --- |
| `docs/index.md` | Öffentliche Baustellenseite |
| `assets/brand/` | Gemeinsame Originale der ausgewählten Wortmarken |
| `assets/brand/variants/` | Frühere Gestaltungsvarianten, werden nicht veröffentlicht |
| `docs/assets/stylesheets/` | Gestaltung ausschließlich für die Dokumentation |
| `docs/assets/brand/` | Erzeugte Kopien der ausgewählten Wortmarken |
| `scripts/prepare_docs_assets.py` | Übernahme der gemeinsamen Wortmarken vor Vorschau und Build |
| `docs/requirements.txt` | Festgelegte Zensical-Version |
| `zensical.toml` | Sprache, Domain und Darstellung |
| `.github/workflows/dokumentation.yml` | Pflichtprüfung und Veröffentlichung |

Die Wortmarken verwenden die originalen Konturen von Helvetica Neue Medium. Die Seitenschrift verwendet lokal verfügbare Systemschriften. Die Suche bleibt für die einzelne Baustellenseite ausgeschaltet.

## GitHub Pages und Domain

Wähle in den [Pages-Einstellungen](https://github.com/OliverHennhoefer/mietkartei.de/settings/pages) „GitHub Actions“ als Quelle und `docs.mietkartei.de` als benutzerdefinierte Domain. Aktiviere HTTPS, sobald das Zertifikat verfügbar ist.

Cloudflare verwaltet den DNS-Eintrag `CNAME docs → oliverhennhoefer.github.io`. Für die direkte Auslieferung durch GitHub Pages wird „DNS only“ verwendet. In `zensical.toml` steht `site_url = "https://docs.mietkartei.de/"`.

Jeder Pull Request erhält die Pflichtprüfung „Dokumentation prüfen“. Der eigentliche Zensical-Build läuft bei relevanten Änderungen, sobald die Seite eingerichtet ist. Dazu zählen auch die gemeinsamen Markenressourcen und das Vorbereitungsskript. Nach erfolgreicher Prüfung auf `main` wird bei diesen Änderungen veröffentlicht. Ein manueller Start ist ebenfalls möglich; Veröffentlichungen sind auf `main` beschränkt und laufen nacheinander.
