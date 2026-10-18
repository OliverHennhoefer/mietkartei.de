# Öffentliche Startseite pflegen

Die statische Baustellenseite unter `https://mietkartei.de/` stellt das Projekt kurz vor und verlinkt auf die Dokumentation. Sie besteht aus HTML und CSS. Geist, Wortmarken und Favicon werden aus den gemeinsamen Markenressourcen übernommen; die Seite benötigt kein JavaScript.

## Vorschau

Führe die folgenden Befehle im Stammverzeichnis mit Python 3 aus:

```sh
python3 scripts/build_homepage.py
python3 -m http.server 8002 --bind 127.0.0.1 --directory dist/homepage
```

Öffne anschließend [http://127.0.0.1:8002](http://127.0.0.1:8002). Nach Änderungen erzeugst du die Ausgabe erneut. Prüfe die Darstellung auf kleinen Bildschirmen und die Verweise zur Dokumentation.

## Dateien

| Pfad | Aufgabe |
| --- | --- |
| `website/index.html` | Öffentliche deutsche Startseite |
| `website/impressum/index.html` | Impressum mit Platzhaltern für Anbieter- und Kontaktdaten |
| `website/styles.css` | Darstellung, einschließlich heller und dunkler Farben |
| `website/assets/house-blueprint.svg` | Dekorative Hauszeichnung für die Startseite |
| `website/_headers` | HTTP-Antwortheader für Cloudflare |
| `website/robots.txt` | Angaben für Suchmaschinen |
| `website/wrangler.toml` | Cloudflare-Worker und benutzerdefinierte Domain |
| `scripts/build_homepage.py` | Erzeugt die öffentliche Ausgabe mit gemeinsamen Ressourcen |
| `dist/homepage/` | Erzeugte Ausgabe; wird nicht eingecheckt |

Der Build übernimmt nur die aufgeführten öffentlichen Dateien, die Hauszeichnung, die beiden Wortmarken, die zwei Geist-Varianten mit invertiertem „kartei“, das Favicon sowie die Originalschrift mit ihrer OFL-Lizenz. Die Schrift und die Marken-SVGs werden in `assets/brand/` gepflegt. Der Startseitenkopf zeigt derzeit die hervorgehobene Gestaltungsvariante aus `assets/brand/variants/`. Seitenspezifische Illustrationen liegen in `website/assets/`.

Das Impressum ist unter `/impressum/` erreichbar. Ersetze die Angaben in eckigen Klammern durch die tatsächlichen Anbieter- und Kontaktdaten und entferne nicht zutreffende optionale Angaben.

## Veröffentlichung

Cloudflare liefert die Seite als statische Assets des Workers **mietkartei-startseite** aus. Die benutzerdefinierte Domain ist `mietkartei.de`. Die Dokumentation bleibt unabhängig davon auf GitHub Pages unter `docs.mietkartei.de`.

Erzeuge bei Aktualisierungen die Ausgabe neu. Anschließend kannst du mit einem bereits angemeldeten Wrangler veröffentlichen:

```sh
python3 scripts/build_homepage.py
npx wrangler@4 deploy --config website/wrangler.toml
```

Alternativ wählst du den Worker im Cloudflare-Dashboard aus und lädst bei einer neuen statischen Bereitstellung ausschließlich den Inhalt von `dist/homepage/` hoch. Der erste Stand wurde auf diesem Weg veröffentlicht. Eine automatische Git-Verknüpfung ist noch nicht eingerichtet.

Für eine spätere Git-Verknüpfung mit Cloudflare Builds sind das Repository-Stammverzeichnis, der Produktionszweig `main`, der Build-Befehl `python3 scripts/build_homepage.py` und der Deploy-Befehl `npx wrangler@4 deploy --config website/wrangler.toml` vorgesehen. Die bestehenden GitHub-Actions-Abläufe veröffentlichen ausschließlich die Dokumentation.
