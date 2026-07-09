const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { mergeWithExisting } = require("./merge-analysis");

const envPath = path.join(__dirname, "..", ".env");
let fileEnv = {};
dotenv.config({ path: envPath });

try {
  fileEnv = dotenv.parse(fsSync.readFileSync(envPath));
  Object.entries(fileEnv).forEach(([key, value]) => {
    if (!process.env[key]) process.env[key] = value;
  });
} catch {
  // Missing .env is handled by the login guard.
}

function env(name, fallback = "") {
  return process.env[name] || fileEnv[name] || fallback;
}

const dataPath = env("COMMUNIO_ADVISOR_DATA_PATH")
  || path.join(__dirname, "..", "data", "latest.json");
const rawPath = env("COMMUNIO_API_RAW_PATH")
  || path.join(__dirname, "..", "data", "comunio-api-raw.json");
const uploadDir = env("COMMUNIO_ADVISOR_UPLOAD_DIR")
  || path.join(__dirname, "..", "uploads");
const publicUploadBase = env("COMMUNIO_ADVISOR_PUBLIC_UPLOAD_BASE")
  || "modules/MMM-CommunioAdvisor/uploads";

function splitEnvList(value, fallback = []) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .concat(fallback)
    .filter((item, index, list) => list.indexOf(item) === index);
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function tokenFromPayload(payload) {
  return payload?.access_token
    || payload?.accessToken
    || payload?.token
    || payload?.jwt
    || "";
}

function formatMoney(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value;
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value);
  return Math.round(value).toLocaleString("de-DE");
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function walk(value, visit) {
  const seen = new Set();
  const stack = [value];

  while (stack.length) {
    const item = stack.pop();
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);
    visit(item);
    Object.values(item).forEach((nested) => {
      if (nested && typeof nested === "object") stack.push(nested);
    });
  }
}

function collectArrays(value) {
  const arrays = [];
  walk(value, (item) => {
    Object.values(item).forEach((nested) => {
      if (Array.isArray(nested)) arrays.push(nested);
    });
  });
  if (Array.isArray(value)) arrays.push(value);
  return arrays;
}

function lowerKeys(object) {
  return Object.fromEntries(
    Object.entries(object || {}).map(([key, value]) => [key.toLowerCase(), value])
  );
}

function objectName(item) {
  if (!item || typeof item !== "object") return "";
  const direct = firstValue(
    item.name,
    item.username,
    item.userName,
    item.teamName,
    item.clubName,
    item.title,
    item.displayName,
    item.fullName,
    item.playerName
  );
  if (direct) return String(direct);
  return firstValue(
    item.player?.name,
    item.player?.displayName,
    item.user?.name,
    item.owner?.name,
    item.manager?.name,
    item.communityUser?.name,
    item.team?.name,
    item._embedded?.user?.name,
    item._embedded?.team?.name,
    item._embedded?.owner?.name,
    ""
  );
}

