# Änderungen

Hier steht, was sich von Version zu Version an mietkartei ändert. Das Format folgt [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), die Versionsnummern folgen der [semantischen Versionierung](https://semver.org/lang/de/):

- **Major** (2.0.0): Inkompatible Änderungen, etwa an der REST-API, am Export-Format oder an Schritten beim Selbsthosten.
- **Minor** (1.1.0): Neue Funktionen, bestehende bleiben unverändert nutzbar.
- **Patch** (1.0.1): Fehlerbehebungen und Sicherheitskorrekturen.

Die Abschnitte je Version heißen Neu, Geändert, Behoben, Sicherheit, Entfernt und Inkompatibel. Was noch in keiner Version steckt, sammelt sich unter „Unveröffentlicht“.

## [Unveröffentlicht]

## [0.1.0] - 2026-10-29

Erste öffentliche Version. Sie enthält:

### Neu

- Betriebskostenabrechnung nach Betriebskostenverordnung mit tagesgenauer Umlage, Umlageschlüssel je Kostenart, CO₂-Kostenaufteilung und Abrechnung je Mieter als PDF mit Rechenweg.
- Mietkonto mit Soll und Haben je Mietvertrag, Rückständen und Kaution mit laufendem Bestand.
- Kautionsabrechnung nach dem Auszug: Zinsen, Einbehalte mit Grund und die Verrechnung mit einem Mietrückstand werden gebucht, die Auszahlung errechnet und das Schreiben an den Mieter erstellt.
- Übergabeprotokoll für Einzug und Auszug mit Räumen und ihrem Zustand, Schlüsseln und Zählerständen als PDF zum Unterschreiben; beim Auszug steht der Zustand vom Einzug daneben, die Zählerstände kommen auch zu den Zählern.
- Bankimport per camt.053 oder CSV mit Zuordnungsvorschlägen und -regeln.
- Objekte, Einheiten, Mieter und Mietverträge mit Index- und Staffelmiete.
- Mieterhöhung auf die ortsübliche Vergleichsmiete nach § 558 BGB: Sperrfrist und Kappungsgrenze werden geprüft, das Erhöhungsverlangen mit Begründung aus Mietspiegel, Mietdatenbank, Gutachten oder Vergleichswohnungen entsteht als Schreiben, die Fristen für Zustimmung und Klage stehen bei den Fristen; die Zustimmung, auch eine teilweise, wird mit dem Datum eingetragen.
- Mieterübersicht mit „Steht an“: Rückstände samt letzter Mahnung, Kündigungen und anstehende Einzüge oben; die Liste zeigt je Mieter Warmmiete, Mietkonto, Mietbeginn und Hinweise.
- Kleine Straßenkarte bei jedem Objekt aus Daten von OpenStreetMap, verortet über die Adresse, und eine interaktive Karte mit allen Objekten zum Verschieben und Zoomen: Objekte mit Leerstand oder Rückstand sind farbig hervorgehoben, ein Klick zeigt Einheiten, Rückstand und die Kaltmiete neben dem Zensus-Durchschnitt der Gemeinde; unter Einstellungen → Darstellung abschaltbar.
- Helle oder dunkle Farben zur Wahl unter Einstellungen → Darstellung; ohne Wahl folgt mietkartei der Einstellung des Geräts.
- Zähler und Abrechnungskreise, Dokumente, Aufgaben und Fristen.
- Startseite Aufgaben mit allem, was zu tun ist: eigene Aufgaben und Erinnerungen an Rückstände, nicht zugeordnete Bankumsätze, länger nicht geladene Kontoauszüge und Leerstand; darüber die nächsten Fristen, alle Fristen auf einer eigenen Seite.
- Reparaturen: Aufgaben der Art „Reparatur“ nennen die Ausgaben, mit denen sie bezahlt wurden, ob von Hand erfasst oder aus der Bank zugeordnet; die Liste zeigt die Kosten je Reparatur.
- Dienstleister unter Bestand: Handwerker, Hausmeisterdienst, Schornsteinfeger und andere Betriebe mit Leistung und Kontakt. Aufgaben, Ausgaben und Bankzuordnungen können den Dienstleister nennen, ohne Angabe gilt er als unbekannt; eine Ausgabe, die zu einer Aufgabe gehört, übernimmt deren Dienstleister. Die Auswertung der Ausgaben zeigt die Summe je Dienstleister, die Liste der Dienstleister ihre Aufgaben und Ausgaben.
- Fristen per E-Mail: Jeden Montag eine Übersicht der überfälligen und in den nächsten zwei Wochen fälligen Fristen und Aufgaben mit Links, einzuschalten je Zugang unter Einstellungen → Kalender; ohne Anstehendes kommt keine E-Mail.
- Alle Tabellen lassen sich mit einem Klick auf die Spaltenüberschrift sortieren: Text von A bis Z, Beträge und Daten vom größten und neuesten an, Hinweise und Status vom dringendsten an; ein zweiter Klick dreht die Reihenfolge um, ein dritter stellt die gewohnte wieder her.
- Auswertung mit Überblick, Mieteinnahmen, Ausgaben, Objektvergleich, Rendite und Cashflow nach Zins und Tilgung, Nebenkosten-Vergleich mit dem Betriebskostenspiegel des Mieterbunds sowie Prognose der nächsten zwölf Monate mit möglichen Mieterhöhungen und erwarteten Nachzahlungen.
- Zugänge für Mitverwalter und mit Lesezugriff.
- Datenübernahme per CSV, vollständiger Export und Änderungsprotokoll.
- Umzug zwischen Instanzen: Einen Export samt Dokumenten in ein leeres Konto einspielen, etwa von app.mietkartei.de auf den eigenen Server.
- MCP-Server und REST-API für KI-Assistenten wie Claude und ChatGPT. Assistenten lesen dort auch den aktuellen Wortlaut der Paragraphen, die mietkartei anwendet, und zu jeder Frist ihre Rechtsgrundlage.
- Betrieb gehostet unter app.mietkartei.de oder selbst als Docker-Container.
- Selbst betreiben im eigenen Cloudflare-Konto ohne eigene Domain: eingerichtet über „Deploy to Cloudflare“, die erste Registrierung mit einem selbst gewählten Einrichtungscode, Updates per Klick in GitHub.

[Unveröffentlicht]: https://github.com/OliverHennhoefer/mietkartei.de/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/OliverHennhoefer/mietkartei.de/releases/tag/v0.1.0
