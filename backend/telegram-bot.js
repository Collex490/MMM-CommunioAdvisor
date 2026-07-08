require("dotenv").config();

const fs = require("fs/promises");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");
const { analyzeScreenshot } = require("./openai-analyze");
const { generateRumorImage } = require("./generate-rumor-image");
const { normalizeAnalysis } = require("./normalize-analysis");
const { mergeWithExisting } = require("./merge-analysis");

const token = process.env.TELEGRAM_BOT_TOKEN;
const dataPath = process.env.COMMUNIO_ADVISOR_DATA_PATH
  || path.join(__dirname, "..", "data", "latest.json");
const uploadDir = process.env.COMMUNIO_ADVISOR_UPLOAD_DIR
  || path.join(__dirname, "..", "uploads");
const allowedChatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
const publicUploadBase = process.env.COMMUNIO_ADVISOR_PUBLIC_UPLOAD_BASE
  || "modules/MMM-CommunioAdvisor/uploads";
const shouldGenerateRumorImage = process.env.COMMUNIO_ADVISOR_GENERATE_RUMOR_IMAGE === "true";
const chatModes = new Map();

const modeLabels = {
  auto: "Automatik",
  transfermarket: "Transfermarkt",
  transfernews: "Transfernews",
  standings: "Tabelle",
  lineup: "Aufstellung",
  budget: "Budget",
  squad: "Kader",
  logo: "Vereinslogo"
};

if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN fehlt in der Umgebung.");
}

const bot = new TelegramBot(token, { polling: true });

function getChatMode(chatId) {
  return chatModes.get(String(chatId)) || "auto";
}

function setChatMode(chatId, mode) {
  chatModes.set(String(chatId), mode);
}

function modeFromText(text) {
  const normalized = String(text || "").trim().toLowerCase();

  if (/^\/logo\b/.test(normalized)) return "logo";
  if (/^\/transfers\b|^\/transfernews\b/.test(normalized)) return "transfernews";
  if (/^\/transfermarkt\b/.test(normalized)) return "transfermarket";
  if (/^\/tabelle\b|^\/standings\b/.test(normalized)) return "standings";
  if (/^\/aufstellung\b|^\/lineup\b/.test(normalized)) return "lineup";
  if (/^\/budget\b/.test(normalized)) return "budget";
  if (/^\/kader\b|^\/squad\b/.test(normalized)) return "squad";
  if (/^\/auto\b/.test(normalized)) return "auto";

  return null;
}

function buildHelpText() {
  return [
    "ComunioAdvisor Modi:",
    "/auto - Screenshot automatisch erkennen",
    "/transfermarkt - Marktangebote fuer Kaufempfehlung auswerten",
    "/transfers - echte Kaeufe/Verkaeufe der Liga fuer Banner und Transfernews sammeln",
    "/tabelle - Liga-Tabelle mit Punkten speichern",
    "/aufstellung - offizielles Aufstellungsbild speichern",
    "/budget - Kontostand/Budget auswerten",
    "/kader - Kader fuer Halten/Verkaufen/Tauschen auswerten",
    "/kapitaen Name - Kapitaen oben rechts setzen",
    "/logo - naechstes Bild als Vereinslogo speichern",
    "/status - letzte Analyse anzeigen",
    "",
    "Tipp: Modus setzen und danach 1 bis 3 Screenshots schicken. Der Bot sammelt passende Daten und aktualisiert die Tagesuebersicht."
  ].join("\n");
}