function numberish(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.replace(/[^\d-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function objectMoney(item) {
  return firstValue(
    item.marketValue,
    item.marketvalue,
    item.market_value,
    item.teamValue,
    item.teamvalue,
    item.team_value,
    item.value,
    item.price,
    item.amount,
    item.money,
    item.balance,
    ""
  );
}

const knownClubs = [
  "pasta la vista fc",
  "sporting bolzackerer",
  "squadra absenta"
];

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function knownClubName(value) {
  const normalized = normalizeText(value);
  return knownClubs.find((club) => normalized === club || normalized.includes(club)) || "";
}

function deepKnownClubName(value) {
  let found = knownClubName(objectName(value));
  if (found) return found;

  walk(value, (item) => {
    if (found || !item || typeof item !== "object") return;
    Object.values(item).forEach((nested) => {
      if (!found && typeof nested === "string") found = knownClubName(nested);
    });
  });

  return found;
}

function deepFirstValueByKeys(value, keys) {
  let found;
  walk(value, (item) => {
    if (found !== undefined || !item || typeof item !== "object") return;
    const lower = lowerKeys(item);
    for (const key of keys) {
      if (lower[key] !== undefined && lower[key] !== null && lower[key] !== "") {
        found = lower[key];
        return;
      }
    }
  });
  return found;
}

function titleCaseClubName(value) {
  const normalized = knownClubName(value) || normalizeText(value);
  if (normalized === "pasta la vista fc") return "Pasta la Vista FC";
  if (normalized === "sporting bolzackerer") return "Sporting Bolzackerer";
  if (normalized === "squadra absenta") return "Squadra Absenta";
  return String(value || "");
}

function directNumberByKeys(item, keys) {
  const lower = lowerKeys(item);
  for (const key of keys) {
    const parsed = numberish(lower[key]);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function directValueByKeys(item, keys) {
  const lower = lowerKeys(item);
  for (const key of keys) {
    if (lower[key] !== undefined && lower[key] !== null && lower[key] !== "") return lower[key];
  }
  return undefined;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "user-agent": "Mozilla/5.0 (X11; Linux armv7l) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 MMM-CommunioAdvisor/0.1",
      "accept-language": "de-DE,de;q=0.9,en;q=0.7",
      accept: "application/json, text/plain, */*",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  return {
    url,
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    json: parseJsonSafe(text),
    snippet: text.replace(/\s+/g, " ").trim().slice(0, 1200)
  };
}

async function fetchBinary(url, token) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (X11; Linux armv7l) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 MMM-CommunioAdvisor/0.1",
      "accept-language": "de-DE,de;q=0.9,en;q=0.7",
      accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      authorization: `Bearer ${token}`,
      origin: "https://www.comunio.de",
      referer: "https://www.comunio.de/wm"
    }
  });

  if (!response.ok) {
    throw new Error(`Bild konnte nicht geladen werden: HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

async function login() {
  const username = env("COMMUNIO_USERNAME");
  const password = env("COMMUNIO_PASSWORD");
  const apiBase = env("COMMUNIO_API_BASE", "https://www.comunio.com/api").replace(/\/+$/, "");

  if (!username || !password) {
    throw new Error("COMMUNIO_USERNAME und COMMUNIO_PASSWORD fehlen in .env.");
  }

  const payload = {
    username,
    password,
    tzoffset: Number(env("COMMUNIO_TZOFFSET", "2"))
  };
  const result = await fetchJson(`${apiBase}/login`, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: {
      origin: "https://www.comunio.de",
      referer: "https://www.comunio.de/wm",
      "content-type": "application/json"
    }
  });
  const token = tokenFromPayload(result.json);

  if (!token) {
    throw new Error(`Comunio-Login ohne Token. Status: ${result.status}`);
  }

  return { apiBase, token };
}

function configuredUrls(apiBase) {
  const communityId = env("COMMUNIO_COMMUNITY_ID");
  const userId = env("COMMUNIO_USER_ID");
  const configuredFetchUrls = [
    env("COMMUNIO_API_FETCH_URLS"),
    env("COMMUNIO_FETCH_URLS"),
    env("COMMUNIO_STANDINGS_TOTAL_URL"),
    env("COMMUNIO_STANDINGS_URL"),
    env("COMMUNIO_MEMBERS_URL"),
    env("COMMUNIO_STATE_URL")
  ].filter(Boolean).join(",");
  const fallback = [
    `${apiBase}/login/state`,
    communityId && userId ? `${apiBase}/communities/${communityId}/users/${userId}/lineup` : "",
    userId ? `${apiBase}/users/${userId}/squad` : "",
    userId && communityId ? `${apiBase}/users/${userId}/squad?eid=${communityId}` : "",
    communityId && userId ? `${apiBase}/communities/${communityId}/users/${userId}/offers?current` : "",
    `${apiBase}/matchdays`,
    communityId && userId ? `${apiBase}/communities/${communityId}/users/${userId}/news?group=true&originaltypes=true&start=0&limit=50&type=HIDDEN_NEWS` : "",
    communityId && userId ? `${apiBase}/communities/${communityId}/users/${userId}/news?group=true&originaltypes=true&start=0&limit=20` : "",
    communityId ? `${apiBase}/communities/${communityId}/members?online` : "",
    communityId ? `${apiBase}/communities/${communityId}/standings` : "",
    communityId ? `${apiBase}/communities/${communityId}/standings?period=total&wpe=true` : ""
  ].filter(Boolean);

  return splitEnvList(configuredFetchUrls, fallback);
}

async function fetchComunioData() {
  const { apiBase, token } = await login();
  const urls = configuredUrls(apiBase);
  const pages = [];

  for (const url of urls) {
    try {
      pages.push(await fetchJson(url, {
        headers: {
          authorization: `Bearer ${token}`,
          origin: "https://www.comunio.de",
          referer: "https://www.comunio.de/wm"
        }
      }));
    } catch (error) {
      pages.push({ url, error: error.message });
    }
  }

  const raw = {
    generatedAt: new Date().toISOString(),
    apiBase,
    pages
  };

  await fs.mkdir(path.dirname(rawPath), { recursive: true });
  await fs.writeFile(rawPath, JSON.stringify(raw, null, 2), "utf8");
  return { raw, token };
}

function pageByUrl(raw, part) {
  return raw.pages.find((page) => page.url.includes(part) && page.status === 200 && page.json)?.json;
}

function pagesByUrl(raw, part) {
  return raw.pages
    .filter((page) => page.url.includes(part) && page.status === 200 && page.json)
    .map((page) => page.json);
}

function bestArrayByScore(value, scorer) {
  return collectArrays(value)
    .map((items) => ({ items, score: items.reduce((sum, item) => sum + scorer(item), 0) }))
    .sort((a, b) => b.score - a.score)[0]?.items || [];
}

function mapStandings(json) {
  const items = bestArrayByScore(json, (item) => {
    if (!item || typeof item !== "object") return 0;
    const keys = lowerKeys(item);
    const clubName = deepKnownClubName(item);
    const hasStandingsPoints = directNumberByKeys(item, [
      "points",
      "totalpoints",
      "overallpoints",
      "pointstotal",
      "score",
      "matchdaypoints",
      "lastpoints"
    ]) !== undefined;
    return [
      objectName(item) || clubName ? 2 : 0,
      clubName ? 4 : 0,
      keys.rank !== undefined || keys.position !== undefined ? 2 : 0,
      hasStandingsPoints ? 4 : 0,
      firstValue(directValueByKeys(item, ["marketvalue", "teamvalue"]), item._embedded?.teamInfo?.teamValue) ? 1 : 0
    ].reduce((sum, value) => sum + value, 0);
  });

  return items
    .filter((item) => {
      if (!item || typeof item !== "object") return false;
      if (!(objectName(item) || deepKnownClubName(item))) return false;
      return directNumberByKeys(item, [
        "points",
        "totalpoints",
        "overallpoints",
        "pointstotal",
        "score",
        "matchdaypoints",
        "lastpoints"
      ]) !== undefined;
    })
    .map((item, index) => {
      const known = deepKnownClubName(item);
      const name = titleCaseClubName(known || objectName(item));
      const matchdayPoints = directNumberByKeys(item, [
        "matchdaypoints",
        "currentpoints",
        "daypoints",
        "lastpoints"
      ]);
      const totalPoints = directNumberByKeys(item, [
        "totalpoints",
        "overallpoints",
        "pointstotal",
        "score",
        "points"
      ]);
      return {
        rank: directNumberByKeys(item, ["rank", "position", "place"]) || index + 1,
        name,
        matchdayPoints: matchdayPoints !== undefined ? matchdayPoints : totalPoints,
        totalPoints,
        marketValue: formatMoney(firstValue(
          directValueByKeys(item, ["marketvalue", "teamvalue"]),
          item._embedded?.teamInfo?.teamValue
        )),
        isUserClub: normalizeText(name) === "pasta la vista fc"
      };
    })
    .filter((item, index, list) => list.findIndex((other) => normalizeText(other.name) === normalizeText(item.name)) === index)
    .slice(0, 12);
}

function mapStandingsFromRaw(raw) {
  const candidates = raw.pages
    .filter((page) => {
      if (page.status !== 200 || !page.json) return false;
      if (page.url.includes("/news")) return false;
      if (page.url.includes("/offers")) return false;
      if (page.url.includes("/squad")) return false;
      if (page.url.includes("/lineup")) return false;
      return page.url.includes("/standings") || page.url.includes("total.json");
    })
    .map((page) => page.json);

  const standings = candidates
    .map((json) => mapStandings(json))
    .filter((items) => items.length >= 2)
    .sort((a, b) => {
      const clubCount = (items) => new Set(items.map((item) => normalizeText(item.name)).filter((name) => knownClubs.includes(name))).size;
      const marketCount = (items) => items.filter((item) => item.marketValue).length;
      const totalPointCount = (items) => items.filter((item) => item.totalPoints !== undefined).length;
      return clubCount(b) - clubCount(a) || totalPointCount(b) - totalPointCount(a) || marketCount(b) - marketCount(a) || b.length - a.length;
    })[0] || [];

  const validRows = standings.filter((item) => item.totalPoints !== undefined || item.matchdayPoints !== undefined);
  if (validRows.length < 2) return [];

  const marketValues = mapTeamMarketValues(raw);
  return standings.map((team) => ({
    ...team,
    marketValue: team.marketValue || marketValues.get(normalizeText(team.name)) || ""
  }));
}

function squadMarketValue(squadJson) {
  const players = mapPlayers(squadJson);
  const total = players.reduce((sum, player) => {
    const value = numberish(player.marketValue || player.raw?.quotedprice || player.raw?.quotedPrice || player.raw?.recommendedprice || player.raw?.recommendedPrice);
    return sum + (value || 0);
  }, 0);
  return total > 0 ? formatMoney(total) : "";
}

function mapTeamMarketValues(raw) {
  const values = new Map();

  raw.pages
    .filter((page) => page.status === 200 && page.json)
    .forEach((page) => {
      walk(page.json, (item) => {
        if (!item || typeof item !== "object") return;
        const name = titleCaseClubName(deepKnownClubName(item) || objectName(item));
        const normalized = normalizeText(name);
        if (!knownClubs.includes(normalized)) return;

        const value = directValueByKeys(item, [
          "marketvalue",
          "market_value",
          "teamvalue",
          "team_value",
          "squadvalue",
          "squad_value",
          "rostervalue",
          "roster_value"
        ]);

        if (value !== undefined && value !== null && value !== "") {
          values.set(normalized, formatMoney(value));
        }
      });
    });

  const ownSquad = pageByUrl(raw, "/squad");
  const ownValue = squadMarketValue(ownSquad);
  if (ownValue && !values.has("pasta la vista fc")) {
    values.set("pasta la vista fc", ownValue);
  }

  return values;
}

function mapPlayers(json) {
  const items = bestArrayByScore(json, (item) => {
    if (!item || typeof item !== "object") return 0;
    const name = objectName(item.player || item);
    return [
      name ? 3 : 0,
      objectMoney(item.player || item) ? 1 : 0,
      item.position || item.player?.position ? 1 : 0
    ].reduce((sum, value) => sum + value, 0);
  });

  return items
    .map((item) => item.player || item)
    .filter((item) => item && typeof item === "object" && objectName(item))
    .map((item) => ({
      name: objectName(item),
      position: firstValue(item.position, item.positionName, item.role, ""),
      marketValue: formatMoney(objectMoney(item)),
      points: numberish(firstValue(item.points, item.totalPoints, item.score)),
      raw: item
    }))
    .slice(0, 30);
}

function mapOffers(json) {
  const items = bestArrayByScore(json, (item) => {
    if (!item || typeof item !== "object") return 0;
    return (objectName(item.player || item) ? 3 : 0) + (objectMoney(item) || objectMoney(item.player) ? 2 : 0);
  });

  return items
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const player = item.player || item;
      return {
        player: objectName(player),
        price: formatMoney(firstValue(item.price, item.amount, item.value, objectMoney(player))),
        seller: objectName(item.seller || item.owner || item.user || {}) || "Transfermarkt",
        reason: "Aktuell per Comunio-API auf dem Transfermarkt sichtbar.",
        priority: index + 1
      };
    })
    .filter((item) => item.player)
    .slice(0, 12);
}

function collectText(value) {
  const texts = [];
  walk(value, (item) => {
    Object.values(item).forEach((nested) => {
      if (typeof nested === "string" && nested.length > 8) texts.push(nested);
    });
  });
  return texts;
}

function mapTransferTicker(json) {
  return collectText(json)
    .filter((text) => /gekauft|verkauft|transfer|wechselt|kauf|verkauf/i.test(text))
    .map((text) => ({
      action: /verkauft|verkauf/i.test(text) ? "verkauft" : "gekauft",
      player: text.replace(/\s+/g, " ").slice(0, 90),
      club: "",
      price: ""
    }))
    .slice(0, 12);
}

function findBudget(json) {
  let found = "";
  walk(json, (item) => {
    if (found || !item || typeof item !== "object") return;
    const keys = lowerKeys(item);
    const value = firstValue(keys.credit, keys.balance, keys.budget, keys.money, keys.accountbalance, keys.account);
    if (value !== undefined && value !== null && value !== "") found = formatMoney(value);
  });
  return found;
}

function mapMatchdays(json) {
  const items = bestArrayByScore(json, (item) => {
    if (!item || typeof item !== "object") return 0;
    return (item.date || item.start || item.startDate || item.deadline ? 2 : 0) + (objectName(item) ? 1 : 0);
  });

  return items
    .map((item, index) => ({
      label: firstValue(item.name, item.title, item.label, `Spieltag ${index + 1}`),
      at: firstValue(item.date, item.start, item.startDate, item.deadline, item.kickoff)
    }))
    .filter((item) => item.at)
    .slice(0, 8);
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function playerPhotoUrl(player) {
  return firstValue(
    player.raw?._links?.photo?.href,
    player.raw?.photo?.href,
    player.raw?.player?._links?.photo?.href,
    player.raw?.tradable?._links?.photo?.href,
    ""
  );
}

function positionGroup(position) {
  const text = normalizeText(position);
  if (text.includes("keeper") || text.includes("goal") || text.includes("torwart")) return "goalkeeper";
  if (text.includes("defender") || text.includes("abwehr") || text.includes("defence")) return "defender";
  if (text.includes("striker") || text.includes("sturm") || text.includes("forward")) return "striker";
  return "midfielder";
}

function lineupPlayersFromRaw(raw) {
  const lineup = pageByUrl(raw, "/lineup");
  const squad = pageByUrl(raw, "/squad");
  const lineupPlayers = mapPlayers(lineup);
  const squadPlayers = mapPlayers(squad).filter((player) => player.raw?.linedup === true);
  const players = lineupPlayers.length ? lineupPlayers : squadPlayers;
  const seen = new Set();

  return players
    .filter((player) => {
      const key = normalizeText(player.name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 11);
}

function coordinatesForLineup(players) {
  const rows = {
    goalkeeper: players.filter((player) => positionGroup(player.position) === "goalkeeper"),
    defender: players.filter((player) => positionGroup(player.position) === "defender"),
    midfielder: players.filter((player) => positionGroup(player.position) === "midfielder"),
    striker: players.filter((player) => positionGroup(player.position) === "striker")
  };

  if (!rows.goalkeeper.length && players.length >= 11) {
    rows.goalkeeper = [players[0]];
  }

  const placed = new Set(rows.goalkeeper.map((player) => player.name));
  rows.defender = rows.defender.filter((player) => !placed.has(player.name));
  rows.midfielder = rows.midfielder.filter((player) => !placed.has(player.name));
  rows.striker = rows.striker.filter((player) => !placed.has(player.name));

  const distribute = (items, y) => {
    const count = Math.max(items.length, 1);
    return items.map((player, index) => ({
      player,
      x: 120 + ((560 / (count + 1)) * (index + 1)),
      y
    }));
  };

  return [
    ...distribute(rows.striker, 145),
    ...distribute(rows.midfielder, 285),
    ...distribute(rows.defender, 420),
    ...distribute(rows.goalkeeper, 545)
  ];
}

async function renderGeneratedLineup(raw, token) {
  const players = lineupPlayersFromRaw(raw);
  if (!players.length) return null;

  const photoCache = new Map();
  for (const player of players) {
    const url = playerPhotoUrl(player);
    if (!url) continue;
    try {
      photoCache.set(player.name, await fetchBinary(url, token));
    } catch {
      // Missing photos should not break the whole lineup render.
    }
  }

  const placed = coordinatesForLineup(players);
  const cards = placed.map(({ player, x, y }, index) => {
    const photo = photoCache.get(player.name);
    const clipId = `playerPhoto${index}`;
    const initials = player.name
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

    return `
      <g transform="translate(${Math.round(x - 42)}, ${Math.round(y - 54)})">
        <rect x="0" y="0" width="84" height="108" rx="10" fill="#17345a" stroke="#e0b13f" stroke-width="2"/>
        <clipPath id="${clipId}"><rect x="9" y="8" width="66" height="58" rx="8"/></clipPath>
        ${photo
          ? `<image href="${photo}" x="9" y="8" width="66" height="58" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`
          : `<rect x="9" y="8" width="66" height="58" rx="8" fill="#243447"/><text x="42" y="45" text-anchor="middle" font-size="20" fill="#e0b13f" font-weight="800">${escapeXml(initials)}</text>`}
        <rect x="8" y="70" width="68" height="28" rx="6" fill="#10243f"/>
        <text x="42" y="82" text-anchor="middle" font-size="9" fill="#ffffff" font-weight="800">${escapeXml(player.name).slice(0, 16)}</text>
        <text x="42" y="94" text-anchor="middle" font-size="8" fill="#d6d6d6">${escapeXml(player.position || "Spieler")}</text>
        ${player.points !== undefined ? `<circle cx="72" cy="14" r="11" fill="#ffffff"/><text x="72" y="18" text-anchor="middle" font-size="10" fill="#2ba84a" font-weight="900">${player.points}</text>` : ""}
      </g>`;
  }).join("");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="620" viewBox="0 0 800 620">
  <defs>
    <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2f7f38"/>
      <stop offset="1" stop-color="#1f5f2c"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#000000" flood-opacity="0.35"/>
    </filter>
  </defs>
  <rect width="800" height="620" rx="22" fill="#111"/>
  <g transform="translate(45, 38)" filter="url(#shadow)">
    <rect width="710" height="540" rx="18" fill="url(#grass)" stroke="#e0b13f" stroke-width="3"/>
    <g stroke="#dbe8d4" stroke-width="3" fill="none" opacity="0.7">
      <rect x="34" y="28" width="642" height="484"/>
      <line x1="34" y1="270" x2="676" y2="270"/>
      <circle cx="355" cy="270" r="62"/>
      <rect x="221" y="28" width="268" height="76"/>
      <rect x="221" y="436" width="268" height="76"/>
      <rect x="283" y="28" width="144" height="35"/>
      <rect x="283" y="477" width="144" height="35"/>
    </g>
    <g opacity="0.16">
      ${Array.from({ length: 9 }, (_, index) => `<rect x="${34 + index * 72}" y="28" width="36" height="484" fill="#ffffff"/>`).join("")}
    </g>
    ${cards}
  </g>
  <text x="400" y="28" text-anchor="middle" fill="#e0b13f" font-size="18" font-weight="900" letter-spacing="1">Pasta La Vista FC - Automatische Aufstellung</text>
  <text x="400" y="604" text-anchor="middle" fill="#d6d6d6" font-size="13">Generiert aus Comunio API - ${escapeXml(new Date().toLocaleString("de-DE"))}</text>
</svg>`;

  await fs.mkdir(uploadDir, { recursive: true });
  const filename = "generated-lineup.svg";
  await fs.writeFile(path.join(uploadDir, filename), svg, "utf8");

  return {
    url: `${publicUploadBase}/${filename}`,
    alt: "Automatisch generierte Teamaufstellung",
    updatedAt: new Date().toISOString()
  };
}

function buildAnalysis(raw, generatedLineupImage) {
  const lineup = pageByUrl(raw, "/lineup");
  const squad = pageByUrl(raw, "/squad");
  const offers = pageByUrl(raw, "/offers?current");
  const matchdays = pageByUrl(raw, "/matchdays");
  const news = raw.pages
    .filter((page) => page.status === 200 && page.url.includes("/news"))
    .map((page) => page.json);
  const squadPlayers = mapPlayers(squad);
  const marketCandidates = mapOffers(offers);
  const standings = mapStandingsFromRaw(raw);
  const ownTeam = standings.find((team) => team.isUserClub);
  const budget = findBudget(offers) || findBudget(lineup) || findBudget(squad);

  return {
    league: "WM Comunio",
    source: {
      platform: "Comunio",
      screenType: "api"
    },
    club: {
      name: "Pasta La Vista FC",
      boss: "Patron Co",
      coach: "Gennaro Gattuso",
      colors: ["Schwarz", "Gold"],
      motto: "Mangia, Lotta, Vinci",
      captain: "Sorloth"
    },
    recommendations: {
      buy: marketCandidates[0]
        ? {
            player: marketCandidates[0].player,
            title: "Kaufempfehlung",
            reason: `${marketCandidates[0].player} ist aktuell auf dem Markt sichtbar. Preis pruefen und nur mit Reserve bieten.`,
            confidence: "mittel"
          }
        : undefined,
      sell: squadPlayers[0]
        ? {
            player: squadPlayers[squadPlayers.length - 1]?.name || squadPlayers[0].name,
            title: "Verkaufskandidat",
            reason: "Kader per API geladen. Verkaufskandidat nach ChatGPT-Analyse aus Rollen, Punkten und Marktangeboten verfeinern.",
            confidence: "mittel"
          }
        : undefined,
      risk: squadPlayers[0]
        ? {
            player: squadPlayers[0].name,
            title: "Startelf-Risiko",
            reason: "Aufstellung und Kader per API geladen. Startelf-Risiko nach Spieltagsdaten und Rollenverteilung pruefen.",
            confidence: "mittel"
          }
        : undefined,
      budget: {
        title: budget ? "Budget aus Comunio erkannt" : "Budget weiter per Telegram sichern",
        reason: budget
          ? `${budget} auf dem Konto. Reserve fuer kurzfristige Marktchancen halten.`
          : "Kontostand wurde in den API-Daten noch nicht sicher gefunden; Telegram-/Budget-Screenshot bleibt Backup.",
        confidence: budget ? "hoch" : "mittel"
      }
    },
    marketCandidates,
    standings,
    transferTicker: news.flatMap(mapTransferTicker).slice(0, 12),
    budgetStatus: budget ? { amount: budget, note: "Aus Comunio-API erkannt" } : {},
    lineupImage: generatedLineupImage || undefined,
    squadInsights: {
      keep: squadPlayers.slice(0, 2).map((player) => `${player.name} im Kader behalten und Rolle pruefen`),
      sell: squadPlayers.slice(-2).map((player) => `${player.name} als moeglichen Tausch-/Verkaufskandidaten pruefen`),
      watch: marketCandidates.slice(0, 2).map((item) => `${item.player} auf dem Markt beobachten`)
    },
    matchdays: mapMatchdays(matchdays),
    rumorKitchen: {
      headline: "Pasta La Vista FC zapft die Comunio-Leitung an",
      body: `Patron Co sieht ${ownTeam?.totalPoints || "neue"} Punkte im Datenraum, waehrend Gattuso Transfermarkt und Kaderliste enger zusammenrueckt.`
    },
    generatedAt: raw.generatedAt || new Date().toISOString()
  };
}

async function main() {
  const { raw, token } = await fetchComunioData();
  const generatedLineupImage = await renderGeneratedLineup(raw, token);
  const analysis = buildAnalysis(raw, generatedLineupImage);
  const merged = await mergeWithExisting(dataPath, analysis);

  await fs.mkdir(path.dirname(dataPath), { recursive: true });
  await fs.writeFile(dataPath, JSON.stringify(merged, null, 2), "utf8");

  console.log(`Comunio-API-Rohdaten gespeichert: ${rawPath}`);
  console.log(`Comunio-API-Daten in latest.json uebernommen: ${dataPath}`);
  if (generatedLineupImage?.url) {
    console.log(`Aufstellungsbild generiert: ${generatedLineupImage.url}`);
  }
  console.log(`Tabelle: ${analysis.standings.length}, Kaderhinweise: ${analysis.squadInsights.keep.length + analysis.squadInsights.sell.length}, Markt: ${analysis.marketCandidates.length}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
