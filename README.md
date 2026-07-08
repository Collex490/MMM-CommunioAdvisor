# MMM-CommunioAdvisor

MagicMirror-Modul fuer Comunio/Kickbase-Screenshots mit Telegram-Upload, OpenAI-Vision-Analyse und Rollenspiel-Geruechtekueche.

Version 0.1 ist bewusst einfach gehalten:

- keine offizielle Comunio- oder Kickbase-API
- keine Logins
- kein Scraping
- Demo-Daten aus `data/latest.json`
- vorbereitetes Node.js-Backend fuer Telegram und OpenAI

## Anzeige

Das Modul zeigt:

- Liga: WM Comunio
- Beste Kaufempfehlung
- Verkaufskandidat
- Startelf-Risiko
- Budget-Hinweis
- Ligatabelle mit Punkten
- Transfermarkt-Laufbanner fuer Kaeufe und Verkaeufe
- Teamaufstellung als gespeichertes Screenshot-Bild
- Kader-Check fuer Halten, Verkaufen/Tauschen und Beobachten
- Geruechtekueche mit optional generiertem Fantasy-Sportmedien-Bild
- Zeitstempel der letzten Analyse

Design: dunkler Hintergrund, goldene Akzente fuer Pasta La Vista FC, gut lesbar auf dem MagicMirror.

## Installation auf dem Raspberry Pi

1. Modulordner kopieren:

   ```bash
   cp -r MMM-CommunioAdvisor /home/pi/MagicMirror/modules/
   ```

2. Abhaengigkeiten installieren:

   ```bash
   cd /home/pi/MagicMirror/modules/MMM-CommunioAdvisor
   npm install
   ```

3. MagicMirror-Konfiguration sichern:

   ```bash
   cp /home/pi/MagicMirror/config/config.js /home/pi/MagicMirror/config/config.js.backup-$(date +%Y%m%d-%H%M%S)
   ```

4. Modul in `/home/pi/MagicMirror/config/config.js` eintragen:

   ```js
   {
     module: "MMM-CommunioAdvisor",
     position: "middle_center",
     config: {
       updateInterval: 5 * 60 * 1000,
       dataFile: "modules/MMM-CommunioAdvisor/data/latest.json",
       title: "WM Comunio",
       clubName: "Pasta La Vista FC",
       showStandings: true,
       showTransferTicker: true,
       showLineupImage: true,
       showSquadInsights: true,
       showRumorImage: true
     }
   }
   ```

5. Carousel-Seite 3 konfigurieren.

   In deiner aktuellen `MMM-Carousel`-Konfiguration nutzt du `mode: "slides"` mit einer `slides`-Liste. Ergaenze dort eine dritte Seite fuer den Comunio Advisor:

   ```js
   {
     module: "MMM-Carousel",
     position: "bottom_center",
     config: {
       transitionInterval: 60000,
       mode: "slides",
       showPageIndicators: true,
       showPageControls: false,
       slides: [
         ["clock", "calendar", "weather", "weatherforecast", "MMM-Traffic", "MMM-MovieListings"],
         ["MMM-OnSpotify", "updatenotification", "MMM-MyTeams-LeagueTable", "MMM-Fuel"],
         ["MMM-CommunioAdvisor"]
       ]
     }
   }
   ```

   Wichtig: `MMM-CommunioAdvisor` muss zusaetzlich als eigenes Modul in der `modules`-Liste stehen. Der Carousel-Block steuert nur, auf welcher Seite es angezeigt wird.

6. MagicMirror neu starten:

   ```bash
   pm2 restart MagicMirror
   ```

## Demo testen

Die Datei `data/latest.json` enthaelt Beispielwerte. MagicMirror sollte die Karten direkt anzeigen, sobald das Modul in der Konfiguration aktiv ist.

## Telegram/OpenAI vorbereiten

1. `.env.example` nach `.env` kopieren:

   ```bash
   cp .env.example .env
   ```

2. Werte in `.env` setzen:

  - `TELEGRAM_BOT_TOKEN`: Token vom BotFather
  - `TELEGRAM_ALLOWED_CHAT_ID`: optional, aber empfohlen
  - `OPENAI_API_KEY`: OpenAI API-Key
  - `COMMUNIO_ADVISOR_GENERATE_RUMOR_IMAGE`: `true`, wenn zu jeder Analyse ein fiktives Geruechte-Bild generiert werden soll
  - `COMMUNIO_ADVISOR_DATA_PATH`: Zielpfad der JSON-Datei
  - `COMMUNIO_ADVISOR_UPLOAD_DIR`: Zielordner fuer hochgeladene Screenshots
  - `COMMUNIO_ADVISOR_PUBLIC_UPLOAD_BASE`: oeffentlicher MagicMirror-Pfad fuer Uploads

Geruechtebilder sind bewusst als fiktive Parodie angelegt. Sie nutzen keine echten Logos oder 1:1-Layouts von Kicker, Transfermarkt, BILD oder anderen Medienmarken.

3. Telegram-Bot starten:

   ```bash
   npm run telegram
   ```

4. Screenshot an den Bot senden.

Der Bot speichert die aktuelle Tagesuebersicht in `data/latest.json`. MagicMirror liest diese Datei automatisch nach.

