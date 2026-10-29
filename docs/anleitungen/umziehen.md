---
title: Umziehen und Daten mitnehmen
description: "Wie du mit allen Daten und Dokumenten von app.mietkartei.de auf einen eigenen Server umziehst oder zurück, was der Export enthält und was du danach neu einrichtest."
---

# Umziehen und Daten mitnehmen

Deine Daten gehören dir. Du kannst jederzeit alles herunterladen und mit wenigen Klicks in eine andere mietkartei-Instanz mitnehmen: von app.mietkartei.de auf deinen eigenen Server, von deinem Server zu app.mietkartei.de oder von einem Server auf einen anderen.

## 1. Export herunterladen

Öffne in der bisherigen Instanz **Einstellungen → Export** und klicke auf **Export herunterladen**. Du bekommst eine ZIP-Datei mit

- `export.json`: alle Einträge deines Kontos, also Objekte, Einheiten, Mieter, Mietverträge, Mietkonten und Zahlungen, Kautionen, Bankumsätze, Betriebskosten und Abrechnungen, Zähler, Versicherungen, Hausgeldabrechnungen, Aufgaben, Steuerdaten und das Protokoll,
- den Ordner `documents/` mit allen hochgeladenen Dokumenten im Original.
- `FEHLENDE-DOKUMENTE.txt`, nur wenn zu einem Dokument die Datei im Speicher fehlt: Die Liste nennt diese Dokumente, damit dir die Lücke gleich auffällt und nicht erst, wenn du das Dokument brauchst. Ihre Angaben stehen trotzdem in `export.json`, und das Protokoll vermerkt beim Export, wie viele es sind.

Passwörter und API-Schlüssel sind nicht enthalten. Den Export darf nur der Vermieter herunterladen, Mitverwalter nicht. Auch ein Konto, das nach der Testphase ohne Abo nur noch lesbar ist, kann jederzeit exportieren.

`export.json` ist eine gewöhnliche JSON-Datei mit einer Liste je Tabelle. Du kannst sie also auch ohne mietkartei weiterverarbeiten, etwa in einer Tabellenkalkulation oder einem eigenen Skript.

## 2. Neue Instanz vorbereiten

Lege in der neuen Instanz ein Konto an. Wie du mietkartei selbst betreibst, steht unter [Selbst hosten](../selbst-hosten.md). Das neue Konto muss leer sein: Es darf noch keine Objekte und keine Dokumente enthalten. Was sonst schon darin steht, etwa die Standard-Kostenarten, ersetzt der Export.

## 3. Export einspielen

Öffne in der neuen Instanz **Einstellungen → Export** und wähle unter **Export einspielen** die ZIP-Datei aus. Der Browser liest die Datei und schickt erst die Einträge, dann jedes Dokument einzeln. So spielt das auch große Exporte mit vielen Dokumenten ein. Am Ende siehst du, wie viele Einträge und Dokumente übernommen wurden. Die Seite braucht dafür JavaScript.

Alle Einträge behalten ihre Verknüpfungen: Verträge gehören weiter zu ihren Einheiten und Mietern, Dokumente zu ihren Objekten und Verträgen, und das Protokoll zeigt die bisherigen Änderungen. Was du selbst geändert hast, steht danach unter deinem neuen Zugang.

## Danach neu einrichten

Einige Dinge hängen an der alten Instanz und kommen deshalb nicht mit:

- **Mitverwalter** lädst du unter **Einstellungen → Mitverwalter** neu ein.
- **Kalender-Abos** legst du unter **Einstellungen → Kalender** neu an, weil sich die Adresse ändert.
- **API-Schlüssel und verbundene KI-Assistenten** richtest du neu ein, siehe [KI-Assistenten anbinden](ki-assistenten.md).
- **Ein Abo** bei app.mietkartei.de kündigst du unter **Abo**, wenn du es nicht mehr brauchst. Danach kannst du das alte Konto unter **Einstellungen → Konto** löschen.

Ziehst du innerhalb derselben Instanz um, etwa in ein zweites Konto, lösche das alte Konto vorher. Sonst lässt sich der Export nicht einspielen, weil es jeden Eintrag schon gibt.

## Ohne Umzug an die Daten kommen

- Über die [REST-API und den MCP-Server](ki-assistenten.md) liest ein eigenes Programm oder ein KI-Assistent Objekte, Mieter, Verträge, Mietkonten, Ausgaben und Abrechnungen.
- Die Steuerübersicht gibt es als CSV und PDF, jede Betriebskostenabrechnung, jede Mahnung und jede Mieterhöhung als PDF.
- Betreibst du mietkartei selbst, liegen alle Daten in einer SQLite-Datei, die Dokumente als Dateien daneben.
