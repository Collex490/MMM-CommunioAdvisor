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

  for (const scriptUrl of scripts.slice(0, 40)) {
    try {
      const script = await fetchText(scriptUrl, { includeText: true, snippetLimit: 2000 });
      const foundEndpoints = extractEndpoints(script.text || script.snippet);
      scriptResults.push({
        url: scriptUrl,
        status: script.status,
        contentType: script.contentType,
        endpoints: foundEndpoints
      });
      endpoints.push(...foundEndpoints);
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

  throw new Error(`Unbekannter Befehl: ${command}. Nutze probe, discover, env-check oder login.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
