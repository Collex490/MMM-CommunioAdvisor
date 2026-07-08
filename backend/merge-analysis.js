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

function mergeStandings(previousStandings, incomingStandings) {
  const byTeam = new Map();

  [...(previousStandings || []), ...(incomingStandings || [])].forEach((team) => {
    if (!team || typeof team !== "object") {
      return;
    }

    const key = String(team.name || team.rank || "").trim().toLowerCase();
    if (!key) {
      return;
    }

    byTeam.set(key, {
      ...byTeam.get(key),
      ...team
    });
  });

  return Array.from(byTeam.values())
    .sort((a, b) => {
      const rankA = Number(a.rank || 999);
      const rankB = Number(b.rank || 999);
      return rankA - rankB;
    })
    .slice(0, 12);
}

function mergeTextList(previousItems, incomingItems) {
  const seen = new Set();
  return [...(incomingItems || []), ...(previousItems || [])]
    .filter((item) => {
      const text = String(item || "").trim();
      const key = text.toLowerCase();

      if (!text || seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .slice(0, 6);
}

function mergeSquadInsights(previous, incoming) {
  return {
    keep: mergeTextList(previous?.keep, incoming?.keep),
    sell: mergeTextList(previous?.sell, incoming?.sell),
    watch: mergeTextList(previous?.watch, incoming?.watch)
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
    standings: mergeStandings(previous.standings, incoming.standings),
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
