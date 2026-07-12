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
      livePlayers: currentData.livePlayers || [],
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

function numericValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = String(value || "")
    .replace(/[^\d,-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function marketCandidateScore(candidate, squadPlayers = []) {
  const ownNames = new Set((squadPlayers || []).map((player) => normalizeName(player.name)));
  if (!candidate?.player || ownNames.has(normalizeName(candidate.player))) return -9999;

  const livePoints = numericValue(candidate.livePoints);
  const lastPoints = numericValue(candidate.lastPoints);
  const points = numericValue(candidate.points);
  const price = numericValue(candidate.price);
  const position = normalizeName(candidate.position || candidate.role);
  const weakestPoints = Math.min(
    ...((squadPlayers || [])
      .map((player) => numericValue(player.points))
      .filter((pointsValue) => pointsValue > 0)),
    9999
  );

  const isUpgrade = weakestPoints !== 9999 && points > weakestPoints + 8;
  const hasSubstance = livePoints > 0 || lastPoints > 0 || points >= 20 || candidate.marketTrend === "up" || isUpgrade;

  let score = Math.min(points, 220) + (lastPoints * 12) + (livePoints * 14);
  if (position.includes("striker") || position.includes("sturm") || position.includes("forward")) score += 22;
  if (position.includes("midfielder") || position.includes("mittel")) score += 14;
  if (candidate.marketTrend === "up") score += 30;
  if (isUpgrade) score += 28;
  if (price > 18000000) score -= 14;
  if (price > 13000000) score -= 8;
  if (!livePoints && !lastPoints && !points && candidate.marketTrend !== "up") score -= 120;
  if (points > 0 && points < 10 && !livePoints && !lastPoints && candidate.marketTrend !== "up") score -= 45;
  if (!hasSubstance) score -= 30;
  return score;
}

function bestMarketCandidate(marketCandidates = [], squadPlayers = []) {
  return [...(marketCandidates || [])]
    .filter((candidate) => candidate?.player)
    .sort((a, b) => marketCandidateScore(b, squadPlayers) - marketCandidateScore(a, squadPlayers))[0];
}

function recommendationFromMarketCandidate(candidate) {
  if (!candidate?.player) {
    return null;
  }

  const reasons = [];
  if (numericValue(candidate.livePoints) > 0) {
    reasons.push(`${candidate.livePoints} Livepunkte sprechen für direkten Formschub`);
  }
  if (candidate.lastPoints !== undefined && candidate.lastPoints !== null && numericValue(candidate.lastPoints) > 0) {
    reasons.push(`${candidate.lastPoints} Punkte zuletzt sprechen für Marktwertfantasie`);
  }
  if (candidate.points !== undefined && candidate.points !== null && numericValue(candidate.points) > 0) {
    reasons.push(`${candidate.points} Saisonpunkte zeigen Qualität`);
  }
  if (candidate.marketTrend === "up") {
    reasons.push("Marktwerttrend zeigt nach oben");
  }
  if (candidate.reason) {
    reasons.push(candidate.reason);
  }
  if (candidate.price) {
    reasons.push(`Preis ${candidate.price}`);
  }
  if (candidate.seller) {
    reasons.push(`Anbieter: ${candidate.seller}`);
  }

  return {
    player: candidate.player,
    title: "Kaufempfehlung",
    reason: reasons.length
      ? reasons.join(". ")
      : "Fremdes Marktangebot mit möglichem Upgrade- oder Marktwertpotenzial.",
    confidence: "mittel"
  };
}

function marketCandidateSource(candidate) {
  const seller = normalizeName([
    candidate?.seller,
    candidate?.sellerName,
    candidate?.owner,
    candidate?.ownerName,
    candidate?.provider,
    candidate?.club
  ].find(Boolean));

  return seller.includes("computer") ? "computer" : "manager";
}

function buildBuyViews(marketCandidates = [], squadPlayers = []) {
  const views = [
    {
      source: "manager",
      sourceLabel: "Manager-Markt",
      candidate: bestMarketCandidate(
        marketCandidates.filter((candidate) => marketCandidateSource(candidate) !== "computer"),
        squadPlayers
      )
    },
    {
      source: "computer",
      sourceLabel: "Computer-Markt",
      candidate: bestMarketCandidate(
        marketCandidates.filter((candidate) => marketCandidateSource(candidate) === "computer"),
        squadPlayers
      )
    }
  ];

  return views
    .map((view) => {
      const recommendation = recommendationFromMarketCandidate(view.candidate);
      return recommendation
        ? {
            ...recommendation,
            source: view.source,
            sourceLabel: view.sourceLabel
          }
        : null;
    })
    .filter(Boolean);
}

function isNoBuyRecommendation(recommendation) {
  const text = [
    recommendation?.player,
    recommendation?.title,
    recommendation?.reason
  ].join(" ").toLowerCase();

  return !recommendation
    || text.includes("keine kaufempfehlung")
    || text.includes("kein fremdes marktangebot")
    || text.includes("keine passende kaufempfehlung");
}

async function analyzeComunioRawData(payload) {
  const response = await client.chat.completions.create({
    model: process.env.OPENAI_TEXT_MODEL || process.env.OPENAI_VISION_MODEL || "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "Du analysierst Rohdaten aus Comunio-Seiten für ein MagicMirror-Modul.",
          "Gib ausschließlich JSON im bekannten ComunioAdvisor-Schema zurück.",
          "Erfinde keine exakten Spieler, Punkte, Marktwerte oder Budgets, wenn sie in den Rohdaten nicht stehen.",
          "Nutze latestStructuredData zuerst; rawApiExtracts sind nur Zusatzbelege.",
          "Nutze die Daten, um Tabelle, Kader, Aufstellung, Transfers, Transfermarkt, Budget und Managerempfehlungen zu bewerten.",
          "Die vier recommendation-Kacheln müssen analytische Manager-Hinweise sein, keine technischen Meta-Sätze.",
          "Schreibe niemals Formulierungen wie 'API geladen', 'Screenshot sichtbar', 'Computer ist aktuell sichtbar' oder 'nach ChatGPT-Analyse verfeinern' in Kacheln.",
          "Schreibe auch niemals 'Noch keine Daten', 'nicht verwertbar' oder 'keine auslesbaren Daten', wenn latestStructuredData bereits Markt, Kader, Budget oder Tabelle enthaelt.",
          "Beste Kaufempfehlung muss aus aktuellen Marktangeboten/offers kommen. Nutze niemals 'Computer' als Spielername.",
          "Bewerte die Kaufempfehlung wie ein Manager: Priorität 1 ist ein Marktspieler, der zuletzt/live stark gepunktet hat und dadurch Marktwert gewinnen könnte.",
          "Priorität 2 ist ein Marktspieler, der klar besser oder wertvoller wirkt als ein aktueller schwacher eigener Kaderspieler.",
          "Die Kaufempfehlung muss kurz begründen, ob der Spieler wegen Spieltagsform, Marktwert-Potenzial oder als Kader-Upgrade interessant ist.",
          "Empfiehl keinen Spieler zum Kauf, der in squadPlayers steht oder dessen Marktangebot vom eigenen Club Pasta La Vista FC stammt; solche Spieler sind eigene Verkaufsangebote.",
          "Wenn kein fremder Marktspieler diese Form- oder Upgrade-Logik erfüllt, setze recommendations.buy auf title 'Keine Kaufempfehlung' mit kurzer Begründung: kein klares Form-/Upgrade-Angebot.",
          "Schreibe Budget-, Minus- oder Kontostandstrategie nur in recommendations.budget, nicht in die Kaufempfehlung.",
          "Verkaufskandidat muss aus dem eigenen Kader kommen und kurz begruenden, warum Verkauf oder Tausch sinnvoll sein koennte.",
          "Startelf-Risiko bedeutet: ein eigener Spieler mit unsicherer Rolle, schwacher Preis-Leistung, Rotations-/Minutenrisiko oder Bedarf zum Beobachten.",
          "Verkaufskandidat und Startelf-Risiko sollen unterschiedliche Spieler sein, wenn mindestens zwei eigene Kaderspieler verfügbar sind.",
          "Budget-Hinweis soll den erkannten Kontostand praktisch einordnen: aggressiv bieten, Reserve halten, bewusst ins Minus gehen, erst verkaufen oder abwarten.",
          "Wenn der Kontostand negativ ist, berücksichtige: Nach Spieltagsbeginn kann Minus bis zum nächsten Spieltag taktisch genutzt werden, um Marktwertgewinn mitzunehmen; trotzdem rechtzeitig vor dem nächsten Spieltag ausgleichen.",
          "transferTicker darf nur echte abgeschlossene Transfers aus latestStructuredData.transferTicker oder belegbaren News enthalten.",
          "Schreibe niemals Platzhalter wie 'Noch keine Transfers', 'Screenshot per Telegram senden' oder 'Info' in transferTicker.",
          "Wenn keine echten Transfernews belegt sind, lasse transferTicker als leeres Array; der bestehende API-Ticker bleibt erhalten.",
          "squadInsights.keep, squadInsights.sell und squadInsights.watch müssen kurze begruendete Sätze sein, nicht nur Spielernamen. Format pro Eintrag: 'Spieler: konkrete Begründung in maximal 16 Wörtern'.",
          "Nenne im Kader-Check nur Spieler, die im aktuellen Kader oder in der aktuellen Aufstellung vorkommen. Verkauft- oder Transfernews-Spieler duerfen dort nicht auftauchen, wenn sie nicht mehr im Kader stehen.",
          "Wenn es nur Login-/Fehlerseiten sind, lasse nicht belegbare Bereiche leer."
        ].join(" ")
      },
      {
        role: "user",
        content: [
          "Analysiere diese strukturierten Comunio-Daten für die MagicMirror-Kacheln.",
          "Rollenspielwelt: Pasta La Vista FC, Patron Co, Gennaro Gattuso, Motto Mangia Lotta Vinci, Captain Sorloth; Sporting Bolzackerer; Squadra Absenta.",
          "Schema: { league: string, source: { platform: string, screenType: string }, club: { name: string, boss: string, coach: string, colors: string[], motto: string, captain: string }, recommendations: { buy: { player: string, reason: string, confidence: string }, sell: { player: string, reason: string, confidence: string }, risk: { player: string, reason: string, confidence: string }, budget: { title: string, reason: string, confidence: string } }, marketCandidates: [{ player: string, price: string, seller: string, reason: string, priority: number }], standings: [{ rank: number, name: string, matchdayPoints: number, totalPoints: number, marketValue: string, isUserClub: boolean }], transferTicker: [{ action: string, player: string, club: string, price: string }], budgetStatus: { amount: string, note: string }, squadInsights: { keep: string[], sell: string[], watch: string[] }, rumorKitchen: { headline: string, body: string }, generatedAt: string }.",
          JSON.stringify(payload).slice(0, 60000)
        ].join("\n\n")
      }
    ]
  });

  return JSON.parse(response.choices[0].message.content);
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

