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
              "Erstelle Empfehlungen fuer buy, sell, risk und budget.",
              "Klassifiziere source.screenType moeglichst exakt als squad, transfermarket, budget, standings oder lineup.",
              "Nutze diese Rollenspielwelt: Pasta La Vista FC, Patron Co, Gennaro Gattuso, Motto Mangia Lotta Vinci, Kapitaen Sorloth; Sporting Bolzackerer mit Mister Rob und Ruben Amorim; Squadra Absenta mit Don Rib.",
              "Wenn der Screenshot eine Tabelle zeigt, extrahiere standings als Array mit rank, name, matchdayPoints, totalPoints, marketValue und isUserClub. Wichtig: Bei Comunio-Tabellen ist die linke Punktzahl der letzte Spieltag bzw. Spieltagspunkte, die rechte Punktzahl sind die Gesamtpunkte.",
              "Wenn der Screenshot Transferaktivitaet zeigt, extrahiere transferTicker als Array mit action, player, club und price.",
              "Wenn der Screenshot eine Aufstellung zeigt, nutze source.screenType lineup.",
              "Wenn der Screenshot Budget, Kontostand oder Geld zeigt, extrahiere budgetStatus mit amount und note.",
              "Wenn der Screenshot einen Kader zeigt, extrahiere squadInsights mit keep, sell und watch als Textarrays.",
              "Nutze exakt dieses JSON-Schema: { league: string, source: { platform: string, screenType: string }, club: { name: string, boss: string, coach: string, colors: string[], motto: string, captain: string }, recommendations: { buy: { player: string, reason: string, confidence: string }, sell: { player: string, reason: string, confidence: string }, risk: { player: string, reason: string, confidence: string }, budget: { title: string, reason: string, confidence: string } }, standings: [{ rank: number, name: string, matchdayPoints: number, totalPoints: number, marketValue: string, isUserClub: boolean }], transferTicker: array, budgetStatus: { amount: string, note: string }, squadInsights: { keep: string[], sell: string[], watch: string[] }, lineupImage: object, rumorKitchen: { headline: string, body: string }, generatedAt: string }.",
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
