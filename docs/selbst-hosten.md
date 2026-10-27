---
title: Selbst hosten
description: mietkartei im eigenen Cloudflare-Konto oder auf dem eigenen Rechner oder Server betreiben.
---

# Selbst hosten

mietkartei ist Open Source, du kannst es also selbst betreiben. Dafür gibt es zwei Wege:

- **Im eigenen Cloudflare-Konto:** ohne eigenen Server und ohne eigene Domain, eingerichtet mit wenigen Klicks im Browser. Dafür zahlst du an Cloudflare rund 5 US-Dollar im Monat.
- **Mit Docker:** auf deinem eigenen Rechner, NAS oder Server. Das kostet nichts, setzt aber etwas Technikerfahrung voraus.

Wenn du erst einmal nur schauen willst, nimm die [Demo](https://demo.mietkartei.de). Dort musst du nichts installieren.

## Im eigenen Cloudflare-Konto

[Cloudflare](https://www.cloudflare.com/de-de/) betreibt Rechenzentren auf der ganzen Welt, und auf denen läuft auch app.mietkartei.de. Mit einem eigenen Konto dort bekommst du dieselbe Software unter einer Adresse wie `https://mietkartei.dein-name.workers.dev`. Datenbank, Dokumente und Updates liegen dann in deinem Konto, nicht bei uns.

### Was du brauchst

- Ein **Cloudflare-Konto** mit dem Tarif **Workers Paid** für 5 US-Dollar im Monat, zuzüglich Umsatzsteuer. Der kostenlose Tarif reicht leider nicht: Er erlaubt pro Anfrage nur 10 Millisekunden Rechenzeit, und allein die sichere Prüfung deines Passworts beim Anmelden braucht mehr. Datenbank und Dokumentenspeicher sind für eine private Vermietung im Tarif enthalten bzw. kostenlos.
- Ein kostenloses **GitHub-Konto**. Dort legt Cloudflare deine eigene Kopie von mietkartei an, aus der es die Anwendung baut.
- Eine **Kreditkarte** oder ein PayPal-Konto für Cloudflare.

Eine eigene Domain brauchst du nicht.

### Einrichten

1. Lege bei [Cloudflare](https://dash.cloudflare.com/sign-up) ein Konto an und bestätige deine E-Mail-Adresse.
2. Buche im Dashboard unter **Workers & Pages → Pläne** den Tarif **Workers Paid**. Aktiviere unter **R2-Objektspeicher** einmal den Speicher für Dokumente; das kostenlose Kontingent von 10 GB reicht für viele Jahre.
3. Lege bei [GitHub](https://github.com/signup) ein Konto an, falls du noch keins hast.
4. Klicke auf diesen Link:

    **[mietkartei bei Cloudflare einrichten →](https://deploy.workers.cloudflare.com/?url=https://github.com/OliverHennhoefer/mietkartei.de)**

5. Cloudflare fragt nach deinem GitHub-Konto und schlägt Namen für die Kopie, die Datenbank und den Dokumentenspeicher vor. Die Vorschläge kannst du übernehmen.
6. Unter **SETUP_CODE** trägst du einen **Einrichtungscode** ein, den nur du kennst, etwa drei zufällige Wörter wie `kanal-tulpe-wolke`. Notiere ihn dir.
7. Klicke auf **Erstellen und bereitstellen**. Cloudflare baut mietkartei jetzt, das dauert ein paar Minuten. Danach zeigt es dir die Adresse deiner mietkartei, die auf `.workers.dev` endet.
8. Öffne diese Adresse mit `/registrieren` am Ende, also etwa `https://mietkartei.dein-name.workers.dev/registrieren`. Gib deine E-Mail-Adresse, ein Passwort und den Einrichtungscode ein. Danach ist die Registrierung geschlossen: Ohne den Code konnte sich bis dahin niemand sonst anmelden, und jetzt kann es niemand mehr.

Unter **Einstellungen → Konto → Demodaten anlegen** füllst du ein leeres Konto mit einem Beispielbestand, wenn du dich erst einmal umsehen willst.

### Was anders ist als bei app.mietkartei.de

- **Keine E-Mails.** Für den Versand von E-Mails braucht mietkartei eine eigene Domain. Ohne Domain bleiben E-Mails ungesendet. Das betrifft das Zurücksetzen eines vergessenen Passworts und Einladungen an Mitverwalter. Bewahre dein Passwort deshalb gut auf, etwa in einem Passwortmanager.
- **Keine Straßenkarte.** Die Objekte erscheinen auf einer Deutschlandkarte mit einem Punkt je Postleitzahl.
- **Kein Abo.** Bezahlt wird nur Cloudflare.
- **Speicherort.** Cloudflare legt Datenbank und Dokumente in einem Rechenzentrum in deiner Nähe an. Eine feste Bindung an die EU wie bei app.mietkartei.de richtet die Einrichtung nicht ein.

### Aktualisieren

Neue Versionen von mietkartei holst du dir selbst, wann du willst:

1. Lade vorher unter **Einstellungen → Export** eine Sicherung deiner Daten herunter. Solange mietkartei noch jung ist, kann ein Update Daten verändern.
2. Öffne deine Kopie auf GitHub, gehe auf **Actions → Update → Run workflow** und bestätige mit **Run workflow**.
3. Nach etwa einer Minute ist das Update in deiner Kopie. Cloudflare baut mietkartei dann neu, nach ein paar Minuten läuft die neue Version.

### Weitere Einstellungen

Optionale Funktionen schaltest du im Cloudflare-Dashboard unter **Workers & Pages → mietkartei → Einstellungen → Variablen und geheime Schlüssel** ein. Lege jeden Wert als Typ **Geheim** an; sie bleiben bei jedem Update erhalten.

- **Verbraucherpreisindex für Indexmieten:** Lege ein kostenloses Konto bei [GENESIS-Online](https://genesis.destatis.de) des Statistischen Bundesamts an und trage dessen API-Token als `GENESIS_API_TOKEN` ein.
- **Bankabruf:** Damit mietkartei die Umsätze selbst bei deiner Bank abholt, legst du eine kostenlose Anwendung bei Enable Banking an, wie unter [Bankabruf](#bankabruf) beschrieben. Als Weiterleitungsadresse nimmst du deine `.workers.dev`-Adresse mit `/bank/abruf` am Ende.

## Mit Docker

mietkartei läuft als ein einziger Docker-Container. Alle Daten liegen in einer SQLite-Datei, hochgeladene Dokumente als Dateien daneben.

!!! tip "Erreichbarkeit"
Der Befehl unten macht mietkartei nur auf deinem eigenen Rechner erreichbar. Den Betrieb auf einem Server beschreibt die [Serveranleitung](https://github.com/OliverHennhoefer/mietkartei.de/blob/main/.github/SELF_HOSTING.md) (englisch).

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

Damit mietkartei die Umsätze selbst bei deiner Bank abholt, legst du kostenlos eine eigene Anwendung bei [Enable Banking](https://enablebanking.com/cp/applications) an. Als Weiterleitungsadresse trägst du die Adresse deiner Installation mit `/bank/abruf` am Ende ein, etwa `https://mietkartei.example.de/bank/abruf` oder `https://mietkartei.dein-name.workers.dev/bank/abruf`. Mit Docker setzt du außerdem `ORIGIN` auf dieselbe Adresse. Ohne Vertrag läuft die Anwendung im eingeschränkten Modus und ruft nur Konten ab, die du im Control Panel von Enable Banking verknüpft hast. Das ist kostenlos und reicht für die eigenen Konten. Die Anwendungs-Id und den heruntergeladenen privaten Schlüssel übergibst du als `ENABLE_BANKING_APP_ID` und `ENABLE_BANKING_PRIVATE_KEY`.

## Straßenkarte

Ohne weitere Einstellung zeigt jedes Objekt eine kleine Deutschlandkarte mit einem Punkt an seiner Postleitzahl. Für eine Straßenkarte der Umgebung lädst du mit dem Programm [pmtiles](https://github.com/protomaps/go-pmtiles/releases) einen Ausschnitt Deutschlands aus den Kartendaten von OpenStreetMap, die [Protomaps](https://maps.protomaps.com/builds/) täglich baut. Er ist einige Gigabyte groß:

```sh
pmtiles extract https://build.protomaps.com/20261025.pmtiles deutschland.pmtiles \
  --bbox=5.5,47.1,15.5,55.2 --maxzoom=14
```

Lege die Datei ins Datenverzeichnis und setze `MAP_TILES_PATH=/data/deutschland.pmtiles`. mietkartei fragt dann einmal je Adresse beim Geocoder von OpenStreetMap nach, wo ein Objekt liegt; übermittelt wird nur die Adresse. Mit `GEOCODER_URL=off` unterbleibt das, die Karte zeigt dann die Gegend der Postleitzahl.

## Weiterführend

- Alle Einstellungen über Umgebungsvariablen, etwa für den Mailversand, stehen in der [Beschreibung der Anwendung](https://github.com/OliverHennhoefer/mietkartei.de/blob/main/app/README.md).
- Den Betrieb auf einem kleinen Server, erreichbar über ein privates Netz, beschreibt die [Serveranleitung](https://github.com/OliverHennhoefer/mietkartei.de/blob/main/.github/SELF_HOSTING.md) (englisch).
