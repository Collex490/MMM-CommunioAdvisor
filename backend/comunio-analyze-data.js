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

async function readJsonIfExists(filePath, fallback = {}) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function compactPayloadForAnalysis(rawPayload, currentData) {
  const relevantPages = (rawPayload.pages || [])
    .filter((page) => page?.status === 200 && page.json)
    .filter((page) => /lineup|squad|offers|matchdays|news|standings|market/i.test(page.url || ""))
    .map((page) => ({
      url: page.url,
      contentType: page.contentType,
      jsonPreview: JSON.stringify(page.json).slice(0, 12000)
    }))
    .slice(0, 10);

  return {
    latestStructuredData: {
      league: currentData.league,
      club: currentData.club,
      standings: currentData.standings || [],
      transferTicker: currentData.transferTicker || [],
      budgetStatus: currentData.budgetStatus || {},
      marketCandidates: currentData.marketCandidates || [],
      squadPlayers: currentData.squadPlayers || [],
      squadInsights: currentData.squadInsights || {},
      matchdays: currentData.matchdays || [],
      lineupImage: currentData.lineupImage || {},
      generatedAt: currentData.generatedAt
    },
    rawApiExtracts: relevantPages
  };
}

async function analyzeComunioRawData(payload) {
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
          "Nutze latestStructuredData zuerst; rawApiExtracts sind nur Zusatzbelege.",
          "Nutze die Daten, um Tabelle, Kader, Aufstellung, Transfers, Transfermarkt, Budget und Managerempfehlungen zu bewerten.",
          "Die vier recommendation-Kacheln muessen analytische Manager-Hinweise sein, keine technischen Meta-Saetze.",
          "Schreibe niemals Formulierungen wie 'API geladen', 'Screenshot sichtbar', 'Computer ist aktuell sichtbar' oder 'nach ChatGPT-Analyse verfeinern' in Kacheln.",
          "Schreibe auch niemals 'Noch keine Daten', 'nicht verwertbar' oder 'keine auslesbaren Daten', wenn latestStructuredData bereits Markt, Kader, Budget oder Tabelle enthaelt.",
          "Beste Kaufempfehlung muss aus aktuellen Marktangeboten/offers kommen. Nutze niemals 'Computer' als Spielername.",
          "Empfiehl keinen Spieler zum Kauf, der in squadPlayers steht oder dessen Marktangebot vom eigenen Club Pasta La Vista FC stammt; solche Spieler sind eigene Verkaufsangebote.",
          "Wenn marketCandidates leer ist, setze recommendations.buy auf title 'Keine Kaufempfehlung' mit kurzer Begruendung: kein fremdes Angebot attraktiv, Budget halten.",
          "Verkaufskandidat muss aus dem eigenen Kader kommen und kurz begruenden, warum Verkauf oder Tausch sinnvoll sein koennte.",
          "Startelf-Risiko bedeutet: ein eigener Spieler mit unsicherer Rolle, schwacher Preis-Leistung, Rotations-/Minutenrisiko oder Bedarf zum Beobachten.",
          "Verkaufskandidat und Startelf-Risiko sollen unterschiedliche Spieler sein, wenn mindestens zwei eigene Kaderspieler verfuegbar sind.",
          "Budget-Hinweis soll den erkannten Kontostand praktisch einordnen: aggressiv bieten, Reserve halten, erst verkaufen oder abwarten.",
          "squadInsights.keep, squadInsights.sell und squadInsights.watch muessen kurze begruendete Saetze sein, nicht nur Spielernamen. Format pro Eintrag: 'Spieler: konkrete Begruendung in maximal 16 Woertern'.",
          "Nenne im Kader-Check nur Spieler, die im aktuellen Kader oder in der aktuellen Aufstellung vorkommen. Verkauft- oder Transfernews-Spieler duerfen dort nicht auftauchen, wenn sie nicht mehr im Kader stehen.",
          "Wenn es nur Login-/Fehlerseiten sind, lasse nicht belegbare Bereiche leer."
        ].join(" ")
      },
      {
        role: "user",
        content: [
          "Analysiere diese strukturierten Comunio-Daten fuer die MagicMirror-Kacheln.",
          "Rollenspielwelt: Pasta La Vista FC, Patron Co, Gennaro Gattuso, Motto Mangia Lotta Vinci, Captain Sorloth; Sporting Bolzackerer; Squadra Absenta.",
          "Schema: { league: string, source: { platform: string, screenType: string }, club: { name: string, boss: string, coach: string, colors: string[], motto: string, captain: string }, recommendations: { buy: { player: string, reason: string, confidence: string }, sell: { player: string, reason: string, confidence: string }, risk: { player: string, reason: string, confidence: string }, budget: { title: string, reason: string, confidence: string } }, marketCandidates: [{ player: string, price: string, seller: string, reason: string, priority: number }], standings: [{ rank: number, name: string, matchdayPoints: number, totalPoints: number, marketValue: string, isUserClub: boolean }], transferTicker: [{ action: string, player: string, club: string, price: string }], budgetStatus: { amount: string, note: string }, squadInsights: { keep: string[], sell: string[], watch: string[] }, rumorKitchen: { headline: string, body: string }, generatedAt: string }.",
          JSON.stringify(payload).slice(0, 60000)
        ].join("\n\n")
      }
    ]
  });

  return JSON.parse(response.choices[0].message.content);
}

async function main() {
  const rawPayload = await readJsonIfExists(sourcePath, {});
  const currentData = await readJsonIfExists(dataPath, {});
  const payload = compactPayloadForAnalysis(rawPayload, currentData);
  const analysis = normalizeAnalysis(await analyzeComunioRawData(payload));
  if (!analysis.marketCandidates?.length) {
    analysis.recommendations = analysis.recommendations || {};
    analysis.recommendations.buy = {
      title: "Keine Kaufempfehlung",
      reason: "Aktuell kein fremdes Marktangebot attraktiv genug. Eigene Angebote nicht zurueckkaufen; Budget halten.",
      confidence: "hoch"
    };
  }
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
