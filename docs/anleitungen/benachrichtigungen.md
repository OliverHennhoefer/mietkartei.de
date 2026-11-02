---
title: Benachrichtigungen einrichten
description: "Wie mietkartei dich von selbst an Fristen und Aufgaben erinnert: per E-Mail, als Push aufs Handy mit ntfy oder per Webhook an n8n, Make, Zapier, Home Assistant und darüber auch an WhatsApp oder Telegram."
---

# Benachrichtigungen einrichten

mietkartei meldet sich von selbst, wenn bei einer Frist oder Aufgabe etwas ansteht. Du musst also nicht jeden Tag in die App schauen, um nichts zu verpassen. Damit die Hinweise nicht nerven, gelten feste Regeln:

- **Höchstens dreimal je Frist.** Ein Hinweis kommt mit Vorlauf, bei gesetzlichen Fristen noch einmal drei Tage vorher und einmal, wenn die Frist überfällig ist. Danach steht sie nur noch in der wöchentlichen Übersicht.
- **Eine Nachricht am Tag.** Was an einem Tag zusammenkommt, kommt gesammelt. Ist nichts neu, kommt nichts.
- **Zu deiner Uhrzeit.** Du wählst, ab wann die Hinweise kommen (Vorschlag: 7 Uhr) und ob auch am Wochenende.

Du richtest alles unter **Einstellungen → Benachrichtigungen** ein. Jeder Zugang stellt seine Hinweise selbst ein, auch Mitverwalter.

## Wann ein Hinweis kommt

| Frist oder Aufgabe                                          | Vorlauf         | Drei Tage vorher |
| ----------------------------------------------------------- | --------------- | ---------------- |
| Betriebskostenabrechnung                                    | 6 Wochen        | ja               |
| Kündigungsfrist einer Versicherung                          | 4 Wochen        | ja               |
| Vertragsende, Kaution abrechnen, CO₂-Kostenanteil erstatten | 30 Tage         | ja               |
| Zustimmung zur Mieterhöhung, Klagefrist                     | 14 Tage         | ja               |
| Zählerstände bei Auszug                                     | 7 Tage          | ja               |
| Nächste Mietstaffel, Ende einer Versicherung                | 30 bzw. 28 Tage | nein             |
| Indexanpassung oder Mieterhöhung möglich                    | 14 Tage         | nein             |
| Einwendungsfrist, Kautionsrate                              | 7 Tage          | nein             |
| Eigene Aufgaben mit Fälligkeit                              | 7 Tage          | nein             |

„Drei Tage vorher“ und „überfällig“ gelten als dringend. Für jeden Kanal kannst du wählen, ob er alle Hinweise bekommt oder nur die dringenden. Bewährt hat sich: alles per E-Mail, nur Dringendes aufs Handy.

Jeder Hinweis per E-Mail hat einen Link **Später erinnern**. Darüber verschiebst du einen Hinweis um drei Tage, eine oder zwei Wochen; eine Aufgabe kannst du dort auch gleich als erledigt markieren.

## Per E-Mail

Unter **Kanal hinzufügen → E-Mail** schaltest du die Hinweise an deine Anmeldeadresse ein. Die E-Mail nennt Mieter und Einheit und verlinkt direkt auf die Stelle in mietkartei. Die wöchentliche Übersicht am Montag gibt es weiterhin, unabhängig davon.

## Push aufs Handy mit ntfy

