# GitHub-Vorlagen und Projektverwaltung

## Vorlagen aktivieren

GitHub verwendet die Issue- und Pull-Request-Vorlagen aus dem Standardzweig `main`. Nach dem Übernehmen dieser Dateien sind die vier Issue-Formulare und die Pull-Request-Vorlage dort verfügbar. Die unterstützten Ablageorte sind in der [GitHub-Dokumentation zu Vorlagen](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/about-issue-and-pull-request-templates) beschrieben.

| Datei | Aufgabe |
| --- | --- |
| `ISSUE_TEMPLATE/01-fehler.yml` | Fehlerberichte mit Schritten zum Nachstellen |
| `ISSUE_TEMPLATE/02-funktionswunsch.yml` | Vorschläge mit Problem und gewünschtem Ergebnis |
| `ISSUE_TEMPLATE/03-dokumentation.yml` | Hinweise auf fehlende oder unklare Dokumentation |
| `ISSUE_TEMPLATE/04-frage.yml` | Fragen zur Nutzung, Einrichtung und Mitarbeit |
| `ISSUE_TEMPLATE/config.yml` | Auswahl der Formulare und vertraulichen Meldewege |
| `PULL_REQUEST_TEMPLATE.md` | Beschreibung, Prüfung und Hinweise zu einem Beitrag |
| `CODEOWNERS` | Zuständigkeit für die Begutachtung |
| `labels.json` | Deutsche Bezeichnungen und ihre Beschreibungen |
| `workflows/bezeichnungen.yml` | Anlegen und Aktualisieren der Bezeichnungen |
| `workflows/dokumentation.yml` | Prüfen und Veröffentlichen der Dokumentation |
| `DOKUMENTATION.md` | Vorschau, Build und Veröffentlichung der Dokumentation |
| `dependabot.yml` | Wöchentliche Aktualisierungsvorschläge für Abhängigkeiten |
| `release.yml` | Kategorien für automatisch generierte Versionshinweise |
| `RELEASE_TEMPLATE.md` | Manuell verwendete Vorlage für eine Versionsbeschreibung |

Die Dateien [CONTRIBUTING.md](../CONTRIBUTING.md), [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md), [SECURITY.md](../SECURITY.md) und [SUPPORT.md](../SUPPORT.md) beschreiben Mitarbeit, Verhalten, Sicherheitsmeldungen und Unterstützung.

## Bezeichnungen verwalten

Ändere Namen, Farben und Beschreibungen in [labels.json](labels.json). Der Arbeitsablauf „Bezeichnungen synchronisieren“ läuft bei einer Änderung dieser Konfiguration oder seines eigenen Ablaufs auf `main`. Er lässt sich auch im Bereich „Actions“ manuell starten. Für die Ausführung müssen GitHub Actions im Repository aktiviert sein.

Der Ablauf legt fehlende Bezeichnungen an und aktualisiert abweichende Einträge. Andere Bezeichnungen werden nicht gelöscht. Er verwendet das von GitHub bereitgestellte Repository-Token und benötigt dafür Lesezugriff auf Inhalte und Schreibzugriff auf Issues. Die verwendete Aktion ist auf einen konkreten Commit festgelegt.

Behalte Namen, die in den Issue-Formularen oder in `release.yml` verwendet werden, mit der Konfiguration konsistent. Nutze „guter einstieg“ für klar abgegrenzte Aufgaben und „hilfe gesucht“, wenn Unterstützung ausdrücklich willkommen ist.

## GitHub-Aktionen aktuell halten

[dependabot.yml](dependabot.yml) prüft die dort aufgeführten Abhängigkeiten montags um 07:00 Uhr in der Zeitzone Europe/Berlin auf neue Versionen und erstellt bei Bedarf Pull Requests. Die Vorschläge werden mit „abhängigkeiten“ und „wartung“ eingeordnet. Die unterstützten Optionen stehen in der [Dependabot-Dokumentation](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference).

Prüfe solche Änderungen vor dem Zusammenführen auf neue Berechtigungen und Auswirkungen auf den Ablauf. Halte verwendete Aktionen weiterhin auf konkrete Commit-IDs festgelegt.

## Dokumentation veröffentlichen

Der Ablauf [dokumentation.yml](workflows/dokumentation.yml) meldet für jeden Pull Request die Prüfung „Dokumentation prüfen“. Er prüft geänderte Dateien auf fehlerhafte Leerzeichen und baut die Dokumentationsseite bei Änderungen in `docs/`, an `zensical.toml` oder an seiner eigenen Workflow-Datei. Solange noch keine Dokumentationsseite eingerichtet ist, entfällt der Build. Vorhandene Markdown-Seiten ohne Zensical-Konfiguration lassen die Prüfung fehlschlagen.

Nach relevanten Änderungen auf `main` veröffentlicht der Ablauf die Seite auf GitHub Pages. Dafür muss in den [Pages-Einstellungen](https://github.com/OliverHennhoefer/mietkartei.de/settings/pages) die Quelle „GitHub Actions“ gewählt sein. Ein manueller Start auf `main` ist ebenfalls möglich. Die [Dokumentationsanleitung](DOKUMENTATION.md) beschreibt Vorschau, Build und Domain.

## Standardzweig schützen

Für `main` werden Pull Requests auch für Administratoren verlangt. Eine zusätzliche Freigabe ist beim aktuellen Einzelmaintainer nicht erforderlich. Vor dem Zusammenführen müssen die Prüfung „Dokumentation prüfen“ erfolgreich und alle Begutachtungsgespräche abgeschlossen sein. Direkte Pushes, Force-Pushes und das Löschen von `main` bleiben gesperrt.

Die Pflichtprüfung läuft ohne Pfadfilter auf jedem Pull Request. Dadurch bleiben Beiträge ohne Dokumentationsänderungen nicht wegen einer fehlenden Statusmeldung blockiert. Weitere Anwendungstests werden mit dem Anwendungscode ergänzt.

## Eine Version veröffentlichen

1. Prüfe die für die Version vorgesehenen Änderungen und ihren Stand im Standardzweig.
2. Ordne die Pull Requests mit den passenden Bezeichnungen ein. Kennzeichne insbesondere inkompatible Änderungen und Sicherheitskorrekturen.
3. Erstelle auf GitHub einen Release-Entwurf mit dem vorgesehenen Tag und dem richtigen Commit.
4. Kopiere bei Bedarf die [Versionsvorlage](RELEASE_TEMPLATE.md) in die Beschreibung. Diese Datei wird nicht automatisch in das Release-Formular eingefügt.
5. Erzeuge die Versionshinweise und prüfe sie. `release.yml` ordnet die Einträge deutschen Kategorien zu; „Weitere Änderungen“ erfasst Beiträge ohne passende Kategorie. Das Verhalten ist in der [GitHub-Dokumentation zu Versionshinweisen](https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes) beschrieben.
6. Ergänze erforderliche Aktualisierungsschritte und bekannte Einschränkungen. Aktualisiere bei Bedarf die unterstützten Versionen in [SECURITY.md](../SECURITY.md).
7. Veröffentliche die Version nach der abschließenden Prüfung.

Behalte bei Änderungen am vertraulichen Meldeweg [SECURITY.md](../SECURITY.md) und [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) konsistent.
