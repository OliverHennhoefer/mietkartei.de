# Markenressourcen

Hier liegen die gemeinsamen Originaldateien für Dokumentation, README und die künftige Anwendung.

| Datei | Verwendung |
| --- | --- |
| [logo.svg](logo.svg) | Schwarze Wortmarke für helle Hintergründe |
| [logo-white.svg](logo-white.svg) | Weiße Wortmarke für dunkle Hintergründe |
| [favicon.svg](favicon.svg) | Weißer Hausumriss auf schwarzem Grund als Browser-Symbol |
| [fonts/geist/](fonts/geist/) | Originalschrift mit Quelle und SIL-OFL-Lizenz |
| [variants/](variants/) | Gestaltungsvarianten und frühere Schriftvergleiche |

Die ausgewählte Wortmarke zeigt **mietkartei** in einer Zeile, gesetzt in **Geist Medium (500)** mit nativer Laufweite und Kerning. Die originalen Schriftkonturen sind in SVG-Pfade umgewandelt; zur Darstellung muss die Schrift nicht installiert sein. Die beiden Logos direkt in diesem Ordner bilden die schlichte Grundversion. Zusätzliche Entwürfe liegen unter `variants/`.

Als Gestaltungsprobe verwendet die öffentliche Startseite derzeit [geist-highlight.svg](variants/geist-highlight.svg): „miet“ bleibt unverändert, „kartei“ steht weiß in einer schwarzen rechteckigen Fläche. [geist-highlight-white.svg](variants/geist-highlight-white.svg) kehrt die Farben für dunkle Hintergründe um. Beide Varianten verwenden ebenfalls die originalen Geist-Konturen und werden vom selben Skript erzeugt.

Das ausgewählte Favicon zeigt einen weißen Hausumriss auf schwarzem Grund und ist auf 16 und 32 Pixel ausgelegt. Die SVG-Zeichnung wird direkt in `favicon.svg` bearbeitet. Die Entwürfe [Kartei](variants/favicon-card-index.svg) und [Haus](variants/favicon-house.svg) bleiben als Gestaltungsreferenz verfügbar.

Die Wortmarken-Exporte lassen sich mit Python 3.12 aus der mitgelieferten Originalschrift neu erzeugen:

```sh
python -m pip install -r scripts/requirements-brand.txt
python scripts/generate_brand_logos.py
```

`python scripts/prepare_docs_assets.py` kopiert die beiden ausgewählten Logos, das Favicon und Geist mit der OFL-Lizenz nach `docs/assets/brand/`. Diese erzeugten Kopien werden nicht eingecheckt. Die Dokumentationsgestaltung bleibt in `docs/assets/stylesheets/`. Startseite, Dokumentation und Anwendung verwenden dieselbe lokale Originalschrift über ihren jeweiligen Build.