async function main() {
  const rawPayload = await readJsonIfExists(sourcePath, {});
  const currentData = await readJsonIfExists(dataPath, {});
  const payload = compactPayloadForAnalysis(rawPayload, currentData);
  const analysis = normalizeAnalysis(await analyzeComunioRawData(payload));

  analysis.marketCandidates = currentData.marketCandidates?.length
    ? currentData.marketCandidates
    : analysis.marketCandidates || [];
  analysis.standings = currentData.standings?.length ? currentData.standings : analysis.standings || [];
  analysis.transferTicker = currentData.transferTicker?.length ? currentData.transferTicker : analysis.transferTicker || [];
  analysis.budgetStatus = currentData.budgetStatus?.amount
    ? currentData.budgetStatus
    : analysis.budgetStatus;
  analysis.livePlayers = currentData.livePlayers || analysis.livePlayers || [];
  analysis.squadPlayers = currentData.squadPlayers || analysis.squadPlayers || [];
  analysis.lineupImage = currentData.lineupImage || analysis.lineupImage;

  const buyViews = buildBuyViews(analysis.marketCandidates, analysis.squadPlayers);
  if (buyViews.length) {
    analysis.recommendations = analysis.recommendations || {};
    analysis.recommendations.buyViews = buyViews;
    analysis.recommendations.buy = buyViews[0];
  }

  const marketNames = new Set((analysis.marketCandidates || []).map((candidate) => normalizeName(candidate.player)));
  const ownNames = new Set((currentData.squadPlayers || []).map((player) => normalizeName(player.name)));
  const buyName = normalizeName(analysis.recommendations?.buy?.player);
  const preferredMarketCandidate = bestMarketCandidate(analysis.marketCandidates, currentData.squadPlayers);

  if (!buyViews.length && !analysis.marketCandidates?.length) {
    analysis.recommendations = analysis.recommendations || {};
    analysis.recommendations.buy = {
      title: "Keine Kaufempfehlung",
      reason: "Aktuell kein fremdes Marktangebot mit klarem Formschub oder Upgrade-Potenzial.",
      confidence: "hoch"
    };
  } else if (!buyViews.length && buyName && (ownNames.has(buyName) || !marketNames.has(buyName))) {
    const marketBuy = recommendationFromMarketCandidate(preferredMarketCandidate);
    analysis.recommendations = analysis.recommendations || {};
    analysis.recommendations.buy = marketBuy || {
      title: "Keine Kaufempfehlung",
      reason: "Aktuell kein fremdes Marktangebot mit klarem Formschub oder Upgrade-Potenzial.",
      confidence: "hoch"
    };
  }

  if (!buyViews.length && analysis.marketCandidates?.length && isNoBuyRecommendation(analysis.recommendations?.buy)) {
    const marketBuy = recommendationFromMarketCandidate(preferredMarketCandidate);
    if (marketBuy) {
      analysis.recommendations = analysis.recommendations || {};
      analysis.recommendations.buy = marketBuy;
    }
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
