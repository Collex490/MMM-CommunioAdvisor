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
    reason: item.reason || item.detail || item.assessment || "Keine Begruendung erkannt.",
    confidence: item.confidence || "mittel"
  };
}

function normalizeRumorKitchen(value) {
  const item = firstItem(value);

  if (typeof item === "string") {
    return {
      headline: item,
      body: "Die Geruechtekueche brodelt weiter rund um Pasta La Vista FC."
    };
  }

  if (!item || typeof item !== "object") {
    return {
      headline: "Patron Co prueft den naechsten Transferzug",
      body: "In der Pasta-Zentrale wird weiter kalkuliert."
    };
  }

  return {
    headline: item.headline || "Patron Co prueft den naechsten Transferzug",
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

function normalizeAnalysis(analysis) {
  const recommendations = analysis.recommendations || {};

  return {
    ...analysis,
    league: analysis.league || "WM Comunio",
    source: normalizeSource(analysis.source),
    club: normalizeClub(analysis.club),
    recommendations: {
      buy: normalizeRecommendation(recommendations.buy, "Kaufempfehlung offen"),
      sell: normalizeRecommendation(recommendations.sell, "Verkaufskandidat offen"),
      risk: normalizeRecommendation(recommendations.risk, "Startelf-Risiko offen"),
      budget: normalizeRecommendation(recommendations.budget, "Budget-Hinweis offen")
    },
    standings: Array.isArray(analysis.standings) ? analysis.standings : [],
    transferTicker: Array.isArray(analysis.transferTicker) ? analysis.transferTicker : [],
    squadInsights: normalizeSquadInsights(analysis.squadInsights),
    rumorKitchen: normalizeRumorKitchen(analysis.rumorKitchen),
    generatedAt: analysis.generatedAt || new Date().toISOString()
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
