import { GoogleGenAI, Type, Modality, GenerateContentResponse } from "@google/genai";
import { StudyData, ChatMessage } from "../types";

export interface FileData {
  data: string;
  mimeType: string;
}

/**
 * Utility for exponential backoff to handle 429 (Quota) errors.
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
        delay *= 2; // Exponential backoff: 1s, 2s, 4s
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
  const conversation = history.map(m => `${m.role}: ${m.content}`).join('\n');
  
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Summarize the following study chat conversation concisely, focusing on the key questions asked and answers provided. Maintain technical context:\n\n${conversation}`,
    config: {
      thinkingConfig: { thinkingBudget: 0 } // Minimal thinking for simple summary
    }
  });
  
  return response.text || "";
}

export const processLectureNotes = async (content: string, fileData?: FileData): Promise<StudyData> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const textPart = {
    text: `You are an advanced academic assistant with PhD-level reasoning capabilities. 
    Analyze the provided lecture material (text and/or document) deeply to generate a high-fidelity study guide.
    
    SUMMARY ENGINE REQUIREMENTS:
    1. STRUCTURE & DEPTH: 
       - Generate a detailed, academic summary structured with CLEAR HEADINGS.
       - Cover 100% of the core concepts found in the document.
       - Prioritize depth and comprehensive explanation over brevity.
       - Use an academic tone and technical terminology.
    
    2. LANGUAGE MATCHING:
       - Detect the language and write the entire study guide in that language.
    
    3. NO INTRODUCTORY FLUFF:
       - Start immediately with the first heading.
    
    4. CLEAN TEXT POLICY:
       - Simple text-based headings. ZERO backslashes and NO code blocks.
    
    5. ADDITIONAL DATA:
       - Exactly 10 technical terms with academic definitions.
       - Exactly 10 challenging multiple-choice questions.
       - Professional title (3-5 words).
       - "audio_instruction" for TTS.

    ${content ? `Additional Text Notes: ${content}` : 'Please analyze the attached document.'}`
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
        thinkingConfig: { thinkingBudget: 16000 }, // 'Medium' level reasoning for summary
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
    if (!text) throw new Error("Failed to generate study data.");
    const rawData = JSON.parse(text);
    
    return {
      ...rawData,
      languageCode: rawData.language_code,
      audioInstruction: rawData.audio_instruction
    } as StudyData;
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

export const askQuestionAboutDocumentStream = async (
  question: string,
  history: ChatMessage[],
  contextText: string,
  contextFile?: FileData
) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // ROLLING WINDOW: Keep last 10 messages, summarize older ones
  let processedHistory = [...history];
  let condensedContext = "";
  
  if (history.length > 10) {
    const olderMessages = history.slice(0, history.length - 10);
    const recentMessages = history.slice(history.length - 10);
    const summary = await summarizeOldHistory(olderMessages);
    condensedContext = `\nPreviously discussed: ${summary}`;
    processedHistory = recentMessages;
  }

  // HYBRID MEMORY: PIN System Instruction and the PDF Summary
  const systemInstruction = `You are Lumina, a precise academic assistant. 
  Answer questions based ONLY on the provided material. 
  CONTEXT PINNED: Below is the core summary of the material. Use it as your primary reference.
  
  MATERIAL SUMMARY:
  ${contextText}
  ${condensedContext}
  
  INSTRUCTIONS:
  - Keep answers clear and academically focused.
  - If the answer is not in the material, say so based on what IS available.`;

  const contents = [
    ...processedHistory.map(