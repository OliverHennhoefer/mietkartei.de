# Zu mietkartei.de beitragen

Du kannst mit Code, Fehlerberichten, Vorschlägen, Dokumentation, Gestaltung und Verbesserungen der Barrierefreiheit mithelfen. Kleine, nachvollziehbare Beiträge erleichtern die gemeinsame Weiterentwicklung.

## Bevor du beginnst

- Lies den [Verhaltenskodex](CODE_OF_CONDUCT.md).
- Suche in den [vorhandenen Issues](https://github.com/OliverHennhoefer/mietkartei.de/issues), ob dein Anliegen bereits beschrieben wurde. Ergänze bestehende Meldungen mit neuen Informationen.
- Besprich größere Änderungen zunächst in einem Issue. Beschreibe das Problem, das gewünschte Ergebnis und den vorgesehenen Umfang.
- Melde Sicherheitslücken über den [vertraulichen Meldeweg](SECURITY.md).

Issues, Diskussionen und Dokumentation schreiben wir auf Deutsch. Alles rund um den Code ist englisch: Bezeichner, Kommentare, Commit-Nachrichten, Pull Requests und Reviews. Details stehen unter [Sprachen und Fachbegriffe](#sprachen-und-fachbegriffe).

## Das passende Issue erstellen

Nutze die [Issue-Auswahl](https://github.com/OliverHennhoefer/mietkartei.de/issues/new/choose):

- **Fehler melden:** Beschreibe das beobachtete Verhalten, das erwartete Ergebnis und die Schritte zum Nachstellen.
- **Funktion vorschlagen:** Erkläre das zugrunde liegende Problem und wer von der Änderung profitieren würde.
- **Dokumentation verbessern:** Verlinke die betroffene Stelle und beschreibe, was fehlt oder unklar ist.
- **Frage stellen:** Gib den nötigen Kontext und deine bisherigen Versuche an.

Verwende für Beispiele fiktive Daten. Entferne personenbezogene Angaben und Zugangsdaten aus Bildschirmfotos, Protokollen und Anhängen.

## Einen Pull Request vorbereiten

1. Erstelle einen Fork und lade ihn lokal herunter.
2. Lege einen eigenen Zweig für deine Änderung an.
3. Beschränke den Beitrag auf ein zusammenhängendes Anliegen.
4. Prüfe deine Änderung und dokumentiere das Ergebnis.
5. Erstelle einen Pull Request gegen `main` und fülle die Vorlage aus. Für laufende Arbeit kannst du einen Entwurf öffnen.

Verweise auf das zugehörige Issue, falls eines vorhanden ist. Erläutere das Problem und das Verhalten nach der Änderung, damit andere den Beitrag ohne zusätzliche Vorgeschichte beurteilen können.

## Änderungen prüfen

Für Änderungen an der Anwendung in `app/` führe dort die folgenden Befehle aus. Einrichtung, lokale Entwicklung und die End-to-End-Tests für beide Laufzeiten beschreibt [app/README.md](app/README.md).

```sh
npm run lint
npm run check
npm run test:unit -- --run
npm run test:e2e
```

Der GitHub-Actions-Ablauf **App** führt diese Prüfungen für jeden Pull Request aus, der die Anwendung betrifft, testet sie auf Node.js und in der Cloudflare-Laufzeit und baut das Docker-Image. Änderst du das Datenbankschema, erzeuge mit `npm run db:generate` eine Migration und committe sie mit.

Für Änderungen an der öffentlichen Startseite führe `python3 scripts/build_homepage.py` aus und prüfe die Vorschau gemäß der [Startseitenanleitung](.github/HOMEPAGE.md).

Für Änderungen an der Dokumentationsseite richte die Umgebung gemäß der [Dokumentationsanleitung](.github/DOCUMENTATION.md) ein und führe im Stammverzeichnis die folgenden Befehle aus:

```sh
python scripts/prepare_docs_assets.py
zensical build --clean --strict
```

Der GitHub-Actions-Ablauf **Websites** meldet für jeden Pull Request die Pflichtprüfung **Check websites** und baut bei relevanten Änderungen die Dokumentation beziehungsweise die Startseite. Änderungen an den gemeinsamen Markenressourcen betreffen beide Seiten. Pull Requests veröffentlichen keine Dateien. Die [Deployment-Anleitung](.github/DEPLOYMENT.md) beschreibt die Veröffentlichung aus `main`.

Prüfe außerdem passend zu deinem Beitrag:

- Bei Dokumentation: Verständlichkeit, Schreibweise, Verweise und Darstellung.
- Bei GitHub-Formularen: gültige YAML-Syntax, eindeutige Feldkennungen, Pflichtfelder und Verweise auf vorhandene Bezeichnungen.
- Bei Grafiken: Darstellung, Lesbarkeit, Skalierung und Transparenz.
- Bei Automatisierungen: Auslöser, Berechtigungen und das Verhalten bei wiederholter Ausführung.

Erkläre im Pull Request, welche Prüfung du durchgeführt hast und welche Einschränkungen bestehen.

## Begutachtung

Die Projektverantwortlichen prüfen Beiträge auf Nutzen, Verständlichkeit und Auswirkungen. Rückfragen und Änderungswünsche helfen dabei, den Beitrag gemeinsam fertigzustellen. Wenn du eine größere Überarbeitung vornimmst, aktualisiere auch die Beschreibung des Pull Requests.

## Sprachen und Fachbegriffe

Die Anwendung richtet sich an Vermieter in Deutschland, deshalb sind Oberfläche, Webseiten und Dokumentation deutsch. Code und alles, was zur Entwicklung gehört, ist englisch.

Viele Begriffe des Mietrechts haben keine genaue englische Entsprechung. Verwende im Code deshalb die Bezeichnungen aus dieser Tabelle und ergänze sie, wenn ein neuer Fachbegriff hinzukommt:

| Deutscher Begriff | Im Code | Bedeutung |
| --- | --- | --- |
| Vermieter | `landlord` | Person, die vermietet und die Anwendung nutzt |
| Mieter | `tenant` | Vertragspartei eines Mietvertrags |
| Objekt | `property` | Gebäude oder Grundstück mit einer oder mehreren Einheiten |
| Einheit | `unit` | Wohnung, Gewerbeeinheit oder Stellplatz innerhalb eines Objekts |
| Mietvertrag | `lease` | Vertrag über eine Einheit |
| Kaltmiete | `baseRent` | Miete ohne Betriebskosten |
| Betriebskosten | `operatingCosts` | Umlagefähige laufende Kosten nach § 556 BGB und Betriebskostenverordnung |
| Betriebskostenvorauszahlung | `operatingCostPrepayment` | Monatliche Vorauszahlung auf die Betriebskosten |
| Betriebskostenabrechnung | `operatingCostStatement` | Jährliche Abrechnung der Betriebskosten gegenüber den Vorauszahlungen, oft Nebenkostenabrechnung genannt |
| Umlageschlüssel | `allocationKey` | Verteilung von Kosten, etwa nach Fläche, Personen oder Verbrauch |
| Mietsicherheit (Kaution) | `securityDeposit` | Sicherheitsleistung des Mieters |
| Zählerstand | `meterReading` | Ablesewert eines Zählers zu einem Stichtag |

### Pfade

Die Pfade der Seiten sieht man in der Adresszeile, deshalb sind sie deutsch: klein geschrieben, Wörter mit Bindestrich getrennt und ohne Umlaute oder ß (`ae`, `oe`, `ue`, `ss`), etwa `/objekte/neu`, `/passwort-vergessen` oder `/dokumente/[id]/herunterladen`. Endpunkte, die keine Seite sind, liegen unter `/api/` und sind englisch, etwa `/api/webhooks/stripe` oder `/api/e2e/seed`. Bezeichner im Code bleiben englisch, auch wenn sie zu einem deutschen Pfad gehören.

Ausnahme ist `/health`: Docker, die CI und Überwachungsdienste fragen diesen Pfad ab, und er heißt in fast allen Anwendungen so.

## Rechte und Quellen

Die Projektlizenz steht in [LICENSE](LICENSE). Stelle sicher, dass du die eingebrachten Inhalte beitragen darfst. Kennzeichne übernommene Inhalte und ergänze gegebenenfalls die zugehörigen Quellen und Lizenzhinweise.

Beiträge stehen unter derselben Lizenz wie das Projekt, der GNU Affero General Public License, Version 3. Eine Übertragung von Rechten oder eine Contributor License Agreement verlangen wir nicht. Eine gehostete Variante von mietkartei.de verwendet den Code aus diesem Repository; für sie gelten dieselben Lizenzpflichten wie für alle anderen Betreiber.
