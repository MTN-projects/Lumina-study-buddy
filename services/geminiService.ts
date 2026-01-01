import { GoogleGenAI, Type, Modality } from "@google/genai";
import { StudyData, ChatMessage } from "../types";

export interface FileData {
  data: string;
  mimeType: string;
}

/**
 * Utility for exponential backoff to handle 429 (Quota) errors.
 * Retries after 1, 2, and 4 seconds.
 */
async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let delay = 1000;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const isQuotaError = error?.message?.includes('429') || error?.status === 429;
      if (isQuotaError && i < maxRetries) {
        console.warn(`Quota exceeded. Retrying in ${delay}ms... (Attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; 
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}

/**
 * Summarizes old chat history to maintain context without hitting token limits.
 */
async function summarizeOldHistory(history: ChatMessage[]): Promise<string> {
  if (history.length === 0) return "";
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const conversation = history.map(m => `${m.role === 'user' ? 'Student' : 'Assistant'}: ${m.content}`).join('\n');
  
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Summarize the following study session chat history concisely. Focus on the core concepts asked and explained. Keep it technical and brief:\n\n${conversation}`,
    config: {
      thinkingConfig: { thinkingBudget: 0 }
    }
  });
  
  return response.text || "";
}

/**
 * Initial Synthesis: Enforces a structured summary with bold titles and paragraph separation.
 */
export const processLectureNotes = async (content: string, fileData?: FileData): Promise<StudyData> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const textPart = {
    text: `You are an advanced academic assistant. Analyze the material to create a PhD-level study guide.
    
    1. DETAILED SUMMARY: High-fidelity, multi-section summary.
       - Each major topic MUST start with a **Bold Section Title** (e.g., **The Mechanism of Action**).
       - STRICT REQUIREMENT: Each paragraph and section MUST be separated by EXACTLY two newline characters (\\n\\n) to prevent text merging.
       - NEVER merge unrelated concepts into a single block. Keep them distinct.
    2. LANGUAGE: Detect source language and use it throughout.
    3. VOCABULARY: 10 technical terms with academic definitions.
    4. QUIZ: 10 challenging multiple-choice questions.
    5. TITLE: Professional 3-5 word title.
    6. AUDIO: "audio_instruction" for TTS reading.

    ${content ? `Context: ${content}` : 'Analyze the attached document.'}`
  };

  const parts: any[] = [textPart];
  if (fileData) {
    parts.push({
      inlineData: {
        data: fileData.data,
        mimeType: fileData.mimeType
      }
    });
  }

  return retryWithBackoff(async () => {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts },
      config: {
        thinkingConfig: { thinkingBudget: 16000 },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            summary: { type: Type.STRING },
            language_code: { type: Type.STRING },
            audio_instruction: { type: Type.STRING },
            vocabulary: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  word: { type: Type.STRING },
                  definition: { type: Type.STRING }
                },
                required: ["word", "definition"]
              }
            },
            quiz: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  question: { type: Type.STRING },
                  options: { type: Type.ARRAY, items: { type: Type.STRING } },
                  correctAnswerIndex: { type: Type.INTEGER }
                },
                required: ["question", "options", "correctAnswerIndex"]
              }
            }
          },
          required: ["title", "summary", "vocabulary", "quiz", "language_code", "audio_instruction"]
        }
      },
    });

    const text = response.text;
    if (!text) throw new Error("Synthesis failed.");
    const rawData = JSON.parse(text);
    
    return {
      ...rawData,
      languageCode: rawData.language_code,
      audioInstruction: rawData.audio_instruction
    } as StudyData;
  });
};

export const askQuestionAboutDocumentStream = async (
  question: string,
  history: ChatMessage[],
  summaryText: string,
  fileData?: FileData
) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  let processedHistory = [...history];
  let backgroundContext = "";
  
  if (history.length > 10) {
    const olderMessages = history.slice(0, history.length - 10);
    const recentMessages = history.slice(history.length - 10);
    const summary = await summarizeOldHistory(olderMessages);
    backgroundContext = `\nPreviously discussed and established context:\n${summary}`;
    processedHistory = recentMessages;
  }

  const systemInstruction = `You are Lumina. Use the PINNED CONTEXT below as your primary academic source.
  
  [PINNED CONTEXT - SOURCE SUMMARY]:
  ${summaryText}
  
  ${backgroundContext}
  
  INSTRUCTIONS:
  - Answer student queries based strictly on the source material.
  - If information is missing, use academic reasoning but clarify its absence in the primary text.
  - Keep answers concise but intellectually rigorous.`;

  const contents = [
    ...processedHistory.map(m => ({
      role: m.role,
      parts: [{ text: m.content }]
    })),
    {
      role: 'user',
      parts: [
        { text: question },
        ...(fileData ? [{ inlineData: { data: fileData.data, mimeType: fileData.mimeType } }] : [])
      ]
    }
  ];

  return retryWithBackoff(async () => {
    return await ai.models.generateContentStream({
      model: "gemini-3-flash-preview",
      contents,
      config: {
        systemInstruction,
        thinkingConfig: { thinkingBudget: 0 }
      }
    });
  });
};

export const generateSpeech = async (text: string, instruction: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  return retryWithBackoff(async () => {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `${instruction}: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Zephyr' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error("Audio generation failed.");
    return base64Audio;
  });
};