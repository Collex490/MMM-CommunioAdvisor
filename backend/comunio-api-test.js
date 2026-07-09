const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const envPath = path.join(__dirname, "..", ".env");
dotenv.config({ path: envPath });

try {
  const parsedEnv = dotenv.parse(fsSync.readFileSync(envPath));
  Object.entries(parsedEnv).forEach(([key, value]) => {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
} catch {
  // The login command below will show a friendly missing-env message.
}

const dataDir = process.env.COMMUNIO_ADVISOR_TEST_DATA_DIR
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

function sanitizeSnippet(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    redirect: "manual",
    ...options,
    headers: {
      "user-agent": "MMM-CommunioAdvisor/0.1 test adapter",
      accept: "text/html,application/json,application/xml;q=0.9,*/*;q=0.8",
      ...(options.headers || {})
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
    snippet: sanitizeSnippet(text)
  };
}

async function writeJson(fileName, data) {
  await fs.mkdir(dataDir, { recursive: true });
  const targetPath = path.join(dataDir, fileName);
  await fs.writeFile(targetPath, JSON.stringify(data, null, 2), "utf8");
  return targetPath;
}

async function probe() {
  const urls = splitEnvList(process.env.COMMUNIO_PROBE_URLS, defaultProbeUrls);
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

async function loginAndFetch() {
  const username = process.env.COMUNIO_USERNAME;
  const password = process.env.COMUNIO_PASSWORD;
  const loginUrl = process.env.COMUNIO_LOGIN_URL || "https://classic.comunio.de/login.phtml";
  const usernameField = process.env.COMUNIO_USERNAME_FIELD || "login";
  const passwordField = process.env.COMUNIO_PASSWORD_FIELD || "pass";

  if (!username || !password) {
    throw new Error("COMMUNIO_USERNAME und COMMUNIO_PASSWORD fehlen in .env.");
  }

  const form = new URLSearchParams();
  form.set(usernameField, username);
  form.set(passwordField, password);

  if (process.env.COMUNIO_EXTRA_LOGIN_FIELDS) {
    for (const pair of process.env.COMUNIO_EXTRA_LOGIN_FIELDS.split("&")) {
      const [key, value = ""] = pair.split("=");
      if (key) form.set(key, value);
    }
  }

  const loginResult = await fetchText(loginUrl, {
    method: "POST",
    body: form,
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    }
  });

  const cookies = loginResult.setCookie || [];
  const fetchUrls = splitEnvList(process.env.COMUNIO_FETCH_URLS);
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
  console.log(`Username im Adapter: ${process.env.COMUNIO_USERNAME ? "gefunden" : "fehlt"}`);
  console.log(`Passwort im Adapter: ${process.env.COMUNIO_PASSWORD ? "gefunden" : "fehlt"}`);
  console.log(`Login-URL: ${process.env.COMUNIO_LOGIN_URL || "fehlt"}`);
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

  if (command === "login") {
    await loginAndFetch();
    return;
  }

  throw new Error(`Unbekannter Befehl: ${command}. Nutze probe oder login.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
