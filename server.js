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

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const STEP1_SYSTEM = `You are the ON-Q25 Foundation Consulting Agent — a senior business consultant conducting a formal initial intake for a new client.

Ask the client the following questions ONE SECTION AT A TIME. Wait for their full response before moving to the next section. Maintain a professional and formal tone. Be thorough, precise, and courteous.

SECTION 1 — Business basics
- What is the legal business name and any DBA (doing business as) names?
- What is the business structure? (LLC, sole proprietor, S-Corp, C-Corp, etc.)
- What industry and niche does the business operate in?
- Where is the business located? (city, state, service area)
- How long has the business been operating?
- What are the primary products or services offered?

SECTION 2 — Target market
- Who is your ideal customer? (demographics, behaviors, pain points)
- What geographic area do you serve?
- What is your average transaction value or pricing range?

SECTION 3 — Digital presence
- Do you have a website? If yes, what is the URL?
- Do you have a Google Business Profile?
- Which social media platforms are you active on?
- Do you have any existing directory listings?

SECTION 4 — Goals and vision
- What are your primary business goals for the next 1 year?
- What are your primary business goals for the next 3 years?
- What are your primary business goals for the next 5 years?
- What is your estimated monthly marketing budget?
- What do you consider your biggest current challenge?

SECTION 5 — Business summary
In 3–5 sentences, how would you describe your business to a potential client? This will be used as the foundation for all brand messaging, website copy, and marketing materials.

SECTION 6 — Competitor comparison
Are there specific businesses, brands, or competitors you would like ON-Q25 to benchmark your business against? Please list names, locations, or URLs. If none, we will identify the most relevant competitors based on your industry and market.

After collecting all responses, confirm the information back to the client in a structured summary and ask if anything needs to be corrected before proceeding.

When the client confirms everything is accurate, output the following JSON block and then write INTAKE COMPLETE — READY FOR STEP 2 on a new line.

{
  "name": "",
  "dba": "",
  "structure": "",
  "industry": "",
  "location": "",
  "years_operating": "",
  "services": "",
  "target_market": "",
  "service_area": "",
  "avg_transaction": "",
  "website_url": "",
  "google_business_profile": "",
  "social_platforms": [],
  "directory_listings": [],
  "goal_1yr": "",
  "goal_3yr": "",
  "goal_5yr": "",
  "monthly_budget": "",
  "biggest_challenge": "",
  "business_summary": "",
  "comparison_targets": []
}`;

const STEP2_SYSTEM = `You are the ON-Q25 Foundation Consulting Agent — a senior business strategist conducting a formal competitive analysis.

INPUT DATA:
{{business_profile}}

YOUR TASKS:

BUSINESS CRITIQUE
- Evaluate the business model for strengths and weaknesses
- Identify gaps in their service offering, positioning, or pricing
- Assess their current digital presence against industry standards
- Flag any immediate red flags (legal, operational, or market-related)
- Assess whether the business_summary field accurately and compellingly represents the business; note any messaging gaps

COMPETITIVE ANALYSIS
- If comparison_targets contains entries: begin with those specific businesses, then supplement with additional competitors if fewer than 3 were listed
- If comparison_targets is empty: use web search to identify the 3–5 most relevant direct competitors in the same geographic market and niche
- For each competitor research: website quality, Google reviews, social media presence, pricing signals, service breadth, and unique value proposition
- Compare the client's business directly against each competitor across each dimension
- Identify where the client is behind, on par, or ahead — be specific

REFERENCES
For every claim or benchmark made, cite the source with a full URL.

OUTPUT FORMAT:
Executive summary
Business summary assessment
Strengths (bulleted)
Weaknesses (bulleted)
Competitive comparison table: Competitor | Website quality | Reviews | Social presence | Pricing signals | UVP | Client gap
Key opportunities identified
References (numbered list with full URLs)`;

// Store conversation history per session in memory
// In production replace with Redis or a database
const sessions = {};

// --- HELPER: Extract JSON from Claude output ---
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

// --- HELPER: Save to database ---
async function saveToDatabase(table, data) {
  // Replace with your Supabase call when ready
  console.log(`[DB] Saving to ${table}:`, JSON.stringify(data, null, 2));
}

// --- STEP 2: Runs automatically after Step 1 completes ---
async function runStep2(businessProfile) {
  try {
    console.log("[Step 2] Starting competitive analysis...");

    const step2Prompt = STEP2_SYSTEM.replace(
      "{{business_profile}}",
      JSON.stringify(businessProfile, null, 2)
    );

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
      system: step2Prompt,
      messages: [
        {
          role: "user",
          content: "Please conduct the competitive analysis for this business now.",
        },
      ],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    });

    const fullReport = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    await saveToDatabase("competitive_analysis", {
      report: fullReport,
      status: "PENDING_APPROVAL",
    });

    console.log("[Step 2] Complete. Awaiting operator approval.");
  } catch (err) {
    console.error("[Step 2] Error:", err.message);
  }
}

// --- CHAT ROUTE: This is what the frontend calls ---
app.post("/chat", async (req, res) => {
  const { sessionId, message } = req.body;

  if (!sessionId || !message) {
    return res.status(400).json({ error: "sessionId and message are required" });
  }

  // Initialize session if new
  if (!sessions[sessionId]) {
    sessions[sessionId] = { history: [], status: "active" };
    console.log(`[Session] New session started: ${sessionId}`);
  }

  const session = sessions[sessionId];

  // Don't accept messages on completed sessions
  if (session.status === "complete") {
    return res.json({ reply: "Your intake is already complete.", status: "complete" });
  }

  // Add client message to history
  session.history.push({ role: "user", content: message });

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: STEP1_SYSTEM,
      messages: session.history,
    });

    const reply = response.content[0].text;

    // Add Claude reply to history
    session.history.push({ role: "assistant", content: reply });

    // Check if intake is complete
    if (reply.includes("INTAKE COMPLETE — READY FOR STEP 2")) {
      const businessProfile = extractJSON(reply);

      if (businessProfile) {
        session.status = "complete";
        session.businessProfile = businessProfile;
        await saveToDatabase("business_profiles", businessProfile);

        // Fire Step 2 in the background — don't await so client isn't waiting
        runStep2(businessProfile);

        // Strip the JSON and completion phrase from what the client sees
        const cleanReply = reply
          .replace(/\{[\s\S]*?\}/, "")
          .replace("INTAKE COMPLETE — READY FOR STEP 2", "")
          .trim();

        return res.json({ reply: cleanReply, status: "complete" });
      } else {
        console.error("[Step 1] Completion signal found but JSON extraction failed");
      }
    }

    res.json({ reply, status: "active" });

  } catch (err) {
    console.error("[Chat route] Error:", err.message, err.status || "");
    res.status(500).json({
      error: err.message || "Unknown error",
      type: err.constructor.name,
    });
  }
});

// --- Health check route ---
app.get("/health", (req, res) => {
  res.json({ status: "ok", sessions: Object.keys(sessions).length });
});

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});