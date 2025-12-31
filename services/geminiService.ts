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
    Analyze the provided lecture material (text and/or document) deeply to generate a study guide.
    
    OPTIMIZED SUMMARY RULES:
    1. LENGTH & STRUCTURE: Provide exactly 3 paragraphs of comprehensive content.
       - Paragraph 1: Overview of the topic, its historical/theoretical context, and its importance.
       - Paragraph 2: Deep dive into the core mechanisms, categories, arguments, or evidence (e.g., specific classifications or technical processes).
       - Paragraph 3: Impact, conclusions, broader implications, and future outlook of the subject.
    
    2. CLEAN TEXT POLICY:
       - ZERO backslashes, NO newlines (\n), and NO special code symbols.
       - NO quotation marks (single or double), brackets, or technical symbols.
       - Use ONLY periods (.) and commas (,).
       - SENTENCE LENGTH: Keep every single sentence strictly under 15 words for browser stability.
       - PARAGRAPH SEPARATION: Use a period followed by exactly two spaces (".  ") to separate the 3 paragraphs. Do not use any other markers.
    
    3. LANGUAGE & REGION:
       - Identify the primary language.
       - If Arabic is detected, you MUST set language_code to "ar-SA".
       - If French is detected, you MUST set language_code to "fr-FR".
       - Otherwise, use the standard BCP-47 code (e.g., "en-US").

    4. VOCABULARY:
       - Extract exactly 10 technical terms (definitions strictly under 15 words).
    
    5. QUIZ:
       - Generate exactly 10 challenging multiple-choice questions (3 easy, 4 medium, 3 hard).

    6. TITLE: 3-5 words, professional academic style.

    7. AUDIO: Provide an "audio_instruction" specifying target accent and tone.

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
    model: "gemini-3-flash-preview",
    contents: { parts },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: {
            type: Type.STRING,
            description: "A short academic title (3-5 words) summarizing the content.",
          },
          summary: {
            type: Type.STRING,
            description: "Exactly 3 paragraphs of plain text separated by '.  '. No backslashes, no newlines. Sentences < 15 words.",
          },
          language_code: {
            type: Type.STRING,
            description: "BCP-47 code. Use 'ar-SA' for Arabic and 'fr-FR' for French.",
          },
          audio_instruction: {
            type: Type.STRING,
            description: "Target accent and tone for TTS generation.",
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
            description: "Exactly 10 technical terms.",
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
            description: "10 practice questions with mixed difficulty.",
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
  
  // Only send the document context in the first turn or as a system reference
  // Here we include it as part of the initial prompt if history is empty
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
    model: "gemini-3-flash-preview",
    contents: contents as any,
    config: {
      systemInstruction
    }
  });

  return response;
};