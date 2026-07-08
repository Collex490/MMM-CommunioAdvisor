const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const port = Number(process.env.COMMUNIO_ADVISOR_PORT || 8787);
const dataPath = process.env.COMMUNIO_ADVISOR_DATA_PATH
  || path.join(__dirname, "..", "data", "latest.json");

app.use(express.json({ limit: "2mb" }));

app.get("/api/latest", (req, res) => {
  fs.readFile(dataPath, "utf8", (error, content) => {
    if (error) {
      res.status(404).json({ error: "No analysis available yet." });
      return;
    }

    res.type("application/json").send(content);
  });
});

app.post("/api/latest", (req, res) => {
  const nextAnalysis = {
    ...req.body,
    generatedAt: req.body.generatedAt || new Date().toISOString()
  };

  fs.mkdir(path.dirname(dataPath), { recursive: true }, (mkdirError) => {
    if (mkdirError) {
      res.status(500).json({ error: mkdirError.message });
      return;
    }

    fs.writeFile(dataPath, JSON.stringify(nextAnalysis, null, 2), "utf8", (writeError) => {
      if (writeError) {
        res.status(500).json({ error: writeError.message });
        return;
      }

      res.json({ ok: true, path: dataPath });
    });
  });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`MMM-CommunioAdvisor backend listening on http://127.0.0.1:${port}`);
});
