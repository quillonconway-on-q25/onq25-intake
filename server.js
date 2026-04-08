require("dotenv").config();

const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("FATAL: ANTHROPIC_API_KEY is not set");
  process.exit(1);
}

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ✅ STEP 1 PROMPT (CLEAN)
const STEP1_SYSTEM = `You are the ON-Q25 Foundation Consulting Agent.

Ask questions one section at a time. Be professional.

At the end, output JSON and include:
INTAKE COMPLETE — READY FOR STEP 2`;

// ✅ STEP 2 PROMPT (CLEAN)
const STEP2_SYSTEM = `You are a business strategist. Analyze the business:
{{business_profile}}`;

// Store sessions
const sessions = {};

// ✅ SAFE JSON PARSER
function extractJSON(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch (e) {
    console.error("JSON parse error:", e.message);
    return null;
  }
}

// ✅ STEP 2
async function runStep2(businessProfile) {
  try {
    const prompt = STEP2_SYSTEM.replace(
      "{{business_profile}}",
      JSON.stringify(businessProfile, null, 2)
    );

    const response = await client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4000,
      system: prompt,
      messages: [{ role: "user", content: "Analyze this business." }],
    });

    console.log("Step 2 complete");
  } catch (err) {
    console.error("Step 2 error:", err.message);
  }
}

// ✅ CHAT ROUTE
app.post("/chat", async (req, res) => {
  const { sessionId, message } = req.body;

  if (!sessions[sessionId]) {
    sessions[sessionId] = { history: [], status: "active" };
  }

  const session = sessions[sessionId];

  session.history.push({ role: "user", content: message });

  try {
    const response = await client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1000,
      system: STEP1_SYSTEM,
      messages: session.history,
    });

    const reply = response.content?.[0]?.text || "No response";

    session.history.push({ role: "assistant", content: reply });

    if (reply.includes("INTAKE COMPLETE — READY FOR STEP 2")) {
      const json = extractJSON(reply);

      session.status = "complete";

      if (json) runStep2(json);

      return res.json({
        reply: "Intake complete. Preparing analysis...",
        status: "complete",
      });
    }

    res.json({ reply, status: "active" });
  } catch (err) {
    console.error("CHAT ERROR:", err);

    res.status(500).json({
      error: err.message,
    });
  }
});

// ✅ HEALTH CHECK
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// ✅ START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});