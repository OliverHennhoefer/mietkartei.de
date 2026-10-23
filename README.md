<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/brand/lockup-white.svg">
  <img src="assets/brand/lockup.svg" alt="mietkartei" width="280">
</picture>

### Die Hausverwaltung von Vermietern für Vermieter.

Mieten, Bankumsätze und die Betriebskostenabrechnung für deine paar Wohnungen.<br>
Open Source, nachvollziehbar gerechnet und ohne Einarbeitung.

[![App](https://github.com/OliverHennhoefer/mietkartei.de/actions/workflows/app.yml/badge.svg)](https://github.com/OliverHennhoefer/mietkartei.de/actions/workflows/app.yml)
[![Testabdeckung](https://codecov.io/gh/OliverHennhoefer/mietkartei.de/graph/badge.svg)](https://codecov.io/gh/OliverHennhoefer/mietkartei.de)
[![Lizenz: AGPL-3.0](https://img.shields.io/badge/Lizenz-AGPL--3.0-111111)](LICENSE)
[![Docker-Image](https://img.shields.io/badge/Docker-ghcr.io-2496ed?logo=docker&logoColor=white)](https://github.com/OliverHennhoefer/mietkartei.de/pkgs/container/mietkartei)
![Status: im Aufbau](https://img.shields.io/badge/Status-im%20Aufbau-d97706)

[**Startseite**](https://mietkartei.de) · [**Dokumentation**](https://docs.mietkartei.de) · [**Selbst hosten**](.github/SELF_HOSTING.md) · [**Mitmachen**](CONTRIBUTING.md)

<br>

<img src="assets/screenshots/uebersicht.png" alt="Übersicht von mietkartei mit Rückständen, Leerstand, offenen Bankumsätzen und Fristen" width="900">

</div>

## Warum mietkartei?

Wer drei bis zehn Wohnungen vermietet, ist für die großen Verwaltungsprogramme zu klein und für Excel zu groß. mietkartei ist für genau diese Lücke gebaut.

|  |  |
| --- | --- |
| **Fachlich genau** | Kostenarten nach Betriebskostenverordnung, tagesgenaue Umlage, CO₂-Kostenaufteilung. Jeder Betrag zeigt seinen Rechenweg. |
| **Einfach** | Ein Bestand, ein Mietkonto pro Vertrag, eine Übersicht. Keine Buchhaltungskenntnisse nötig. |
| **Offen** | Der komplette Code unter AGPL-3.0. Deine Daten passen in eine einzige SQLite-Datei und lassen sich jederzeit exportieren. |
| **Bequem** | Selbst gehostet als ein Docker-Container oder einfach gehostet unter [app.mietkartei.de](https://app.mietkartei.de). Beides läuft mit demselben Code. |

## So sieht es aus

<table>
  <tr>
    <td width="50%" valign="top">
      <b>Betriebskostenabrechnung</b><br>
      Belege erfassen, Umlageschlüssel wählen, fertig. Jeder Mieter sieht, wie sich sein Anteil berechnet, und bekommt die Abrechnung als PDF.
    </td>
    <td width="50%" valign="top">
      <b>Mietkonto</b><br>
      Soll und Ist für jeden Mietvertrag. Rückstände stehen oben, Kontoauszüge ordnet mietkartei per Vorschlag den Verträgen zu.
    </td>
  </tr>
  <tr>
    <td><img src="assets/screenshots/abrechnung-mieter.png" alt="Anteil eines Mieters in der Betriebskostenabrechnung mit Umlageschlüssel je Kostenart"></td>
    <td><img src="assets/screenshots/mietkonto.png" alt="Mietkonto mit Saldo, Rückständen und letzter Zahlung je Mietvertrag"></td>
  </tr>
</table>

**Außerdem dabei:** Objekte und Einheiten · Mieter und Mietverträge mit Kaution · Index- und Staffelmiete · Bankimport mit Zuordnungsregeln · Zähler und Abrechnungskreise · Dokumente · Aufgaben und Fristen · Mitverwalter · Datenübernahme per CSV · vollständiger Export · Änderungsprotokoll

> [!IMPORTANT]
> **mietkartei ist im Aufbau** und ändert sich gerade schnell. Probier es mit den eingebauten Demodaten aus, verwalte damit aber noch keine echten Mieterdaten.

## In zwei Minuten ausprobieren

Mit Docker:

```sh
docker run -p 127.0.0.1:3000:3000 -v mietkartei-data:/data ghcr.io/oliverhennhoefer/mietkartei
```

Oder aus dem Quellcode mit Node.js 22:

```sh
git clone https://github.com/OliverHennhoefer/mietkartei.de.git
cd mietkartei.de/app && npm ci && npm run dev
```

Öffne <http://localhost:3000> (beim Start aus dem Quellcode <http://localhost:5173>), lege ein Konto an und wähle **Einstellungen → Konto → Demodaten anlegen**. Du bekommst zwei Häuser mit sechs Einheiten, zwei Jahre Mietzahlungen und die Belege für eine Abrechnung. Den Betrieb auf einem eigenen Server beschreibt die [Anleitung zum Selbsthosten](.github/SELF_HOSTING.md), alle Befehle stehen in [app/README.md](app/README.md).

## Mitmachen

mietkartei entsteht offen, und jede Hilfe zählt: Code, Fehlerberichte, Fachwissen aus der Vermietung, Texte, Gestaltung und Barrierefreiheit. Gerade wer selbst vermietet, weiß am besten, was fehlt.

- [Gute Einstiegsaufgaben](https://github.com/OliverHennhoefer/mietkartei.de/issues?q=is%3Aissue+is%3Aopen+label%3A%22guter+einstieg%22) und [wo Hilfe gesucht wird](https://github.com/OliverHennhoefer/mietkartei.de/issues?q=is%3Aissue+is%3Aopen+label%3A%22hilfe+gesucht%22)
- [Fehler melden](https://github.com/OliverHennhoefer/mietkartei.de/issues/new?template=01-fehler.yml) · [Funktion vorschlagen](https://github.com/OliverHennhoefer/mietkartei.de/issues/new?template=02-funktionswunsch.yml) · [Frage stellen](SUPPORT.md) · [Sicherheitslücke melden](SECURITY.md)
- Den Einstieg erklärt [CONTRIBUTING.md](CONTRIBUTING.md), für die Zusammenarbeit gilt unser [Verhaltenskodex](CODE_OF_CONDUCT.md).

Issues und Dokumentation schreiben wir auf Deutsch, Code, Commits und Pull Requests auf Englisch. Wenn dir mietkartei gefällt, hilft schon ein ⭐, damit andere Vermieter das Projekt finden.

<details>
<summary><b>Aufbau des Repositorys</b></summary>

| Ordner | Inhalt |
| --- | --- |
| [`app/`](app/) | Die Anwendung: SvelteKit, Drizzle ORM und SQLite, lauffähig mit Node.js, Docker oder Cloudflare Workers |
| [`website/`](website/) | Die Startseite [mietkartei.de](https://mietkartei.de) |
| [`docs/`](docs/) | Die Dokumentation [docs.mietkartei.de](https://docs.mietkartei.de), gebaut mit Zensical |
| [`assets/`](assets/) | Logo, Schrift und die Bildschirmfotos dieser Seite (`npm run screenshots` in `app/`) |
| [`.github/`](.github/) | Workflows, Vorlagen sowie Anleitungen zu [Deployment](.github/DEPLOYMENT.md), [Selbsthosten](.github/SELF_HOSTING.md) und [Pflege](.github/MAINTENANCE.md) |

</details>

## Lizenz

[GNU Affero General Public License, Version 3](LICENSE). Beiträge stehen unter derselben Lizenz, eine Contributor License Agreement gibt es nicht. Die gehostete Variante unter app.mietkartei.de läuft mit genau dem Code aus diesem Repository.