[ntfy](https://ntfy.sh/) ist eine kostenlose Open-Source-App für Android und iPhone, die Nachrichten als Mitteilung anzeigt.

1. Installiere die App ntfy und tippe auf **+**, um ein Thema zu abonnieren.
2. Wähle einen Namen, den niemand errät, etwa `mietkartei-7f3k9q2w`. Wer den Namen kennt, kann auf ntfy.sh mitlesen.
3. Trage in mietkartei unter **Kanal hinzufügen → ntfy** die Adresse ein, also `https://ntfy.sh/mietkartei-7f3k9q2w`.
4. Klicke bei dem neuen Kanal auf **Test senden**. Auf dem Handy erscheint „mietkartei: Test“.

Ohne das Häkchen **Mit Namen der Mieter** gehen nur Art der Frist, Datum und Link mit, keine Namen. Eigene Aufgaben heißen dann nur „Aufgabe“, weil in ihrem Titel ein Name stehen kann. Betreibst du einen eigenen ntfy-Server, trägst du dessen Adresse ein; für ein geschütztes Thema gibst du zusätzlich ein Zugangstoken an.

## Per Webhook

Ein Webhook schickt jeden Hinweis als JSON an eine Adresse deiner Wahl. So verbindest du mietkartei mit [n8n](https://n8n.io/), Make, Zapier, Home Assistant oder Slack, und über diese Dienste auch mit WhatsApp oder Telegram.

mietkartei schickt eine `POST`-Anfrage mit diesem Inhalt:

```json
{
  "version": 1,
  "event": "notices",
  "sentAt": "2026-12-28T06:00:12.000Z",
  "summary": "1 bald fällig",
  "notices": [
    {
      "id": "deadline-3f9a1c2b7d4e5f60a1b2c3d4",
      "kind": "statement",
      "stage": "soon",
      "urgent": true,
      "date": "2026-12-31",
      "title": "Betriebskostenabrechnung 2025",
      "url": "https://app.mietkartei.de/betriebskosten/abrechnungen"
    }
  ]
}
```

- `stage` ist `lead` (mit Vorlauf), `soon` (drei Tage vorher) oder `overdue` (überfällig).
- `kind` ist `task` für eigene Aufgaben, sonst die Art der Frist, etwa `statement`, `insurance_notice` oder `lease_end`.
- `detail` mit Mietern und Einheit ist nur dabei, wenn du **Mit Namen der Mieter** wählst. Ohne das Häkchen ist `title` bei eigenen Aufgaben nur `Aufgabe`, da du den Titel selbst schreibst und darin ein Name stehen kann.
- **Test senden** schickt eine Anfrage mit `"event": "test"` und leerer Liste.

Antwortet die Adresse nicht mit einem Status 2xx, zählt mietkartei das als Fehler. Kam der Hinweis auch über keinen anderen Kanal an, versucht mietkartei es in der nächsten Stunde noch einmal. Nach fünf Fehlern in Folge pausiert der Kanal; ein erfolgreicher Test schaltet ihn wieder ein. Unter **Verlauf** siehst du jede Zustellung mit Ergebnis.

### Signatur prüfen

Beim Anlegen zeigt mietkartei einmalig einen Schlüssel, der mit `whsec_` beginnt. Jede Anfrage trägt die Kopfzeile `X-Mietkartei-Signature: t=<Zeitpunkt>,v1=<Signatur>`. Die Signatur ist ein HMAC-SHA256 über `<Zeitpunkt>.<Inhalt der Anfrage>` mit diesem Schlüssel, als Hexadezimalzahl. So prüfst du sie in JavaScript (etwa in einem Code-Knoten von n8n):

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function valid(header, body, secret) {
  const { t, v1 } = Object.fromEntries(
    header.split(",").map((part) => part.split("=")),
  );
  const expected = createHmac("sha256", secret)
    .update(`${t}.${body}`)
    .digest("hex");
  const fresh = Math.abs(Date.now() / 1000 - Number(t)) < 300;
  return fresh && timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}
```

Prüfe den Inhalt so, wie er ankam, bevor du ihn als JSON liest. Hast du den Schlüssel verloren, entfernst du den Webhook und legst ihn neu an.

### Beispiel: WhatsApp über n8n

1. Lege in n8n einen Workflow mit dem Knoten **Webhook** (Methode POST) an und kopiere seine Produktions-Adresse.
2. Trage sie in mietkartei als Webhook ein, am besten mit **Nur Dringendes**.
3. Hänge in n8n den Knoten **WhatsApp Business Cloud** an und schicke als Text etwa `{{ $json.body.summary }}: {{ $json.body.notices[0].title }} am {{ $json.body.notices[0].date }}`.

WhatsApp verlangt dafür ein eigenes Konto bei Meta mit einer freigegebenen Nachrichtenvorlage und berechnet jede Nachricht. Telegram ist kostenlos: Der Knoten **Telegram** schickt mit einem eigenen Bot an deinen Chat.

### Beispiel: Home Assistant

Lege in Home Assistant eine Automation mit dem Auslöser **Webhook** an und trage `https://<dein-home-assistant>/api/webhook/<webhook-id>` in mietkartei ein. Betreibst du mietkartei selbst, geht auch eine `http`-Adresse im eigenen Netz. In der Automation erreichst du die Hinweise als `trigger.json.notices`.

## Datenschutz

E-Mails gehen wie alle Mails von mietkartei über den Versanddienst der Instanz. ntfy.sh und die Dienste hinter einem Webhook sind eigene Anbieter, die du selbst wählst. Deshalb gehen dorthin ohne dein Häkchen keine Namen von Mietern, nur die Art der Frist, das Datum und ein Link. Wer dem Link folgt, muss sich bei mietkartei anmelden.
