<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/brand/mark-white.svg">
  <img src="assets/brand/mark.svg" alt="mietkartei" width="64" height="64">
</picture>

**Vermieten. Mit Überblick.**

Open-Source-Hausverwaltung für Privatvermieter in Deutschland.

[Startseite](https://mietkartei.de) · [Dokumentation](https://docs.mietkartei.de) · [Mitmachen](CONTRIBUTING.md)

[![App](https://github.com/OliverHennhoefer/mietkartei.de/actions/workflows/app.yml/badge.svg)](https://github.com/OliverHennhoefer/mietkartei.de/actions/workflows/app.yml)
[![Testabdeckung](https://codecov.io/gh/OliverHennhoefer/mietkartei.de/graph/badge.svg)](https://codecov.io/gh/OliverHennhoefer/mietkartei.de)
[![Lizenz: AGPL-3.0](https://img.shields.io/badge/Lizenz-AGPL--3.0-111111)](LICENSE)
![Status: im Aufbau](https://img.shields.io/badge/Status-im%20Aufbau-d97706)

</div>

> [!IMPORTANT]
> **mietkartei ist im Aufbau.** Heute kannst du dich anmelden und Objekte mit ihren Einheiten anlegen. Mieter, Mietverträge und die Betriebskostenabrechnung folgen als Nächstes. Verwalte damit bitte noch keine echten Mieterdaten.

## Worum es geht

Wer ein paar Wohnungen vermietet, jongliert oft mit Tabellen, Ordnern und Fristen im Kopf. mietkartei soll das an einem Ort zusammenführen:

- **Objekte, Einheiten und Mieter** mit Verträgen, Kaltmiete, Vorauszahlungen und Kaution
- **Betriebskostenabrechnung** mit Umlageschlüsseln und Zählerständen
- **Deine Daten bleiben bei dir:** selbst gehostet als ein Container mit einer einzigen Datenbankdatei, oder künftig als gehosteter Dienst
- **Offen für alle:** derselbe Code unter AGPL-3.0, egal wer die Anwendung betreibt

## Ausprobieren

Mit Node.js 22 oder neuer:

```sh
git clone https://github.com/OliverHennhoefer/mietkartei.de.git
cd mietkartei.de/app
npm ci
npm run dev
```

Danach läuft die Anwendung unter <http://localhost:5173>. Betrieb mit Docker oder auf Cloudflare sowie alle Prüfbefehle beschreibt [app/README.md](app/README.md).

## Aufbau des Repositorys

| Ordner | Inhalt |
| --- | --- |
| [`app/`](app/) | Die Anwendung: SvelteKit, Drizzle ORM und SQLite, lauffähig mit Node.js, Docker oder Cloudflare Workers |
| [`website/`](website/) | Die Startseite [mietkartei.de](https://mietkartei.de) |
| [`docs/`](docs/) | Die Dokumentation [docs.mietkartei.de](https://docs.mietkartei.de), gebaut mit Zensical |
| [`assets/brand/`](assets/brand/) | Logo, Favicon und Schrift |
| [`.github/`](.github/) | Workflows, Vorlagen sowie Anleitungen zu [Deployment](.github/DEPLOYMENT.md) und [Pflege](.github/MAINTENANCE.md) |

## Mitmachen

Beiträge zu Code, Dokumentation, Gestaltung und Barrierefreiheit sind willkommen. Den Einstieg findest du in [CONTRIBUTING.md](CONTRIBUTING.md); für die Zusammenarbeit gilt unser [Verhaltenskodex](CODE_OF_CONDUCT.md).

[Fehler melden](https://github.com/OliverHennhoefer/mietkartei.de/issues/new?template=01-fehler.yml) · [Funktion vorschlagen](https://github.com/OliverHennhoefer/mietkartei.de/issues/new?template=02-funktionswunsch.yml) · [Frage stellen](SUPPORT.md) · [Sicherheitslücke melden](SECURITY.md)

Issues und Dokumentation schreiben wir auf Deutsch, Code, Commits und Pull Requests auf Englisch.

## Lizenz

[GNU Affero General Public License, Version 3](LICENSE). Beiträge stehen unter derselben Lizenz, eine Contributor License Agreement gibt es nicht. Eine gehostete Variante von mietkartei.de läuft mit genau dem Code aus diesem Repository.
