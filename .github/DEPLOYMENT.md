# Webseiten auf Cloudflare veröffentlichen

Startseite und Dokumentation liegen im selben Repository und werden als zwei statische Cloudflare Workers veröffentlicht. Zensical erzeugt weiterhin die Dokumentation; GitHub Pages wird nach der Umstellung nicht mehr benötigt.

| Adresse | Worker | GitHub-Umgebung | Konfiguration | Ausgabe |
| --- | --- | --- | --- | --- |
| `https://mietkartei.de/` | `mietkartei-de` | `website-production` | `website/wrangler.toml` | `dist/homepage/` |
| `https://docs.mietkartei.de/` | `mietkartei-de-docs` | `documentation` | `docs/wrangler.toml` | `site/` |

Beide Seiten sind öffentlich. Eine spätere Anwendung mit Anmeldung und Bezahlschranke erhält eine eigene Bereitstellung und eigene Zugangskontrollen.

## Einmalige Einrichtung

Führe diese Schritte vor dem Merge der Umstellung aus. Änderungen am Repository allein schalten die bisherigen Cloudflare- und GitHub-Einstellungen nicht um.

### 1. Cloudflare-Zugang für GitHub anlegen

1. Öffne in Cloudflare die API-Token-Verwaltung und erstelle ein Token mit der Vorlage **Edit Cloudflare Workers**. Beschränke es auf das verwendete Konto und die Zone **mietkartei.de**. Das Token muss Workers erstellen beziehungsweise veröffentlichen und die benutzerdefinierten Domains verwalten dürfen.
2. Öffne im Repository **Settings → Secrets and variables → Actions → New repository secret**.
3. Hinterlege `CLOUDFLARE_API_TOKEN` mit dem erzeugten Token und `CLOUDFLARE_ACCOUNT_ID` mit der Cloudflare-Konto-ID. Die Konto-ID steht in der Cloudflare-Kontoübersicht und in der Dashboard-URL.

Die Werte gehören in GitHub Secrets. Die Anleitung von Cloudflare beschreibt [Token und GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/). Weitere Tokens, eine interaktive Anmeldung im Workflow oder zusätzliche GitHub-Token sind nicht erforderlich.

### 2. GitHub-Umgebungen einrichten

Öffne **Settings → Environments** und richte **website-production** und **documentation** ein. Beschränke die erlaubten Bereitstellungszweige jeweils auf **main**. Die Secrets aus Schritt 1 gelten für beide Umgebungen; bei stattdessen verwendeten Umgebungs-Secrets müssen sie in beiden hinterlegt werden.

Die Umgebung **github-pages** wird von diesem Workflow nicht mehr verwendet. Ihre bisherigen Deployment-Einträge können erhalten bleiben. Sie muss nicht umbenannt werden. Die bestehende Pflichtprüfung **Dokumentation prüfen** bleibt unter demselben Namen erhalten und prüft bei relevanten Änderungen auch die Startseite.

### 3. Automatische Cloudflare-Builds abschalten

Der vorhandene Startseiten-Worker muss **mietkartei-de** heißen; die Wrangler-Konfiguration verwendet diesen Namen. Öffne den Worker unter **Workers & Pages → Settings → Builds** und schalte die automatischen Produktions- und Vorschau-Builds der bisherigen Git-Integration ab beziehungsweise trenne die Build-Verbindung zum Repository. Der bestehende Worker und seine Domain bleiben bestehen.

GitHub Actions übernimmt künftig die Builds und Deployments. Der zusätzliche Workflow zur Übernahme von Workers-Builds-Checks entfällt, da die Deployment-Jobs ihre GitHub-Umgebungen direkt verwenden. Für den neuen Dokumentations-Worker wird keine Cloudflare-Git-Integration benötigt.

### 4. Dokumentationsdomain umstellen und veröffentlichen

