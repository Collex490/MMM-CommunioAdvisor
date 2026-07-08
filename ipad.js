(function () {
  const CONFIG = {
    dataFile: "data/latest.json",
    clubName: "Pasta La Vista FC",
    title: "WM Comunio",
    refreshMs: 60 * 1000,
    matchdays: [
      { label: "Viertelfinale", at: "2026-07-10T20:00:00+02:00" },
      { label: "Halbfinale", at: "2026-07-14T20:00:00+02:00" },
      { label: "Spiel um Platz 3", at: "2026-07-18T20:00:00+02:00" },
      { label: "Finale", at: "2026-07-19T20:00:00+02:00" }
    ]
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

  function getOwnTeam(data) {
    const clubName = CONFIG.clubName.trim().toLowerCase();
    return (data.standings || []).find((team) => {
      const teamName = String(team.name || "").trim().toLowerCase();
      return team.isUserClub || teamName === clubName;
    });
  }

  function getNextMatchday(data) {
    const configured = Array.isArray(CONFIG.matchdays) ? CONFIG.matchdays : [];
    const fromData = Array.isArray(data.matchdays) ? data.matchdays : [];
    const matchdays = [...fromData, ...configured]
      .filter((matchday) => matchday && (matchday.at || matchday.date))
      .sort((a, b) => new Date(a.at || a.date).getTime() - new Date(b.at || b.date).getTime());
    const now = Date.now();

    return matchdays.find((matchday) => {
      const time = new Date(matchday.at || matchday.date).getTime();
      return Number.isFinite(time) && time > now - 3 * 60 * 60 * 1000;
    });
  }

  function getCountdown(data) {
    const matchday = getNextMatchday(data);
    if (!matchday) return { label: "Fokus", value: "Analyse" };

    const target = new Date(matchday.at || matchday.date);
    const diffMs = target.getTime() - Date.now();
    const label = matchday.label || "Naechster Spieltag";

    if (diffMs <= 0 && diffMs > -3 * 60 * 60 * 1000) return { label, value: "laeuft jetzt" };
    if (diffMs <= 0) return { label, value: "heute pruefen" };

    const totalMinutes = Math.ceil(diffMs / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0) return { label, value: `${days}T ${hours}Std` };
    if (hours > 0) return { label, value: `${hours}Std ${minutes}Min` };
    return { label, value: `${minutes}Min` };
  }

  function card(label, item, fallback) {
    const recommendation = normalizeRecommendation(item, fallback);
    const node = el("section", "ipad-advisor__card");
    node.appendChild(el("div", "ipad-advisor__label", label));
    node.appendChild(el("div", "ipad-advisor__card-title", firstValue(recommendation.player, recommendation.title, fallback)));
    node.appendChild(el("div", "ipad-advisor__card-text", firstValue(recommendation.reason, recommendation.detail, "Noch keine Begruendung vorhanden.")));
    node.appendChild(el("div", "ipad-advisor__meta", recommendation.confidence ? `Sicherheit: ${recommendation.confidence}` : "Analyse"));
    return node;
  }

  function statusStrip(data) {
    const ownTeam = getOwnTeam(data);
    const countdown = getCountdown(data);
    const budget = data.budgetStatus || {};
    const points = firstValue(ownTeam?.totalPoints, ownTeam?.points);
    const items = [
      ["Budget", firstValue(budget.amount, budget.label, "offen")],
      ["Platz", ownTeam?.rank ? `${ownTeam.rank}.` : "-"],
      ["Punkte", points ? `${points} P` : "-"],
      [countdown.label, countdown.value]
    ];

    const node = el("section", "ipad-advisor__status");
    items.forEach(([label, value]) => {
      const item = el("div", "ipad-advisor__status-item");
      item.appendChild(el("span", "", label));
      item.appendChild(el("strong", "", value));
      node.appendChild(item);
    });
    return node;
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
        const price = item.price ? ` fuer ${item.price}` : "";
        return `${item.action || "Update"}: ${item.player || "Unbekannt"} zu ${item.club || "unbekannt"}${price}`;
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
      && !text.includes("computer")
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
      ["Verkaufen/Tauschen", insights.sell],
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
    const recommendations = data.recommendations || {};
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