async function readCurrentAnalysis() {
  try {
    const content = await fs.readFile(dataPath, "utf8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function writeCurrentAnalysis(data) {
  const nextData = {
    ...data,
    generatedAt: new Date().toISOString()
  };

  await fs.mkdir(path.dirname(dataPath), { recursive: true });
  await fs.writeFile(dataPath, JSON.stringify(nextData, null, 2), "utf8");
  return nextData;
}

function normalizeClubForUpdate(data) {
  if (data.club && typeof data.club === "object") {
    return data.club;
  }

  return {
    name: data.club || "Pasta La Vista FC",
    boss: "Patron Co",
    coach: "Gennaro Gattuso",
    colors: ["Schwarz", "Gold"],
    motto: "Mangia, Lotta, Vinci",
    captain: "Sorloth"
  };
}

function fileExtension(fileName, fallback = ".jpg") {
  const extension = path.extname(fileName || "").toLowerCase();
  return extension || fallback;
}

async function saveClubLogo(message, sourcePath, extension = ".jpg") {
  const logoFileName = extension === ".png" ? "club-logo.png" : "club-logo.jpg";
  const logoPath = path.join(uploadDir, logoFileName);
  await fs.copyFile(sourcePath, logoPath);

  const current = await readCurrentAnalysis();
  const club = normalizeClubForUpdate(current);
  club.logo = {
    url: `${publicUploadBase}/${logoFileName}`,
    alt: `${club.name || "Pasta La Vista FC"} Logo`,
    updatedAt: new Date().toISOString()
  };

  await writeCurrentAnalysis({ ...current, club });
  await bot.sendMessage(message.chat.id, "Vereinslogo gespeichert. MagicMirror aktualisiert sich gleich.");
}

async function setModeAndReply(message, mode) {
  setChatMode(message.chat.id, mode);
  await bot.sendMessage(message.chat.id, `Modus gesetzt: ${modeLabels[mode]}. Sende jetzt den passenden Screenshot.`);
}

bot.onText(/\/help|\/start/, async (message) => {
  await bot.sendMessage(message.chat.id, buildHelpText());
});

bot.onText(/\/auto/, (message) => setModeAndReply(message, "auto"));
bot.onText(/\/transfermarkt/, (message) => setModeAndReply(message, "transfermarket"));
bot.onText(/\/transfers|\/transfernews/, (message) => setModeAndReply(message, "transfernews"));
bot.onText(/\/tabelle|\/standings/, (message) => setModeAndReply(message, "standings"));
bot.onText(/\/aufstellung|\/lineup/, (message) => setModeAndReply(message, "lineup"));
bot.onText(/\/budget/, (message) => setModeAndReply(message, "budget"));
bot.onText(/\/kader|\/squad/, (message) => setModeAndReply(message, "squad"));
bot.onText(/\/logo/, (message) => setModeAndReply(message, "logo"));

bot.onText(/\/kapitaen(?:\s+(.+))?/, async (message, match) => {
  const captain = (match?.[1] || "").trim();

  if (!captain) {
    await bot.sendMessage(message.chat.id, "Bitte so senden: /kapitaen Sorloth");
    return;
  }

  const current = await readCurrentAnalysis();
  const club = normalizeClubForUpdate(current);
  club.captain = captain;
  await writeCurrentAnalysis({ ...current, club });
  await bot.sendMessage(message.chat.id, `Kapitän aktualisiert: ${captain}`);
});

bot.on("photo", async (message) => {
  try {
    if (allowedChatId && String(message.chat.id) !== String(allowedChatId)) {
      await bot.sendMessage(message.chat.id, "Dieser Chat ist fuer den Comunio Advisor nicht freigegeben.");
      return;
    }

    const captionMode = modeFromText(message.caption);
    const chatMode = captionMode || getChatMode(message.chat.id);
    if (captionMode) {
      setChatMode(message.chat.id, captionMode);
    }
    await bot.sendMessage(message.chat.id, `Screenshot erhalten. Modus: ${modeLabels[chatMode]}. Ich analysiere und fuege es zur Tagesuebersicht hinzu...`);

    const photo = message.photo[message.photo.length - 1];
    await fs.mkdir(uploadDir, { recursive: true });

    const downloadedPath = await bot.downloadFile(photo.file_id, uploadDir);
    const targetPath = path.join(uploadDir, `${Date.now()}-${path.basename(downloadedPath)}.jpg`);
    await fs.rename(downloadedPath, targetPath);

    if (chatMode === "logo") {
      await saveClubLogo(message, targetPath, ".jpg");
      return;
    }

    const analysis = normalizeAnalysis(await analyzeScreenshot(targetPath, { screenTypeHint: chatMode }));
    if (chatMode !== "auto") {
      analysis.source.screenType = chatMode;
    }

    const screenType = String(analysis.source?.screenType || "").toLowerCase();
    const isLineup = screenType.includes("lineup")
      || screenType.includes("aufstellung")
      || screenType.includes("formation");

    let completeAnalysis = {
      ...analysis,
      generatedAt: analysis.generatedAt || new Date().toISOString()
    };

    if (isLineup) {
      const lineupFileName = "latest-lineup.jpg";
      const lineupPath = path.join(uploadDir, lineupFileName);
      await fs.copyFile(targetPath, lineupPath);
      completeAnalysis.lineupImage = {
        url: `${publicUploadBase}/${lineupFileName}`,
        alt: "Aktuelle Teamaufstellung",
        updatedAt: completeAnalysis.generatedAt
      };
    }

    if (shouldGenerateRumorImage) {
      const rumorImage = await generateRumorImage({
        rumorKitchen: completeAnalysis.rumorKitchen,
        club: completeAnalysis.club,
        outputDir: uploadDir
      });

      completeAnalysis.rumorImage = {
        url: `${publicUploadBase}/${rumorImage.fileName}`,
        alt: "Fiktive Sportmedien-Schlagzeile",
        updatedAt: completeAnalysis.generatedAt
      };
    }

    completeAnalysis = await mergeWithExisting(dataPath, completeAnalysis);

    await fs.mkdir(path.dirname(dataPath), { recursive: true });
    await fs.writeFile(dataPath, JSON.stringify(completeAnalysis, null, 2), "utf8");

    await bot.sendMessage(message.chat.id, "Analyse gespeichert. MagicMirror aktualisiert sich gleich.");
  } catch (error) {
    await bot.sendMessage(message.chat.id, `Analyse fehlgeschlagen: ${error.message}`);
  }
});

bot.on("document", async (message) => {
  try {
    if (allowedChatId && String(message.chat.id) !== String(allowedChatId)) {
      await bot.sendMessage(message.chat.id, "Dieser Chat ist fuer den Comunio Advisor nicht freigegeben.");
      return;
    }

    const captionMode = modeFromText(message.caption);
    const chatMode = captionMode || getChatMode(message.chat.id);
    if (captionMode) {
      setChatMode(message.chat.id, captionMode);
    }

    if (chatMode !== "logo") {
      await bot.sendMessage(message.chat.id, "Dateien werden aktuell nur im /logo-Modus verarbeitet. Fuer Screenshots bitte als Bild senden.");
      return;
    }

    const document = message.document;
    const extension = fileExtension(document.file_name, ".png");
    const mimeType = String(document.mime_type || "").toLowerCase();

    if (extension !== ".png" && !mimeType.includes("png")) {
      await bot.sendMessage(message.chat.id, "Bitte das Vereinslogo als PNG-Datei senden, damit Transparenz erhalten bleibt.");
      return;
    }

    await fs.mkdir(uploadDir, { recursive: true });
    const downloadedPath = await bot.downloadFile(document.file_id, uploadDir);
    const targetPath = path.join(uploadDir, `${Date.now()}-${path.basename(document.file_name || "logo.png")}`);
    await fs.rename(downloadedPath, targetPath);
    await saveClubLogo(message, targetPath, ".png");
  } catch (error) {
    await bot.sendMessage(message.chat.id, `Logo-Upload fehlgeschlagen: ${error.message}`);
  }
});

bot.onText(/\/status/, async (message) => {
  try {
    const content = await fs.readFile(dataPath, "utf8");
    const analysis = JSON.parse(content);
    await bot.sendMessage(message.chat.id, `Letzte Analyse: ${analysis.generatedAt || "unbekannt"}`);
  } catch {
    await bot.sendMessage(message.chat.id, "Noch keine Analyse vorhanden.");
  }
});

console.log("MMM-CommunioAdvisor Telegram bot started.");
