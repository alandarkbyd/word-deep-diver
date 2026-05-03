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

    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    if (!GROQ_API_KEY) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "API key not configured" }),
      };
    }

    // ── FALLBACK MODEL LIST ──
    // একটা model এ limit বা error হলে automatically পরেরটায় চলে যাবে।
    // সবগুলো Groq এ free।
    const MODELS = [
      "llama-3.3-70b-versatile",   // সেরা quality, আগে try করবে
      "llama3-70b-8192",           // Fallback 1
      "llama3-8b-8192",            // Fallback 2 — দ্রুত, একটু কম quality
      "gemma2-9b-it",              // Fallback 3
      "mixtral-8x7b-32768",        // Fallback 4
    ];

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

    // ── প্রতিটা model একে একে try করো ──
    let lastError = null;

    for (const model of MODELS) {
      try {
        console.log(`Trying model: ${model}`);

        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model: model,
            temperature: 0.4,
            max_tokens: 4000,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              {
                role: "user",
                content: `Analyze this English word deeply for a Bangladeshi student: "${word}"`,
              },
            ],
          }),
        });

        const groqData = await groqRes.json();

        // Rate limit বা model unavailable হলে পরেরটায় যাও
        if (!groqRes.ok) {
          const errCode = groqData?.error?.code || groqData?.error?.type || groqRes.status;
          console.warn(`Model ${model} failed: ${errCode}. Trying next...`);
          lastError = groqData;
          continue;
        }

        const rawText = groqData?.choices?.[0]?.message?.content || "";

        // Markdown fence clean করো
        let clean = rawText.trim();
        clean = clean
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/```\s*$/i, "")
          .trim();

        // JSON valid কিনা check করো — না হলে পরেরটায় যাও
        try {
          JSON.parse(clean);
        } catch (parseErr) {
          console.warn(`Model ${model} returned invalid JSON. Trying next...`);
          lastError = { error: "Invalid JSON from model" };
          continue;
        }

        // সফল — result পাঠাও
        console.log(`Success with model: ${model}`);
        return {
          statusCode: 200,
          headers: { ...headers, "X-Model-Used": model },
          body: clean,
        };

      } catch (fetchErr) {
        console.warn(`Model ${model} fetch error: ${fetchErr.message}. Trying next...`);
        lastError = { error: fetchErr.message };
        continue;
      }
    }

    // সব model fail করলে
    console.error("All models failed:", JSON.stringify(lastError));
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({
        error: "সব models এ সমস্যা হচ্ছে। কিছুক্ষণ পর try করো।",
        details: lastError,
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
