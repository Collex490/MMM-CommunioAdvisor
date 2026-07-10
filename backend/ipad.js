(function () {
  const CONFIG = {
    dataFile: "data/latest.json",
    clubName: "Pasta La Vista FC",
    title: "WM Comunio",
    refreshMs: 60 * 1000
  };

  const app = document.getElementById("app");
  let latestData = null;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function firstValue(...values) {
    return values.find((value) => value !== undefined && value !== null && value !== "") || "";
  }

  function assetUrl(url, version = "") {
    if (!url) return "";
    if (/^https?:\/\//.test(url) || url.startsWith("/")) {
      return version ? `${url}?v=${encodeURIComponent(version)}` : url;
    }

    const resolved = url.startsWith("modules/")
      ? `/${url}`
      : url;

    return version ? `${resolved}?v=${encodeURIComponent(version)}` : resolved;
  }

  function normalizeRecommendation(item, fallback) {
    return item && typeof item === "object"
      ? item
      : { title: fallback, reason: "Noch keine passende Analyse vorhanden.", confidence: "" };
  }

  function hasRecommendation(item) {
    if (!item || typeof item !== "object") return false;
    const text = [item.player, item.title, item.reason].join(" ").toLowerCase();
    return Boolean(item.player || item.title || item.reason)
      && !text.includes("noch keine daten")
      && !text.includes("sende einen screenshot")
      && !text.includes("kauf offen")
      && !text.includes("verkauf offen")
      && !text.includes("risiko offen");
  }

  function recommendationFromInsight(text, title, fallbackReason) {
    const value = String(text || "").trim();
    if (!value) return { title, reason: fallbackReason, confidence: "mittel" };

    const [player, ...reasonParts] = value.split(":");
    return {
      player: reasonParts.length ? player.trim() : title,
      title,
      reason: reasonParts.length ? reasonParts.join(":").trim() : value,
      confidence: "mittel"
    };
  }

  function displayRecommendations(data) {
    const recommendations = { ...(data.recommendations || {}) };

    if (!hasRecommendation(recommendations.buy)) {
      recommendations.buy = {
        title: "Keine Kaufempfehlung",
        reason: "Aktuell kein fremdes Marktangebot attraktiv genug. Eigene Angebote nicht zurueckkaufen; Budget halten.",
        confidence: "hoch"
      };
    }

    if (!hasRecommendation(recommendations.sell)) {
      recommendations.sell = recommendationFromInsight(
        data.squadInsights?.sell?.[0],
        "Verkauf offen",
        "Noch kein klarer Verkaufskandidat. Erst bei echtem Upgrade oder starkem Angebot handeln."
      );
    }

    if (!hasRecommendation(recommendations.risk)) {
      recommendations.risk = recommendationFromInsight(
        data.squadInsights?.watch?.[0],
        "Risiko offen",
        "Aktuell kein klares Startelf-Risiko erkannt. Rollen vor dem Spieltag weiter beobachten."
      );
    }

    return recommendations;
  }

  function getOwnTeam(data) {
    const clubName = CONFIG.clubName.trim().toLowerCase();
    return (data.standings || []).find((team) => {
      const teamName = String(team.name || "").trim().toLowerCase();
      return team.isUserClub || teamName === clubName;
    });
  }

  function card(label, item, fallback) {
    const recommendation = normalizeRecommendation(item, fallback);
    const node = el("section", "ipad-advisor__card");
    node.appendChild(el("div", "ipad-advisor__label", label));
    node.appendChild(el("div", "ipad-advisor__card-title", firstValue(recommendation.player, recommendation.title, fallback)));
    node.appendChild(el("div", "ipad-advisor__card-text", firstValue(recommendation.reason, recommendation.detail, "Noch keine Begruendung vorhanden.")));
    return node;
  }

  function statusStrip(data) {
    const ownTeam = getOwnTeam(data);
    const budget = data.budgetStatus || {};
    const points = firstValue(ownTeam?.totalPoints, ownTeam?.points);
    const tableStatus = getTableStatus(data.standings || [], ownTeam);
    const items = [
      { label: "Budget", value: formatMoney(firstValue(budget.amount, budget.label, "offen")), type: "budget" },
      { label: "Platz", value: ownTeam?.rank ? `${ownTeam.rank}.` : "-" },
      { label: "Punkte", value: points ? `${points} P` : "-" },
      tableStatus
    ];

    const node = el("section", "ipad-advisor__status");
    items.forEach(({ label, value, type }) => {
      const item = el("div", `ipad-advisor__status-item${type ? ` ipad-advisor__status-item--${type}` : ""}`);
      item.appendChild(el("span", "", label));
      if (type === "gap" && Array.isArray(value)) {
        const gap = el("strong", "ipad-advisor__gap");
        value.forEach((entry) => {
          gap.appendChild(el("em", `ipad-advisor__gap-chip ipad-advisor__gap-chip--${entry.tone}`, entry.text));
        });
        item.appendChild(gap);
      } else if (Array.isArray(value)) {
        const multi = el("strong", "ipad-advisor__status-multi");
        value.forEach((line) => multi.appendChild(el("em", "", line)));
        item.appendChild(multi);
      } else {
        item.appendChild(el("strong", "", value));
      }
      node.appendChild(item);
    });
    return node;
  }

  function formatMoney(value) {
    if (!value || value === "offen" || value === "-") return value || "-";
    const text = String(value).trim();
    return text.includes("\u20ac") ? text : `${text} \u20ac`;
  }

  function getTableStatus(standings, ownTeam) {
    if (!ownTeam) return { label: "Lage", value: "-", type: "gap" };

    const ownPoints = Number(firstValue(ownTeam.totalPoints, ownTeam.points));
    const ownRank = Number(ownTeam.rank);
    if (!Number.isFinite(ownPoints) || !Number.isFinite(ownRank)) {
      return { label: "Lage", value: "-", type: "gap" };
    }

    const sorted = [...standings]
      .filter((team) => team && Number.isFinite(Number(team.rank)))
      .sort((a, b) => Number(a.rank) - Number(b.rank));

    if (ownRank === 1) {
      const chaser = sorted.find((team) => Number(team.rank) === 2);
      const chaserPoints = Number(firstValue(chaser?.totalPoints, chaser?.points));
      if (!Number.isFinite(chaserPoints)) return { label: "Lage", value: "Spitze", type: "gap" };
      const gap = Math.max(0, ownPoints - chaserPoints);
      return {
        label: "Lage",
        type: "gap",
        value: gap > 0 ? [{ tone: "good", text: `${gap} P` }] : "Spitze"
      };
    }

    const leader = sorted.find((team) => Number(team.rank) === 1);
    const front = sorted.find((team) => Number(team.rank) === ownRank - 1);
    const rear = sorted.find((team) => Number(team.rank) === ownRank + 1);
    const leaderPoints = Number(firstValue(leader?.totalPoints, leader?.points));
    const frontPoints = Number(firstValue(front?.totalPoints, front?.points));
    const rearPoints = Number(firstValue(rear?.totalPoints, rear?.points));

    const leaderGap = Number.isFinite(leaderPoints) ? Math.max(0, leaderPoints - ownPoints) : null;
    const frontGap = Number.isFinite(frontPoints) ? Math.max(0, frontPoints - ownPoints) : null;
    const rearGap = Number.isFinite(rearPoints) ? Math.max(0, ownPoints - rearPoints) : null;

    return {
      label: "Lage",
      type: "gap",
      value: [
        { tone: "bad", text: `${frontGap ?? leaderGap ?? "-"} P` },
        { tone: "good", text: rearGap === null ? "frei" : `${rearGap} P` }
      ]
    };
  }

  function ticker(data) {
    const node = el("section", "ipad-advisor__ticker");
    node.appendChild(el("div", "ipad-advisor__ticker-label", "Transfernews"));
    const track = el("div", "ipad-advisor__ticker-track");
    const humanTransfers = (data.transferTicker || []).filter(isHumanTransfer);
    const transfers = humanTransfers.length ? humanTransfers : [
      { action: "Info", player: "Noch keine Transfers", club: "Telegram-Screenshot senden" }
    ];
    const text = transfers
      .slice(0, 12)
      .map((item) => {
        if (item.text) return item.text.replace(/\bfuer\b/g, "fÃƒÂ¼r");
        const price = item.price ? ` fÃƒÂ¼r ${item.price}` : "";
        const direction = item.from || item.to
          ? `${item.from ? `von ${item.from}` : ""}${item.from && item.to ? " " : ""}${item.to ? `zu ${item.to}` : ""}`
          : `zu ${item.club || "unbekannt"}`;
        return `${item.action || "Update"}: ${item.player || "Unbekannt"} ${direction}${price}`;
      })
      .join("  +++  ");
    track.textContent = `${text}  +++  ${text}`;
    node.appendChild(track);
    return node;
  }

  function isHumanTransfer(item) {
    const text = [
      item?.action,
      item?.player,
      item?.club,
      item?.price
    ].join(" ").toLowerCase();
    return Boolean(item?.player || item?.action)
      && !text.includes("listed")
      && !text.includes("gelistet");
  }

  function lineup(data) {
    const node = el("section", "ipad-advisor__lineup");
    node.appendChild(el("div", "ipad-advisor__label", "Teamaufstellung"));
    if (!data.lineupImage?.url) {
      node.appendChild(el("div", "ipad-advisor__empty", "Noch kein Aufstellungsbild gespeichert."));
      return node;
    }
    const img = el("img", "ipad-advisor__lineup-image");
    img.src = assetUrl(data.lineupImage.url, data.lineupImage.updatedAt || "");
    img.alt = data.lineupImage.alt || "Aktuelle Teamaufstellung";
    node.appendChild(img);
    return node;
  }

  function standings(data) {
    const node = el("section", "ipad-advisor__standings");
    node.appendChild(el("div", "ipad-advisor__label", "Ligatabelle"));
    if (!data.standings?.length) {
      node.appendChild(el("div", "ipad-advisor__empty", "Noch kein Tabellen-Screenshot ausgewertet."));
      return node;
    }

    data.standings.slice(0, 6).forEach((team, index) => {
      const row = el("div", "ipad-advisor__standing-row");
      if (team.isUserClub || String(team.name || "").trim().toLowerCase() === CONFIG.clubName.toLowerCase()) {
        row.className += " ipad-advisor__standing-row--own";
      }

      row.appendChild(el("span", "ipad-advisor__rank", `${team.rank || index + 1}.`));

      const teamBlock = el("span");
      teamBlock.appendChild(el("span", "ipad-advisor__team-name", team.name || "Unbekannt"));
      if (team.marketValue || team.value) {
        teamBlock.appendChild(el("span", "ipad-advisor__market", team.marketValue || team.value));
      }
      row.appendChild(teamBlock);

      const points = el("span", "ipad-advisor__points");
      points.appendChild(el("span", "ipad-advisor__pill ipad-advisor__pill--matchday", firstValue(team.matchdayPoints, team.lastMatchdayPoints, team.dayPoints, "-")));
      points.appendChild(el("span", "ipad-advisor__pill ipad-advisor__pill--total", firstValue(team.totalPoints, team.points, "-")));
      row.appendChild(points);
      node.appendChild(row);
    });

    return node;
  }

  function squad(data) {
    const insights = data.squadInsights || {};
    const node = el("section", "ipad-advisor__squad");
    node.appendChild(el("div", "ipad-advisor__label", "Kader-Check"));
    [
      ["Halten", insights.keep],
      ["Verkaufen", insights.sell],
      ["Beobachten", insights.watch]
    ].forEach(([label, items]) => {
      if (!Array.isArray(items) || !items.length) return;
      const row = el("div", "ipad-advisor__squad-row");
      row.appendChild(el("span", "", label));
      row.appendChild(el("strong", "", items.slice(0, 2).join(" + ")));
      node.appendChild(row);
    });
    if (node.children.length === 1) {
      node.appendChild(el("div", "ipad-advisor__empty", "Noch kein Kader-Screenshot ausgewertet."));
    }
    return node;
  }

  function rumor(data) {
    const node = el("section", "ipad-advisor__rumor");
    node.appendChild(el("div", "ipad-advisor__label", "Geruechtekueche"));
    node.appendChild(el("div", "ipad-advisor__rumor-title", data.rumorKitchen?.headline || "Patron Co prueft den naechsten Deal"));
    node.appendChild(el("div", "ipad-advisor__rumor-text", data.rumorKitchen?.body || "Die Pasta-Zentrale kalkuliert weiter."));
    return node;
  }

  function render(data) {
    latestData = data;
    const recommendations = displayRecommendations(data);
    app.innerHTML = "";

    const shell = el("div", "ipad-advisor__shell");
    const header = el("header", "ipad-advisor__header");
    const title = el("div");
    title.appendChild(el("div", "ipad-advisor__league", data.league || CONFIG.title));
    title.appendChild(el("div", "ipad-advisor__club", CONFIG.clubName));
    title.appendChild(el("div", "ipad-advisor__motto", data.club?.motto || "Mangia, Lotta, Vinci"));
    header.appendChild(title);
    header.appendChild(el("div", "ipad-advisor__captain", data.club?.captain ? `Captain ${data.club.captain}` : "Captain offen"));
    shell.appendChild(header);
    shell.appendChild(ticker(data));

    const topGrid = el("div", "ipad-advisor__top-grid");
    const left = el("div");
    const cards = el("section", "ipad-advisor__cards");
    cards.appendChild(card("Beste Kaufempfehlung", recommendations.buy, "Kauf offen"));
    cards.appendChild(card("Verkaufskandidat", recommendations.sell, "Verkauf offen"));
    cards.appendChild(card("Startelf-Risiko", recommendations.risk, "Risiko offen"));
    cards.appendChild(card("Budget-Hinweis", recommendations.budget, "Budget offen"));
    left.appendChild(cards);
    left.appendChild(statusStrip(data));
    topGrid.appendChild(left);

    const side = el("div", "ipad-advisor__side");
    side.appendChild(lineup(data));
    side.appendChild(standings(data));
    topGrid.appendChild(side);
    shell.appendChild(topGrid);

    const bottomGrid = el("div", "ipad-advisor__bottom-grid");
    bottomGrid.appendChild(squad(data));
    bottomGrid.appendChild(rumor(data));
    shell.appendChild(bottomGrid);
    const timestamp = data.generatedAt ? new Date(data.generatedAt).toLocaleString("de-DE") : "unbekannt";
    shell.appendChild(el("footer", "ipad-advisor__footer", `Letzte Analyse: ${timestamp}`));
    app.appendChild(shell);
  }

  async function load() {
    try {
      const response = await fetch(`${CONFIG.dataFile}?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      render(await response.json());
    } catch (error) {
      app.innerHTML = "";
      app.appendChild(el("div", "ipad-advisor__error", `Keine Daten geladen: ${error.message}`));
    }
  }

  load();
  setInterval(load, CONFIG.refreshMs);
  setInterval(() => {
    if (latestData) render(latestData);
  }, 60 * 1000);
})();
