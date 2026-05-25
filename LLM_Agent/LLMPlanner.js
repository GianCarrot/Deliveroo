import OpenAI from "openai";
import { PLANNER_PROMPT } from "./prompts/plannerPrompt.js";

export class LLMPlanner {
  constructor({ baseURL, apiKey, model }) {
    this.client = new OpenAI({ baseURL, apiKey });
    this.model = model;
  }

  async plan(memory) {
    const toolsList = [
      "moveTo(x, y)",
      "move(direction)",
      "pickup()",
      "putdown()",
      "get_my_position()",
    ];

    const worldState = memory.worldSnapshot ?? {};
    const prompt = `
  ${PLANNER_PROMPT}

  Objective: ${memory.objective}

  World state (JSON):
  ${JSON.stringify(worldState, null, 2)}

  Available tools:
  ${toolsList.join("\n")}

  Return ONLY a JSON array of steps, no explanation.
  `.trim();

    console.log("Ciao")

    /*const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: "You are a planning module." },
        { role: "user", content: prompt },
      ],
      temperature: 0,
    });*/

    const response = await fetch(`${this.client.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.LITELLM_API_KEY}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: "You are a planning module." },
          { role: "user", content: prompt }
        ],
        temperature: 0
      })
    });

    // Read JSON
    const data = await response.json();
    console.log("RAW DATA =", data);

    // Extract Text
    const text = data.choices?.[0]?.message?.content ?? "[]";

    console.log("Text = ")
    console.log(text)

    try {
      const plan = JSON.parse(text);
      return Array.isArray(plan) ? plan : [];
    } catch {
      return [];
    }
  }
}