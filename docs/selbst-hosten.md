---
title: Selbst hosten
description: mietkartei auf dem eigenen Rechner oder Server betreiben.
---

# Selbst hosten

mietkartei läuft als ein einziger Docker-Container. Alle Daten liegen in einer SQLite-Datei, hochgeladene Dokumente als Dateien daneben. Wenn du erst einmal nur schauen willst, nimm die [Demo](https://demo.mietkartei.de): Dort musst du nichts installieren.

!!! tip "Erreichbarkeit"
Der Befehl unten macht mietkartei nur auf deinem eigenen Rechner erreichbar. Den Betrieb auf einem Server beschreibt die [Serveranleitung](https://github.com/OliverHennhoefer/mietkartei.de/blob/main/.github/SELF_HOSTING.md) (englisch).

## Mit Docker

```sh
docker run -d --name mietkartei -p 127.0.0.1:3000:3000 \
  -v mietkartei-data:/data \
  ghcr.io/oliverhennhoefer/mietkartei
```

Öffne danach <http://localhost:3000> und lege ein Konto an. Die erste Person übernimmt die Instanz, danach ist die Registrierung geschlossen. Unter **Einstellungen → Konto → Demodaten anlegen** füllst du ein leeres Konto mit einem Beispielbestand.

**Aktualisieren:** `docker pull ghcr.io/oliverhennhoefer/mietkartei`, dann den Container löschen und mit demselben Befehl neu starten. Die Daten bleiben im Volume `mietkartei-data`.

**Sichern:** Halte den Container mit `docker stop mietkartei` an und kopiere den Inhalt von `/data`. Unter **Einstellungen → Export** lädst du außerdem jederzeit alle Daten deines Kontos als ZIP-Datei herunter.

**Umziehen:** Nutzt du bisher app.mietkartei.de, lade dort den Export herunter und spiele ihn in deiner eigenen Instanz unter **Einstellungen → Export → Export einspielen** ein. Alle Einträge und Dokumente kommen mit; wie das genau geht, steht unter [Umziehen und Daten mitnehmen](anleitungen/umziehen.md). Andersherum geht es genauso.

**Herkunft prüfen:** Jedes Image trägt eine signierte Herkunftsangabe, die belegt, dass es aus diesem Repository gebaut wurde. Mit der [GitHub CLI](https://cli.github.com) prüfst du sie so:

```sh
gh attestation verify oci://ghcr.io/oliverhennhoefer/mietkartei --owner OliverHennhoefer
```

## Aus dem Quellcode

Mit Node.js 22 oder neuer:

```sh
git clone https://github.com/OliverHennhoefer/mietkartei.de.git
cd mietkartei.de/app
npm ci
npm run dev
```

Die Anwendung läuft dann unter <http://localhost:5173>.

Jedes [Release](https://github.com/OliverHennhoefer/mietkartei.de/releases) enthält zusätzlich ein Quellarchiv mit Prüfsumme (`SHA256SUMS`) und einer [SLSA-Herkunftsangabe](https://slsa.dev) (`mietkartei.intoto.jsonl`), die du mit dem [slsa-verifier](https://github.com/slsa-framework/slsa-verifier) prüfen kannst.

## Bankabruf

Damit mietkartei die Umsätze selbst bei deiner Bank abholt, legst du kostenlos eine eigene Anwendung bei [Enable Banking](https://enablebanking.com/cp/applications) an. Als Weiterleitungsadresse trägst du die Adresse deiner Installation mit `/bank/abruf` am Ende ein, etwa `https://mietkartei.example.de/bank/abruf`, und setzt `ORIGIN` auf dieselbe Adresse. Ohne Vertrag läuft die Anwendung im eingeschränkten Modus und ruft nur Konten ab, die du im Control Panel von Enable Banking verknüpft hast. Für die eigenen Konten reicht das. Die Anwendungs-Id und den heruntergeladenen privaten Schlüssel übergibst du als `ENABLE_BANKING_APP_ID` und `ENABLE_BANKING_PRIVATE_KEY`.

## Weiterführend

- Alle Einstellungen über Umgebungsvariablen, etwa für den Mailversand, stehen in der [Beschreibung der Anwendung](https://github.com/OliverHennhoefer/mietkartei.de/blob/main/app/README.md).
- Den Betrieb auf einem kleinen Server, erreichbar über ein privates Netz, beschreibt die [Serveranleitung](https://github.com/OliverHennhoefer/mietkartei.de/blob/main/.github/SELF_HOSTING.md) (englisch).
