# Webseiten auf Cloudflare veröffentlichen

Startseite und Dokumentation liegen im selben Repository und werden durch einen gemeinsamen Workflow in der GitHub-Umgebung **production** veröffentlicht. Die Seiten verwenden zwei statische Cloudflare Workers. Zensical erzeugt weiterhin die Dokumentation; GitHub Pages wird nicht mehr benötigt.

| Adresse | Worker | GitHub-Umgebung | Konfiguration | Ausgabe |
| --- | --- | --- | --- | --- |
| `https://mietkartei.de/` | `mietkartei-de` | `production` | `website/wrangler.toml` | `dist/homepage/` |
| `https://docs.mietkartei.de/` | `mietkartei-de-docs` | `production` | `docs/wrangler.toml` | `site/` |

Beide Seiten sind öffentlich. Eine spätere Anwendung unter `app.mietkartei.de` kann denselben Workflow und dieselbe GitHub-Umgebung **production** verwenden. Anmeldung, Berechtigungsprüfungen und Laufzeit-Zugangsdaten werden in der Anwendung beziehungsweise ihrer Laufzeit eingerichtet.

## Einmalige Einrichtung

Führe diese Schritte vor dem Merge der Umstellung aus. Änderungen am Repository allein schalten die bisherigen Cloudflare- und GitHub-Einstellungen nicht um.

### 1. Cloudflare-Zugang für GitHub anlegen

1. Öffne in Cloudflare die API-Token-Verwaltung und verwende **Edit Cloudflare Workers** als Ausgangspunkt. Für diese beiden statischen Workers genügen **Account → Workers Scripts → Edit**, **Account → Account Settings → Read**, **Zone → Workers Routes → Edit** und **Zone → Zone → Read**. Beschränke die Ressourcen auf das verwendete Konto und die Zone **mietkartei.de**. Zusätzliche Berechtigungen für KV, R2, Container oder Cloudflare Pages sind nicht erforderlich.
2. Erstelle das Token ohne festgelegten Zeitraum. Cloudflare zeigt den generierten geheimen Wert nur einmal; der frei gewählte Tokenname ist kein Zugangsschlüssel.
3. Öffne im Repository **Settings → Secrets and variables → Actions → New repository secret** und hinterlege `CLOUDFLARE_ACCOUNT_ID` mit der Cloudflare-Konto-ID. Die Konto-ID steht in der Cloudflare-Kontoübersicht und in der Dashboard-URL.
4. Hinterlege den generierten Tokenwert anschließend wie in Schritt 2 beschrieben als Umgebungs-Secret `CLOUDFLARE_API_TOKEN` in **production**. Der Tokenwert gehört weder in den Quelltext noch in Protokolle oder Pull-Request-Beschreibungen.

Die Werte gehören in GitHub Secrets. Die Anleitung von Cloudflare beschreibt [Token und GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/). Weitere Tokens, eine interaktive Anmeldung im Workflow oder zusätzliche GitHub-Token sind nicht erforderlich.

### 2. GitHub-Umgebung einrichten

Öffne **Settings → Environments** und richte **production** ein. Wähle bei **Deployment branches and tags** **Selected branches and tags** und erlaube ausschließlich den Branch **main**; Tags bleiben ausgeschlossen. Öffne **Add environment secret** und hinterlege den generierten Tokenwert unter `CLOUDFLARE_API_TOKEN`. Die Konto-ID wird als Repository-Secret aus Schritt 1 übernommen. Dadurch steht der Deployment-Token nur Jobs zur Verfügung, die die geschützte Umgebung **production** verwenden.

Bei einer Umstellung von **website-production** und **documentation** muss **production** einschließlich Secret und Branch-Regel vor dem Merge eingerichtet sein. GitHub zeigt gespeicherte Secret-Werte nicht wieder an; verwende den ursprünglichen Tokenwert. Prüfe nach dem Merge, dass beide Deployment-Jobs in **production** erfolgreich sind. Anschließend können die bisherigen Umgebungen einschließlich **github-pages** entfernt werden. Beim Löschen einer Umgebung werden auch ihre Secrets und Schutzregeln gelöscht.

Die bestehende Pflichtprüfung **Dokumentation prüfen** bleibt unter demselben Namen erhalten und prüft bei relevanten Änderungen auch die Startseite.

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

Auch gelöschte Dateien und beide Seiten einer Umbenennung werden berücksichtigt. Die Pflichtprüfung läuft für jeden Pull Request; Änderungen ohne Webseitenbezug benötigen keinen Build. Pull Requests veröffentlichen keine Dateien und erhalten keine Cloudflare-Secrets. Nach dem Merge werden die geprüften Ausgaben desselben Workflow-Laufs veröffentlicht. Produktionsläufe desselben Branches werden vollständig nacheinander verarbeitet; bis zu 100 Läufe können warten, ohne einen vorher wartenden Lauf zu verdrängen. Innerhalb eines Laufs können die beiden Deployment-Jobs parallel arbeiten. Bei Pull Requests ersetzt ein neuer Lauf weiterhin die veraltete Prüfung.

Für eine vollständige erneute Veröffentlichung wählst du **Actions → Webseiten → Run workflow → Branch: main**. Der manuelle Lauf baut und veröffentlicht beide Seiten. Auf anderen Zweigen prüft er lediglich die Builds.

## Fehler und Rückkehr zum bisherigen Hosting

Fehlende Secrets oder unzureichende Token-Rechte lassen den jeweiligen Deployment-Job fehlschlagen. Ein Fehler bei einer Seite verhindert nicht die Veröffentlichung der anderen, sofern die gemeinsame Build-Prüfung erfolgreich war. Wiederhole den fehlgeschlagenen Job nach der Korrektur oder starte den Workflow auf `main` erneut.

Wenn die Domain noch nicht auf Cloudflare zeigt, kontrolliere zuerst, ob der alte `docs`-CNAME entfernt und die Custom Domain registriert wurde. Für eine Rückkehr zu GitHub Pages entfernst du die Custom Domain vom Dokumentations-Worker und stellst den bisherigen CNAME mit **DNS only** sowie die GitHub-Pages-Domain wieder her. Der bisherige Pages-Stand bleibt bis zum erfolgreichen Wechsel verfügbar; für künftige Pages-Veröffentlichungen müsste auch der frühere Workflow wiederhergestellt werden.
