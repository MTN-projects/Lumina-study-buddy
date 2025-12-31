
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
    Analyze the provided lecture material (text and/or document) deeply to:
    1. Identify the primary language of the content.
    2. Summarize the main argument and core concepts with academic rigor.
    3. Extract exactly 10 of the most important terms used in the material:
       - Select the 5 most critical high-level concepts.
       - Select 5 specific technical terms or 'hidden' details that are likely to be on a test.
       - DEFINITION STYLE: Definitions must be strictly under 15 words each. Keep them punchy and compact.
    4. Generate exactly 10 challenging multiple-choice questions to test comprehension. 
       - Every time a quiz is generated, select different key concepts from the document to ensure variety. 
       - Difficulty Mix: Provide exactly 3 easy, 4 medium, and 3 hard questions to create a professional learning curve.
       - Do not repeat questions or concepts from previous attempts.
    5. Generate a short, professional academic title (3-5 words) for this study material.
    6. Provide a "language_code" (BCP-47 string, e.g., 'en-US', 'fr-FR', 'ar-MA').
    7. Provide an "audio_instruction" specifying target accent and tone (e.g., 'Speak in a clear American English accent with a helpful academic tone').

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
            description: "A high-level synthesis of the lecture's main argument and primary concepts.",
          },
          language_code: {
            type: Type.STRING,
            description: "A standard BCP-47 language code string.",
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
            description: "Exactly 10 technical terms and concepts with definitions under 15 words.",
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
            description: "10 practice questions with a mix of easy (3), medium (4), and hard (3) difficulties.",
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
      // Use Modality enum for audio generation
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
  If the answer is not in the document, politely state that you can't find that information. 
  Keep answers clear, concise, and academically focused.`;

  const promptParts: any[] = [];
  
  if (history.length === 0) {
    promptParts.push({ text: `Context Material:\n${contextText}` });
    if (contextFile) {
      promptParts.push({
        inlineData: {
          data: contextFile.base64,
          mimeType: contextFile.mimeType
        }
      });
    }
    promptParts.push({ text: `User Question: ${question}` });
  } else {
    promptParts.push({ text: question });
  }

  const contents = [
    ...history.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    })),
    {
      role: 'user',
      parts: promptParts
    }
  ];

  const response = await ai.models.generateContentStream({
    model: "gemini-3-flash-preview",
    contents: contents,
    config: {
      systemInstruction
    }
  });

  return response;
};
