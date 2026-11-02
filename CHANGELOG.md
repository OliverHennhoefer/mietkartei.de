# Änderungen

Hier steht, was sich von Version zu Version an mietkartei ändert. Das Format folgt [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), die Versionsnummern folgen der [semantischen Versionierung](https://semver.org/lang/de/):

- **Major** (2.0.0): Inkompatible Änderungen, etwa an der REST-API, am Export-Format oder an Schritten beim Selbsthosten.
- **Minor** (1.1.0): Neue Funktionen, bestehende bleiben unverändert nutzbar.
- **Patch** (1.0.1): Fehlerbehebungen und Sicherheitskorrekturen.

Die Abschnitte je Version heißen Neu, Geändert, Behoben, Sicherheit, Entfernt und Inkompatibel. Was noch in keiner Version steckt, sammelt sich unter „Unveröffentlicht“.

## [Unveröffentlicht]

### Neu

- Garage oder Stellplatz im Mietvertrag: Wird eine Garage mit der Wohnung vermietet, trägst du ihren Anteil an der Kaltmiete unter „davon Garage/Stellplatz“ ein, beim Anlegen des Vertrags und bei einer Mietänderung unter „Änderung ab Datum“. Die Mieterhöhung nach § 558 BGB rechnet Kappungsgrenze und Vergleichsmiete je m² dann nur mit der Miete der Wohnung, und das Schreiben nennt den unveränderten Garagenanteil. Die Steuerübersicht führt den Anteil in Zeile 26, das Mietniveau, die Auswertung je m² und die Prognose lassen ihn bei der Wohnung weg. Bestehende Verträge haben keinen Anteil, bis du ihn einträgst.
- Mieter direkt im Mietvertrag anlegen: Tippst du bei **Mieter** einen Namen ein, den es noch nicht gibt, bietet die Liste „… als neuen Mieter anlegen“ an. Der Mieter entsteht zusammen mit dem Vertrag; wird der Vertrag abgelehnt, bleibt auch kein Mieter zurück. Umgekehrt geht es nach **Mieter anlegen** gleich weiter zum Mietvertrag, und Mieter ohne Vertrag haben in der Liste und auf ihrer Seite einen Link dorthin.
- KI-Assistenten tragen mehr ein: Ausgaben wie eine Handwerkerrechnung, Zählerstände und die Zuordnung offener Bankumsätze als Miete, Kaution oder Ausgabe. Dazu lesen sie die Bankumsätze mit dem Vorschlag von mietkartei, die Zähler eines Objekts und die Dienstleister. So reicht es, dem Assistenten eine Rechnung oder das Foto eines Zählers zu zeigen.
- GiroCode auf Zahlungsschreiben: Nachzahlungen aus der Betriebskostenabrechnung, Zahlungserinnerungen und Mahnungen sowie ein Rest nach der Kautionsabrechnung tragen einen QR-Code für die Überweisung, wenn unter Einstellungen → Profil eine IBAN steht. Die Banking-App des Mieters übernimmt Empfänger, Betrag und Verwendungszweck; der Verwendungszweck nennt Einheit und Mieter, damit der Bankabgleich die Zahlung zuordnet.
- Mieterwechsel im laufenden Vertrag: Tritt ein Mitmieter aus (etwa per Nachtrag) oder ein neuer ein, trägst du in der Übersicht des Mietvertrags unter „Vertragsparteien“ das Datum ein. Der Mieter bleibt mit seinem Austrittsdatum im Vertrag, so bleibt erkennbar, wer an einem früheren Tag Vertragspartei war; Briefe und Abrechnungen gehen an die heutigen Vertragsparteien.
- Den Zugang einer freigegebenen Indexanpassung kannst du nachträglich korrigieren, wenn das Schreiben an einem anderen Tag ankommt als bei der Freigabe angenommen. Bei Wohnraum verschiebt sich die neue Miete dann auf den richtigen Monat (§ 557b Abs. 3 BGB), der Brief und die Sollstellungen werden neu berechnet.
- Passwortfelder haben ein Auge: Ein Klick darauf zeigt das Eingegebene im Klartext, ein zweiter verbirgt es wieder. So prüfst du ein langes Passwort vor dem Absenden auf Tippfehler. Beim Absenden ist es wieder verborgen.

### Geändert

- Die Adresse eines Mieters kommt aus dem Mietvertrag: Im Mieterformular trägst du keine Straße, Postleitzahl und Ort mehr ein, solange der Mieter in der gemieteten Einheit wohnt. Nur für eine andere Postanschrift setzt du den Haken und gibst sie vollständig an. Die Mieterseite zeigt die Adresse, an die Schreiben gehen.
- Adressen und Etagen werden beim Speichern aufgeräumt: doppelte Leerzeichen, Tabs und Leerzeichen vor Kommas verschwinden, Hausnummern mit Zusatz wie „1e“ bleiben, wie sie sind. Etagen wie „4 og“, „4.OG“, „4. Stock“ oder „viertes OG“ heißen einheitlich „4. OG“, „eg“ und „Erdgeschoss“ heißen „EG“. Der Import erkennt eine Straße auch bei anderer Schreibweise („Karl-Liebknecht-Str.“ und „Karl Liebknecht Straße“).
- Beim Ausfüllen mit der Tab-Taste springt der Fokus von Feld zu Feld und überspringt die Fragezeichen mit den Hinweisen. Die Hinweise erscheinen weiter beim Darüberfahren oder Antippen, und Screenreader lesen sie mit dem Feld vor.
- Die E-Mails zur Registrierung, zu Einladungen, zum Zurücksetzen des Passworts, zur neuen E-Mail-Adresse und zur Übergabe oder zum Ende eines Zugangs kommen im Aussehen von mietkartei: mit Wortmarke, einem Knopf für den Link, im hellen und dunklen Modus und auf dem Handy gut lesbar. Sie laden keine Bilder nach. Mail-Programme, die nur Text anzeigen, bekommen denselben Inhalt als Text.
- Die wöchentliche Fristenübersicht per E-Mail stellst du jetzt unter Einstellungen → Benachrichtigungen ein statt unter Kalender.
- Das Protokoll nennt beim Bearbeiten eines Mietvertrags die Mieter, die hinzugekommen oder ausgeschieden sind.
- Fehlt zu einem Dokument die Datei im Speicher, nennt der Export es in `FEHLENDE-DOKUMENTE.txt` und das Protokoll zählt es, statt es stillschweigend auszulassen.

### Behoben

- Passwort-Manager speichern beim Anlegen eines Kontos das richtige Passwort zur richtigen Adresse. Die Seiten zum Anlegen über den Link aus der E-Mail und zum Zurücksetzen nennen jetzt die E-Mail-Adresse des Kontos, und der Einrichtungscode ist kein zweites Passwortfeld mehr. Bisher konnte ein Passwort-Manager das Passwort ohne Adresse oder den Einrichtungscode als Passwort ablegen und beim Anmelden das falsche einsetzen.
- Ein Mietvertrag, der schon vor mietkartei lief, zeigt keine jahrealten Fristen mehr als überfällig, etwa „Kaution: 1. Rate fällig, überfällig seit 3.900 Tagen“. Fristen zählen wie das Mietkonto erst ab „Mietkonto führen ab“; was davor fällig war, gilt als erledigt. Das gilt auch für Aufgaben, Benachrichtigungen, den Kalender und die Fristen-E-Mail.
- Umlageschlüssel nach Personen: Ein Mietvertrag, der einen Stellplatz mit der Wohnung vermietet, zählt seine Personentage nur noch einmal. Bisher zählten sie für jede Einheit des Vertrags, sodass dieser Mieter zu viel und die anderen zu wenig trugen und der Rechenweg doppelt stand. Ein leerer Stellplatz zählt keine Personen mehr bei Leerstand. Bereits freigegebene Abrechnungen bleiben unverändert; eine Korrektur rechnet sie neu.
- Umlageschlüssel nach Einheiten und nach Wohnfläche: Stellplätze zählen nur noch in einem Abrechnungskreis, in dem nur Stellplätze liegen. Bisher zählte jeder Stellplatz als volle Einheit, ein Mietvertrag über Wohnung und Stellplatz bekam zwei Anteile, und die Kosten eines leeren Stellplatzes blieben beim Vermieter. Eine eingetragene Garagenfläche zählt auch bei der CO₂-Kostenaufteilung nicht mehr zur Wohnfläche. Bereits freigegebene Abrechnungen bleiben unverändert; eine Korrektur rechnet sie neu.

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
