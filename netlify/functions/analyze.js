exports.handler = async function (event, context) {
  // Only allow POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // CORS headers - allows your frontend to call this function
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  try {
    const { word } = JSON.parse(event.body);
    if (!word) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "No word provided" }) };
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: "API key not configured" }) };
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
- Respond ONLY with JSON, nothing else, no markdown`;

    const requestBody = {
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: `Analyze this English word deeply for a Bangladeshi student: "${word}"` }] }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 2500,
      },
    };

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      }
    );

    const geminiData = await geminiRes.json();

    if (!geminiRes.ok) {
      console.error("Gemini error:", geminiData);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: "Gemini API error", details: geminiData }),
      };
    }

    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Clean markdown fences if any
    let clean = rawText.trim();
    clean = clean.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

    // Validate JSON
    JSON.parse(clean); // will throw if invalid

    return { statusCode: 200, headers, body: clean };

  } catch (err) {
    console.error("Function error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Server error: " + err.message }),
    };
  }
};
