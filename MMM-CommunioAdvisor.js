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
    nextMatchdayLabel: "Naechster Spieltag",
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
    const recommendations = this.getDisplayRecommendations(data);

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
    mainColumn.appendChild(this.buildLivePlayers(data));

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

  getDisplayRecommendations(data) {
    const recommendations = { ...(data.recommendations || {}) };

    if (!this.hasRecommendation(recommendations.buy)) {
      recommendations.buy = {
        title: "Keine Kaufempfehlung",
        reason: "Aktuell kein fremdes Marktangebot attraktiv genug. Eigene Angebote nicht zurueckkaufen; Budget halten.",
        confidence: "hoch"
      };
    }

    if (!this.hasRecommendation(recommendations.sell)) {
      recommendations.sell = this.recommendationFromInsight(
        data.squadInsights?.sell?.[0],
        "Verkauf offen",
        "Noch kein klarer Verkaufskandidat. Erst bei echtem Upgrade oder starkem Angebot handeln."
      );
    }

    if (!this.hasRecommendation(recommendations.risk)) {
      recommendations.risk = this.recommendationFromInsight(
        data.squadInsights?.watch?.[0],
        "Risiko offen",
        "Aktuell kein klares Startelf-Risiko erkannt. Rollen vor dem Spieltag weiter beobachten."
      );
    }

    if (!this.hasRecommendation(recommendations.budget)) {
      const budget = data.budgetStatus?.amount || data.budgetStatus?.label;
      recommendations.budget = {
        title: budget ? "Budget vorsichtig einsetzen" : "Budget offen",
        reason: budget
          ? `${this.formatCurrencyText(budget)} als Reserve nutzen; nur bei klarer Marktchance aggressiv bieten.`
          : "Noch kein belastbarer Budgetwert erkannt.",
        confidence: budget ? "mittel" : "niedrig"
      };
    }

    return recommendations;
  },

  hasRecommendation(item) {
    if (!item || typeof item !== "object") return false;
    const text = [item.player, item.title, item.reason].join(" ").toLowerCase();
    return Boolean(item.player || item.title || item.reason)
      && !text.includes("noch keine daten")
      && !text.includes("sende einen screenshot")
      && !text.includes("kauf offen")
      && !text.includes("verkauf offen")
      && !text.includes("risiko offen");
  },

  recommendationFromInsight(text, title, fallbackReason) {
    const value = String(text || "").trim();
    if (!value) {
      return { title, reason: fallbackReason, confidence: "mittel" };
    }

    const [player, ...reasonParts] = value.split(":");
    return {
      player: reasonParts.length ? player.trim() : title,
      title,
      reason: reasonParts.length ? reasonParts.join(":").trim() : value,
      confidence: "mittel"
    };
  },

  formatCurrencyText(value) {
    const text = String(value || "").trim();
    if (!text || /\u20ac|eur|offen|unbekannt|^-$/i.test(text)) {
      return text;
    }

    return /^\d{1,3}(?:[.\s]\d{3})+(?:,\d+)?$|^-?\d{4,}$/.test(text)
      ? `${text} \u20ac`
      : text;
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

    card.appendChild(cardLabel);
    card.appendChild(name);
    card.appendChild(reason);

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
    const budgetValue = budget.amount || budget.label || "offen";
    const ownTotalPoints = ownTeam?.totalPoints ?? ownTeam?.points;
    const gapStatus = this.getGapStatus(data.standings || [], ownTeam);
    const items = [
      { label: "Budget", value: this.formatCurrencyText(budgetValue), type: this.isNegativeMoney(budgetValue) ? "negative" : "budget" },
      { label: "Platz", value: ownTeam?.rank ? `${ownTeam.rank}.` : "-" },
      { label: "Punkte", value: ownTotalPoints != null ? `${ownTotalPoints} P` : "-" },
      gapStatus
    ];

    items.forEach(({ label, value, type }) => {
      const item = document.createElement("div");
      item.className = `communio-advisor__status-item${type ? ` communio-advisor__status-item--${type}` : ""}`;

      const itemLabel = document.createElement("span");
      itemLabel.textContent = label;

      const itemValue = document.createElement("strong");
      if (type === "gap" && Array.isArray(value)) {
        itemValue.className = "communio-advisor__gap";
        value.forEach((entry) => {
          const chip = document.createElement("span");
          chip.className = `communio-advisor__gap-chip communio-advisor__gap-chip--${entry.tone}`;
          chip.textContent = entry.text;
          itemValue.appendChild(chip);
        });
      } else if (Array.isArray(value)) {
        itemValue.className = "communio-advisor__status-multi";
        value.forEach((line) => {
          const lineNode = document.createElement("span");
          lineNode.textContent = line;
          itemValue.appendChild(lineNode);
        });
      } else {
        itemValue.textContent = value;
      }

      item.appendChild(itemLabel);
      item.appendChild(itemValue);
      strip.appendChild(item);
    });

    return strip;
  },

  isNegativeMoney(value) {
    const parsed = Number(String(value || "").replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) && parsed < 0;
  },

  getGapStatus(standings, ownTeam) {
    if (!ownTeam) {
      return { label: "Lage", value: "-", type: "gap" };
    }

    const ownPoints = ownTeam.totalPoints ?? ownTeam.points;
    const ownRank = Number(ownTeam.rank);
    if (ownPoints == null || !Number.isFinite(ownRank)) {
      return { label: "Lage", value: "-", type: "gap" };
    }

    const sorted = [...standings]
      .filter((team) => team && Number.isFinite(Number(team.rank)))
      .sort((a, b) => Number(a.rank) - Number(b.rank));
    const leader = sorted.find((team) => Number(team.rank) === 1);
    const leaderPoints = leader?.totalPoints ?? leader?.points;

    if (ownRank === 1) {
      const chaser = sorted.find((team) => Number(team.rank) === 2);
      const chaserPoints = chaser?.totalPoints ?? chaser?.points;
      if (chaserPoints == null) {
        return { label: "Lage", value: "Spitze", type: "gap" };
      }

      const gap = Math.max(0, Number(ownPoints) - Number(chaserPoints));
      return {
        label: "Lage",
        type: "gap",
        value: gap > 0 ? [{ tone: "good", text: `+${gap}` }] : "Spitze"
      };
    }

    const target = sorted.find((team) => Number(team.rank) === ownRank - 1);
    const targetPoints = target?.totalPoints ?? target?.points;
    const chaser = sorted.find((team) => Number(team.rank) === ownRank + 1);
    const chaserPoints = chaser?.totalPoints ?? chaser?.points;

    if (targetPoints == null) {
      return { label: "Lage", value: "-", type: "gap" };
    }

    const leaderGap = leaderPoints == null ? null : Math.max(0, Number(leaderPoints) - Number(ownPoints));
    const frontGap = Math.max(0, Number(targetPoints) - Number(ownPoints));
    const rearGap = chaserPoints == null ? null : Math.max(0, Number(ownPoints) - Number(chaserPoints));

    return {
      label: "Lage",
      type: "gap",
      value: [
        { tone: "top", text: leaderGap == null ? "-" : `${leaderGap}` },
        { tone: "bad", text: `${frontGap || leaderGap || "-"}` },
        { tone: "good", text: rearGap == null ? "frei" : `${rearGap}` }
      ]
    };
  },
  buildLivePlayers(data) {
    const sourcePlayers = data.livePlayers || data.livePoints || [];
    const livePlayers = (Array.isArray(sourcePlayers) ? sourcePlayers : [])
      .filter((player) => player && (player.livePoints !== undefined || player.status))
      .slice(0, 6);
    const fallbackPlayers = (Array.isArray(data.squadPlayers) ? data.squadPlayers : [])
      .filter((player) => player && player.name)
      .sort((a, b) => (b.points ?? -999) - (a.points ?? -999))
      .slice(0, 6)
      .map((player) => ({
        ...player,
        status: player.status || "Saisonpunkte"
      }));
    const players = livePlayers.length ? livePlayers : fallbackPlayers;
    const isLive = livePlayers.length > 0;

    if (!players.length) {
      return document.createDocumentFragment();
    }

    const panel = document.createElement("div");
    panel.className = "communio-advisor__live";

    const header = document.createElement("div");
    header.className = "communio-advisor__live-header";

    const title = document.createElement("div");
    title.className = "communio-advisor__card-label";
    title.textContent = isLive ? "Live-Punkte" : "Kader-Vorschau";

    const state = document.createElement("div");
    state.className = "communio-advisor__live-state";
    state.textContent = isLive ? "Spiel laeuft" : "Kader-Vorschau";

    header.appendChild(title);
    header.appendChild(state);
    panel.appendChild(header);

    const list = document.createElement("div");
    list.className = "communio-advisor__live-list";

    players.forEach((player) => {
      const item = document.createElement("div");
      item.className = "communio-advisor__live-player";

      const photo = document.createElement(player.photoUrl || player.imageUrl ? "img" : "div");
      photo.className = "communio-advisor__live-photo";
      if (player.photoUrl || player.imageUrl) {
        photo.src = player.photoUrl || player.imageUrl;
        photo.alt = player.name || "Spieler";
      } else {
        photo.textContent = this.initials(player.name);
      }

      const info = document.createElement("div");
      info.className = "communio-advisor__live-info";

      const name = document.createElement("strong");
      name.textContent = player.name || "Unbekannt";

      const meta = document.createElement("span");
      meta.textContent = this.formatPlayerMeta(player);

      info.appendChild(name);
      if (meta.textContent) {
        info.appendChild(meta);
      }

      item.appendChild(photo);
      item.appendChild(info);
      if (isLive) {
        const points = document.createElement("div");
        points.className = "communio-advisor__live-points";
        const value = player.livePoints ?? "-";
        points.textContent = `${value} P`;
        item.appendChild(points);
      }
      list.appendChild(item);
    });

    panel.appendChild(list);
    return panel;
  },

  initials(name) {
    return String(name || "?")
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  },

  formatPlayerMeta(player) {
    return [
      this.formatPositionLabel(player.position),
      player.club,
      player.status
    ].filter(Boolean).join(" | ");
  },

  formatPositionLabel(position) {
    const key = String(position || "").trim().toLowerCase();
    const labels = {
      goalkeeper: "Tor",
      goalie: "Tor",
      keeper: "Tor",
      tw: "Tor",
      defender: "Abwehr",
      defense: "Abwehr",
      defence: "Abwehr",
      df: "Abwehr",
      midfielder: "Mittelfeld",
      midfield: "Mittelfeld",
      mf: "Mittelfeld",
      striker: "Sturm",
      forward: "Sturm",
      attacker: "Sturm",
      st: "Sturm"
    };
    return labels[key] || position || "";
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
    const label = matchday.label || this.config.nextMatchdayLabel || "Naechster Spieltag";

    if (diffMs <= 0 && diffMs > -3 * 60 * 60 * 1000) {
      return { label, value: "laeuft jetzt" };
    }

    if (diffMs <= 0) {
      return { label, value: "heute pruefen" };
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
    const sourceMatchdays = configuredMatchdays.length ? configuredMatchdays : dataMatchdays;
    const matchdays = sourceMatchdays
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
      marketValue.textContent = this.formatCurrencyText(team.marketValue || team.value || "");

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
    label.textContent = "Transfernews";

    const track = document.createElement("div");
    track.className = "communio-advisor__ticker-track";

    const items = transfers.length ? transfers : [
      { action: "Info", player: "Noch keine Transfers", club: "Screenshot per Telegram senden" }
    ];

    const text = items
      .filter((item) => this.isHumanTransfer(item))
      .slice(0, 10)
      .map((item) => {
        if (item.text) {
          return item.text;
        }

        const price = item.price ? ` fuer ${this.formatCurrencyText(item.price)}` : "";
        const direction = item.from || item.to
          ? `${item.from ? `von ${item.from}` : ""}${item.from && item.to ? " " : ""}${item.to ? `zu ${item.to}` : ""}`
          : `zu ${item.club || "unbekannt"}`;
        return `${item.action || "Update"}: ${item.player || "Unbekannt"} ${direction}${price}`;
      })
      .join("  +++  ");

    track.textContent = `${text}  +++  ${text}`;

    ticker.appendChild(label);
    ticker.appendChild(track);

    return ticker;
  },

  isHumanTransfer(item) {
    const text = [
      item?.action,
      item?.player,
      item?.club,
      item?.price
    ].join(" ").toLowerCase();
    return Boolean(item?.player || item?.action)
      && !text.includes("listed")
      && !text.includes("gelistet");
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
      ["Verkaufen", insights.sell],
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
    label.textContent = "Geruechtekueche";

    const headline = document.createElement("div");
    headline.className = "communio-advisor__rumor-headline";
    headline.textContent = rumorKitchen?.headline || "Patron Co prueft Last-Minute-Deal";

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
