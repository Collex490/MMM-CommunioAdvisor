const fs = require("fs/promises");
const { normalizeAnalysis } = require("./normalize-analysis");

function hasUsefulRecommendation(recommendation) {
  if (!recommendation || typeof recommendation !== "object") {
    return false;
  }

  const text = [
    recommendation.player,
    recommendation.title,
    recommendation.reason,
    recommendation.assessment
  ].join(" ").toLowerCase();

  const blockedPhrases = [
    "noch keine belastbare empfehlung erkannt",
    "kein einzelspieler sichtbar",
    "kein spieler sichtbar",
    "keine spieler sichtbar",
    "nicht sichtbar",
    "keine verkaufskandidaten",
    "keine konkreten",
    "screenshot ist nur",
    "screenshot zeigt nur",
    "nur das budget",
    "nur die tabelle",
    "keine spielerwerte",
    "keine kaderdaten",
    "keine begruendung erkannt",
    "keine begründung erkannt",
    "kaufempfehlung offen",
    "verkaufskandidat offen",
    "startelf-risiko offen",
    "budget-hinweis offen"
  ];

  if (blockedPhrases.some((phrase) => text.includes(phrase))) {
    return false;
  }

  return Boolean(recommendation.player || recommendation.title || recommendation.reason);
}

function mergeRecommendations(previous, incoming) {
  const result = {};

  ["buy", "sell", "risk", "budget"].forEach((key) => {
    if (hasUsefulRecommendation(previous?.[key])) {
      result[key] = previous[key];
    }
  });

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

function isTransferNewsScreen(screenType) {
  return screenType === "transfernews" || screenType === "transfers";
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

function mergeBudgetStatus(previous, incoming, screenType) {
  if (screenType !== "budget") {
    return previous || {};
  }

  return incoming?.amount ? incoming : previous || {};
}

function mergeClub(previousClub, incomingClub) {
  const previous = previousClub && typeof previousClub === "object" ? previousClub : {};
  const incoming = incomingClub && typeof incomingClub === "object" ? incomingClub : {};
  const fixedName = previous.name || "Pasta La Vista FC";

  return {
    ...incoming,
    ...previous,
    name: fixedName,
    captain: previous.captain || incoming.captain || "Sorloth",
    logo: previous.logo?.url ? previous.logo : incoming.logo
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
    club: mergeClub(previous.club, incoming.club),
    recommendations: mergeRecommendations(previous.recommendations, incoming.recommendations),
    standings: mergeStandings(previous.standings, incoming.standings),
    transferTicker: isTransferNewsScreen(screenType)
      ? mergeTransfers(previous.transferTicker, incoming.transferTicker)
      : previous.transferTicker || [],
    budgetStatus: mergeBudgetStatus(previous.budgetStatus, incoming.budgetStatus, screenType),
    squadInsights: mergeSquadInsights(previous.squadInsights, incoming.squadInsights),
    lineupImage: incoming.lineupImage?.url ? incoming.lineupImage : previous.lineupImage,
    rumorKitchen: incoming.rumorKitchen || previous.rumorKitchen,
    rumorImage: incoming.rumorImage?.url ? incoming.rumorImage : previous.rumorImage,
    lastScreenType: screenType,
    generatedAt: incoming.generatedAt || new Date().toISOString()
  };
}

module.exports = { mergeWithExisting };
