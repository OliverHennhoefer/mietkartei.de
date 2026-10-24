---
title: Eigentumswohnung vermieten
description: "Eine vermietete Eigentumswohnung in einer WEG in mietkartei abbilden: Verwalter und Miteigentumsanteile erfassen und die Kosten aus der Hausgeldabrechnung so übernehmen, dass der Mieter sie nachrechnen kann."
---

# Eigentumswohnung vermieten

Bei einer Eigentumswohnung bekommst du die Rechnungen des Hauses nicht selbst. Der Verwalter der Wohnungseigentümergemeinschaft (WEG) verteilt sie und schickt dir einmal im Jahr die Hausgeldabrechnung. Daraus übernimmst du die umlagefähigen Kosten in die Nebenkostenabrechnung deines Mieters.

Der Mieter muss dabei sehen können, wie sein Anteil zustande kommt: die Gesamtkosten der Anlage, den Schlüssel und den Anteil der Wohnung daran (§ 556a Abs. 3 BGB). Nur „72,3 m² von 72,3 m²“ reicht dafür nicht. mietkartei druckt deshalb zu jeder Kostenart aus der Hausgeldabrechnung eine Zeile wie „Gesamt 4.200,00 € · MEA 85 von 1.000 · Anteil 357,00 €“.

## 1. Wohnung als Objekt anlegen

Unter **Objekte → Objekt anlegen** wählst du als Art **Eigentumswohnung in einer WEG**. Dann kommen drei Felder dazu:

- **Verwalter:** wer die WEG verwaltet und die Hausgeldabrechnung schickt.
- **Miteigentumsanteil der Wohnung:** der Anteil laut Teilungserklärung, zum Beispiel 85.
- **Miteigentumsanteile der WEG:** alle Anteile zusammen, meist 1.000 oder 10.000.

Lege danach die Wohnung als Einheit an, mit Wohnfläche. Gehört ein Stellplatz dazu, legst du ihn als zweite Einheit an.

## 2. Kosten aus der Hausgeldabrechnung erfassen

Die Hausgeldabrechnung listet jede Kostenart mit den Gesamtkosten der WEG, dem Verteilerschlüssel und dem Betrag, der auf deine Wohnung entfällt. Für jede umlagefähige Position legst du unter **Betriebskosten → Belege → Beleg erfassen** einen Beleg an:

- **Betrag:** der Anteil deiner Wohnung laut Hausgeldabrechnung, zum Beispiel 357,00 €.
- **Gesamtkosten der WEG:** die Kosten der ganzen Anlage, zum Beispiel 4.200,00 €.
- **Schlüssel der WEG**, **Summe des Schlüssels** und **Anteil der Wohnung:** so, wie der Verwalter verteilt hat. mietkartei schlägt dafür die Miteigentumsanteile des Objekts vor. Verteilt der Verwalter eine Position anders, etwa nach Wohnfläche oder nach Einheiten, trägst du diesen Schlüssel mit seinen Zahlen ein.

Unter dem Anteil zeigt das Formular, welcher Betrag sich aus dem Schlüssel ergibt. Weicht dein Betrag um mehr als einen Euro davon ab, weist dich auch der Entwurf der Abrechnung darauf hin. Oft steckt dahinter ein Tippfehler oder eine Position, die der Verwalter anders verteilt hat.

Kosten, die du selbst bezahlst, erfasst du wie bei einem eigenen Haus ohne die Felder der WEG, etwa die Grundsteuer, die die Gemeinde dir direkt schickt.

Nicht umlagefähige Positionen der Hausgeldabrechnung, etwa die Verwaltervergütung, die Instandhaltung oder die Zuführung zur Erhaltungsrücklage, gehören nicht in die Nebenkostenabrechnung.

## 3. Abrechnung erstellen

Den Entwurf erstellst du wie bei jedem Objekt, siehe [Nebenkostenabrechnung erstellen](nebenkostenabrechnung.md). In der Kostenaufstellung stehen bei den Positionen aus der Hausgeldabrechnung die Gesamtkosten der WEG, der Schlüssel des Verwalters und der Anteil deiner Wohnung. Hat das Objekt mehrere Einheiten, etwa Wohnung und Stellplatz, folgt dahinter, wie der Anteil auf die Einheiten verteilt ist.

## Über die Schnittstelle

KI-Assistenten und eigene Programme können solche Belege über die [Schnittstelle](ki-assistenten.md) anlegen. `create_cost_item` nimmt dafür `associationTotal`, `associationKey`, `associationKeyTotal` und `associationKeyShare` entgegen.
