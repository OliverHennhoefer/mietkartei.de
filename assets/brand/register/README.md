# Registerfaltung — gewählte Bildmarke

Die gewählte Bildmarke für **mietkartei** verbindet geordnete Registereinträge mit einer gemeinsamen räumlichen Falte. Die drei parallelen Ebenen geben dem Zeichen einen Bezug zur Kartei. Die zurücklaufenden Kanten erzeugen Tiefe. Die Gestaltung bleibt abstrakt und vollständig schwarz-weiß.

| Datei | Verwendung |
| --- | --- |
| [mark.svg](mark.svg), [mark-white.svg](mark-white.svg) | Schwarze und weiße Bildmarke auf transparentem Hintergrund |
| [lockup.svg](lockup.svg), [lockup-white.svg](lockup-white.svg) | Bildmarke mit der originalen Geist-Medium-Wortmarke |
| [lockup-auto.svg](lockup-auto.svg) | Dieselbe Kombination, schwarz und im dunklen Modus des Betrachters weiß; für das Repository-README, wo die GitHub-App `<picture>`-Quellen nicht beachtet |
| [small.svg](small.svg) | Kleine schwarze Fassung mit weiter geöffneter senkrechter Fuge |
| [favicon.svg](favicon.svg) | Kleine weiße Fassung auf schwarzem Grund |
| [construction.py](construction.py), [geometry.json](geometry.json) | Reproduzierbare Vektorkonstruktion und Maße |

Die Bildmarke und das Favicon verwenden eine 96 × 96 große Zeichenfläche. Für kleine Darstellungen ist die senkrechte Fuge geöffnet. Die Wortmarken-Kombinationen werden auf den öffentlichen Seiten als gemeinsame Signatur verwendet.

## Einheitliche Flächen

Die untere Ebene besitzt keine zusätzliche senkrechte Stirnfläche mehr. Sie verwendet dieselbe vierseitige Flächengeometrie und dieselbe projizierte Dicke wie die mittlere Ebene und der obere Umschlag. Der Rücken ist entsprechend gekürzt, damit seine Unterkante mit der unteren Ebene in derselben Projektion abschließt.

Die Projektionsachsen bleiben bei `(1, -0.4)` und `(1, 0.45)`. Die Breite der freistehenden Bildmarke, die parallelen Zwischenräume und die senkrechte Fuge bleiben erhalten. Durch den leichteren unteren Abschluss wird das Zeichen insgesamt niedriger. Es ist in seiner 96 × 96 großen Zeichenfläche neu vertikal zentriert.

Die kleine Fassung öffnet die senkrechte Fuge so weit, dass sie bei 16 Pixeln Exportgröße genau einem Pixel entspricht. Alle Aussparungen bleiben transparent. Schwarze und weiße Bildmarke verwenden dieselbe Geometrie. Die Kombinationen enthalten die vorhandenen [Geist-Konturen](../logo.svg) als Pfade und benötigen keine installierte Schrift.

## Verhältnis zur Wortmarke

In der gemeinsamen Signatur ist die Bildmarke auf 78 Einheiten Höhe vergrößert. Die originalen Geist-Konturen behalten ihre Höhe von 58 Einheiten. Beide sind vertikal zentriert, mit 21 Einheiten Abstand. Dadurch erhält das Zeichen neben dem Namen mehr Gewicht. Die gemeinsame Zeichenfläche misst 469 × 96 Einheiten.

Startseite und Impressum zeigen diese Kombination mit 52 Pixeln Höhe, auf kleinen Bildschirmen mit 44 Pixeln. Der Dokumentationskopf verwendet 44 beziehungsweise 40 Pixel. Die Anwendung zeigt das freistehende Zeichen in einer 52 × 52 Pixel großen Fläche.

## Quellen und Einsatz

Zum erneuten Erzeugen genügt Python 3: `python3 assets/brand/register/construction.py` vom Repository-Stamm aus. Das Skript verwendet die vorhandene Wortmarke im übergeordneten Ordner und aktualisiert dort auch die gemeinsam eingebundenen Exporte `mark.svg`, `mark-white.svg`, `lockup.svg`, `lockup-white.svg`, `lockup-auto.svg` und `favicon.svg`.

Startseite, Impressum, Dokumentationskopf und Repository-README verwenden Bildmarke und Wortmarke zusammen. Die Anwendung behält das freistehende Zeichen. Die Webseiten-Builds übernehmen die gemeinsamen Exporte aus dem übergeordneten Ordner.
