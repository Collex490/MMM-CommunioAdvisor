const fs = require("fs/promises");
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function analyzeScreenshot(imagePath, options = {}) {
  const imageBuffer = await fs.readFile(imagePath);
  const base64Image = imageBuffer.toString("base64");
  const screenTypeHint = options.screenTypeHint || "auto";

  const response = await client.chat.completions.create({
    model: process.env.OPENAI_VISION_MODEL || "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "Du analysierst Comunio- und Kickbase-Screenshots fuer ein MagicMirror-Modul.",
          "Gib ausschliesslich JSON im vereinbarten Schema zurueck.",
          "Keine offiziellen APIs, keine Logins, keine erfundenen exakten Marktwerte, wenn sie im Bild nicht sichtbar sind.",
          "Die Geruechtekueche ist eine harmlose Sportmedien-Parodie im WM-2026-Rollenspiel."
        ].join(" ")
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "Analysiere den Screenshot.",
              `Vom Nutzer gesetzter Screenshot-Modus: ${screenTypeHint}. Wenn der Modus nicht auto ist, verwende ihn fuer source.screenType.`,
              "Erstelle in recommendations kurze, nutzbare Manager-Infos statt Meta-Erklaerungen. Keine Saetze wie 'im Screenshot ist nur...' oder 'keine Spieler sichtbar' als Kacheltext verwenden.",
              "Wenn der Screenshot keine Spieler zeigt, lasse buy, sell und risk leer oder gib nur allgemein strategische Hinweise ohne Spielername. Ueberschreibe keine vorhandenen Spielerempfehlungen mit Platzhaltern.",
              "Die Budget-Kachel soll eine konkrete Handlung enthalten, z. B. Maximalgebot, Reserve halten, aggressiv kaufen oder abwarten.",
              "Wenn source.screenType transfermarket ist, muss recommendations.buy zwingend den besten sichtbaren Kaufkandidaten enthalten. Schreibe diese Kaufempfehlung nicht nur in recommendations.budget. recommendations.buy.player darf nicht leer sein, wenn ein Spieler sichtbar ist.",
              "Wenn source.screenType squad ist, muss recommendations.sell zwingend einen echten Verkaufskandidaten aus dem sichtbaren Kader enthalten und recommendations.risk zwingend ein echtes Startelf-/Rollenrisiko aus dem Kader oder der Aufstellung. Nutze dafuer sichtbare Spielernamen.",
              "Wenn source.screenType lineup ist, muss recommendations.risk den wichtigsten sichtbaren Startelf- oder Rotationshinweis enthalten.",
              "Klassifiziere source.screenType moeglichst exakt als squad, transfermarket, transfernews, budget, standings oder lineup.",
              "Nutze diese Rollenspielwelt: Pasta La Vista FC, Patron Co, Gennaro Gattuso, Motto Mangia Lotta Vinci, Kapitaen Sorloth; Sporting Bolzackerer mit Mister Rob und Ruben Amorim; Squadra Absenta mit Don Rib.",
              "Wenn der Screenshot eine Tabelle zeigt, extrahiere standings als Array mit rank, name, matchdayPoints, totalPoints, marketValue und isUserClub. Wichtig: Bei Comunio-Tabellen ist die linke Punktzahl der letzte Spieltag bzw. Spieltagspunkte, die rechte Punktzahl sind die Gesamtpunkte.",
              "Wichtig: marketValue, Kaderwert, Teamwert oder Vereinswert sind kein Budget/Kontostand. Schreibe solche Werte nie in budgetStatus.amount.",
              "Wenn source.screenType transfermarket ist, geht es um aktuell angebotene Spieler auf dem Markt. Fuettere damit recommendations.buy, aber schreibe keine Marktangebote in transferTicker.",
              "Wenn source.screenType transfernews ist, geht es um abgeschlossene Kaeufe/Verkaeufe der Liga. Extrahiere nur dann transferTicker als Array mit action, player, club und price. Beispiele fuer action: gekauft, verkauft. Ignoriere alle Zeilen mit Computer, Markt, listed, gelistet oder freien Marktangeboten.",
              "Wenn der Screenshot eine Aufstellung zeigt, nutze source.screenType lineup.",
              "Nur wenn der Screenshot explizit Budget, Kontostand, Konto oder Geldbestand zeigt, extrahiere budgetStatus mit amount und note.",
              "Wenn der Screenshot einen Kader zeigt, extrahiere squadInsights mit keep, sell und watch als Textarrays.",
              "Nutze exakt dieses JSON-Schema: { league: string, source: { platform: string, screenType: string }, club: { name: string, boss: string, coach: string, colors: string[], motto: string, captain: string }, recommendations: { buy: { player: string, reason: string, confidence: string }, sell: { player: string, reason: string, confidence: string }, risk: { player: string, reason: string, confidence: string }, budget: { title: string, reason: string, confidence: string } }, standings: [{ rank: number, name: string, matchdayPoints: number, totalPoints: number, marketValue: string, isUserClub: boolean }], transferTicker: [{ action: string, player: string, club: string, price: string }], budgetStatus: { amount: string, note: string }, squadInsights: { keep: string[], sell: string[], watch: string[] }, lineupImage: object, rumorKitchen: { headline: string, body: string }, generatedAt: string }.",
              "Keine Arrays fuer recommendations.buy, recommendations.sell, recommendations.risk oder rumorKitchen verwenden."
            ].join(" ")
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${base64Image}`
            }
          }
        ]
      }
    ]
  });

  return JSON.parse(response.choices[0].message.content);
}

module.exports = { analyzeScreenshot };
