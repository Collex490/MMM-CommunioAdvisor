const fs = require("fs/promises");
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function analyzeScreenshot(imagePath) {
  const imageBuffer = await fs.readFile(imagePath);
  const base64Image = imageBuffer.toString("base64");

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
              "Erstelle Empfehlungen fuer buy, sell, risk und budget.",
              "Klassifiziere source.screenType moeglichst exakt als squad, transfermarket, budget, standings oder lineup.",
              "Nutze diese Rollenspielwelt: Pasta La Vista FC, Patron Co, Gennaro Gattuso, Motto Mangia Lotta Vinci, Kapitaen Sorloth; Sporting Bolzackerer mit Mister Rob und Ruben Amorim; Squadra Absenta mit Don Rib.",
              "Wenn der Screenshot eine Tabelle zeigt, extrahiere standings als Array mit rank, name, points und isUserClub.",
              "Wenn der Screenshot Transferaktivitaet zeigt, extrahiere transferTicker als Array mit action, player, club und price.",
              "Wenn der Screenshot eine Aufstellung zeigt, nutze source.screenType lineup.",
              "Nutze exakt dieses JSON-Schema: { league: string, source: { platform: string, screenType: string }, club: { name: string, boss: string, coach: string, colors: string[], motto: string, captain: string }, recommendations: { buy: { player: string, reason: string, confidence: string }, sell: { player: string, reason: string, confidence: string }, risk: { player: string, reason: string, confidence: string }, budget: { title: string, reason: string, confidence: string } }, standings: array, transferTicker: array, lineupImage: object, rumorKitchen: { headline: string, body: string }, generatedAt: string }.",
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
