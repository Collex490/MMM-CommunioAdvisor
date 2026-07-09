const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const envPath = path.join(__dirname, "..", ".env");
let fileEnv = {};
dotenv.config({ path: envPath });

try {
  fileEnv = dotenv.parse(fsSync.readFileSync(envPath));
  Object.entries(fileEnv).forEach(([key, value]) => {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
} catch {
  // The login command below will show a friendly missing-env message.
}

function env(name, fallback = "") {
  return process.env[name] || fileEnv[name] || fallback;
}

const dataDir = env("COMMUNIO_ADVISOR_TEST_DATA_DIR")
  || path.join(__dirname, "..", "data");

const defaultProbeUrls = [
  "https://www.comunio.de/",
  "https://classic.comunio.de/",
  "https://www.comunio.de/api",
  "https://www.comunio.de/soap.php?wsdl",
  "https://www.comunio.de/webservice.php?wsdl",
  "https://classic.comunio.de/soap.php?wsdl",
  "https://classic.comunio.de/webservice.php?wsdl"
];

const endpointPattern = /(?:"|'|`)((?:https?:\/\/[^"'`]+|\/[^"'`]*)(?:api|auth|login|session|token|graphql|user|market|standings|transfers|lineup|team|squad)[^"'`]*)(?:"|'|`)/gi;
const scriptPattern = /<script[^>]+src=["']([^"']+\.js(?:\?[^"']*)?)["']/gi;
const nextAssetPattern = /(?:"|'|`|=)((?:https?:\/\/[^"'`<>\s]+|\/[^"'`<>\s]*)(?:_next\/static|static\/chunks)[^"'`<>\s]+\.js(?:\?[^"'`<>\s]*)?)/gi;

function splitEnvList(value, fallback = []) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .concat(fallback)
    .filter((item, index, list) => list.indexOf(item) === index);
}

function cookieHeader(cookies) {
  return cookies
    .map((cookie) => cookie.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function tokenFromPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  return payload.token
    || payload.accessToken
    || payload.access_token
    || payload.jwt
    || payload.idToken
    || payload.sessionToken
    || "";
}

function findFirstKeyDeep(value, keyNames) {
  const keys = new Set(keyNames.map((key) => key.toLowerCase()));
  const stack = [value];
  const seen = new Set();

  while (stack.length) {
    const item = stack.pop();
    if (!item || typeof item !== "object" || seen.has(item)) {
      continue;
    }

    seen.add(item);

    for (const [key, nestedValue] of Object.entries(item)) {
      if (keys.has(key.toLowerCase()) && (typeof nestedValue === "string" || typeof nestedValue === "number")) {
        return nestedValue;
      }

      if (nestedValue && typeof nestedValue === "object") {
        stack.push(nestedValue);
      }
    }
  }

  return "";
}

function loginPayloadVariants(username, password) {
  const tzoffset = Number(env("COMMUNIO_TZOFFSET", "2"));
  return [
    { username, password, tzoffset },
    { username, password },
    { login: username, password },
    { email: username, password },
    { name: username, password },
    { userName: username, password },
    { identifier: username, password },
    { username, pass: password },
    { login: username, pass: password },
    { email: username, pass: password },
    { username, pwd: password },
    { login: username, pwd: password }
  ];
}

function compactUrlList(urls) {
  return unique(urls)
    .filter((url) => !url.includes("//squad"))
    .filter((url) => !url.includes("//standings"))
    .filter((url) => !url.includes("//users//"))
    .filter((url) => !url.includes("undefined"))
    .filter((url) => !url.includes("null"));
}

function sanitizeSnippet(text, limit = 1200) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function absoluteUrl(baseUrl, value) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function extractScripts(html, baseUrl) {
  const scripts = [];
  let match;
  const text = normalizeText(html);

  while ((match = scriptPattern.exec(text))) {
    scripts.push(absoluteUrl(baseUrl, match[1]));
  }

  while ((match = nextAssetPattern.exec(text))) {
    scripts.push(absoluteUrl(baseUrl, match[1]));
  }

  return unique(scripts);
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\\u002F/g, "/")
    .replace(/\\\//g, "/")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractEndpoints(text) {
  const endpoints = [];
  let match;
  const normalized = normalizeText(text);

  while ((match = endpointPattern.exec(normalized))) {
    endpoints.push(match[1]);
  }

  return unique(endpoints)
    .filter((endpoint) => !endpoint.includes("_next/static"))
    .slice(0, 300);
}

function extractContexts(text, needles) {
  const normalized = normalizeText(text);
  const contexts = [];

  needles.forEach((needle) => {
    let index = normalized.toLowerCase().indexOf(needle.toLowerCase());

    while (index !== -1 && contexts.length < 80) {
      contexts.push({
        needle,
        text: sanitizeSnippet(normalized.slice(Math.max(0, index - 350), index + 650), 1000)
      });
      index = normalized.toLowerCase().indexOf(needle.toLowerCase(), index + needle.length);
    }
  });

  return contexts;
}

function countMatches(text, pattern) {
  return (String(text || "").match(pattern) || []).length;
}

async function fetchText(url, options = {}) {
  const snippetLimit = options.snippetLimit || 1200;
  const includeText = Boolean(options.includeText);
  const redirect = options.redirect || "follow";
  const fetchOptions = { ...options };
  delete fetchOptions.snippetLimit;
  delete fetchOptions.includeText;
  delete fetchOptions.redirect;

  const response = await fetch(url, {
    redirect,
    ...fetchOptions,
    headers: {
      "user-agent": "Mozilla/5.0 (X11; Linux armv7l) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 MMM-CommunioAdvisor/0.1",
      accept: "text/html,application/json,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "de-DE,de;q=0.9,en;q=0.7",
      ...(fetchOptions.headers || {})
    }
  });

  const text = await response.text();
  const setCookie = response.headers.getSetCookie
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);

  return {
    url,
    status: response.status,
    redirected: response.status >= 300 && response.status < 400,
    location: response.headers.get("location") || "",
    contentType: response.headers.get("content-type") || "",
    setCookie,
    snippet: sanitizeSnippet(text, snippetLimit),
    text: includeText ? text : undefined
  };
}

async function fetchJsonAware(url, options = {}) {
  const result = await fetchText(url, {
    includeText: true,
    snippetLimit: 3000,
    ...options
  });

  return {
    ...result,
    json: parseJsonSafe(result.text)
  };
}

async function writeJson(fileName, data) {
  await fs.mkdir(dataDir, { recursive: true });
  const targetPath = path.join(dataDir, fileName);
  await fs.writeFile(targetPath, JSON.stringify(data, null, 2), "utf8");
  return targetPath;
}

async function probe() {
  const urls = splitEnvList(env("COMMUNIO_PROBE_URLS"), defaultProbeUrls);
  const results = [];

  for (const url of urls) {
    try {
      results.push(await fetchText(url));
    } catch (error) {
      results.push({
        url,
        error: error.message
      });
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    note: "Nur Erreichbarkeitstest. Keine Zugangsdaten gespeichert.",
    results
  };

  const targetPath = await writeJson("comunio-api-probe.json", payload);
  console.log(`Probe gespeichert: ${targetPath}`);
  results.forEach((result) => {
    console.log(`${result.status || "ERR"} ${result.url} ${result.contentType || result.error || ""}`);
  });
}

async function discover() {
  const startUrl = env("COMMUNIO_DISCOVER_URL", "https://www.comunio.de/wm");
  const page = await fetchText(startUrl, { includeText: true, snippetLimit: 5000 });
  const pageText = page.text || page.snippet || "";
  const scripts = extractScripts(pageText, startUrl);
  const endpoints = extractEndpoints(pageText);
  const scriptResults = [];
  const contexts = extractContexts(pageText, ["/login", "login/state", "password", "username", "email"]);

  for (const scriptUrl of scripts.slice(0, 40)) {
    try {
      const script = await fetchText(scriptUrl, { includeText: true, snippetLimit: 2000 });
      const scriptText = script.text || script.snippet;
      const foundEndpoints = extractEndpoints(scriptText);
      const foundContexts = extractContexts(scriptText, ["/login", "login/state", "password", "username", "email"]);
      scriptResults.push({
        url: scriptUrl,
        status: script.status,
        contentType: script.contentType,
        endpoints: foundEndpoints,
        contexts: foundContexts
      });
      endpoints.push(...foundEndpoints);
      contexts.push(...foundContexts.map((context) => ({
        ...context,
        source: scriptUrl
      })));
    } catch (error) {
      scriptResults.push({
        url: scriptUrl,
        error: error.message,
        endpoints: []
      });
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    startUrl,
    page: {
      status: page.status,
      contentType: page.contentType,
      htmlLength: pageText.length,
      scriptTags: countMatches(pageText, /<script/gi),
      nextAssets: countMatches(pageText, /_next\/static/gi),
      scriptsFound: scripts.length,
      snippet: sanitizeSnippet(pageText, 5000)
    },
    scripts,
    endpoints: unique(endpoints),
    contexts: contexts.slice(0, 80),
    scriptResults
  };

  const targetPath = await writeJson("comunio-discovery.json", payload);
  console.log(`Discovery gespeichert: ${targetPath}`);
  console.log(`Scripts gefunden: ${scripts.length}`);
  console.log(`Moegliche Endpunkte gefunden: ${payload.endpoints.length}`);
  payload.endpoints.slice(0, 40).forEach((endpoint) => console.log(endpoint));
}

async function loginAndFetch() {
  const username = env("COMMUNIO_USERNAME");
  const password = env("COMMUNIO_PASSWORD");
  const loginUrl = env("COMMUNIO_LOGIN_URL", "https://classic.comunio.de/login.phtml");
  const usernameField = env("COMMUNIO_USERNAME_FIELD", "login");
  const passwordField = env("COMMUNIO_PASSWORD_FIELD", "pass");

  if (!username || !password) {
    throw new Error("COMMUNIO_USERNAME und COMMUNIO_PASSWORD fehlen in .env.");
  }

  const form = new URLSearchParams();
  form.set(usernameField, username);
  form.set(passwordField, password);

  if (env("COMMUNIO_EXTRA_LOGIN_FIELDS")) {
    for (const pair of env("COMMUNIO_EXTRA_LOGIN_FIELDS").split("&")) {
      const [key, value = ""] = pair.split("=");
      if (key) form.set(key, value);
    }
  }

  const loginResult = await fetchText(loginUrl, {
    method: "POST",
    redirect: "manual",
    body: form,
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    }
  });

  const cookies = loginResult.setCookie || [];
  const fetchUrls = splitEnvList(env("COMMUNIO_FETCH_URLS"));
  const pages = [];

  for (const url of fetchUrls) {
    try {
      pages.push(await fetchText(url, {
        headers: {
          cookie: cookieHeader(cookies)
        }
      }));
    } catch (error) {
      pages.push({
        url,
        error: error.message
      });
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    login: {
      url: loginUrl,
      status: loginResult.status,
      location: loginResult.location,
      contentType: loginResult.contentType,
      cookiesReceived: cookies.length,
      snippet: loginResult.snippet
    },
    pages
  };

  const targetPath = await writeJson("comunio-login-test.json", payload);
  console.log(`Login-Test gespeichert: ${targetPath}`);
  console.log(`Login Status: ${loginResult.status}, Cookies: ${cookies.length}`);
  pages.forEach((page) => console.log(`${page.status || "ERR"} ${page.url} ${page.contentType || page.error || ""}`));
}

async function apiLoginAndFetch() {
  const username = env("COMMUNIO_USERNAME");
  const password = env("COMMUNIO_PASSWORD");
  const apiBase = env("COMMUNIO_API_BASE", "https://comunio.de/api").replace(/\/+$/, "");
  const loginUrl = env("COMMUNIO_API_LOGIN_URL", `${apiBase}/login`);
  const stateUrl = env("COMMUNIO_API_STATE_URL", `${apiBase}/login/state`);

  if (!username || !password) {
    throw new Error("COMMUNIO_USERNAME und COMMUNIO_PASSWORD fehlen in .env.");
  }

  const commonHeaders = {
    origin: "https://www.comunio.de",
    referer: "https://www.comunio.de/wm",
    accept: "application/json, text/plain, */*"
  };

  const beforeState = await fetchJsonAware(stateUrl, {
    headers: commonHeaders
  });

  const loginAttempts = [];
  let loginResult = null;
  let loginPayloadShape = "";

  for (const candidate of loginPayloadVariants(username, password)) {
    const shape = Object.keys(candidate).join("+");
    const result = await fetchJsonAware(loginUrl, {
      method: "POST",
      redirect: "manual",
      body: JSON.stringify(candidate),
      headers: {
        ...commonHeaders,
        "content-type": "application/json"
      }
    });

    loginAttempts.push({
      shape,
      status: result.status,
      contentType: result.contentType,
      cookiesReceived: (result.setCookie || []).length,
      tokenReceived: Boolean(tokenFromPayload(result.json)),
      snippet: result.snippet
    });

    if (!loginResult || (result.status !== 400 && result.status !== 422)) {
      loginResult = result;
      loginPayloadShape = shape;
    }

    if (result.status >= 200 && result.status < 300) {
      loginResult = result;
      loginPayloadShape = shape;
      break;
    }
  }

  const cookies = loginResult.setCookie || [];
  const token = tokenFromPayload(loginResult.json);
  const authHeaders = token ? { authorization: `Bearer ${token}` } : {};
  const afterState = await fetchJsonAware(stateUrl, {
    headers: {
      ...commonHeaders,
      ...authHeaders,
      cookie: cookieHeader(cookies)
    }
  });
  const communityId = env("COMMUNIO_COMMUNITY_ID")
    || findFirstKeyDeep(afterState.json, ["communityId", "community_id", "community"]);
  const userId = env("COMMUNIO_USER_ID")
    || findFirstKeyDeep(afterState.json, ["userId", "user_id", "authenticatedUserId", "ownerId"]);

  const defaultApiUrls = compactUrlList([
    `${apiBase}/login/state`,
    communityId && userId ? `${apiBase}/communities/${communityId}/users/${userId}/lineup` : "",
    userId ? `${apiBase}/users/${userId}/squad` : "",
    communityId && userId ? `${apiBase}/communities/${communityId}/users/${userId}/offers?current` : "",
    `${apiBase}/matchdays`,
    communityId && userId ? `${apiBase}/communities/${communityId}/users/${userId}/news?group=true&originaltypes=true&start=0&limit=50&type=HIDDEN_NEWS` : "",
    communityId && userId ? `${apiBase}/communities/${communityId}/users/${userId}/news?group=true&originaltypes=true&start=0&limit=20` : "",
    communityId ? `${apiBase}/communities/${communityId}/standings` : "",
    `${apiBase}/users/`,
    `${apiBase}/users/me`,
    `${apiBase}/user`,
    `${apiBase}/me`,
    `${apiBase}/account`,
    `${apiBase}/profile`,
    `${apiBase}/communities`,
    `${apiBase}/community`,
    `${apiBase}/news`,
    `${apiBase}/game/news`,
    `${apiBase}/market`,
    `${apiBase}/game/market`,
    `${apiBase}/transfers`,
    `${apiBase}/standings`,
    `${apiBase}/lineup`,
    `${apiBase}/game/info/user`,
    `${apiBase}/game/info/user/`,
    `${apiBase}/game/info/user/statement`,
    userId && communityId ? `${apiBase}/users/${userId}/squad?eid=${communityId}` : "",
    communityId && userId ? `${apiBase}/communities/${communityId}/users/${userId}/offers` : ""
  ]);
  const apiUrls = splitEnvList(env("COMMUNIO_API_FETCH_URLS"), defaultApiUrls);
  const pages = [];

  for (const url of apiUrls) {
    try {
      pages.push(await fetchJsonAware(url, {
        headers: {
          ...commonHeaders,
          ...authHeaders,
          cookie: cookieHeader(cookies)
        }
      }));
    } catch (error) {
      pages.push({
        url,
        error: error.message
      });
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    apiBase,
    beforeState: {
      url: stateUrl,
      status: beforeState.status,
      contentType: beforeState.contentType,
      snippet: beforeState.snippet
    },
    login: {
      url: loginUrl,
      status: loginResult.status,
      location: loginResult.location,
      contentType: loginResult.contentType,
      cookiesReceived: cookies.length,
      tokenReceived: Boolean(token),
      payloadShape: loginPayloadShape,
      snippet: loginResult.snippet
    },
    loginAttempts,
    afterState: {
      url: stateUrl,
      status: afterState.status,
      contentType: afterState.contentType,
      communityId: communityId || "",
      userId: userId || "",
      snippet: afterState.snippet
    },
    pages: pages.map((page) => ({
      url: page.url,
      status: page.status,
      contentType: page.contentType,
      location: page.location,
      snippet: page.snippet,
      error: page.error
    }))
  };

  const targetPath = await writeJson("comunio-api-login-test.json", payload);
  console.log(`API-Login-Test gespeichert: ${targetPath}`);
  console.log(`State vorher: ${beforeState.status}`);
  console.log(`Login Status: ${loginResult.status}, Cookies: ${cookies.length}, Token: ${token ? "ja" : "nein"}, Payload: ${loginPayloadShape}`);
  console.log(`State danach: ${afterState.status}, Community: ${communityId || "unbekannt"}, User: ${userId || "unbekannt"}`);
  pages.forEach((page) => console.log(`${page.status || "ERR"} ${page.url} ${page.contentType || page.error || ""}`));
  const hits = pages.filter((page) => page.status && page.status !== 404);
  if (hits.length) {
    console.log("Moegliche Treffer:");
    hits.forEach((page) => console.log(`${page.status} ${page.url}`));
  }
}

function checkEnv() {
  console.log(`Adapter-Datei: ${__filename}`);
  console.log(`ENV-Pfad: ${envPath}`);
  console.log(`ENV-Datei vorhanden: ${fsSync.existsSync(envPath) ? "ja" : "nein"}`);
  console.log(`ENV-Keys gelesen: ${Object.keys(fileEnv).filter((key) => key.startsWith("COMMUNIO")).length}`);
  console.log(`Username im Adapter: ${env("COMMUNIO_USERNAME") ? "gefunden" : "fehlt"}`);
  console.log(`Passwort im Adapter: ${env("COMMUNIO_PASSWORD") ? "gefunden" : "fehlt"}`);
  console.log(`Login-URL: ${env("COMMUNIO_LOGIN_URL", "fehlt")}`);
}

async function main() {
  const command = process.argv[2] || "probe";

  if (command === "env-check") {
    checkEnv();
    return;
  }

  if (command === "probe") {
    await probe();
    return;
  }

  if (command === "discover") {
    await discover();
    return;
  }

  if (command === "login") {
    await loginAndFetch();
    return;
  }

  if (command === "api-login") {
    await apiLoginAndFetch();
    return;
  }

  throw new Error(`Unbekannter Befehl: ${command}. Nutze probe, discover, env-check, login oder api-login.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
