# Zu mietkartei.de beitragen

Du kannst mit Code, Fehlerberichten, Vorschlägen, Dokumentation, Gestaltung und Verbesserungen der Barrierefreiheit mithelfen. Kleine, nachvollziehbare Beiträge erleichtern die gemeinsame Weiterentwicklung.

## Bevor du beginnst

- Lies den [Verhaltenskodex](CODE_OF_CONDUCT.md).
- Suche in den [vorhandenen Issues](https://github.com/OliverHennhoefer/mietkartei.de/issues), ob dein Anliegen bereits beschrieben wurde. Ergänze bestehende Meldungen mit neuen Informationen.
- Besprich größere Änderungen zunächst in einem Issue. Beschreibe das Problem, das gewünschte Ergebnis und den vorgesehenen Umfang.
- Melde Sicherheitslücken über den [vertraulichen Meldeweg](SECURITY.md).

Deutsch ist die gemeinsame Sprache für Issues, Pull Requests und Dokumentation. Technische Bezeichner und etablierte Begriffe dürfen in ihrer üblichen Schreibweise bleiben.

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

Für Änderungen an der öffentlichen Startseite führe `python3 scripts/build_homepage.py` aus und prüfe die Vorschau gemäß der [Startseitenanleitung](.github/STARTSEITE.md).

Das Repository enthält derzeit noch keinen Anwendungscode. Für Änderungen an der Dokumentationsseite richte die Umgebung gemäß der [Dokumentationsanleitung](.github/DOKUMENTATION.md) ein und führe im Stammverzeichnis die folgenden Befehle aus:

```sh
python scripts/prepare_docs_assets.py
zensical build --clean --strict
```

Der GitHub-Actions-Ablauf „Dokumentation“ meldet für jeden Pull Request die Prüfung „Dokumentation prüfen“ und baut die Seite bei relevanten Änderungen, einschließlich der gemeinsamen Markenressourcen.

Prüfe außerdem passend zu deinem Beitrag:

- Bei Dokumentation: Verständlichkeit, Schreibweise, Verweise und Darstellung.
- Bei GitHub-Formularen: gültige YAML-Syntax, eindeutige Feldkennungen, Pflichtfelder und Verweise auf vorhandene Bezeichnungen.
- Bei Grafiken: Darstellung, Lesbarkeit, Skalierung und Transparenz.
- Bei Automatisierungen: Auslöser, Berechtigungen und das Verhalten bei wiederholter Ausführung.

Sobald Anwendungscode und weitere Prüfwerkzeuge hinzukommen, ergänzen wir hier die konkreten Befehle. Erkläre im Pull Request, welche Prüfung du durchgeführt hast und welche Einschränkungen bestehen.

## Begutachtung

Die Projektverantwortlichen prüfen Beiträge auf Nutzen, Verständlichkeit und Auswirkungen. Rückfragen und Änderungswünsche helfen dabei, den Beitrag gemeinsam fertigzustellen. Wenn du eine größere Überarbeitung vornimmst, aktualisiere auch die Beschreibung des Pull Requests.

## Rechte und Quellen

Die Projektlizenz steht in [LICENSE](LICENSE). Stelle sicher, dass du die eingebrachten Inhalte beitragen darfst. Kennzeichne übernommene Inhalte und ergänze gegebenenfalls die zugehörigen Quellen und Lizenzhinweise.
