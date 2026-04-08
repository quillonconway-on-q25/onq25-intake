const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// --- SYSTEM PROMPTS ---
// Paste your full Step 1 and Step 2 system prompts here
const STEP1_SYSTEM = `Your Step 1 system prompt here...`;
const STEP2_SYSTEM = `Your Step 2 system prompt here...`;

// --- STEP 1: Run the intake conversation ---
async function runStep1(conversationHistory) {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: STEP1_SYSTEM,
    messages: conversationHistory,
  });

  const output = response.content[0].text;

  // Detect completion signal
  if (output.includes("INTAKE COMPLETE — READY FOR STEP 2")) {
    const businessProfile = extractJSON(output);
    await saveToDatabase("business_profile", businessProfile);
    return { done: true, businessProfile };
  }

  // Not done yet — return the response so the client can reply
  return { done: false, reply: output };
}

// --- STEP 2: Fire automatically once Step 1 is done ---
async function runStep2(businessProfile) {
  const step2Prompt = STEP2_SYSTEM.replace(
    "{{business_profile}}",
    JSON.stringify(businessProfile, null, 2)
  );

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8096,
    system: step2Prompt,
    messages: [
      {
        role: "user",
        content:
          "Please conduct the competitive analysis for this business now.",
      },
    ],
    tools: [{ type: "web_search_20250305", name: "web_search" }],
  });

  // Collect all text blocks (web search returns multiple content blocks)
  const fullReport = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  await saveToDatabase("competitive_analysis", {
    report: fullReport,
    status: "PENDING_APPROVAL",
  });

  console.log("Step 2 complete. Awaiting operator approval before Step 3.");
  return fullReport;
}

// --- HELPER: Pull JSON from Claude's output ---
function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON found in Step 1 output");
  return JSON.parse(match[0]);
}

// --- HELPER: Save to your database ---
// Replace this with your actual DB calls (Supabase, Airtable, etc.)
async function saveToDatabase(table, data) {
  console.log(`Saving to ${table}:`, data);
  // e.g. await supabase.from(table).insert(data)
}

// --- MAIN: Orchestrate the full flow ---
async function main() {
  const conversationHistory = [];

  // Simulate the client answering intake questions
  // In a real app, this loop runs in your chat UI
  const clientMessages = [
    "Hi, I'd like to start the intake process.",
    // ... client's section-by-section replies go here
    "Yes, everything looks accurate. Please proceed.",
  ];

  for (const message of clientMessages) {
    conversationHistory.push({ role: "user", content: message });

    const result = await runStep1(conversationHistory);

    if (result.done) {
      console.log("Step 1 complete. Firing Step 2 automatically...");
      await runStep2(result.businessProfile);
      break;
    }

    // Add Claude's reply to history so it remembers the conversation
    conversationHistory.push({ role: "assistant", content: result.reply });
    console.log("Claude:", result.reply);
  }
}

main();