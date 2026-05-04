exports.handler = async function (event, context) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  try {
    const { word } = JSON.parse(event.body);
    if (!word) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "No word provided" }),
      };
    }

    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    const GROQ_API_KEY = process.env.GROQ_API_KEY;

    if (!OPENROUTER_API_KEY && !GROQ_API_KEY) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "No API key configured" }),
      };
    }

    const SYSTEM_PROMPT = `You are an expert English linguistics teacher specializing in collocations, word meanings, and usage patterns. Your student is Bangladeshi and learning English.

When given a word, respond ONLY with a valid JSON object (no markdown, no backticks, no extra text) with this exact structure:

{
  "word": "the word",
  "pronunciation": "/prəˌnʌnsiˈeɪʃən/",
  "partOfSpeech": ["noun", "verb"],
  "coreMeaning": "One sentence core meaning in simple English with Bangla translation in parentheses",
  "meanings": [
    {
      "definition": "Clear definition in English",
      "bangla": "বাংলা অর্থ",
      "example": "A natural example sentence with the **word** bolded",
      "context": "formal/informal/academic/casual"
    }
  ],
  "collocations": [
    {
      "type": "Verb + Word",
      "typeLabel": "Verb Collocations",
      "color": "cyan",
      "items": [
        {
          "phrase": "make a decision",
          "sentence": "She had to **make a decision** before the deadline.",
          "bangla": "সিদ্ধান্ত নেওয়া"
        }
      ]
    },
    {
      "type": "Adjective + Word",
      "typeLabel": "Adjective Collocations",
      "color": "green",
      "items": []
    },
    {
      "type": "Word + Preposition",
      "typeLabel": "Preposition Patterns",
      "color": "amber",
      "items": []
    }
  ],
  "commonMistakes": [
    {
      "wrong": "The wrong way",
      "right": "The correct way",
      "reason": "Why it is wrong in simple English"
    }
  ],
  "quiz": [
    {
      "question": "Fill in the blank: She _____ a difficult decision.",
      "options": ["made", "did", "took", "had"],
      "correct": 0,
      "explanation": "We say make a decision, not do a decision."
    },
    {
      "question": "Which collocation is correct?",
      "options": ["option1", "option2", "option3", "option4"],
      "correct": 0,
      "explanation": "Explanation here."
    },
    {
      "question": "Choose the correct usage:",
      "options": ["option1", "option2", "option3", "option4"],
      "correct": 1,
      "explanation": "Explanation here."
    }
  ],
  "memoryTips": [
    { "title": "Key Pattern", "tip": "The most important pattern with Bangla examples." },
    { "title": "Common Mistake", "tip": "The mistake Bangladeshi learners most often make." },
    { "title": "Practice Sentence", "tip": "A memorable sentence using multiple collocations." }
  ]
}

RULES:
- Give 3-5 meanings
- Give at least 3 collocation groups with 3-4 items each
- Give 4 common mistakes
- Give exactly 3 quiz questions with 4 options each
- Give 3 memory tips
- Bold key words in sentences using **word** syntax
- Focus on mistakes Bangladeshi learners make
- Respond ONLY with JSON, nothing else, no markdown, no backticks`;

    const USER_MESSAGE = `Analyze this English word deeply for a Bangladeshi student: "${word}"`;

    // ════════════════════════════════════════════
    // PRIORITY 1 — OpenRouter (Claude free models)
    // ════════════════════════════════════════════
    const OPENROUTER_MODELS = [
      "anthropic/claude-haiku-4-5",          // Claude Haiku — best free option
      "anthropic/claude-3-haiku",             // Claude 3 Haiku fallback
      "google/gemini-2.0-flash-exp:free",     // Gemini free
      "meta-llama/llama-3.3-70b-instruct:free", // Llama free
      "mistralai/mistral-7b-instruct:free",   // Mistral free
    ];

    if (OPENROUTER_API_KEY) {
      for (const model of OPENROUTER_MODELS) {
        try {
          console.log(`[OpenRouter] Trying: ${model}`);

          const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
              "HTTP-Referer": "https://analize-word.netlify.app",
              "X-Title": "Word Deep Diver",
            },
            body: JSON.stringify({
              model: model,
              temperature: 0.4,
              max_tokens: 4000,
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: USER_MESSAGE },
              ],
            }),
          });

          const data = await res.json();

          if (!res.ok) {
            const errMsg = data?.error?.message || res.status;
            console.warn(`[OpenRouter] ${model} failed: ${errMsg}. Trying next...`);
            continue;
          }

          const rawText = data?.choices?.[0]?.message?.content || "";
          let clean = rawText.trim()
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/```\s*$/i, "")
            .trim();

          try {
            JSON.parse(clean);
          } catch {
            console.warn(`[OpenRouter] ${model} returned invalid JSON. Trying next...`);
            continue;
          }

          console.log(`[OpenRouter] Success: ${model}`);
          return {
            statusCode: 200,
            headers: { ...headers, "X-Model-Used": model },
            body: clean,
          };

        } catch (err) {
          console.warn(`[OpenRouter] ${model} error: ${err.message}. Trying next...`);
          continue;
        }
      }
    }

    // ════════════════════════════════════════════
    // PRIORITY 2 — Groq fallback (if OpenRouter fails)
    // ════════════════════════════════════════════
    const GROQ_MODELS = [
      "llama-3.3-70b-versatile",
      "llama3-70b-8192",
      "llama3-8b-8192",
      "gemma2-9b-it",
      "mixtral-8x7b-32768",
    ];

    if (GROQ_API_KEY) {
      for (const model of GROQ_MODELS) {
        try {
          console.log(`[Groq] Trying: ${model}`);

          const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${GROQ_API_KEY}`,
            },
            body: JSON.stringify({
              model: model,
              temperature: 0.4,
              max_tokens: 4000,
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: USER_MESSAGE },
              ],
            }),
          });

          const data = await res.json();

          if (!res.ok) {
            const errMsg = data?.error?.message || res.status;
            console.warn(`[Groq] ${model} failed: ${errMsg}. Trying next...`);
            continue;
          }

          const rawText = data?.choices?.[0]?.message?.content || "";
          let clean = rawText.trim()
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/```\s*$/i, "")
            .trim();

          try {
            JSON.parse(clean);
          } catch {
            console.warn(`[Groq] ${model} returned invalid JSON. Trying next...`);
            continue;
          }

          console.log(`[Groq] Success: ${model}`);
          return {
            statusCode: 200,
            headers: { ...headers, "X-Model-Used": model },
            body: clean,
          };

        } catch (err) {
          console.warn(`[Groq] ${model} error: ${err.message}. Trying next...`);
          continue;
        }
      }
    }

    // সব fail হলে
    console.error("All models and providers failed.");
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({
        error: "সব models এ সমস্যা হচ্ছে। কিছুক্ষণ পর try করো।",
      }),
    };

  } catch (err) {
    console.error("Function error:", err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Server error: " + err.message }),
    };
  }
};
