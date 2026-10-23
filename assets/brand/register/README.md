# Registerfaltung — gewählte Bildmarke

Die gewählte Bildmarke für **mietkartei** verbindet geordnete Registereinträge mit einer gemeinsamen räumlichen Falte. Die drei parallelen Ebenen geben dem Zeichen einen Bezug zur Kartei. Die zurücklaufenden Kanten erzeugen Tiefe. Die Gestaltung bleibt abstrakt und vollständig schwarz-weiß.

| Datei | Verwendung |
| --- | --- |
| [mark.svg](mark.svg), [mark-white.svg](mark-white.svg) | Schwarze und weiße Bildmarke auf transparentem Hintergrund |
| [lockup.svg](lockup.svg), [lockup-white.svg](lockup-white.svg) | Bildmarke mit der originalen Geist-Medium-Wortmarke |
| [small.svg](small.svg) | Kleine schwarze Fassung mit weiter geöffneter senkrechter Fuge |
| [favicon.svg](favicon.svg) | Kleine weiße Fassung auf schwarzem Grund |
| [construction.py](construction.py), [geometry.json](geometry.json) | Reproduzierbare Vektorkonstruktion und Maße |

Die Bildmarke und das Favicon verwenden eine 96 × 96 große Zeichenfläche. Für kleine Darstellungen ist die senkrechte Fuge geöffnet. Die Wortmarken-Kombinationen stehen als ergänzende SVGs zur Verfügung.

## Einheitliche Flächen

Die untere Ebene besitzt keine zusätzliche senkrechte Stirnfläche mehr. Sie verwendet dieselbe vierseitige Flächengeometrie und dieselbe projizierte Dicke wie die mittlere Ebene und der obere Umschlag. Der Rücken ist entsprechend gekürzt, damit seine Unterkante mit der unteren Ebene in derselben Projektion abschließt.

Die Projektionsachsen bleiben bei `(1, -0.4)` und `(1, 0.45)`. Auch die Breite, die parallelen Zwischenräume, die senkrechte Fuge und der Abstand zur Wortmarke bleiben erhalten. Durch den leichteren unteren Abschluss wird das Zeichen insgesamt niedriger. Es ist in seiner 96 × 96 großen Zeichenfläche neu vertikal zentriert.

Die kleine Fassung öffnet die senkrechte Fuge so weit, dass sie bei 16 Pixeln Exportgröße genau einem Pixel entspricht. Alle Aussparungen bleiben transparent. Schwarze und weiße Bildmarke verwenden dieselbe Geometrie. Die Kombinationen enthalten die vorhandenen [Geist-Konturen](../logo.svg) als Pfade und benötigen keine installierte Schrift.

## Quellen und Einsatz

Zum erneuten Erzeugen genügt Python 3: `python3 assets/brand/register/construction.py` vom Repository-Stamm aus. Das Skript verwendet die vorhandene Wortmarke im übergeordneten Ordner und aktualisiert dort auch die gemeinsam eingebundenen Exporte `mark.svg`, `mark-white.svg` und `favicon.svg`.

Startseite, Impressum, Anwendung, Dokumentationskopf und Repository-README verwenden die Bildmarke ohne Schriftzug. Die Webseiten-Builds übernehmen die gemeinsamen Exporte aus dem übergeordneten Ordner. Die Wortmarken-Kombinationen bleiben als zusätzliche Ressource in diesem Ordner verfügbar.
