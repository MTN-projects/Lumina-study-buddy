
import { GoogleGenAI, Type } from "@google/genai";
import { StudyData } from "../types";

export const processLectureNotes = async (content: string): Promise<StudyData> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analyze the following lecture notes and generate a structured study guide. 
    Notes Content:
    ---
    ${content}
    ---`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: {
            type: Type.STRING,
            description: "A concise summary of the lecture notes (approx 150-200 words).",
          },
          vocabulary: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                word: { type: Type.STRING },
                definition: { type: Type.STRING }
              },
              required: ["word", "definition"]
            },
            description: "A list of exactly 5 key vocabulary terms and their definitions.",
          },
          quiz: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                options: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                },
                correctAnswerIndex: { type: Type.INTEGER }
              },
              required: ["question", "options", "correctAnswerIndex"]
            },
            description: "3 multiple-choice practice questions based on the content.",
          }
        },
        required: ["summary", "vocabulary", "quiz"]
      }
    },
  });

  const text = response.text;
  if (!text) throw new Error("Failed to generate study data.");
  return JSON.parse(text) as StudyData;
};
