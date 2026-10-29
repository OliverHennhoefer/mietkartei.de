<div align="center">

<a href="https://mietkartei.de"><img src="assets/brand/lockup-card.svg" alt="mietkartei" width="396"></a>

### Die Hausverwaltung von Vermietern für Vermieter.

Mietverwaltung, Bankabgleich und Betriebskostenabrechnung (Nebenkostenabrechnung) für private Vermieter an einem Ort. Open Source, nachvollziehbar gerechnet, ohne Einarbeitung und direkt mit Claude oder ChatGPT nutzbar.

[![Tests](https://img.shields.io/github/actions/workflow/status/OliverHennhoefer/mietkartei.de/app.yml?branch=main&label=Tests)](https://github.com/OliverHennhoefer/mietkartei.de/actions/workflows/app.yml)
[![Cloudflare Workers](https://img.shields.io/website?url=https%3A%2F%2Fapp.mietkartei.de%2Fhealth&label=Cloudflare%20Workers&logo=cloudflare&logoColor=white&up_message=online&down_message=offline)](https://app.mietkartei.de)
[![Testabdeckung](https://codecov.io/gh/OliverHennhoefer/mietkartei.de/graph/badge.svg)](https://codecov.io/gh/OliverHennhoefer/mietkartei.de)
[![OpenSSF Scorecard](https://img.shields.io/ossf-scorecard/github.com/OliverHennhoefer/mietkartei.de?label=OpenSSF%20Scorecard)](https://scorecard.dev/viewer/?uri=github.com/OliverHennhoefer/mietkartei.de)
[![Lizenz: AGPL-3.0](https://img.shields.io/badge/Lizenz-AGPL--3.0-111111)](LICENSE)
[![Docker-Image](https://img.shields.io/badge/Docker-ghcr.io-2496ed?logo=docker&logoColor=white)](https://github.com/OliverHennhoefer/mietkartei.de/pkgs/container/mietkartei)

<br>

<a href="https://demo.mietkartei.de"><img src="assets/screenshots/auswertung.png" alt="Auswertung von mietkartei mit Einnahmen, Ausgaben, Überschuss und Kaltmiete pro m² sowie dem Verlauf über ein Jahr" width="900"></a>

</div>

## Funktionen

- **Betriebskostenabrechnung:** Belege erfassen, Umlageschlüssel wählen, jeder Mieter bekommt seinen Anteil mit Rechenweg als PDF.
- **Mietkonto und Bankabgleich:** Soll und Ist je Vertrag, Rückstände oben, Kontoauszüge werden per Vorschlag zugeordnet.
- **Auswertung:** Einnahmen, Ausgaben, Rendite, Cashflow und Prognose je Objekt und über alle Jahre.
- **Objekte und Einheiten:** Häuser und Eigentumswohnungen mit Flächen, Lage und Versicherungen.
- **Mieter und Mietverträge:** Vertragsdaten, Übergabe und Kaution samt Zinsen an einem Ort.
- **Index- und Staffelmiete:** Erhöhungstermine und neue Miete nach Verbraucherpreisindex automatisch berechnet.
- **Bankimport mit Regeln:** CSV gängiger Banken einlesen, wiederkehrende Umsätze ordnen sich selbst zu.
- **Zähler und Abrechnungskreise:** Verbrauch und Kosten genau den betroffenen Einheiten zuordnen.
- **Steuerübersicht:** Einnahmen und Werbungskosten nach den Zeilen der Anlage V, als PDF und CSV.
- **Dokumente:** Verträge, Belege und Schreiben direkt am Objekt oder Vertrag ablegen.
- **Aufgaben und Fristen:** Kündigungsfristen, Mieterhöhungen und Abrechnungstermine im Blick, auch im eigenen Kalender.
- **Zugänge:** Mitverwalter mit vollen Rechten oder Steuerberater mit Lesezugriff einladen.
- **KI-Assistenten:** Claude, ChatGPT und andere MCP-Clients beantworten Fragen wie „Wer ist im Rückstand?“, dazu eine REST-API. → [Anleitung](https://docs.mietkartei.de/anleitungen/ki-assistenten/)
- **Kein Lock-in:** Offener Code, Datenübernahme per CSV, vollständiger Export und Änderungsprotokoll.
- **Kein Datengeschäft:** Keine Werbung, keine Leads. Selbst betrieben kostenlos, gehostet 5 € im Monat oder 50 € im Jahr, egal wie viele Wohnungen.

## Ausprobieren: Demo oder selbst hosten

- **[Demo](https://demo.mietkartei.de):** eigener Beispielbestand mit fertiger Betriebskostenabrechnung, ohne Anmeldung.
- **[Selbst hosten](https://docs.mietkartei.de/selbst-hosten/):** kostenlos als Docker-Container auf dem eigenen Rechner oder Server, oder mit wenigen Klicks im eigenen Cloudflare-Konto für rund 5 US-Dollar im Monat an Cloudflare, ohne Server und ohne Domain. Beides mit allen Funktionen.

  [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/OliverHennhoefer/mietkartei.de)

## Mitmachen

Du vermietest selbst? Dann weißt du am besten, was fehlt. Jede Hilfe zählt: Code, Fehlerberichte, Fachwissen, Texte, Gestaltung, Barrierefreiheit. Ein ⭐ hilft anderen Vermietern, es zu finden.

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
