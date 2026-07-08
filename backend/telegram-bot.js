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
  standings: "Tabelle",
  lineup: "Aufstellung",
  budget: "Budget",
  squad: "Kader"
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

function buildHelpText() {
  return [
    "ComunioAdvisor Modi:",
    "/auto - Screenshot automatisch erkennen",
    "/transfers - Transfermarkt/Kaeufe/Verkaeufe sammeln",
    "/tabelle - Liga-Tabelle mit Punkten speichern",
    "/aufstellung - offizielles Aufstellungsbild speichern",
    "/budget - Kontostand/Budget auswerten",
    "/kader - Kader fuer Halten/Verkaufen/Tauschen auswerten",
    "/status - letzte Analyse anzeigen",
    "",
    "Tipp: Modus setzen und danach 1 bis mehrere Screenshots schicken."
  ].join("\n");
}

async function setModeAndReply(message, mode) {
  setChatMode(message.chat.id, mode);
  await bot.sendMessage(message.chat.id, `Modus gesetzt: ${modeLabels[mode]}. Sende jetzt den passenden Screenshot.`);
}

bot.onText(/\/help|\/start/, async (message) => {
  await bot.sendMessage(message.chat.id, buildHelpText());
});

bot.onText(/\/auto/, (message) => setModeAndReply(message, "auto"));
bot.onText(/\/transfers|\/transfermarkt/, (message) => setModeAndReply(message, "transfermarket"));
bot.onText(/\/tabelle|\/standings/, (message) => setModeAndReply(message, "standings"));
bot.onText(/\/aufstellung|\/lineup/, (message) => setModeAndReply(message, "lineup"));
bot.onText(/\/budget/, (message) => setModeAndReply(message, "budget"));
bot.onText(/\/kader|\/squad/, (message) => setModeAndReply(message, "squad"));

bot.on("photo", async (message) => {
  try {
    if (allowedChatId && String(message.chat.id) !== String(allowedChatId)) {
      await bot.sendMessage(message.chat.id, "Dieser Chat ist fuer den Comunio Advisor nicht freigegeben.");
      return;
    }

    const chatMode = getChatMode(message.chat.id);
    await bot.sendMessage(message.chat.id, `Screenshot erhalten. Modus: ${modeLabels[chatMode]}. Ich analysiere...`);

    const photo = message.photo[message.photo.length - 1];
    await fs.mkdir(uploadDir, { recursive: true });

    const downloadedPath = await bot.downloadFile(photo.file_id, uploadDir);
    const targetPath = path.join(uploadDir, `${Date.now()}-${path.basename(downloadedPath)}.jpg`);
    await fs.rename(downloadedPath, targetPath);

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
