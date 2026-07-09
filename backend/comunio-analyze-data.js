const fs = require("fs/promises");
const path = require("path");
const OpenAI = require("openai");
const { normalizeAnalysis } = require("./normalize-analysis");
const { mergeWithExisting } = require("./merge-analysis");

require("dotenv").config({
  path: path.join(__dirname, "..", ".env")
});

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const dataPath = process.env.COMMUNIO_ADVISOR_DATA_PATH
  || path.join(__dirname, "..", "data", "latest.json");
const sourcePath = process.env.COMMUNIO_API_ANALYZE_SOURCE
  || process.env.COMUNIO_API_ANALYZE_SOURCE
  || path.join(__dirname, "..", "data", "comunio-api-raw.json");

async function analyzeComunioRawData(rawPayload) {
  const response = await client.chat.completions.create({
    model: process.env.OPENAI_TEXT_MODEL || process.env.OPENAI_VISION_MODEL || "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "Du analysierst Rohdaten aus Comunio-Seiten fuer ein MagicMirror-Modul.",
          "Gib ausschliesslich JSON im bekannten ComunioAdvisor-Schema zurueck.",
          "Erfinde keine exakten Spieler, Punkte, Marktwerte oder Budgets, wenn sie in den Rohdaten nicht stehen.",
          "Nutze die Daten, um Tabelle, Kader, Aufstellung, Transfers, Transfermarkt, Budget und Managerempfehlungen zu extrahieren.",
          "Die vier recommendation-Kacheln muessen analytische Manager-Hinweise sein, keine technischen Meta-Saetze.",
          "Schreibe niemals Formulierungen wie 'API geladen', 'Screenshot sichtbar', 'Computer ist aktuell sichtbar' oder 'nach ChatGPT-Analyse verfeinern' in Kacheln.",
          "Beste Kaufempfehlung muss aus aktuellen Marktangeboten/offers kommen. Nutze niemals 'Computer' als Spielername.",
          "Verkaufskandidat muss aus dem eigenen Kader kommen und kurz begruenden, warum Verkauf oder Tausch sinnvoll sein koennte.",
          "Startelf-Risiko bedeutet: ein eigener Spieler mit unsicherer Rolle, schwacher Preis-Leistung, Rotations-/Minutenrisiko oder Bedarf zum Beobachten.",
          "Budget-Hinweis soll den erkannten Kontostand praktisch einordnen: aggressiv bieten, Reserve halten, erst verkaufen oder abwarten.",
          "Wenn es nur Login-/Fehlerseiten sind, lasse nicht belegbare Bereiche leer."
        ].join(" ")
      },
      {
        role: "user",
        content: [
          "Analysiere diese Comunio-Rohdaten.",
          "Rollenspielwelt: Pasta La Vista FC, Patron Co, Gennaro Gattuso, Motto Mangia Lotta Vinci, Captain Sorloth; Sporting Bolzackerer; Squadra Absenta.",
          "Schema: { league: string, source: { platform: string, screenType: string }, club: { name: string, boss: string, coach: string, colors: string[], motto: string, captain: string }, recommendations: { buy: { player: string, reason: string, confidence: string }, sell: { player: string, reason: string, confidence: string }, risk: { player: string, reason: string, confidence: string }, budget: { title: string, reason: string, confidence: string } }, marketCandidates: [{ player: string, price: string, seller: string, reason: string, priority: number }], standings: [{ rank: number, name: string, matchdayPoints: number, totalPoints: number, marketValue: string, isUserClub: boolean }], transferTicker: [{ action: string, player: string, club: string, price: string }], budgetStatus: { amount: string, note: string }, squadInsights: { keep: string[], sell: string[], watch: string[] }, rumorKitchen: { headline: string, body: string }, generatedAt: string }.",
          JSON.stringify(rawPayload).slice(0, 60000)
        ].join("\n\n")
      }
    ]
  });

  return JSON.parse(response.choices[0].message.content);
}

async function main() {
  const rawPayload = JSON.parse(await fs.readFile(sourcePath, "utf8"));
  const analysis = normalizeAnalysis(await analyzeComunioRawData(rawPayload));
  analysis.source = {
    platform: "Comunio",
    screenType: "api-analysis"
  };
  analysis.generatedAt = new Date().toISOString();

  const merged = await mergeWithExisting(dataPath, analysis);
  await fs.mkdir(path.dirname(dataPath), { recursive: true });
  await fs.writeFile(dataPath, JSON.stringify(merged, null, 2), "utf8");

  console.log(`Comunio-Rohdaten analysiert und gespeichert: ${dataPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
