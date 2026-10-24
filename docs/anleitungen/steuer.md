---
title: Steuerübersicht für die Anlage V
description: "Wie mietkartei die Einnahmen und Werbungskosten eines Objekts nach den Zeilen der Anlage V zusammenstellt: Kaltmiete und Umlagen, AfA, Schuldzinsen, Hausgeld und Erhaltungsrücklage, mit Export als PDF und CSV."
---

# Steuerübersicht für die Anlage V

Unter **Objekte → Objekt → Steuer** stellt mietkartei für ein Kalenderjahr zusammen, was das Objekt eingebracht und gekostet hat, sortiert nach den Zeilen der Anlage V. Die Zeilennummern folgen dem Vordruck 2025; in anderen Jahren können sie abweichen.

!!! warning "Keine Steuerberatung"
Die Steuerübersicht ist eine Hilfe zum Ausfüllen der Anlage V und für das Gespräch mit deinem Steuerberater. Sie kennt nur, was in mietkartei gebucht ist, und ersetzt keine Beratung. Prüfe die Zahlen vor der Abgabe.

## Wie gezählt wird

Einnahmen und Ausgaben zählen in dem Jahr, in dem das Geld geflossen ist (§ 11 EStG). Maßgeblich sind deshalb die Zahlungen auf den Mietkonten und deine Ausgaben, nicht die Sollstellungen.

## Einnahmen

- **Zeile 15, 18 und 26:** die Kaltmiete, je nach Art der Einheit des Mietvertrags für Wohnungen, Gewerbe oder Stellplätze.
- **Zeile 20:** die Vorauszahlungen auf Betriebs- und Heizkosten.
- **Zeile 21:** Nachzahlungen und Guthaben aus Betriebskostenabrechnungen.
- **Zeile 29:** weitere Sollstellungen, die du im Mietkonto von Hand gebucht hast.

mietkartei teilt das Geld, das ein Mietvertrag im Jahr gezahlt hat, so auf, wie die Sollstellungen der Monate des Jahres zusammengesetzt sind. Hat ein Mieter mehr oder weniger gezahlt als gefordert, ist die Aufteilung anteilig; mietkartei weist darauf hin. Nachzahlungen für frühere Jahre gehören eigentlich in Zeile 25.

## Werbungskosten

| Zeile | Was                    | Woher                                                                                               |
| ----- | ---------------------- | --------------------------------------------------------------------------------------------------- |
| 33    | AfA des Gebäudes       | Angaben zur AfA auf der Seite **Steuer**                                                            |
| 46    | Schuldzinsen           | Kategorie **Darlehenszinsen** und die Zinsen laut Zinsbescheinigung                                 |
| 55    | Erhaltungsaufwendungen | **Instandhaltung und Reparaturen**, **Sonderumlage für Erhaltung (WEG)**, Entnahme aus der Rücklage |
| 73    | Umgelegte Kosten       | **Betriebskosten** und der umlagefähige Teil des Hausgelds                                          |
| 76    | Nicht umgelegte Kosten | **Verwaltung, Beratung und Gebühren** und der übrige Teil des Hausgelds                             |
| 80    | Sonstige Kosten        | **Sonstiges**                                                                                       |

Was du gebucht hast, das aber nicht sofort abziehbar ist, steht getrennt darunter: Tilgung, **Modernisierung und Anschaffungen** (sie gehören zu den Herstellungskosten und laufen über die AfA), die Zuführung zur Erhaltungsrücklage und Sonderumlagen in die Rücklage.

Sind in den ersten drei Jahren nach dem Kauf Instandhaltung und Modernisierung zusammen höher als 15 % des Gebäudeanteils, weist mietkartei darauf hin. Solche Kosten zählen meist als anschaffungsnahe Herstellungskosten (§ 6 Abs. 1 Nr. 1a EStG).

### AfA

Für die Abschreibung gibst du einmal je Objekt vier Angaben ein:

- **Kaufdatum:** der Übergang von Nutzen und Lasten laut Kaufvertrag. Im ersten Jahr zählen die Monate ab diesem Monat.
- **Anschaffungskosten:** Kaufpreis plus Nebenkosten wie Grunderwerbsteuer, Notar, Grundbuch und Makler.
- **Gebäudeanteil:** der Anteil des Gebäudes an den Anschaffungskosten. Grund und Boden wird nicht abgeschrieben. Bei der Aufteilung hilft die Arbeitshilfe des Bundesfinanzministeriums.
- **AfA-Satz:** meist 2 % im Jahr, für Gebäude, die vor 1925 fertiggestellt wurden, 2,5 %, für Gebäude, die ab 2023 fertiggestellt wurden, 3 %.

### Darlehen

Eine Darlehensrate enthält Zinsen und Tilgung. Abziehbar sind nur die Zinsen. Buche die Raten mit der Kategorie **Darlehensrate (Zins und Tilgung)**, etwa aus deinen [Kontoauszügen](kontoauszuege-importieren.md), und trag auf der Seite **Steuer** die Zinsen des Jahres aus der Zinsbescheinigung deiner Bank ein. Bucht deine Bank Zinsen und Tilgung getrennt ab, nimm die Kategorien **Darlehenszinsen** und **Tilgung**.

### Hausgeld

Bei einer [Eigentumswohnung](eigentumswohnung.md) zählt das gezahlte Hausgeld ohne die Zuführung zur Erhaltungsrücklage. Die Aufteilung in umgelegte und nicht umgelegte Kosten und die Zuführung kommen aus der Hausgeldabrechnung des Wirtschaftsjahres. Was der Verwalter aus der Rücklage für Reparaturen ausgegeben hat, zählt im Jahr der Ausgabe als Erhaltungsaufwand. Fehlt die Hausgeldabrechnung, steht das Hausgeld voll in Zeile 76, und mietkartei weist darauf hin.

## Für den Steuerberater

Mit **PDF** lädst du die Übersicht als Bericht herunter, mit den Zeilen, den Einnahmen je Mietvertrag, der AfA-Rechnung und den Hinweisen. **CSV** liefert dieselben Zahlen als Tabelle mit Semikolon und Dezimalkomma, die Excel und die meisten Programme direkt öffnen. Die Werte trägst du in ELSTER oder dein Steuerprogramm in die genannten Zeilen ein.

## Über die Schnittstelle

KI-Assistenten und eigene Programme lesen die Steuerübersicht über die [Schnittstelle](ki-assistenten.md) mit `get_tax_overview`.
