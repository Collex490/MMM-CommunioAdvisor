require("dotenv").config();

const fs = require("fs/promises");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");
const { analyzeScreenshot } = require("./openai-analyze");

const token = process.env.TELEGRAM_BOT_TOKEN;
const dataPath = process.env.COMMUNIO_ADVISOR_DATA_PATH
  || path.join(__dirname, "..", "data", "latest.json");
const uploadDir = process.env.COMMUNIO_ADVISOR_UPLOAD_DIR
  || path.join(__dirname, "..", "uploads");
const allowedChatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;

if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN fehlt in der Umgebung.");
}

const bot = new TelegramBot(token, { polling: true });

bot.on("photo", async (message) => {
  try {
    if (allowedChatId && String(message.chat.id) !== String(allowedChatId)) {
      await bot.sendMessage(message.chat.id, "Dieser Chat ist fuer den Comunio Advisor nicht freigegeben.");
      return;
    }

    await bot.sendMessage(message.chat.id, "Screenshot erhalten. Ich analysiere den Markt...");

    const photo = message.photo[message.photo.length - 1];
    await fs.mkdir(uploadDir, { recursive: true });

    const downloadedPath = await bot.downloadFile(photo.file_id, uploadDir);
    const targetPath = path.join(uploadDir, `${Date.now()}-${path.basename(downloadedPath)}.jpg`);
    await fs.rename(downloadedPath, targetPath);

    const analysis = await analyzeScreenshot(targetPath);
    const completeAnalysis = {
      ...analysis,
      generatedAt: analysis.generatedAt || new Date().toISOString()
    };

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
