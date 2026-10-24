---
title: KI-Assistenten anbinden
description: "Wie du Claude, Cursor oder einen anderen KI-Assistenten über den MCP-Server von mietkartei an deine Daten anbindest, was er lesen und ändern darf und wie die REST-API funktioniert."
---

# KI-Assistenten anbinden

mietkartei hat einen MCP-Server. Über ihn kann ein KI-Assistent wie Claude deine Daten lesen und auf Wunsch einzelne Dinge eintragen. Du kannst dann zum Beispiel fragen:

- „Wer ist mit der Miete im Rückstand, und seit wann?“
- „Wie hoch sind die Verzugszinsen für den Rückstand im Vertrag Erdgeschoss links?“
- „Was habe ich 2025 an Miete eingenommen und ausgegeben? Ich brauche die Zahlen für die Anlage V.“
- „Welche Fristen stehen in den nächsten drei Monaten an?“
- „Trag die Grundsteuer 2026 über 612,40 € für das Haus in der Lindenstraße ein.“

MCP steht für Model Context Protocol, einen offenen Standard, über den KI-Assistenten mit anderen Programmen sprechen. Die Adresse des Servers ist `https://app.mietkartei.de/mcp`. Betreibst du mietkartei selbst, nimmst du stattdessen deine eigene Adresse mit `/mcp` am Ende.

## claude.ai, Claude-App und ChatGPT

Hier brauchst du keinen Schlüssel. Du trägst nur die Adresse ein und meldest dich bei mietkartei an:

1. Füge in den Einstellungen deines Assistenten einen eigenen Connector hinzu. Bei Claude heißt das **Einstellungen → Connectors → Eigenen Connector hinzufügen**. Bei ChatGPT findest du es unter den Apps bzw. Connectors, je nach Tarif mit eingeschaltetem Entwicklermodus.
2. Gib als Adresse `https://app.mietkartei.de/mcp` ein. Weitere Angaben wie eine Client-ID brauchst du nicht.
3. Beim Verbinden öffnet sich mietkartei. Melde dich an, falls nötig. Danach siehst du, welche App zugreifen möchte und wohin es danach weitergeht.
4. Wähle die Rechte (**Nur lesen** oder **Lesen und schreiben**) und klicke auf **Erlauben**.

Die Verbindung erscheint danach unter **Einstellungen → API-Schlüssel → Verbundene Apps**. Dort trennst du sie auch wieder. Nutzt die App die Verbindung 90 Tage lang nicht, endet sie von selbst.

## Andere Assistenten: API-Schlüssel anlegen

Claude Code, Claude Desktop, Cursor und eigene Programme melden sich mit einem API-Schlüssel an. Den legst du in mietkartei unter **Einstellungen → API-Schlüssel** an:

1. Gib dem Schlüssel einen Namen, an dem du ihn wiedererkennst, etwa „Claude auf dem Laptop“.
2. Wähle die Rechte: **Nur lesen** reicht für Fragen. **Lesen und schreiben** braucht es, wenn der Assistent auch etwas eintragen soll.
3. Wähle, wie lange der Schlüssel gilt (30, 90 oder 365 Tage).
4. Kopiere den Schlüssel sofort. Er beginnt mit `mk_` und wird nur dieses eine Mal angezeigt.

Unter dem neuen Schlüssel zeigt mietkartei gleich die passenden Befehle zum Einrichten an, mit deinem Schlüssel schon eingesetzt.

## Einrichten

### Claude Code

```sh
claude mcp add --transport http mietkartei https://app.mietkartei.de/mcp --header "Authorization: Bearer mk_…"
```

### Claude Desktop, Cursor und andere MCP-Clients

Clients, die nur lokale MCP-Server starten, verbinden sich über das Hilfsprogramm `mcp-remote`. Dafür muss Node.js installiert sein. In die Konfigurationsdatei des Clients (bei Claude Desktop unter **Einstellungen → Entwickler → Konfiguration bearbeiten**) kommt:

```json
{
  "mcpServers": {
    "mietkartei": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://app.mietkartei.de/mcp",
        "--header",
        "Authorization: Bearer mk_…"
      ]
    }
  }
}
```

Danach startest du den Client neu.

## Was der Assistent darf

Ein Schlüssel oder eine verbundene App hat dieselben Rechte wie du und sieht alle Daten deines Kontos, auch die persönlichen Daten deiner Mieter. Gib ihn nur Programmen, denen du vertraust.

**Lesen** kann der Assistent Objekte und Einheiten, Mieter, Mietverträge mit Mietänderungen und Kaution, das Mietkonto jedes Vertrags, Salden und Rückstände, den Mahnstand mit Verzugszinsen, Belege, Kostenarten und Umlageschlüssel, Betriebskostenabrechnungen, Hausgeldabrechnungen von Eigentumswohnungen, Ausgaben, die Auswertung, Fristen und Aufgaben.

**Schreiben** darf der Assistent mit Schreibrechten nur vier Dinge, die etwas hinzufügen:

- eine Zahlung auf dem Mietkonto buchen,
- eine Aufgabe anlegen,
- eine Aufgabe erledigen,
- einen Beleg der Betriebskosten erfassen, bei einer Eigentumswohnung mit den Zahlen der Hausgeldabrechnung.

Löschen oder ändern kann der Assistent nichts. Gute Clients fragen vor jedem Schreiben nach, ob sie das wirklich tun sollen. Jede Änderung steht unter deinem Namen im **Änderungsprotokoll**.

Außerdem gilt:

- Hast du als Mitverwalter nur **Lesezugriff** auf ein Konto, darf auch der Assistent nur lesen, egal welche Rechte du beim Anlegen gewählt hast.
- Läuft dein Testzeitraum ohne Abo ab, ist das Konto schreibgeschützt, auch für den Assistenten.
- Änderst du dein Passwort, werden alle deine Schlüssel widerrufen und alle Apps getrennt. Einzelne Schlüssel und Apps widerrufst du unter **Einstellungen → API-Schlüssel**.

Mahnungen, Mieterhöhungen und Abrechnungen erstellst du weiterhin in mietkartei selbst. Der Assistent kann dir aber sagen, was ansteht und welche Beträge offen sind.

## REST-API

Dieselben Daten gibt es auch als REST-API unter `https://app.mietkartei.de/api/v1`, mit demselben Schlüssel:

```sh
curl -H "Authorization: Bearer mk_…" https://app.mietkartei.de/api/v1/leases
```

`GET /api/v1` listet alle Endpunkte mit ihren Parametern. Beträge sind ganze Cent, Datumsangaben haben die Form `JJJJ-MM-TT`. Je Schlüssel sind die Anfragen pro Minute begrenzt. Wird die Grenze überschritten, antwortet der Server mit `429` und sagt, wann es weitergeht.
