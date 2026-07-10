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
  const formatted = typeof value === "number" && Number.isFinite(value)
    ? Math.round(value).toLocaleString("de-DE")
    : String(value).trim();
  if (!formatted) return "";
  return /\u20ac|eur/i.test(formatted) ? formatted : `${formatted} \u20ac`;
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
    item.tradable?.name,
    item.tradable?.displayName,
    item.user?.name,
    item.owner?.name,
    item.manager?.name,
    item.communityUser?.name,
    item.team?.name,
    item._embedded?.user?.name,
    item._embedded?.tradable?.name,
    item._embedded?.player?.name,
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
    item.tradable?.marketValue,
    item.tradable?.value,
    item._embedded?.tradable?.marketValue,
    item._embedded?.tradable?.value,
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

function isOwnClubName(value) {
  const normalized = normalizeText(value);
  return normalized === "pasta la vista fc" || normalized === "pasta la vista";
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
      "cache-control": "no-cache",
      pragma: "no-cache",
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
  const livePeriods = splitEnvList(env("COMMUNIO_LIVE_PERIODS"), env("COMMUNIO_LIVE_PERIOD") ? [env("COMMUNIO_LIVE_PERIOD")] : []);
  const liveStandingsUrls = splitEnvList(env("COMMUNIO_LIVE_STANDINGS_URL"))
    .concat(
      communityId
        ? livePeriods.map((period) => `${apiBase}/communities/${communityId}/standings?period=${encodeURIComponent(period)}&wpe=true`)
        : []
    );
  const configuredFetchUrls = [
    env("COMMUNIO_API_FETCH_URLS"),
    env("COMMUNIO_FETCH_URLS"),
    env("COMMUNIO_STANDINGS_TOTAL_URL"),
    env("COMMUNIO_STANDINGS_URL"),
    liveStandingsUrls.join(","),
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

function cacheBustedUrl(url) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}_=${Date.now()}`;
}

async function fetchComunioData() {
  const { apiBase, token } = await login();
  const urls = configuredUrls(apiBase);
  const pages = [];

  for (const url of urls) {
    try {
      pages.push(await fetchJson(cacheBustedUrl(url), {
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
  return standings
    .filter((team) => knownClubs.includes(normalizeText(team.name)))
    .map((team) => ({
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
      position: firstValue(item.type, item.positionName, item.role, item.position, ""),
      marketValue: formatMoney(objectMoney(item)),
      points: numberish(firstValue(item.points, item.totalPoints, item.score)),
      photoUrl: playerPhotoUrl({ raw: item }),
      raw: item
    }))
    .slice(0, 30);
}

function mapOffers(json) {
  const items = bestArrayByScore(json, (item) => {
    if (!item || typeof item !== "object") return 0;
    const tradable = item.tradable || item._embedded?.tradable || item.player || item._embedded?.player || item;
    return (objectName(tradable) ? 3 : 0) + (objectMoney(item) || objectMoney(tradable) ? 2 : 0);
  });

  return items
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const player = item.tradable || item._embedded?.tradable || item.player || item._embedded?.player || item;
      const playerName = objectName(player);
      const seller = objectName(item.seller || item.owner || item.user || item.from || item._embedded?.seller || {});
      return {
        player: playerName,
        price: formatMoney(firstValue(item.price, item.amount, item.value, objectMoney(player))),
        seller: seller || "Transfermarkt",
        isOwnListing: isOwnClubName(seller) || Boolean(item.isOwn || item.ownOffer || item.ownedByCurrentUser),
        reason: "Aktuelles Marktangebot mit sichtbarem Spieler und Preis.",
        priority: index + 1
      };
    })
    .filter((item) => item.player && normalizeText(item.player) !== "computer" && !item.isOwnListing)
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
  const structuredTransfers = [];

  walk(json, (item) => {
    const message = item?.message;
    if (!message || typeof message !== "object") return;

    const groups = [
      ["FROM_COMPUTER", "gekauft"],
      ["TO_COMPUTER", "verkauft"],
      ["BETWEEN_USERS", "transfer"]
    ];

    groups.forEach(([key, fallbackAction]) => {
      asArray(message[key]).forEach((transfer) => {
        const player = objectName(transfer.tradable || transfer.player || transfer);
        const from = objectName(transfer.from || transfer.seller || {});
        const to = objectName(transfer.to || transfer.buyer || transfer.user || {});
        const price = formatMoney(firstValue(transfer.price, transfer.amount, transfer.value));

        if (!player || (!from && !to) || !isUsefulTransferPlayer(player)) return;

        const action = fallbackAction === "transfer"
          ? `${from ? "von " + from : ""}${from && to ? " " : ""}${to ? "zu " + to : ""}`.trim()
          : fallbackAction;
        const text = fallbackAction === "verkauft"
          ? `verkauft: ${player} von ${from || to || "unbekannt"} an Computer${price ? ` fuer ${price}` : ""}`
          : fallbackAction === "gekauft"
            ? `gekauft: ${player} von Computer zu ${to || from || "unbekannt"}${price ? ` fuer ${price}` : ""}`
            : `Transfer: ${player} ${action}${price ? ` fuer ${price}` : ""}`;

        structuredTransfers.push({
          action: fallbackAction,
          player,
          club: fallbackAction === "verkauft" ? (from || to || "") : (to || from || ""),
          from: fallbackAction === "gekauft" ? "Computer" : from,
          to: fallbackAction === "verkauft" ? "Computer" : to,
          price,
          text
        });
      });
    });
  });

  if (structuredTransfers.length) {
    const seen = new Set();
    return structuredTransfers
      .filter((item) => {
        const key = [item.action, item.player, item.from, item.to, item.price].join("|").toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 12);
  }

  return collectText(json)
    .filter((text) => /gekauft|verkauft|transfer|wechselt|kauf|verkauf/i.test(text))
    .filter((text) => isUsefulTransferPlayer(text))
    .map((text) => ({
      action: /verkauft|verkauf/i.test(text) ? "verkauft" : "gekauft",
      player: text.replace(/\s+/g, " ").slice(0, 90),
      club: "",
      price: ""
    }))
    .slice(0, 12);
}

function newsTimestamp(json) {
  let found = 0;
  walk(json, (item) => {
    if (found || !item || typeof item !== "object") return;
    const value = firstValue(
      item.date,
      item.createdAt,
      item.created,
      item.updatedAt,
      item.updated,
      item.timestamp,
      item.time,
      item.publishedAt
    );
    if (typeof value === "number" && Number.isFinite(value)) {
      found = value > 100000000000 ? value : value * 1000;
      return;
    }
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) found = parsed;
    }
  });
  return found;
}

function newestTransferTicker(newsPages) {
  return newsPages
    .map((json, index) => ({
      json,
      index,
      timestamp: newsTimestamp(json),
      transfers: mapTransferTicker(json)
    }))
    .filter((page) => page.transfers.length)
    .sort((a, b) => (b.timestamp - a.timestamp) || (a.index - b.index))
    .flatMap((page) => page.transfers)
    .filter((item, index, list) => {
      const key = [item.action, item.player, item.from, item.to, item.price, item.text].join("|").toLowerCase();
      return list.findIndex((other) => [other.action, other.player, other.from, other.to, other.price, other.text].join("|").toLowerCase() === key) === index;
    })
    .slice(0, 12);
}

function isUsefulTransferPlayer(value) {
  const text = normalizeText(value);
  if (!text) return false;
  return ![
    "mittelfeld-joker",
    "rotationsverteidiger",
    "bankspieler",
    "stammspieler",
    "unbekannt"
  ].some((phrase) => text.includes(phrase));
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

function findBudgetFromRaw(raw) {
  for (const page of raw.pages || []) {
    if (page.status !== 200 || !page.json) continue;
    const budget = findBudget(page.json);
    if (budget) return budget;
  }
  return "";
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
    player.raw?.photoUrl,
    player.raw?.imageUrl,
    player.raw?.picture,
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
  const directLineup = Object.values(lineup?.items?.lineup || {})
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      name: objectName(item),
      position: firstValue(item.type, item.positionName, item.role, item.position, ""),
      marketValue: formatMoney(objectMoney(item)),
      points: numberish(firstValue(item.points, item.totalPoints, item.score)),
      raw: item
    }));
  const lineupPlayers = directLineup.length ? directLineup : mapPlayers(lineup);
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

function mapLivePlayers(raw) {
  const squadPlayers = mapPlayers(pageByUrl(raw, "/squad"));
  const ownPlayerNames = new Set(squadPlayers.map((player) => normalizeText(player.name)));
  const livePlayers = new Map();
  const livePages = raw.pages.filter((page) => {
    if (page.status !== 200 || !page.json) return false;
    if (!page.url.includes("/standings")) return false;
    if (page.url.includes("period=total")) return false;
    return page.url.includes("period=") || page.url.includes("live");
  });

  livePages
    .forEach((page) => {
      walk(page.json, (item) => {
        if (!item || typeof item !== "object") return;

        const name = objectName(item.player || item.tradable || item);
        if (!name || !ownPlayerNames.has(normalizeText(name))) return;

        const livePoints = directNumberByKeys(item, [
          "livepoints",
          "live_points",
          "currentpoints",
          "current_points",
          "currentmatchpoints",
          "current_match_points"
        ]);

        const hasLiveState = Boolean(directValueByKeys(item, [
          "livestatus",
          "matchstatus",
          "game_status",
          "status"
        ]));

        if (livePoints === undefined && !hasLiveState) return;

        livePlayers.set(normalizeText(name), {
          name,
          position: firstValue(item.position, item.type, item.role, item.player?.position, item.tradable?.position, ""),
          club: firstValue(item.clubName, item.teamName, item.player?.clubName, item.tradable?.clubName, ""),
          livePoints,
          status: String(firstValue(
            directValueByKeys(item, ["livestatus", "matchstatus", "game_status", "status"]),
            "live"
          )),
          photoUrl: playerPhotoUrl({ raw: item.player || item.tradable || item })
        });
      });
    });

  return Array.from(livePlayers.values())
    .sort((a, b) => (b.livePoints ?? -999) - (a.livePoints ?? -999))
    .slice(0, 8);
}

function ownTacticFromRaw(raw) {
  const lineupTactic = firstValue(
    pageByUrl(raw, "/lineup")?.tactic,
    deepFirstValueByKeys(pageByUrl(raw, "/lineup"), ["tactic", "formation"])
  );
  if (lineupTactic) return String(lineupTactic);

  const userId = env("COMMUNIO_USER_ID");
  const standingsPages = pagesByUrl(raw, "standings");
  let tactic = "";

  standingsPages.forEach((json) => {
    if (tactic) return;
    collectArrays(json).forEach((items) => {
      if (tactic) return;
      items.forEach((item) => {
        const embeddedUser = item?._embedded?.user;
        const isOwnUser = String(embeddedUser?.id || "") === String(userId)
          || normalizeText(embeddedUser?.name) === "pasta la vista fc";
        if (isOwnUser) tactic = String(item?._embedded?.teamInfo?.tactic || "");
      });
    });
  });

  return tactic || "343";
}

function tacticRows(tactic) {
  const digits = String(tactic || "")
    .replace(/[^\d]/g, "")
    .split("")
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0);

  const [defenders = 3, midfielders = 4, strikers = 3] = digits;
  return { goalkeeper: 1, defender: defenders, midfielder: midfielders, striker: strikers };
}

function coordinatesForLineup(players, tactic) {
  const rowCounts = tacticRows(tactic);
  const rows = {
    goalkeeper: players.filter((player) => positionGroup(player.position) === "goalkeeper"),
    defender: players.filter((player) => positionGroup(player.position) === "defender"),
    midfielder: players.filter((player) => positionGroup(player.position) === "midfielder"),
    striker: players.filter((player) => positionGroup(player.position) === "striker")
  };

  if (!rows.goalkeeper.length && players.length >= 11) {
    rows.goalkeeper = [players[0]];
  }

  const placed = new Set();
  rows.goalkeeper.forEach((player) => placed.add(player.name));
  rows.defender = rows.defender.filter((player) => !placed.has(player.name));
  rows.midfielder = rows.midfielder.filter((player) => !placed.has(player.name));
  rows.striker = rows.striker.filter((player) => !placed.has(player.name));

  const used = new Set();
  const rowSlots = (items, count, y, label) => {
    const width = 610;
    const slots = [];
    for (let index = 0; index < count; index += 1) {
      const player = items.find((candidate) => !used.has(candidate.name));
      if (player) used.add(player.name);
      slots.push({
        player: player || null,
        label,
        x: 55 + ((width / (count + 1)) * (index + 1)),
        y
      });
    }
    return slots;
  };

  const slots = [
    ...rowSlots(rows.striker, rowCounts.striker, 92, "ST"),
    ...rowSlots(rows.midfielder, rowCounts.midfielder, 205, "MF"),
    ...rowSlots(rows.defender, rowCounts.defender, 318, "DF"),
    ...rowSlots(rows.goalkeeper, rowCounts.goalkeeper, 424, "TW")
  ];

  const overflow = players.filter((player) => !used.has(player.name));
  overflow.forEach((player, index) => {
    const target = slots.find((slot) => !slot.player) || slots[index % slots.length];
    if (target && !target.player) target.player = player;
  });

  return slots;
}

function missingLineupLabels(slots) {
  return slots
    .filter((slot) => !slot.player)
    .map((slot) => slot.label);
}

function buildLineupSlot({ player, x, y, label }, index, photoCache) {
  const clipId = `playerPhoto${index}`;

  if (!player) {
    return `
      <g transform="translate(${Math.round(x - 33)}, ${Math.round(y - 39)})">
        <rect x="0" y="0" width="66" height="78" rx="10" fill="#1d4e2c" stroke="#d9b24c" stroke-width="2" stroke-dasharray="5 4" opacity="0.9"/>
        <circle cx="33" cy="27" r="16" fill="#285f37" stroke="#d9b24c" stroke-width="2"/>
        <text x="33" y="33" text-anchor="middle" font-size="22" fill="#d9b24c" font-weight="900">+</text>
        <text x="33" y="58" text-anchor="middle" font-size="13" fill="#f0d891" font-weight="900">${label}</text>
      </g>`;
  }

  const photo = photoCache.get(player.name);
  const initials = player.name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return `
    <g transform="translate(${Math.round(x - 35)}, ${Math.round(y - 45)})">
      <rect x="0" y="0" width="70" height="90" rx="10" fill="#17345a" stroke="#e0b13f" stroke-width="2"/>
      <clipPath id="${clipId}"><rect x="8" y="7" width="54" height="48" rx="8"/></clipPath>
      ${photo
        ? `<image href="${photo}" x="8" y="7" width="54" height="48" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`
        : `<rect x="8" y="7" width="54" height="48" rx="8" fill="#243447"/><text x="35" y="37" text-anchor="middle" font-size="18" fill="#e0b13f" font-weight="800">${escapeXml(initials)}</text>`}
      <rect x="6" y="59" width="58" height="24" rx="6" fill="#10243f"/>
      <text x="35" y="70" text-anchor="middle" font-size="8" fill="#ffffff" font-weight="800">${escapeXml(player.name).slice(0, 15)}</text>
      <text x="35" y="80" text-anchor="middle" font-size="7" fill="#d6d6d6">${label}</text>
      ${player.points !== undefined ? `<circle cx="62" cy="10" r="10" fill="#ffffff"/><text x="62" y="14" text-anchor="middle" font-size="9" fill="#2ba84a" font-weight="900">${player.points}</text>` : ""}
    </g>`;
}

function buildMiniBench(players, usedNames) {
  return players
    .filter((player) => !usedNames.has(player.name))
    .slice(0, 4)
    .map((player, index) => `
      <text x="735" y="${352 + index * 22}" fill="#f5f5f5" font-size="13" font-weight="700">${escapeXml(player.name).slice(0, 20)}</text>`)
    .join("");
}

async function renderGeneratedLineup(raw, token) {
  const players = lineupPlayersFromRaw(raw);
  if (!players.length) return null;
  const tactic = ownTacticFromRaw(raw);

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

  const placed = coordinatesForLineup(players, tactic);
  const cards = placed.map((slot, index) => buildLineupSlot(slot, index, photoCache)).join("");
  const usedNames = new Set(placed.filter((slot) => slot.player).map((slot) => slot.player.name));
  const missing = missingLineupLabels(placed);
  const missingText = missing.length ? missing.join(", ") : "komplett";
  const miniBench = buildMiniBench(players, usedNames);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="7" stdDeviation="7" flood-color="#000000" flood-opacity="0.35"/>
    </filter>
  </defs>
  <rect width="960" height="540" rx="22" fill="#101713"/>
  <g transform="translate(24, 24)" filter="url(#shadow)">
    <rect width="682" height="492" rx="18" fill="#2f8a43" stroke="#e0b13f" stroke-width="3"/>
    <g opacity="0.12">
      ${Array.from({ length: 9 }, (_, index) => `<rect x="${index * 76}" y="0" width="38" height="492" fill="#ffffff"/>`).join("")}
    </g>
    <g stroke="#e3f3df" stroke-width="3" fill="none" opacity="0.78">
      <rect x="30" y="28" width="622" height="436"/>
      <line x1="30" y1="246" x2="652" y2="246"/>
      <circle cx="341" cy="246" r="58"/>
      <rect x="214" y="28" width="254" height="74"/>
      <rect x="214" y="390" width="254" height="74"/>
      <rect x="278" y="28" width="126" height="34"/>
      <rect x="278" y="430" width="126" height="34"/>
    </g>
    ${cards}
  </g>
  <g transform="translate(730, 44)">
    <rect width="206" height="452" rx="18" fill="#171717" stroke="#4a3a18" stroke-width="2"/>
    <text x="103" y="38" text-anchor="middle" fill="#e0b13f" font-size="16" font-weight="900">Formation</text>
    <text x="103" y="92" text-anchor="middle" fill="#ffffff" font-size="44" font-weight="900">${escapeXml(String(tactic).replace(/(\d)(?=\d)/g, "$1-"))}</text>
    <text x="103" y="126" text-anchor="middle" fill="#bdbdbd" font-size="13">aus Comunio API</text>
    <line x1="24" y1="154" x2="182" y2="154" stroke="#4a3a18"/>
    <text x="24" y="194" fill="#e0b13f" font-size="14" font-weight="900">Offene Slots</text>
    <text x="24" y="220" fill="#ffffff" font-size="18" font-weight="900">${escapeXml(missingText)}</text>
    <text x="24" y="268" fill="#e0b13f" font-size="14" font-weight="900">Kaderbank</text>
    ${miniBench || `<text x="24" y="300" fill="#f5f5f5" font-size="13" font-weight="700">keine extra Spieler</text>`}
  </g>
  <text x="365" y="18" text-anchor="middle" fill="#e0b13f" font-size="16" font-weight="900" letter-spacing="1">Pasta La Vista FC - Automatische Aufstellung</text>
  <text x="365" y="532" text-anchor="middle" fill="#d6d6d6" font-size="12">Generiert aus Comunio API - ${escapeXml(new Date().toLocaleString("de-DE"))}</text>
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
  const news = raw.pages
    .filter((page) => page.status === 200 && page.url.includes("/news"))
    .map((page) => page.json);
  const squadPlayers = mapPlayers(squad);
  const ownPlayerNames = new Set(squadPlayers.map((player) => normalizeText(player.name)));
  const marketCandidates = mapOffers(offers)
    .filter((item) => !ownPlayerNames.has(normalizeText(item.player)) && !isOwnClubName(item.seller));
  const standings = mapStandingsFromRaw(raw);
  const ownTeam = standings.find((team) => team.isUserClub);
  const budget = findBudget(lineup) || findBudget(squad) || findBudgetFromRaw(raw);
  const lowestPointPlayer = [...squadPlayers]
    .filter((player) => player.name && normalizeText(player.name) !== "computer")
    .sort((a, b) => (a.points ?? 9999) - (b.points ?? 9999))[0];
  const highValueCandidate = [...squadPlayers]
    .filter((player) => player.name && normalizeText(player.name) !== "computer")
    .sort((a, b) => (numberish(b.marketValue) || 0) - (numberish(a.marketValue) || 0))[0];
  const roleRisk = [...squadPlayers]
    .filter((player) => player.name && normalizeText(player.name) !== "computer")
    .filter((player) => normalizeText(player.name) !== normalizeText(lowestPointPlayer?.name))
    .sort((a, b) => {
      const pointsA = a.points ?? 9999;
      const pointsB = b.points ?? 9999;
      const valueA = numberish(a.marketValue) || 0;
      const valueB = numberish(b.marketValue) || 0;
      return pointsA - pointsB || valueB - valueA;
    })[0] || highValueCandidate || lowestPointPlayer || squadPlayers[0];

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
            reason: `${marketCandidates[0].price ? `Bei ${marketCandidates[0].price} ` : ""}nur zuschlagen, wenn danach noch Reserve bleibt; als Marktchance gegen die Konkurrenz einplanen.`,
            confidence: "mittel"
          }
        : {
            title: "Keine Kaufempfehlung",
            reason: "Aktuell kein fremdes Marktangebot attraktiv genug. Eigene Angebote nicht zurueckkaufen; Budget halten und auf bessere Chancen warten.",
            confidence: "hoch"
          },
      sell: lowestPointPlayer
        ? {
            player: lowestPointPlayer.name,
            title: "Verkaufskandidat",
            reason: `${lowestPointPlayer.points !== undefined ? `${lowestPointPlayer.points} Punkte sprechen fuer genaues Pruefen. ` : ""}Bei gutem Angebot als Tauschmasse nutzen, wenn ein klarer Starter auf dem Markt liegt.`,
            confidence: "mittel"
          }
        : undefined,
      risk: roleRisk
        ? {
            player: roleRisk.name,
            title: "Startelf-Risiko",
            reason: "Rolle, Punkteausbeute und Minuten vor dem naechsten Spieltag beobachten; bei unsicherem Startelfstatus nicht blind halten.",
            confidence: "mittel"
          }
        : undefined,
      budget: {
        title: budget ? "Budget gezielt einsetzen" : "Budget weiter per Telegram sichern",
        reason: budget
          ? `${budget} auf dem Konto: fuer einen Premium-Deal bieten, aber einen Puffer fuer Nachkaeufe und Spieltagsreaktionen behalten.`
          : "Kontostand wurde in den API-Daten noch nicht sicher gefunden; Telegram-/Budget-Screenshot bleibt Backup.",
        confidence: budget ? "hoch" : "mittel"
      }
    },
    marketCandidates,
    standings,
    transferTicker: newestTransferTicker(news),
    livePlayers: mapLivePlayers(raw),
    budgetStatus: budget ? { amount: budget, note: "Aus Comunio-API erkannt" } : {},
    squadPlayers: squadPlayers.map((player) => ({
      name: player.name,
      position: player.position,
      marketValue: player.marketValue,
      points: player.points,
      photoUrl: player.photoUrl
    })),
    lineupImage: generatedLineupImage || undefined,
    squadInsights: {
      keep: squadPlayers.slice(0, 2).map((player) => `${player.name} im Kader behalten und Rolle pruefen`),
      sell: squadPlayers.slice(-2).map((player) => `${player.name} als moeglichen Tausch-/Verkaufskandidaten pruefen`),
      watch: marketCandidates.slice(0, 2).map((item) => `${item.player} auf dem Markt beobachten`)
    },
    matchdays: [],
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
