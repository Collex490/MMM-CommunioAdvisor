Module.register("MMM-CommunioAdvisor", {
  defaults: {
    updateInterval: 5 * 60 * 1000,
    dataFile: "modules/MMM-CommunioAdvisor/data/latest.json",
    title: "WM Comunio",
    clubName: "Pasta La Vista FC",
    showStandings: true,
    showTransferTicker: true,
    showLineupImage: true,
    showRumorImage: true,
    showSquadInsights: true,
    nextMatchdayAt: "",
    nextMatchdayLabel: "Nächster Spieltag",
    matchdays: [],
    showDebug: false
  },

  start() {
    this.analysis = null;
    this.error = null;
    this.loaded = false;
    this.getAnalysis();
    this.scheduleUpdate();
  },

  getStyles() {
    return ["MMM-CommunioAdvisor.css"];
  },

  scheduleUpdate() {
    setInterval(() => {
      this.getAnalysis();
    }, this.config.updateInterval);

    setInterval(() => {
      if (this.loaded && !this.error) {
        this.updateDom(400);
      }
    }, 60 * 1000);
  },

  getAnalysis() {
    fetch(this.config.dataFile, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        this.analysis = data;
        this.error = null;
        this.loaded = true;
        this.updateDom(800);
      })
      .catch((error) => {
        this.error = error.message;
        this.loaded = true;
        this.updateDom(800);
      });
  },

  getDom() {
    const wrapper = document.createElement("div");
    wrapper.className = "communio-advisor";

    if (!this.loaded) {
      wrapper.appendChild(this.buildStatus("Lade Comunio-Analyse..."));
      return wrapper;
    }

    if (this.error) {
      wrapper.appendChild(this.buildStatus("Keine Analyse gefunden."));
      if (this.config.showDebug) {
        wrapper.appendChild(this.buildDebug(this.error));
      }
      return wrapper;
    }

    const data = this.analysis || {};
    const recommendations = data.recommendations || {};

    wrapper.appendChild(this.buildHeader(data));

    if (this.config.showTransferTicker) {
      wrapper.appendChild(this.buildTransferTicker(data.transferTicker || []));
    }

    const content = document.createElement("div");
    content.className = "communio-advisor__content";

    const mainColumn = document.createElement("div");
    mainColumn.className = "communio-advisor__main-column";

    const grid = document.createElement("div");
    grid.className = "communio-advisor__grid";
    grid.appendChild(this.buildCard("Beste Kaufempfehlung", recommendations.buy, "buy"));
    grid.appendChild(this.buildCard("Verkaufskandidat", recommendations.sell, "sell"));
    grid.appendChild(this.buildCard("Startelf-Risiko", recommendations.risk, "risk"));
    grid.appendChild(this.buildCard("Budget-Hinweis", recommendations.budget, "budget"));
    mainColumn.appendChild(grid);
    mainColumn.appendChild(this.buildStatusStrip(data));

    const sideColumn = document.createElement("div");
    sideColumn.className = "communio-advisor__side-column";

    if (this.config.showLineupImage) {
      sideColumn.appendChild(this.buildLineupImage(data.lineupImage));
    }

    if (this.config.showStandings) {
      sideColumn.appendChild(this.buildStandings(data.standings || []));
    }

    content.appendChild(mainColumn);
    content.appendChild(sideColumn);

    wrapper.appendChild(content);
    if (this.config.showSquadInsights) {
      wrapper.appendChild(this.buildSquadInsights(data.squadInsights));
    }
    wrapper.appendChild(this.buildRumorCard(data.rumorKitchen, data.rumorImage));
    wrapper.appendChild(this.buildFooter(data));

    return wrapper;
  },

  buildHeader(data) {
    const header = document.createElement("div");
    header.className = "communio-advisor__header";
    const logoUrl = this.getClubLogoUrl(data);
    const clubName = this.config.clubName || "Pasta La Vista FC";

    const titleBlock = document.createElement("div");

    const eyebrow = document.createElement("div");
    eyebrow.className = "communio-advisor__eyebrow";
    eyebrow.textContent = data.league || this.config.title;

    const titleRow = document.createElement("div");
    titleRow.className = "communio-advisor__title-row";

    if (logoUrl) {
      const logo = document.createElement("img");
      logo.className = "communio-advisor__logo";
      logo.src = `${logoUrl}?v=${encodeURIComponent(data.club?.logo?.updatedAt || data.generatedAt || "")}`;
      logo.alt = `${clubName} Logo`;
      titleRow.appendChild(logo);
    }

    const title = document.createElement("div");
    title.className = "communio-advisor__title";
    title.textContent = clubName;
    titleRow.appendChild(title);

    const motto = document.createElement("div");
    motto.className = "communio-advisor__motto";
    motto.textContent = data.club?.motto || "Mangia, Lotta, Vinci";

    titleBlock.appendChild(eyebrow);
    titleBlock.appendChild(titleRow);
    titleBlock.appendChild(motto);

    const identity = document.createElement("div");
    identity.className = "communio-advisor__identity";

    const badge = document.createElement("div");
    badge.className = "communio-advisor__badge";
    badge.textContent = data.club?.captain ? `Captain ${data.club.captain}` : "WM 2026";
    identity.appendChild(badge);

    header.appendChild(titleBlock);
    header.appendChild(identity);

    return header;
  },

  getClubLogoUrl(data) {
    const logo = data.club?.logo;
    if (typeof logo === "string") {
      return logo;
    }

    if (logo?.url) {
      return logo.url;
    }

    return data.clubLogo?.url || data.clubLogo || "";
  },

  buildCard(label, item, type) {
    const card = document.createElement("div");
    card.className = `communio-advisor__card communio-advisor__card--${type}`;

    const cardLabel = document.createElement("div");
    cardLabel.className = "communio-advisor__card-label";
    cardLabel.textContent = label;

    const name = document.createElement("div");
    name.className = "communio-advisor__card-name";
    name.textContent = item?.player || item?.title || "Noch keine Daten";

    const reason = document.createElement("div");
    reason.className = "communio-advisor__card-reason";
    reason.textContent = item?.reason || "Sende einen Screenshot per Telegram, sobald das Backend aktiv ist.";

    const meta = document.createElement("div");
    meta.className = "communio-advisor__card-meta";
    meta.textContent = item?.confidence ? `Sicherheit: ${item.confidence}` : "Demo";

    card.appendChild(cardLabel);
    card.appendChild(name);
    card.appendChild(reason);
    card.appendChild(meta);

    return card;
  },

  buildStatusStrip(data) {
    const strip = document.createElement("div");
    strip.className = "communio-advisor__status-strip";

    const clubName = (this.config.clubName || "Pasta La Vista FC").trim().toLowerCase();
    const ownTeam = (data.standings || []).find((team) => {
      const teamName = String(team.name || "").trim().toLowerCase();
      return teamName === clubName || team.isUserClub;
    });
    const budget = data.budgetStatus || {};
    const ownTotalPoints = ownTeam?.totalPoints ?? ownTeam?.points;
    const focus = this.getMatchdayStatus(data) || this.getFocusStatus(data);
    const items = [
      ["Budget", budget.amount || budget.label || "offen"],
      ["Platz", ownTeam?.rank ? `${ownTeam.rank}.` : "-"],
      ["Punkte", ownTotalPoints != null ? `${ownTotalPoints} P` : "-"],
      [focus.label, focus.value]
    ];

    items.forEach(([label, value]) => {
      const item = document.createElement("div");
      item.className = "communio-advisor__status-item";

      const itemLabel = document.createElement("span");
      itemLabel.textContent = label;

      const itemValue = document.createElement("strong");
      itemValue.textContent = value;

      item.appendChild(itemLabel);
      item.appendChild(itemValue);
      strip.appendChild(item);
    });

    return strip;
  },

  getFocusStatus(data) {
    const screenType = data.lastScreenType || data.source?.screenType || "auto";
    const labels = {
      squad: { label: "Fokus", value: "Kader-Check" },
      budget: { label: "Fokus", value: "Kontostand" },
      standings: { label: "Fokus", value: "Ligadruck" },
      transfermarket: { label: "Fokus", value: "Transferjagd" },
      lineup: { label: "Fokus", value: "Startelf" },
      auto: { label: "Fokus", value: "Analyse" }
    };

    if (screenType === "squad") {
      const sellCount = Array.isArray(data.squadInsights?.sell) ? data.squadInsights.sell.length : 0;
      return { label: "Fokus", value: sellCount ? `${sellCount} Tausch-Ideen` : "Kader-Check" };
    }

    if (screenType === "transfermarket") {
      const transferCount = Array.isArray(data.transferTicker) ? data.transferTicker.length : 0;
      return { label: "Fokus", value: transferCount ? `${transferCount} Marktnews` : "Transferjagd" };
    }

    if (screenType === "standings") {
      const ownTeam = (data.standings || []).find((team) => team.isUserClub || team.name === this.config.clubName);
      return { label: "Fokus", value: ownTeam?.rank ? `Jagd auf Platz ${Math.max(1, ownTeam.rank - 1)}` : "Ligadruck" };
    }

    return labels[screenType] || labels.auto;
  },

  getMatchdayStatus(data) {
    const matchday = this.getNextMatchday(data);
    if (!matchday) {
      return null;
    }

    const nextAt = matchday.at || matchday.date || this.config.nextMatchdayAt;

    if (!nextAt) {
      return null;
    }

    const target = new Date(nextAt);
    if (Number.isNaN(target.getTime())) {
      return null;
    }

    const diffMs = target.getTime() - Date.now();
    const label = matchday.label || this.config.nextMatchdayLabel || "Nächster Spieltag";

    if (diffMs <= 0 && diffMs > -3 * 60 * 60 * 1000) {
      return { label, value: "läuft jetzt" };
    }

    if (diffMs <= 0) {
      return { label, value: "heute prüfen" };
    }

    const totalMinutes = Math.ceil(diffMs / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0) {
      return { label, value: `${days}T ${hours}Std` };
    }

    if (hours > 0) {
      return { label, value: `${hours}Std ${minutes}Min` };
    }

    return { label, value: `${minutes}Min` };
  },

  getNextMatchday(data) {
    const configuredMatchdays = Array.isArray(this.config.matchdays) ? this.config.matchdays : [];
    const dataMatchdays = Array.isArray(data.matchdays) ? data.matchdays : [];
    const matchdays = [...dataMatchdays, ...configuredMatchdays]
      .filter((matchday) => matchday && (matchday.at || matchday.date))
      .sort((a, b) => new Date(a.at || a.date).getTime() - new Date(b.at || b.date).getTime());

    const now = Date.now();
    const upcoming = matchdays.find((matchday) => {
      const time = new Date(matchday.at || matchday.date).getTime();
      return Number.isFinite(time) && time > now - 3 * 60 * 60 * 1000;
    });

    if (upcoming) {
      return upcoming;
    }

    if (data.nextMatchday || this.config.nextMatchdayAt) {
      return data.nextMatchday || {
        at: this.config.nextMatchdayAt,
        label: this.config.nextMatchdayLabel
      };
    }

    return null;
  },

  buildStandings(standings) {
    const panel = document.createElement("div");
    panel.className = "communio-advisor__standings";

    const title = document.createElement("div");
    title.className = "communio-advisor__section-title";
    title.textContent = "Ligatabelle";
    panel.appendChild(title);

    if (!standings.length) {
      const empty = document.createElement("div");
      empty.className = "communio-advisor__empty";
      empty.textContent = "Noch kein Tabellen-Screenshot ausgewertet.";
      panel.appendChild(empty);
      return panel;
    }

    standings.slice(0, 6).forEach((team, index) => {
      const row = document.createElement("div");
      row.className = "communio-advisor__standing-row";
      if (String(team.name || "").trim().toLowerCase() === String(this.config.clubName || "").trim().toLowerCase() || team.isUserClub) {
        row.className += " communio-advisor__standing-row--own";
      }

      const rank = document.createElement("span");
      rank.className = "communio-advisor__standing-rank";
      rank.textContent = `${team.rank || index + 1}.`;

      const teamBlock = document.createElement("span");
      teamBlock.className = "communio-advisor__standing-team";

      const name = document.createElement("span");
      name.className = "communio-advisor__standing-name";
      name.textContent = team.name || "Unbekannt";

      const marketValue = document.createElement("span");
      marketValue.className = "communio-advisor__standing-market";
      marketValue.textContent = team.marketValue || team.value || "";

      teamBlock.appendChild(name);
      if (marketValue.textContent) {
        teamBlock.appendChild(marketValue);
      }

      const matchdayPoints = team.matchdayPoints ?? team.lastMatchdayPoints ?? team.dayPoints ?? team.currentPoints;
      const totalPoints = team.totalPoints ?? team.points;
      const points = document.createElement("span");
      points.className = "communio-advisor__standing-points";

      const matchdayBadge = document.createElement("span");
      matchdayBadge.className = "communio-advisor__standing-score communio-advisor__standing-score--matchday";
      matchdayBadge.title = "Punkte letzter Spieltag";
      matchdayBadge.textContent = matchdayPoints ?? "-";

      const totalBadge = document.createElement("span");
      totalBadge.className = "communio-advisor__standing-score communio-advisor__standing-score--total";
      totalBadge.title = "Gesamtpunkte";
      totalBadge.textContent = totalPoints ?? "-";

      points.appendChild(matchdayBadge);
      points.appendChild(totalBadge);

      row.appendChild(rank);
      row.appendChild(teamBlock);
      row.appendChild(points);
      panel.appendChild(row);
    });

    return panel;
  },

  buildTransferTicker(transfers) {
    const ticker = document.createElement("div");
    ticker.className = "communio-advisor__ticker";

    const label = document.createElement("div");
    label.className = "communio-advisor__ticker-label";
    label.textContent = "Transfermarkt";

    const track = document.createElement("div");
    track.className = "communio-advisor__ticker-track";

    const items = transfers.length ? transfers : [
      { action: "Info", player: "Noch keine Transfers", club: "Screenshot per Telegram senden" }
    ];

    const text = items
      .slice(0, 10)
      .map((item) => {
        const price = item.price ? ` fuer ${item.price}` : "";
        return `${item.action || "Update"}: ${item.player || "Unbekannt"} zu ${item.club || "unbekannt"}${price}`;
      })
      .join("  +++  ");

    track.textContent = `${text}  +++  ${text}`;

    ticker.appendChild(label);
    ticker.appendChild(track);

    return ticker;
  },

  buildSquadInsights(squadInsights) {
    const insights = squadInsights || {};
    const hasData = ["keep", "sell", "watch"].some((key) => Array.isArray(insights[key]) && insights[key].length);
    const panel = document.createElement("div");
    panel.className = "communio-advisor__squad";

    const label = document.createElement("div");
    label.className = "communio-advisor__card-label";
    label.textContent = "Kader-Check";
    panel.appendChild(label);

    if (!hasData) {
      const empty = document.createElement("div");
      empty.className = "communio-advisor__empty";
      empty.textContent = "Noch kein Kader-Screenshot ausgewertet.";
      panel.appendChild(empty);
      return panel;
    }

    [
      ["Halten", insights.keep],
      ["Verkaufen/Tauschen", insights.sell],
      ["Beobachten", insights.watch]
    ].forEach(([title, items]) => {
      if (!Array.isArray(items) || !items.length) {
        return;
      }

      const row = document.createElement("div");
      row.className = "communio-advisor__squad-row";

      const rowTitle = document.createElement("span");
      rowTitle.textContent = title;

      const rowText = document.createElement("strong");
      rowText.textContent = items.slice(0, 2).join(" + ");

      row.appendChild(rowTitle);
      row.appendChild(rowText);
      panel.appendChild(row);
    });

    return panel;
  },

  buildLineupImage(lineupImage) {
    const panel = document.createElement("div");
    panel.className = "communio-advisor__lineup";

    const label = document.createElement("div");
    label.className = "communio-advisor__card-label";
    label.textContent = "Teamaufstellung";
    panel.appendChild(label);

    if (!lineupImage?.url) {
      const empty = document.createElement("div");
      empty.className = "communio-advisor__empty";
      empty.textContent = "Noch kein Aufstellungs-Screenshot per Telegram gespeichert.";
      panel.appendChild(empty);
      return panel;
    }

    const image = document.createElement("img");
    image.className = "communio-advisor__lineup-image";
    image.src = `${lineupImage.url}?v=${encodeURIComponent(lineupImage.updatedAt || "")}`;
    image.alt = lineupImage.alt || "Aktuelle Teamaufstellung";

    panel.appendChild(image);

    return panel;
  },

  buildRumorCard(rumorKitchen, rumorImage) {
    const card = document.createElement("div");
    card.className = "communio-advisor__card communio-advisor__card--rumor";

    const label = document.createElement("div");
    label.className = "communio-advisor__card-label";
    label.textContent = "Gerüchteküche";

    const headline = document.createElement("div");
    headline.className = "communio-advisor__rumor-headline";
    headline.textContent = rumorKitchen?.headline || "Patron Co prüft Last-Minute-Deal";

    const body = document.createElement("div");
    body.className = "communio-advisor__card-reason";
    body.textContent = rumorKitchen?.body || "In der Pasta-Zentrale wird leise kalkuliert.";

    card.appendChild(label);
    card.appendChild(headline);
    card.appendChild(body);

    if (this.config.showRumorImage && rumorImage?.url) {
      const image = document.createElement("img");
      image.className = "communio-advisor__rumor-image";
      image.src = `${rumorImage.url}?v=${encodeURIComponent(rumorImage.updatedAt || "")}`;
      image.alt = rumorImage.alt || "Fiktive Sportmedien-Schlagzeile";
      card.appendChild(image);
    }

    return card;
  },

  buildFooter(data) {
    const footer = document.createElement("div");
    footer.className = "communio-advisor__footer";

    const timestamp = data.generatedAt ? new Date(data.generatedAt) : null;
    footer.textContent = timestamp
      ? `Letzte Analyse: ${timestamp.toLocaleString("de-DE")}`
      : "Letzte Analyse: unbekannt";

    return footer;
  },

  buildStatus(message) {
    const status = document.createElement("div");
    status.className = "communio-advisor__status";
    status.textContent = message;
    return status;
  },

  buildDebug(message) {
    const debug = document.createElement("div");
    debug.className = "communio-advisor__debug";
    debug.textContent = message;
    return debug;
  }
});
