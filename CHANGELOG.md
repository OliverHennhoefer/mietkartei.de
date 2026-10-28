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
- Mietkonto mit Soll und Haben je Mietvertrag, Rückständen und Kaution mit laufendem Bestand.
- Bankimport per camt.053 oder CSV mit Zuordnungsvorschlägen und -regeln.
- Objekte, Einheiten, Mieter und Mietverträge mit Index- und Staffelmiete.
- Mieterübersicht mit „Steht an“: Rückstände samt letzter Mahnung, Kündigungen und anstehende Einzüge oben; die Liste zeigt je Mieter Warmmiete, Mietkonto, Mietbeginn und Hinweise.
- Kleine Straßenkarte bei jedem Objekt aus Daten von OpenStreetMap, verortet über die Adresse, und eine interaktive Karte mit allen Objekten zum Verschieben und Zoomen: Objekte mit Leerstand oder Rückstand sind farbig hervorgehoben, ein Klick zeigt Einheiten, Rückstand und die Kaltmiete neben dem Zensus-Durchschnitt der Gemeinde; unter Einstellungen → Darstellung abschaltbar.
- Helle oder dunkle Farben zur Wahl unter Einstellungen → Darstellung; ohne Wahl folgt mietkartei der Einstellung des Geräts.
- Zähler und Abrechnungskreise, Dokumente, Aufgaben und Fristen.
- Alle Tabellen lassen sich mit einem Klick auf die Spaltenüberschrift sortieren: Text von A bis Z, Beträge und Daten vom größten und neuesten an, Hinweise und Status vom dringendsten an; ein zweiter Klick dreht die Reihenfolge um, ein dritter stellt die gewohnte wieder her.
- Auswertung mit Überblick, Mieteinnahmen, Ausgaben, Objektvergleich, Rendite und Cashflow nach Zins und Tilgung Nebenkosten-Vergleich mit dem Betriebskostenspiegel des Mieterbunds sowie Prognose der nächsten zwölf Monate mit möglichen Mieterhöhungen und erwarteten Nachzahlungen.
- Zugänge für Mitverwalter und mit Lesezugriff.
- Datenübernahme per CSV, vollständiger Export und Änderungsprotokoll.
- Umzug zwischen Instanzen: Einen Export samt Dokumenten in ein leeres Konto einspielen, etwa von app.mietkartei.de auf den eigenen Server.
- MCP-Server und REST-API für KI-Assistenten wie Claude und ChatGPT. Assistenten lesen dort auch den aktuellen Wortlaut der Paragraphen, die mietkartei anwendet, und zu jeder Frist ihre Rechtsgrundlage.
- Betrieb gehostet unter app.mietkartei.de oder selbst als Docker-Container.
- Selbst betreiben im eigenen Cloudflare-Konto ohne eigene Domain: eingerichtet über „Deploy to Cloudflare“, die erste Registrierung mit einem selbst gewählten Einrichtungscode, Updates per Klick in GitHub.

[Unveröffentlicht]: https://github.com/OliverHennhoefer/mietkartei.de/commits/main
