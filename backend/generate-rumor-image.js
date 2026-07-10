const fs = require("fs/promises");
const path = require("path");
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function generateRumorImage({ rumorKitchen, club, outputDir }) {
  const headline = rumorKitchen?.headline || "Patron Co prüft Last-Minute-Deal";
  const body = rumorKitchen?.body || "Gattuso fordert mehr Biss im Mittelfeld.";
  const clubName = club?.name || "Pasta La Vista FC";

  const prompt = [
    "Create a fictional German football transfer gossip poster for a fantasy roleplay league.",
    "Do not use real media logos, real brand logos, or exact layouts from Kicker, Transfermarkt, BILD, or other publishers.",
    "Use an original parody sports-news style: dramatic headline, black and gold accents, bold tabloid energy, premium football magazine lighting.",
    `Fantasy club: ${clubName}.`,
    `Headline: ${headline}.`,
    `Subheadline idea: ${body}.`,
    "Include generic labels like TRANSFER-ALARM, WM-COMUNIO, PASTA SPORT KURIER.",
    "No real player photo likenesses. Use abstract stadium lights, silhouettes, transfer arrows, contract papers, and gold-black design.",
    "Landscape 16:9 poster, readable from a distance, MagicMirror dashboard friendly."
  ].join(" ");

  const result = await client.images.generate({
    model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
    prompt,
    size: process.env.OPENAI_RUMOR_IMAGE_SIZE || "1536x1024",
    quality: process.env.OPENAI_RUMOR_IMAGE_QUALITY || "low"
  });

  const imageBase64 = result.data[0].b64_json;
  const imageBytes = Buffer.from(imageBase64, "base64");
  const fileName = "latest-rumor.png";
  const outputPath = path.join(outputDir, fileName);

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputPath, imageBytes);

  return { fileName, outputPath };
}

module.exports = { generateRumorImage };
