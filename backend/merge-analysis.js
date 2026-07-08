const fs = require("fs/promises");
const { normalizeAnalysis } = require("./normalize-analysis");

function hasUsefulRecommendation(recommendation) {
  if (!recommendation || typeof recommendation !== "object") {
    return false;
  }

  const reason = recommendation.reason || "";
  return Boolean(recommendation.player || recommendation.title)
    && !reason.includes("Noch keine belastbare Empfehlung erkannt");
}

function mergeRecommendations(previous, incoming) {
  const result = { ...(previous || {}) };

  ["buy", "sell", "risk", "budget"].forEach((key) => {
    if (hasUsefulRecommendation(incoming?.[key])) {
      result[key] = incoming[key];
    }
  });

  return result;
}

function mergeTransfers(previousTransfers, incomingTransfers) {
  const seen = new Set();
  const combined = [...(incomingTransfers || []), ...(previousTransfers || [])];

  return combined
    .filter((item) => {
      const key = [
        item.action || "",
        item.player || "",
        item.club || "",
        item.price || ""
      ].join("|").toLowerCase();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return Boolean(item.player || item.action);
    })
    .slice(0, 12);
}

function mergeSquadInsights(previous, incoming) {
  return {
    keep: incoming?.keep?.length ? incoming.keep : previous?.keep || [],
    sell: incoming?.sell?.length ? incoming.sell : previous?.sell || [],
    watch: incoming?.watch?.length ? incoming.watch : previous?.watch || []
  };
}

async function readExistingAnalysis(dataPath) {
  try {
    const content = await fs.readFile(dataPath, "utf8");
    return normalizeAnalysis(JSON.parse(content));
  } catch {
    return null;
  }
}

async function mergeWithExisting(dataPath, incomingAnalysis) {
  const previous = await readExistingAnalysis(dataPath);
  const incoming = normalizeAnalysis(incomingAnalysis);
  const screenType = incoming.source?.screenType || "unknown";

  if (!previous) {
    return incoming;
  }

  return {
    ...previous,
    league: incoming.league || previous.league,
    source: incoming.source,
    club: incoming.club || previous.club,
    recommendations: mergeRecommendations(previous.recommendations, incoming.recommendations),
    standings: incoming.standings.length ? incoming.standings : previous.standings,
    transferTicker: mergeTransfers(previous.transferTicker, incoming.transferTicker),
    squadInsights: mergeSquadInsights(previous.squadInsights, incoming.squadInsights),
    lineupImage: incoming.lineupImage?.url ? incoming.lineupImage : previous.lineupImage,
    rumorKitchen: incoming.rumorKitchen || previous.rumorKitchen,
    rumorImage: incoming.rumorImage?.url ? incoming.rumorImage : previous.rumorImage,
    lastScreenType: screenType,
    generatedAt: incoming.generatedAt || new Date().toISOString()
  };
}

module.exports = { mergeWithExisting };
