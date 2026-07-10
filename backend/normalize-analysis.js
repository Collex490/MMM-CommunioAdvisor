function firstItem(value) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeRecommendation(value, fallbackTitle) {
  const item = firstItem(value);

  if (typeof item === "string") {
    return {
      title: fallbackTitle,
      reason: item,
      confidence: "mittel"
    };
  }

  if (!item || typeof item !== "object") {
    return {
      title: fallbackTitle,
      reason: "Noch keine belastbare Empfehlung erkannt.",
      confidence: "niedrig"
    };
  }

  return {
    player: item.player,
    title: item.title || item.assessment || fallbackTitle,
    reason: item.reason || item.detail || item.assessment || "Keine Begründung erkannt.",
    confidence: item.confidence || "mittel"
  };
}

function normalizeRumorKitchen(value) {
  const item = firstItem(value);

  if (typeof item === "string") {
    return {
      headline: item,
      body: "Die Gerüchteküche brodelt weiter rund um Pasta La Vista FC."
    };
  }

  if (!item || typeof item !== "object") {
    return {
      headline: "Patron Co prüft den nächsten Transferzug",
      body: "In der Pasta-Zentrale wird weiter kalkuliert."
    };
  }

  return {
    headline: item.headline || "Patron Co prüft den nächsten Transferzug",
    body: item.body || item.detail || "In der Pasta-Zentrale wird weiter kalkuliert."
  };
}

function normalizeSource(source) {
  if (source && typeof source === "object") {
    return {
      platform: source.platform || "Comunio",
      screenType: source.screenType || "unknown"
    };
  }

  const sourceText = String(source || "").toLowerCase();
  let screenType = "unknown";

  if (sourceText.includes("aufstellung") || sourceText.includes("lineup") || sourceText.includes("formation")) {
    screenType = "lineup";
  } else if (sourceText.includes("tabelle") || sourceText.includes("standings")) {
    screenType = "standings";
  } else if (sourceText.includes("transfernews") || sourceText.includes("transfers")) {
    screenType = "transfernews";
  } else if (sourceText.includes("transfer")) {
    screenType = "transfermarket";
  } else if (sourceText.includes("budget") || sourceText.includes("konto")) {
    screenType = "budget";
  } else if (sourceText.includes("kader") || sourceText.includes("squad")) {
    screenType = "squad";
  }

  return {
    platform: "Comunio",
    screenType
  };
}

function normalizeClub(club) {
  if (club && typeof club === "object") {
    return {
      name: club.name || "Pasta La Vista FC",
      boss: club.boss || "Patron Co",
      coach: club.coach || "Gennaro Gattuso",
      colors: club.colors || ["Schwarz", "Gold"],
      motto: club.motto || "Mangia, Lotta, Vinci",
      captain: club.captain || "Sorloth"
    };
  }

  return {
    name: club || "Pasta La Vista FC",
    boss: "Patron Co",
    coach: "Gennaro Gattuso",
    colors: ["Schwarz", "Gold"],
    motto: "Mangia, Lotta, Vinci",
    captain: "Sorloth"
  };
}

