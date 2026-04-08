require("dotenv").config();

const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Missing API key");
  process.exit(1);
}

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const STEP1_SYSTEM = `
You are a professional business consultant.

Ask the user questions step by step.

When finished, output JSON and include:
INTAKE COMPLETE 
`;

const sessions = {};

function extractJSON(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

app.post("/chat", async (req, res) => {
  const { sessionId, message } = req.body;

  if (!sessions[sessionId]) {
    sessions[sessionId] = [];
  }

  const history = sessions[sessionId];
  history.push({ role: "user", content: message });

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: STEP1_SYSTEM,
      messages: history,
    });

    const reply = response.content?.[0]?.text || "No response";

    history.push({ role: "assistant", content: reply });

    if (reply.includes("INTAKE COMPLETE")) {
      const data = extractJSON(reply);
      console.log("Collected Data:", data);
    }

    res.json({ reply });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});