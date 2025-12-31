import { GoogleGenAI, Type, Modality } from "@google/genai";
import { StudyData, ChatMessage } from "../types";

export interface FileData {
  data: string;
  mimeType: string;
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
       - Use an academic tone and appropriate technical terminology (e.g., specific scientific, legal, or mathematical terms).
    
    2. LANGUAGE MATCHING:
       - Detect the language of the source material.
       - Write the entire study guide (Summary, Vocabulary, and Quiz) in that EXACT same language.
       - If the document is in French, use French. If Arabic, use Arabic (ar-SA). If English, use English.
    
    3. NO INTRODUCTORY FLUFF:
       - Start immediately with the first heading. 
       - DO NOT say "Here is your summary" or "I have analyzed the document".
    
    4. CLEAN TEXT POLICY:
       - Use simple text-based headings (e.g., ALL CAPS followed by a line of dashes or double newlines).
       - ZERO backslashes and NO code blocks.
       - Use exactly two spaces for paragraph separation if not using headings.
    
    5. ADDITIONAL DATA:
       - Extract exactly 10 technical terms with precise academic definitions.
       - Generate exactly 10 challenging multiple-choice questions (3 easy, 4 medium, 3 hard).
       - Provide a professional academic title (3-5 words).
       - Provide "audio_instruction" for the TTS engine (e.g., "Professional academic lecture style, slow pace").

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

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview", // Upgraded to Pro for 100% concept coverage and better reasoning
    contents: { parts },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: {
            type: Type.STRING,
            description: "A short academic title (3-5 words) in the source language.",
          },
          summary: {
            type: Type.STRING,
            description: "Detailed academic summary with clear headings and deep coverage. No introductory fluff.",
          },
          language_code: {
            type: Type.STRING,
            description: "BCP-47 code of the detected language (e.g., 'en-US', 'fr-FR', 'ar-SA').",
          },
          audio_instruction: {
            type: Type.STRING,
            description: "Tone and accent instructions in English for the TTS engine.",
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
            description: "10 technical terms in the source language.",
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
            description: "10 challenging quiz questions in the source language.",
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
};

export const generateSpeech = async (text: string, instruction: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
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
};

export const askQuestionAboutDocumentStream = async (
  question: string,
  history: ChatMessage[],
  contextText: string,
  contextFile?: FileData
) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const systemInstruction = `You are Lumina, a helpful and precise study assistant. 
  Answer questions based ONLY on the provided document content. 
  The conversation history is provided so you can understand follow-up questions.
  Keep answers clear, concise, and academically focused. 
  If the answer is not in the material, explain why politely based on what IS in the material.`;

  const promptParts: any[] = [];
  const initialContext = `Context Material:\n${contextText}`;

  const contents = [
    ...(history.length === 0 ? [] : history.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }))),
    {
      role: 'user',
      parts: [
        ...(history.length === 0 ? [{ text: initialContext }] : []),
        ...(contextFile && history.length === 0 ? [{
          inlineData: {
            data: contextFile.data,
            mimeType: contextFile.mimeType
          }
        }] : []),
        { text: question }
      ]
    }
  ];

  const response = await ai.models.generateContentStream({
    model: "gemini-3-pro-preview",
    contents: contents as any,
    config: {
      systemInstruction
    }
  });

  return response;
};