### Telegram-Modi

Der Bot kann automatisch erkennen, welcher Screenshot-Typ gesendet wurde. Fuer Version 1 ist es aber zuverlaessiger, vorher einen Modus zu setzen. Pro Modus koennen auch 2-3 Screenshots nacheinander geschickt werden; der Bot fuegt passende Daten zur Tagesuebersicht zusammen.

```text
/auto
/transfers
/tabelle
/aufstellung
/budget
/kader
/kapitaen Sorloth
/logo
/status
```

Beispiele:

```text
/transfers
```

Danach 2-3 Transfermarkt-Screenshots schicken. Der Bot sammelt die erkannten Kaeufe und Verkaeufe im Transfermarkt-Banner.

```text
/aufstellung
```

Danach die offizielle Aufstellung schicken. Der Bot speichert sie als `uploads/latest-lineup.jpg` und zeigt sie auf dem MagicMirror an.

```text
/kader
```

Danach den Kader schicken. Der Bot fuellt den Kader-Check mit Halten, Verkaufen/Tauschen und Beobachten.

```text
/kapitaen Sorloth
```

Setzt den Kapitaen oben rechts im Modul.

```text
/logo
```

Danach ein Logo-Bild schicken. Der Bot speichert es als `uploads/club-logo.jpg` und zeigt es oben rechts neben dem Kapitaen an.
Fuer transparente Logos die PNG am besten als Telegram-Datei/Dokument senden; dann speichert der Bot `uploads/club-logo.png`.

Auch bei `/tabelle`, `/budget` und `/kader` duerfen mehrere Screenshots nacheinander kommen, wenn nicht alles auf ein Bild passt.

## Lokaler API-Modus

Optional kann ein kleiner lokaler Server gestartet werden:

```bash
npm run backend
```

Endpoint:

- `GET http://127.0.0.1:8787/api/latest`
- `POST http://127.0.0.1:8787/api/latest`

Fuer Version 1 reicht der Datei-Modus. Der API-Modus ist als Erweiterung vorbereitet.

## Datenformat

```json
{
  "league": "WM Comunio",
  "source": {
    "platform": "Comunio",
    "screenType": "squad"
  },
  "club": {
    "name": "Pasta La Vista FC",
    "boss": "Patron Co",
    "coach": "Gennaro Gattuso",
    "colors": ["Schwarz", "Gold"],
    "motto": "Mangia, Lotta, Vinci",
    "captain": "Sorloth"
  },
  "recommendations": {
    "buy": {
      "player": "Name",
      "reason": "Warum kaufen?",
      "confidence": "mittel"
    },
    "sell": {
      "player": "Name",
      "reason": "Warum verkaufen?",
      "confidence": "mittel"
    },
    "risk": {
      "player": "Name",
      "reason": "Startelf- oder Rotationsrisiko",
      "confidence": "mittel"
    },
    "budget": {
      "title": "Budget-Hinweis",
      "reason": "Budget-Einschaetzung",
      "confidence": "hoch"
    }
  },
  "standings": [
    {
      "rank": 1,
      "name": "Pasta La Vista FC",
      "points": 138,
      "isUserClub": true
    },
    {
      "rank": 2,
      "name": "Sporting Bolzackerer",
      "points": 131
    }
  ],
  "transferTicker": [
    {
      "action": "Gekauft",
      "player": "Nico Williams",
      "club": "Sporting Bolzackerer",
      "price": "7,8 Mio."
    },
    {
      "action": "Verkauft",
      "player": "Rotationsverteidiger",
      "club": "Squadra Absenta",
      "price": "1,4 Mio."
    }
  ],
  "lineupImage": {
    "url": "modules/MMM-CommunioAdvisor/uploads/latest-lineup.jpg",
    "alt": "Aktuelle Teamaufstellung",
    "updatedAt": "2026-07-08T12:51:00.000Z"
  },
  "squadInsights": {
    "keep": ["Sorloth halten"],
    "sell": ["Bankspieler ohne Einsatzgarantie pruefen"],
    "watch": ["Rotation im Mittelfeld beobachten"]
  },
  "rumorKitchen": {
    "headline": "Patron Co prueft Last-Minute-Deal",
    "body": "Gattuso fordert mehr Biss im Mittelfeld."
  },
  "rumorImage": {
    "url": "modules/MMM-CommunioAdvisor/uploads/latest-rumor.png",
    "alt": "Fiktive Sportmedien-Schlagzeile",
    "updatedAt": "2026-07-08T12:51:00.000Z"
  },
  "generatedAt": "2026-07-08T12:51:00.000Z"
}
```

## Naechste Ausbaustufen

- Screenshot-Typ sicherer klassifizieren: Kader, Transfermarkt, Budget, Aufstellung
- Tabellen-Screenshots und Transfermarkt-Screenshots zu einer gemeinsamen Ligazentrale zusammenfuehren
- Mehrere Screenshots zu einer gemeinsamen Analyse zusammenfuehren
- Historie in `data/history/` speichern
- Kickbase-spezifische Felder ergaenzen
- API-Anbindung erst spaeter und getrennt vom MagicMirror-Frontend einbauen
