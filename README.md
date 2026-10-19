# mietkartei.de

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/brand/logo-white.svg">
  <img src="assets/brand/logo.svg" alt="mietkartei" width="200">
</picture>

mietkartei.de entsteht als Open-Source-Hausverwaltung für Privatvermieter in Deutschland. Dieses Repository enthält derzeit die Projektlizenz, das Logo, die öffentliche Startseite, die Grundlagen für die gemeinsame Entwicklung und einen ersten Dokumentationsentwurf. Eine Anleitung für Installation und Betrieb wird mit dem Anwendungscode ergänzt.

## Startseite

Die öffentliche [Startseite unter mietkartei.de](https://mietkartei.de/) informiert über den Projektstand. Der Quelltext liegt in [website/](website/); der Build übernimmt die gemeinsamen Markenressourcen aus `assets/brand/`. Die [Pflegeanleitung](.github/STARTSEITE.md) beschreibt Vorschau und Veröffentlichung auf Cloudflare.

## Dokumentation

Die Dokumentation unter [docs.mietkartei.de](https://docs.mietkartei.de/) beginnt mit einer [deutschen Baustellenseite](docs/index.md). Zensical erzeugt die Seite aus `docs/`. Die [Pflegeanleitung](.github/DOKUMENTATION.md) beschreibt die lokale Vorschau und den Build. Die gemeinsamen Logos und Gestaltungsvarianten liegen in [assets/brand](assets/brand/).

Startseite und Dokumentation werden über einen gemeinsamen GitHub-Actions-Workflow in der Umgebung `production` als getrennte Cloudflare Workers veröffentlicht. Die [Deployment-Anleitung](.github/DEPLOYMENT.md) beschreibt Einrichtung, Domains und automatische Veröffentlichungen nach relevanten Änderungen auf `main`.

## Mitmachen

Beiträge zu Code, Dokumentation, Gestaltung und Barrierefreiheit sind willkommen. Für den Einstieg findest du alle Hinweise in [CONTRIBUTING.md](CONTRIBUTING.md).

| Anliegen | Anlaufstelle |
| --- | --- |
| Fehler melden | [Fehlermeldung erstellen](https://github.com/OliverHennhoefer/mietkartei.de/issues/new?template=01-fehler.yml) |
| Funktion vorschlagen | [Funktionswunsch erstellen](https://github.com/OliverHennhoefer/mietkartei.de/issues/new?template=02-funktionswunsch.yml) |
| Dokumentation verbessern | [Dokumentationshinweis erstellen](https://github.com/OliverHennhoefer/mietkartei.de/issues/new?template=03-dokumentation.yml) |
| Eine Frage stellen | [Hilfe und Unterstützung](SUPPORT.md) |
| Eine Sicherheitslücke melden | [Vertraulicher Meldeweg](SECURITY.md) |

Für die Zusammenarbeit gilt unser [Verhaltenskodex](CODE_OF_CONDUCT.md). Beschreibungen von Issues, Pull Requests und Versionshinweise verfassen wir auf Deutsch.

## Repository herunterladen

```sh
git clone https://github.com/OliverHennhoefer/mietkartei.de.git
cd mietkartei.de
```

## Projektverwaltung

Die GitHub-Vorlagen, Bezeichnungen und Hinweise zur Veröffentlichung von Versionen sind in der [Verwaltungsanleitung](.github/VERWALTUNG.md) beschrieben.

## Lizenz

Der Lizenztext der GNU Affero General Public License, Version 3, steht in [LICENSE](LICENSE).
