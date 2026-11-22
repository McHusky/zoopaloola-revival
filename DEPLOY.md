# Zoopaloola Revival - Hosten und lokal starten

## Lokal

Voraussetzung: Node.js 20 oder neuer.

```bash
npm start
```

Danach `http://localhost:3000` oeffnen. Keine externen npm-Abhaengigkeiten notwendig.

## Render Free + GitHub

1. Alle Projektdateien (einschliesslich `render.yaml`) in ein GitHub-Repository hochladen.
2. In Render **New -> Blueprint** waehlen, GitHub verbinden und das Repository auswaehlen.
3. Kostenlosen Plan pruefen, Blueprint erstellen und die oeffentliche URL abwarten.
4. Die URL im README beim Abschnitt "Spielen" eintragen und an Freunde weitergeben.

Hinweis: Render Free kann bei Inaktivitaet schlafen. Die Spielraeume werden nur im RAM gespeichert. Nach einem Neustart sind bestehende Raeume nicht mehr vorhanden.

## Technik

- Reiner Node.js-HTTP-Server ohne zusaetzliche Abhaengigkeiten.
- Serverautoritative 2D-Kollisionen, Reibung, Wandreflexion, offene Taschen, Zugwechsel.
- Server-Sent Events fuer Live-Updates; HTTP-Polling als Fallback.
- Sitzungsschluessel pro Spieler im Browser (`localStorage`), private 6-stellige Raumcodes.
- Eigene Canvas-Vektorgrafiken und per WebAudio synthetisierte Sounds (keine Assets aus dem Originalspiel).
- Tests: `npm test`.

Hinweis: Dieses Projekt ist ein inoffizieller Fan-Nachbau, kein offizielles Zoopaloola.
