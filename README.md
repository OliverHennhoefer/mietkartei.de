<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/brand/lockup-white.svg">
  <img src="assets/brand/lockup-auto.svg" alt="mietkartei" width="280">
</picture>

### Die Hausverwaltung von Vermietern für Vermieter.

Mieten, Bankumsätze und die Betriebskostenabrechnung für private Vermieter an einem Ort.<br>
Open Source, nachvollziehbar gerechnet, ohne Einarbeitung und direkt mit Claude oder ChatGPT nutzbar.

[![Tests](https://img.shields.io/github/actions/workflow/status/OliverHennhoefer/mietkartei.de/app.yml?branch=main&label=Tests)](https://github.com/OliverHennhoefer/mietkartei.de/actions/workflows/app.yml)
[![Dokumentation](https://img.shields.io/github/actions/workflow/status/OliverHennhoefer/mietkartei.de/websites.yml?branch=main&label=Doku)](https://github.com/OliverHennhoefer/mietkartei.de/actions/workflows/websites.yml)
[![Testabdeckung](https://codecov.io/gh/OliverHennhoefer/mietkartei.de/graph/badge.svg)](https://codecov.io/gh/OliverHennhoefer/mietkartei.de)
[![OpenSSF Scorecard](https://img.shields.io/ossf-scorecard/github.com/OliverHennhoefer/mietkartei.de?label=OpenSSF%20Scorecard)](https://scorecard.dev/viewer/?uri=github.com/OliverHennhoefer/mietkartei.de)
[![Lizenz: AGPL-3.0](https://img.shields.io/badge/Lizenz-AGPL--3.0-111111)](LICENSE)
[![Docker-Image](https://img.shields.io/badge/Docker-ghcr.io-2496ed?logo=docker&logoColor=white)](https://github.com/OliverHennhoefer/mietkartei.de/pkgs/container/mietkartei)

[**▶ Demo ausprobieren**](https://demo.mietkartei.de) · [Startseite](https://mietkartei.de) · [Dokumentation](https://docs.mietkartei.de) · [Mitmachen](CONTRIBUTING.md)

<br>

<a href="https://demo.mietkartei.de"><img src="assets/screenshots/uebersicht.png" alt="Übersicht von mietkartei mit Rückständen, Leerstand, offenen Bankumsätzen und Fristen" width="900"></a>

</div>

## Warum mietkartei?

Gebaut für private Vermieter, von der einzelnen Wohnung bis zu rund zwanzig: zu klein für die großen Verwaltungsprogramme, aber mehr, als eine Excel-Tabelle sauber trägt.

- **Nachvollziehbar gerechnet:** Jede Umlage zeigt ihren Rechenweg. Das hilft, wenn ein Mieter der Abrechnung widerspricht.
- **Kein Lock-in:** Offener Code unter AGPL-3.0 und vollständiger Export. Daten und Software bleiben nutzbar, auch wenn es uns morgen nicht mehr gibt.
- **Kein Datengeschäft:** Die gehostete Version finanziert sich nur über das Abo, nicht über Werbung, Inserate oder deine Daten.
- **Fairer Preis:** Selbst betrieben kostenlos, gehostet 8 € im Monat pauschal, ohne Aufschlag pro Einheit und ohne Zusatzmodule.
- **KI-Anbindung:** Über den MCP-Server fragst du Claude, ChatGPT oder einen anderen Assistenten nach Rückständen, Fristen und Abrechnungen.

## So sieht es aus

**Betriebskostenabrechnung:** Belege erfassen, Umlageschlüssel wählen, fertig. Jeder Mieter sieht, wie sich sein Anteil berechnet, und bekommt die Abrechnung als PDF.

<img src="assets/screenshots/abrechnung-mieter.png" alt="Anteil eines Mieters in der Betriebskostenabrechnung mit Umlageschlüssel je Kostenart" width="900">

**Mietkonto:** Soll und Ist für jeden Mietvertrag. Rückstände stehen oben, Kontoauszüge ordnet mietkartei per Vorschlag den Verträgen zu.

<img src="assets/screenshots/mietkonto.png" alt="Mietkonto mit Saldo, Rückständen und letzter Zahlung je Mietvertrag" width="900">

**KI-Assistenten:** Verbinde Claude, ChatGPT oder einen anderen MCP-Client mit `https://app.mietkartei.de/mcp` und frag: „Wer ist mit der Miete im Rückstand?“ oder „Welche Fristen stehen in den nächsten drei Monaten an?“ Mit Schreibrechten bucht der Assistent auf Wunsch Zahlungen und erfasst Belege. Dieselben Daten gibt es als REST-API. → [KI-Assistenten anbinden](https://docs.mietkartei.de/anleitungen/ki-assistenten/)

**Außerdem dabei:** Objekte und Einheiten · Mieter und Mietverträge mit Kaution · Index- und Staffelmiete · Bankimport mit Zuordnungsregeln · Zähler und Abrechnungskreise · Dokumente · Aufgaben und Fristen · Zugänge für Mitverwalter und mit Lesezugriff · Datenübernahme per CSV · vollständiger Export · Änderungsprotokoll

## Ausprobieren

- **[Demo](https://demo.mietkartei.de):** eigener Beispielbestand mit fertiger Betriebskostenabrechnung, ohne Anmeldung, nach 24 Stunden gelöscht.
- **[Selbst hosten](https://docs.mietkartei.de/selbst-hosten/):** als Docker-Container auf dem eigenen Rechner oder Server.

## Mitmachen

Du vermietest selbst? Dann weißt du am besten, was fehlt. Jede Hilfe zählt: Code, Fehlerberichte, Fachwissen, Texte, Gestaltung, Barrierefreiheit.

**[Einstiegsaufgaben](https://github.com/OliverHennhoefer/mietkartei.de/issues?q=is%3Aissue+is%3Aopen+label%3A%22guter+einstieg%22)** · [Hilfe gesucht](https://github.com/OliverHennhoefer/mietkartei.de/issues?q=is%3Aissue+is%3Aopen+label%3A%22hilfe+gesucht%22) · [Fehler melden](https://github.com/OliverHennhoefer/mietkartei.de/issues/new?template=01-fehler.yml) · [Funktion vorschlagen](https://github.com/OliverHennhoefer/mietkartei.de/issues/new?template=02-funktionswunsch.yml) · [Frage stellen](SUPPORT.md) · [Sicherheitslücke melden](SECURITY.md)

Los geht's mit [CONTRIBUTING.md](CONTRIBUTING.md), es gilt der [Verhaltenskodex](CODE_OF_CONDUCT.md). Issues und Doku auf Deutsch, Code, Commits und Pull Requests auf Englisch. Gefällt dir mietkartei? Ein ⭐ hilft anderen Vermietern, es zu finden.

<details>
<summary><b>Aufbau des Repositorys</b></summary>

| Ordner | Inhalt |
| --- | --- |
| [`app/`](app/) | Die Anwendung: SvelteKit, Drizzle ORM und SQLite, lauffähig mit Node.js, Docker oder Cloudflare Workers |
| [`website/`](website/) | Die Startseite [mietkartei.de](https://mietkartei.de) |
| [`docs/`](docs/) | Die Dokumentation [docs.mietkartei.de](https://docs.mietkartei.de), gebaut mit Zensical |
| [`assets/`](assets/) | Logo, Schrift und die Bildschirmfotos dieser Seite (`npm run screenshots` in `app/`) |
| [`.github/`](.github/) | Workflows, Vorlagen sowie Anleitungen zu [Deployment](.github/DEPLOYMENT.md), [Betrieb auf einem Server](.github/SELF_HOSTING.md) und [Pflege](.github/MAINTENANCE.md) |

</details>
