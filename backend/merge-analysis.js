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
    "noch keine daten",
    "sende einen screenshot",
    "nicht verwertbar",
    "keine auslesbaren",
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
    "budget-hinweis offen",
    "keine kaufempfehlung",
    "kein fremdes marktangebot",
    "keine passende kaufempfehlung",
    "api geladen",
    "per api geladen",
    "chatgpt-analyse",
    "auf dem markt sichtbar",
    "computer ist aktuell auf dem markt sichtbar"
  ];

  if (blockedPhrases.some((phrase) => text.includes(phrase))) {
    return false;
  }

  return Boolean(recommendation.player || recommendation.title || recommendation.reason);
}

function mergeRecommendations(previous, incoming, replacePrevious = false) {
  const result = {};

  if (!replacePrevious) {
    ["buy", "sell", "risk", "budget"].forEach((key) => {
      if (hasUsefulRecommendation(previous?.[key])) {
        result[key] = previous[key];
      }
    });
  }

  ["buy", "sell", "risk", "budget"].forEach((key) => {
    if (hasUsefulRecommendation(incoming?.[key])) {
      result[key] = incoming[key];
    }
  });

  return result;
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeText(value) {
  return normalizeName(value);
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
  const ownPointValues = (squadPlayers || [])
    .map((player) => numericValue(player.points))
    .filter((pointsValue) => pointsValue > 0);
  const weakestPoints = ownPointValues.length ? Math.min(...ownPointValues) : 9999;

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
    reasons.push(`${candidate.lastPoints} Punkte zuletzt sprechen für möglichen Marktwertschub`);
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
    reasons.push(`Preis: ${candidate.price}`);
  }
  if (candidate.seller) {
    reasons.push(`Anbieter: ${candidate.seller}`);
  }

  return {
    player: candidate.player,
    title: "Kaufempfehlung",
    reason: reasons.length ? reasons.join(". ") : "Fremdes Marktangebot mit möglichem Upgrade- oder Marktwertpotenzial.",
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

function recommendationFromBudgetStatus(budgetStatus) {
  if (!budgetStatus?.amount) {
    return null;
  }

  return {
    title: "Budget gezielt einsetzen",
    reason: `Mit ${budgetStatus.amount} nur selektiv bieten und Reserve für Nachkäufe halten.`,
    confidence: "hoch"
  };
}

function isMarketLikeRumor(rumorKitchen, marketCandidates) {
  const text = [
    rumorKitchen?.headline,
    rumorKitchen?.body,
    rumorKitchen?.detail
  ].join(" ").toLowerCase();

  if (!text.trim()) {
    return false;
  }

  const marketNames = (marketCandidates || [])
    .map((candidate) => String(candidate?.player || "").trim().toLowerCase())
    .filter(Boolean);

  const marketWords = [
    "kaufempfehlung",
    "marktgriff",
    "marktangebot",
    "upgrade-chance",
    "wertzuwachs",
    "kaderhilfe",
    "preis mit",
    "sofortoption"
  ];

  return marketWords.some((word) => text.includes(word))
    || marketNames.some((name) => name && text.includes(name));
}

function fallbackRumorKitchen(budgetStatus) {
  const isNegativeBudget = String(budgetStatus?.amount || "").trim().startsWith("-");

  return {
    headline: isNegativeBudget
      ? "Pasta La Vista FC lässt die Rechenmaschine rauchen"
      : "Pasta La Vista FC hält die Markt-Tür einen Spalt offen",
    body: isNegativeBudget
      ? "Patron Co ordnet Kassenruhe an, während Gattuso im Training mehr Disziplin fordert. Die Konkurrenz wittert Nervosität, doch die gold-schwarze Zentrale bleibt wach."
      : "Patron Co prüft die Lage mit ruhiger Hand, während Gattuso mehr Biss im Kader fordert. Sporting und Squadra beobachten jede Bewegung im gold-schwarzen Büro."
  };
}

function mergeTransfers(previousTransfers, incomingTransfers) {
  const seen = new Set();
  const combined = [...(incomingTransfers || []), ...(previousTransfers || [])];
  const blockedPhrases = [
    "mittelfeld-joker",
    "rotationsverteidiger",
    "bankspieler",
    "stammspieler",
    "noch keine transfers",
    "screenshot per telegram",
    "telegram senden"
  ];

  return combined
    .filter((item) => {
      const text = [
        item.action || "",
        item.player || "",
        item.club || "",
        item.price || ""
      ].join(" ").toLowerCase();

      if (text.includes("listed") || text.includes("gelistet")) {
        return false;
      }

      if (text.includes("info") && blockedPhrases.some((phrase) => text.includes(phrase))) {
        return false;
      }

      if (blockedPhrases.some((phrase) => text.includes(phrase))) {
        return false;
      }

      const playerPriceKey = [
        item.player || "",
        item.price || ""
      ].join("|").toLowerCase();
      const key = playerPriceKey.trim() !== "|"
        ? playerPriceKey
        : [
        item.action || "",
        item.player || "",
        item.from || "",
        item.to || "",
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

function mergeMarketCandidates(previousCandidates, incomingCandidates) {
  const seen = new Set();
  return [...(incomingCandidates || []), ...(previousCandidates || [])]
    .filter((item) => {
      const key = [
        item.player || "",
        item.price || "",
        item.seller || ""
      ].join("|").toLowerCase();

      if (!item.player || seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .sort((a, b) => Number(a.priority || 999) - Number(b.priority || 999))
    .slice(0, 12);
}

function isTransferNewsScreen(screenType) {
  return screenType === "transfernews" || screenType === "transfers";
}

function isFullApiScreen(screenType) {
  return screenType === "api" || screenType === "api-analysis";
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

    const hasPoints = team.totalPoints !== undefined
      || team.matchdayPoints !== undefined
      || team.points !== undefined
      || team.overallPoints !== undefined;

    if (!hasPoints) {
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

function shouldReplaceSquadInsights(screenType) {
  return ["api", "api-analysis", "squad"].includes(screenType);
}

function mergeBudgetStatus(previous, incoming, screenType) {
  if (screenType === "budget" || isFullApiScreen(screenType)) {
    return incoming?.amount ? incoming : previous || {};
  }

  return previous || {};
}

function ownMatchdayPoints(standings) {
  const ownTeam = (standings || []).find((team) => team?.isUserClub);
  const value = Number(ownTeam?.matchdayPoints ?? ownTeam?.dayPoints ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function mergeLivePlayers(previousLivePlayers, incomingLivePlayers, incomingStandings, screenType) {
  const ownPoints = ownMatchdayPoints(incomingStandings);

  if (Array.isArray(incomingLivePlayers) && incomingLivePlayers.length) {
    const merged = new Map();
    incomingLivePlayers.forEach((player) => {
      if (!player?.name) return;
      merged.set(normalizeText(player.name), player);
    });

    if (ownPoints > 0 && Array.isArray(previousLivePlayers) && previousLivePlayers.length) {
      previousLivePlayers.forEach((player) => {
        if (!player?.name) return;
        const key = normalizeText(player.name);
        if (!merged.has(key)) {
          merged.set(key, {
            ...player,
            status: player.status || "Spieltag"
          });
        }
      });
    }

    return Array.from(merged.values())
      .sort((a, b) => (Number(b.livePoints ?? -999) - Number(a.livePoints ?? -999)));
  }

  if (screenType === "api-analysis" && Array.isArray(previousLivePlayers) && previousLivePlayers.length) {
    return previousLivePlayers.map((player) => ({
      ...player,
      status: player.status || "Spieltag"
    }));
  }

  if (ownPoints > 0 && Array.isArray(previousLivePlayers) && previousLivePlayers.length) {
    return previousLivePlayers.map((player) => ({
      ...player,
      status: player.status || "Spieltag"
    }));
  }

  return [];
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

  const marketCandidates = isFullApiScreen(screenType)
    ? incoming.marketCandidates || []
    : screenType === "transfermarket"
      ? mergeMarketCandidates(previous.marketCandidates, incoming.marketCandidates)
      : previous.marketCandidates || [];
  const recommendations = mergeRecommendations(
    previous.recommendations,
    incoming.recommendations,
    isFullApiScreen(screenType)
  );
  const budgetStatus = mergeBudgetStatus(previous.budgetStatus, incoming.budgetStatus, screenType);
  const incomingTransfers = mergeTransfers([], incoming.transferTicker);

  if (isFullApiScreen(screenType) && !incoming.budgetStatus?.amount) {
    const budgetRecommendation = recommendationFromBudgetStatus(budgetStatus);
    if (budgetRecommendation) {
      recommendations.budget = budgetRecommendation;
    }
  }

  if (screenType === "transfermarket" || isFullApiScreen(screenType)) {
    const squadPlayers = incoming.squadPlayers?.length ? incoming.squadPlayers : previous.squadPlayers || [];
    const buyViews = buildBuyViews(marketCandidates, squadPlayers);
    if (buyViews.length) {
      recommendations.buyViews = buyViews;
      recommendations.buy = buyViews[0];
    } else if (!hasUsefulRecommendation(recommendations.buy)) {
      const buyFromMarket = recommendationFromMarketCandidate(bestMarketCandidate(marketCandidates, squadPlayers));
      if (buyFromMarket) {
        recommendations.buy = buyFromMarket;
      }
    }
  }

  const rumorKitchen = isMarketLikeRumor(incoming.rumorKitchen, marketCandidates)
    ? fallbackRumorKitchen(budgetStatus)
    : incoming.rumorKitchen || previous.rumorKitchen;

  return {
    ...previous,
    league: incoming.league || previous.league,
    source: incoming.source,
    club: mergeClub(previous.club, incoming.club),
    recommendations,
    marketCandidates,
    standings: isFullApiScreen(screenType)
      ? incoming.standings || []
      : mergeStandings(previous.standings, incoming.standings),
    transferTicker: screenType === "api"
      ? incomingTransfers
      : screenType === "api-analysis"
        ? incomingTransfers.length
          ? incomingTransfers
          : previous.transferTicker || []
        : isTransferNewsScreen(screenType)
        ? mergeTransfers(previous.transferTicker, incoming.transferTicker)
        : previous.transferTicker || [],
    livePlayers: mergeLivePlayers(previous.livePlayers, incoming.livePlayers, incoming.standings, screenType),
    livePlayersMeta: incoming.livePlayersMeta || previous.livePlayersMeta,
    budgetStatus,
    squadPlayers: Array.isArray(incoming.squadPlayers) && incoming.squadPlayers.length
      ? incoming.squadPlayers
      : previous.squadPlayers || [],
    squadInsights: shouldReplaceSquadInsights(screenType)
      ? incoming.squadInsights
      : mergeSquadInsights(previous.squadInsights, incoming.squadInsights),
    lineupImage: incoming.lineupImage?.url ? incoming.lineupImage : previous.lineupImage,
    rumorKitchen,
    rumorImage: incoming.rumorImage?.url ? incoming.rumorImage : previous.rumorImage,
    lastScreenType: screenType,
    generatedAt: incoming.generatedAt || new Date().toISOString()
  };
}

module.exports = { mergeWithExisting };
