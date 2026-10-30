---
title: Dokumentation
description: "Anleitungen zu mietkartei, der Open-Source-Hausverwaltung und Mietverwaltung für Privatvermieter: ausprobieren, gehostet nutzen, selbst betreiben und mitmachen."
hide:
  - navigation
  - toc
---

# Dokumentation

mietkartei ist die Hausverwaltung von Vermietern für Vermieter: Mieten, Bankumsätze und die Betriebskostenabrechnung für private Vermieter an einem Ort, mit nachvollziehbarem Rechenweg zu jedem Betrag.

## Loslegen

- **Ausprobieren:** Die [Demo](https://demo.mietkartei.de) legt dir mit einem Klick einen eigenen Beispielbestand an, ohne Anmeldung. Nach 24 Stunden wird alles gelöscht.
- **Gehostet nutzen:** Unter [app.mietkartei.de](https://app.mietkartei.de) läuft mietkartei ohne eigene Technik für 5 € im Monat oder 50 € im Jahr inklusive Mehrwertsteuer, etwa so viel, wie Cloudflare für den Selbstbetrieb berechnet. Updates spielen wir für dich ein.
- **Mit KI-Assistenten:** Claude, ChatGPT und andere Assistenten verbindest du über den MCP-Server mit deinem Bestand und fragst dann etwa nach Rückständen oder Fristen. Wie das geht, steht unter [KI-Assistenten anbinden](anleitungen/ki-assistenten.md).
- **Selbst betreiben:** mietkartei läuft als ein einziger Docker-Container. Wie das geht, steht unter [Selbst hosten](selbst-hosten.md).

## Erste Schritte in der Anwendung

Nach der Anmeldung führt dich die Startseite Aufgaben durch die ersten Schritte: Objekt und Einheiten anlegen, Mieter erfassen, Mietvertrag mit Miete und Kaution anlegen, Bankverbindung hinzufügen und Kostenarten prüfen. Hast du deine Daten schon in einer Tabelle, übernimmt die Datenübernahme sie per CSV.

Danach steht auf Aufgaben alles, was zu tun ist: deine eigenen Aufgaben und Erinnerungen, die mietkartei aus deinen Daten ableitet, etwa Rückstände, nicht zugeordnete Bankumsätze, Kontoauszüge, die länger nicht geladen wurden, und leere Einheiten. Darüber steht die nächste Frist, alle Fristen der nächsten zwölf Monate findest du unter Fristen.

## Anleitungen

- [Nebenkostenabrechnung erstellen](anleitungen/nebenkostenabrechnung.md): von den Belegen bis zum PDF für jeden Mieter.
- [Umlageschlüssel](anleitungen/umlageschluessel.md): welcher Schlüssel für welche Kostenart passt.
- [Kontoauszüge importieren](anleitungen/kontoauszuege-importieren.md): Mietzahlungen per camt.053 oder CSV zuordnen.
- [Von Excel umsteigen](anleitungen/von-excel-umsteigen.md): Objekte, Mieter, Verträge und Zahlungen per CSV übernehmen.
- [KI-Assistenten anbinden](anleitungen/ki-assistenten.md): Claude, ChatGPT und andere Assistenten über den MCP-Server mit deinen Daten verbinden.

## Hilfe und Mitmachen

- Fragen beantworten wir über die [Hilfe-Seite](https://github.com/OliverHennhoefer/mietkartei.de/blob/main/SUPPORT.md).
- Fehler und Wünsche nimmt der [Issue-Tracker](https://github.com/OliverHennhoefer/mietkartei.de/issues/new/choose) auf.
- Wer mitarbeiten möchte, findet den Einstieg in [CONTRIBUTING.md](https://github.com/OliverHennhoefer/mietkartei.de/blob/main/CONTRIBUTING.md).