1. Stelle sicher, dass die Prüfung des Umstellungs-Pull-Requests erfolgreich ist und die beiden Secrets eingerichtet sind.
2. Entferne in **Cloudflare → mietkartei.de → DNS → Records** ausschließlich den bisherigen Eintrag **CNAME docs → oliverhennhoefer.github.io**. Die Root-Domain bleibt unverändert.
3. Merge den Pull Request in **main**. Unter **Actions → Webseiten** baut und veröffentlicht der erste Lauf beide Seiten. Wrangler aktualisiert **mietkartei-de**, erstellt **mietkartei-de-docs** und registriert `docs.mietkartei.de` als dessen Custom Domain.
4. Prüfe unter **Workers & Pages → mietkartei-de-docs → Settings → Domains & Routes**, dass die Custom Domain vorhanden und das Zertifikat aktiv ist. Öffne anschließend `https://docs.mietkartei.de/` und kontrolliere die Startseite, Logos und Verweise. Die von Wrangler ausgegebene `workers.dev`-Adresse ermöglicht zusätzlich die direkte Prüfung des Dokumentations-Workers.
5. Sobald die Dokumentation über Cloudflare einschließlich HTTPS funktioniert, entferne die benutzerdefinierte Domain in den GitHub-Pages-Einstellungen und veröffentliche die bisherige Pages-Seite nicht weiter. Die alte Umgebung **github-pages** kannst du anschließend bei Bedarf löschen.

Eine vorhandene CNAME verhindert die Registrierung einer Cloudflare Custom Domain. Cloudflare übernimmt danach DNS und Zertifikat; lege keinen neuen CNAME auf `workers.dev` an. Während der Umstellung kann die Dokumentationsdomain kurzzeitig nicht erreichbar sein. Einzelheiten stehen in der [Cloudflare-Anleitung für Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

## Laufende Veröffentlichung

Der Workflow [webseiten.yml](workflows/webseiten.yml) läuft für Pull Requests und nach einem Push auf `main`. Er ermittelt die geänderten Dateien und baut beziehungsweise veröffentlicht nur die betroffene Seite:

| Änderung | Startseite | Dokumentation |
| --- | --- | --- |
| `website/**`, `scripts/build_homepage.py` | Ja | Nein |
| `docs/**`, `zensical.toml`, `scripts/prepare_docs_assets.py` | Nein | Ja |
| `assets/brand/**`, `.github/workflows/webseiten.yml` | Ja | Ja |
| Andere Dateien | Nein | Nein |

Auch gelöschte Dateien und beide Seiten einer Umbenennung werden berücksichtigt. Die Pflichtprüfung läuft für jeden Pull Request; Änderungen ohne Webseitenbezug benötigen keinen Build. Pull Requests veröffentlichen keine Dateien und erhalten keine Cloudflare-Secrets. Nach dem Merge werden die geprüften Ausgaben desselben Workflow-Laufs veröffentlicht. Die beiden Deployment-Jobs laufen unabhängig voneinander und verwenden pro Ziel eine gemeinsame Parallelitätsgruppe.

Für eine vollständige erneute Veröffentlichung wählst du **Actions → Webseiten → Run workflow → Branch: main**. Der manuelle Lauf baut und veröffentlicht beide Seiten. Auf anderen Zweigen prüft er lediglich die Builds.

## Fehler und Rückkehr zum bisherigen Hosting

Fehlende Secrets oder unzureichende Token-Rechte lassen den jeweiligen Deployment-Job fehlschlagen. Ein Fehler bei einer Seite verhindert nicht die Veröffentlichung der anderen, sofern die gemeinsame Build-Prüfung erfolgreich war. Wiederhole den fehlgeschlagenen Job nach der Korrektur oder starte den Workflow auf `main` erneut.

Wenn die Domain noch nicht auf Cloudflare zeigt, kontrolliere zuerst, ob der alte `docs`-CNAME entfernt und die Custom Domain registriert wurde. Für eine Rückkehr zu GitHub Pages entfernst du die Custom Domain vom Dokumentations-Worker und stellst den bisherigen CNAME mit **DNS only** sowie die GitHub-Pages-Domain wieder her. Der bisherige Pages-Stand bleibt bis zum erfolgreichen Wechsel verfügbar; für künftige Pages-Veröffentlichungen müsste auch der frühere Workflow wiederhergestellt werden.
