# Änderungen

Hier steht, was sich von Version zu Version an mietkartei ändert. Das Format folgt [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), die Versionsnummern folgen der [semantischen Versionierung](https://semver.org/lang/de/):

- **Major** (2.0.0): Inkompatible Änderungen, etwa an der REST-API, am Export-Format oder an Schritten beim Selbsthosten.
- **Minor** (1.1.0): Neue Funktionen, bestehende bleiben unverändert nutzbar.
- **Patch** (1.0.1): Fehlerbehebungen und Sicherheitskorrekturen.

Die Abschnitte je Version heißen Neu, Geändert, Behoben, Sicherheit, Entfernt und Inkompatibel. Was noch in keiner Version steckt, sammelt sich unter „Unveröffentlicht“.

## [Unveröffentlicht]

Erste öffentliche Version. Sie enthält:

### Neu

- Betriebskostenabrechnung nach Betriebskostenverordnung mit tagesgenauer Umlage, Umlageschlüssel je Kostenart, CO₂-Kostenaufteilung und Abrechnung je Mieter als PDF mit Rechenweg.
- Mietkonto mit Soll und Ist je Mietvertrag, Rückständen und Kaution.
- Bankimport per camt.053 oder CSV mit Zuordnungsvorschlägen und -regeln.
- Objekte, Einheiten, Mieter und Mietverträge mit Index- und Staffelmiete.
- Zähler und Abrechnungskreise, Dokumente, Aufgaben und Fristen.
- Auswertung mit Überblick, Mieteinnahmen, Ausgaben, Objektvergleich sowie Rendite und Cashflow nach Zins und Tilgung.
- Zugänge für Mitverwalter und mit Lesezugriff.
- Datenübernahme per CSV, vollständiger Export und Änderungsprotokoll.
- Umzug zwischen Instanzen: Einen Export samt Dokumenten in ein leeres Konto einspielen, etwa von app.mietkartei.de auf den eigenen Server.
- MCP-Server und REST-API für KI-Assistenten wie Claude und ChatGPT.
- Betrieb gehostet unter app.mietkartei.de oder selbst als Docker-Container.

[Unveröffentlicht]: https://github.com/OliverHennhoefer/mietkartei.de/commits/main