function normalizeNumberLike(value) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  if (typeof value === "number") {
    return value;
  }

  const parsed = Number(String(value).replace(/[^\d-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeStandings(standings) {
  if (!Array.isArray(standings)) {
    return [];
  }

  return standings
    .map((team, index) => {
      if (!team || typeof team !== "object") {
        return null;
      }

      const totalPoints = normalizeNumberLike(team.totalPoints ?? team.points ?? team.overallPoints);
      const matchdayPoints = normalizeNumberLike(
        team.matchdayPoints ?? team.lastMatchdayPoints ?? team.dayPoints ?? team.currentPoints ?? team.gameweekPoints
      );

      const name = team.name || team.team || team.club || "Unbekannt";

      return {
        ...team,
        rank: normalizeNumberLike(team.rank) ?? index + 1,
        name,
        matchdayPoints,
        totalPoints,
        marketValue: team.marketValue || team.value || team.teamValue || "",
        isUserClub: Boolean(team.isUserClub) || name.trim().toLowerCase() === "pasta la vista fc"
      };
    })
    .filter(Boolean);
}

function normalizeAnalysis(analysis) {
  const recommendations = analysis.recommendations || {};
  const squadInsights = normalizeSquadInsights(analysis.squadInsights);
  const marketCandidates = normalizeMarketCandidates(analysis.marketCandidates || analysis.transferMarket || analysis.marketPlayers);
  const source = normalizeSource(analysis.source);
  const normalizedRecommendations = {
    buy: normalizeRecommendation(recommendations.buy, "Kaufempfehlung offen"),
    sell: normalizeRecommendation(recommendations.sell, "Verkaufskandidat offen"),
    risk: normalizeRecommendation(recommendations.risk, "Startelf-Risiko offen"),
    budget: normalizeRecommendation(recommendations.budget, "Budget-Hinweis offen")
  };
  enhanceRecommendations(normalizedRecommendations, squadInsights, marketCandidates, source.screenType);

  return {
    ...analysis,
    league: analysis.league || "WM Comunio",
    source,
    club: normalizeClub(analysis.club),
    recommendations: normalizedRecommendations,
    marketCandidates,
    standings: normalizeStandings(analysis.standings),
    transferTicker: Array.isArray(analysis.transferTicker) ? analysis.transferTicker : [],
    budgetStatus: normalizeBudgetStatus(analysis.budgetStatus || analysis.budget, normalizedRecommendations.budget),
    squadInsights,
    rumorKitchen: normalizeRumorKitchen(analysis.rumorKitchen),
    generatedAt: analysis.generatedAt || new Date().toISOString()
  };
}

function hasRecommendationContent(recommendation) {
  if (!recommendation || typeof recommendation !== "object") {
    return false;
  }

  const text = [
    recommendation.player,
    recommendation.title,
    recommendation.reason
  ].join(" ").toLowerCase();

  return Boolean(recommendation.player || recommendation.title || recommendation.reason)
    && !text.includes("offen")
    && !text.includes("keine begruendung")
    && !text.includes("keine begründung")
    && !text.includes("noch keine belastbare");
}

function recommendationFromInsight(text, fallbackTitle) {
  const value = String(text || "").trim();
  if (!value) {
    return null;
  }

  const player = value.split(/:| wegen | bei | als | nur | für | für /i)[0].trim();
  return {
    player: player || fallbackTitle,
    title: fallbackTitle,
    reason: value,
    confidence: "mittel"
  };
}

function normalizeMarketCandidates(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index) => {
      if (typeof item === "string") {
        return {
          player: item,
          reason: "Sichtbarer Kandidat auf dem Transfermarkt.",
          priority: index + 1
        };
      }

      if (!item || typeof item !== "object") {
        return null;
      }

      return {
        player: item.player || item.name || item.title || "",
        price: item.price || item.marketValue || item.value || "",
        seller: item.seller || item.club || "",
        reason: item.reason || item.detail || item.assessment || "Sichtbarer Kandidat auf dem Transfermarkt.",
        priority: normalizeNumberLike(item.priority) ?? index + 1
      };
    })
    .filter((item) => item?.player)
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 8);
}

function recommendationFromMarketCandidate(candidate) {
  if (!candidate?.player) {
    return null;
  }

  const price = candidate.price ? ` Preis: ${candidate.price}.` : "";
  const seller = candidate.seller ? ` Anbieter: ${candidate.seller}.` : "";
  return {
    player: candidate.player,
    title: "Kaufempfehlung",
    reason: `${candidate.reason}${price}${seller}`.trim(),
    confidence: "mittel"
  };
}

function enhanceRecommendations(recommendations, squadInsights, marketCandidates, screenType) {
  if (screenType === "transfermarket" && !hasRecommendationContent(recommendations.buy)) {
    const fallbackBuy = recommendationFromMarketCandidate(marketCandidates[0]);
    if (fallbackBuy) {
      recommendations.buy = fallbackBuy;
    }
  }

  if (screenType === "squad") {
    if (!hasRecommendationContent(recommendations.sell)) {
      const fallbackSell = recommendationFromInsight(squadInsights.sell?.[0], "Verkaufskandidat");
      if (fallbackSell) {
        recommendations.sell = fallbackSell;
      }
    }

    if (!hasRecommendationContent(recommendations.risk)) {
      const fallbackRisk = recommendationFromInsight(squadInsights.watch?.[0], "Startelf-Risiko");
      if (fallbackRisk) {
        recommendations.risk = fallbackRisk;
      }
    }
  }
}

function extractBudgetAmount(text) {
  const match = String(text || "").match(/\b\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?\b|\b\d{4,}\b/);
  return match ? match[0] : "";
}

function normalizeBudgetStatus(value, budgetRecommendation) {
  const recommendationText = [
    budgetRecommendation?.player,
    budgetRecommendation?.title,
    budgetRecommendation?.reason
  ].join(" ");

  if (!value) {
    const amount = extractBudgetAmount(recommendationText);
    return amount ? { amount, note: "Aus Budget-Hinweis erkannt" } : {};
  }

  if (typeof value === "string") {
    return { amount: value };
  }

  if (typeof value !== "object") {
    return {};
  }

  return {
    amount: value.amount || value.balance || value.budget || value.label || extractBudgetAmount(recommendationText),
    note: value.note || value.reason || value.assessment || "",
    updatedAt: value.updatedAt || ""
  };
}

function normalizeTextList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (item && typeof item === "object") {
        return item.player && item.reason ? `${item.player}: ${item.reason}` : item.reason || item.player || item.title;
      }

      return "";
    })
    .filter(Boolean);
}

function normalizeSquadInsights(value) {
  if (!value || typeof value !== "object") {
    return {
      keep: [],
      sell: [],
      watch: []
    };
  }

  return {
    keep: normalizeTextList(value.keep || value.hold || value.playersToKeep),
    sell: normalizeTextList(value.sell || value.playersToSell),
    watch: normalizeTextList(value.watch || value.risks || value.playersToWatch)
  };
}

module.exports = { normalizeAnalysis };
