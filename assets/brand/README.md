# Markenressourcen

Hier liegen die gemeinsamen Originaldateien für Dokumentation, README und die künftige Anwendung.

| Datei | Verwendung |
| --- | --- |
| [logo.svg](logo.svg) | Schwarze Wortmarke für helle Hintergründe |
| [logo-white.svg](logo-white.svg) | Weiße Wortmarke für dunkle Hintergründe |
| [variants/](variants/) | Frühere Schriftvarianten und Vergleichstafel als Gestaltungsreferenz |

Die ausgewählte Wortmarke verwendet die originalen Konturen von **Helvetica Neue Medium**. Die Schrift ist in Pfade umgewandelt; zur Darstellung muss sie nicht installiert sein. Die Varianten sind Entwürfe; verwende für neue Einbindungen die beiden Logos direkt in diesem Ordner.

Ändere die Originale hier. `python scripts/prepare_docs_assets.py` kopiert ausschließlich die beiden ausgewählten Logos nach `docs/assets/brand/`. Diese erzeugten Kopien werden nicht eingecheckt. Die Dokumentationsgestaltung bleibt in `docs/assets/stylesheets/`. Die künftige Anwendung kann dieselben Originale über ihren eigenen Build einbinden.
