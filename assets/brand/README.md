# Markenressourcen

Die **Registerfaltung** ist die ausgewählte Bildmarke für mietkartei. Drei geordnete Eintragsebenen werden von einer gemeinsamen räumlichen Falte gehalten. Alle Ebenen folgen derselben dünnen Flächengeometrie; die Gestaltung bleibt vollständig schwarz-weiß.

| Datei | Verwendung |
| --- | --- |
| [mark.svg](mark.svg) | Schwarze Bildmarke für helle Hintergründe |
| [mark-white.svg](mark-white.svg) | Weiße Bildmarke für dunkle Hintergründe |
| [lockup.svg](lockup.svg), [lockup-white.svg](lockup-white.svg) | Bildmarke mit Wortmarke für Startseite, Impressum, Dokumentation und README |
| [favicon.svg](favicon.svg) | Kleine weiße Registerfaltung auf schwarzem Grund als Browser-Symbol |
| [favicon.ico](favicon.ico), [apple-touch-icon.png](apple-touch-icon.png) | Gerasterte Fassungen des Favicons für Browser ohne SVG-Favicon (Safari) und für den Home-Bildschirm, aus `favicon.svg` gerendert |
| [register/](register/README.md) | Vektorkonstruktion, Maße, kleine Fassung und Wortmarken-Kombinationen |
| [logo.svg](logo.svg), [logo-white.svg](logo-white.svg) | Bestehende Geist-Medium-Wortmarken, weiterhin als separate Ressource verfügbar |
| [fonts/geist/](fonts/geist/) | Originalschrift mit Quelle und SIL-OFL-Lizenz |
| [variants/](variants/) | Gestaltungsvarianten und frühere Vergleiche |

Startseite, Impressum, Dokumentationskopf und Repository-README zeigen die Bildmarke zusammen mit der Wortmarke. Die Anwendung verwendet die Bildmarke allein. Die Webseiten verwenden dasselbe Favicon. Helle und dunkle Ansichten zeigen die passende schwarze beziehungsweise weiße Bildmarke; der Link zur Startseite behält den zugänglichen Namen „mietkartei“.

Die Bildmarken und das Favicon direkt in diesem Ordner sind Exporte der gewählten Konstruktion unter `register/`. Sie lassen sich mit Python 3 neu erzeugen:

```sh
python3 assets/brand/register/construction.py
```

Das Skript erzeugt die SVGs unter `register/` und aktualisiert `mark.svg`, `mark-white.svg`, `lockup.svg`, `lockup-white.svg` und `favicon.svg` in diesem Ordner. Die kleine Fassung öffnet die senkrechte Fuge für die Anzeige bei 16 Pixeln. Alle Aussparungen der freistehenden Bildmarke bleiben transparent.

`python3 scripts/build_homepage.py` übernimmt die ausgewählten Bildmarken, Wortmarken-Kombinationen, das Favicon und die Seitenschrift in den Startseiten-Build. `python3 scripts/prepare_docs_assets.py` kopiert dieselben fünf Marken-SVGs und Geist mit der OFL-Lizenz nach `docs/assets/brand/`. Die Anwendung importiert Bildmarke, Favicon und Schrift direkt aus diesem gemeinsamen Ordner. Diese erzeugten Kopien werden nicht eingecheckt. Die Dokumentationsgestaltung bleibt in `docs/assets/stylesheets/`.

Die Wortmarke zeigt **mietkartei** in einer Zeile, gesetzt in **Geist Medium (500)** mit nativer Laufweite und Kerning. Ihre Originalkonturen sind SVG-Pfade. Die Wortmarke bleibt für Kombinationen mit dem Zeichen verfügbar; für die Darstellung muss die Schrift nicht installiert sein. Die Schrift-Exporte lassen sich aus der mitgelieferten Originalschrift neu erzeugen:

```sh
python -m pip install -r scripts/requirements-brand.txt
python scripts/generate_brand_logos.py
```

Frühere Schriftvergleiche bleiben unter [variants/](variants/) als Gestaltungsreferenz verfügbar. Sie gehören nicht zu den öffentlichen Builds.
