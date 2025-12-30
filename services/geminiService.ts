import { GoogleGenAI, Type } from "@google/genai";
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
    1. Summarize the main argument and core concepts with academic rigor.
    2. Extract exactly 5 of the most important technical terms used in the material.
    3. Generate 3 challenging multiple-choice questions to test comprehension of these concepts.
    4. Generate a short, professional academic title (3-5 words) for this study material.

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
            description: "A high-level synthesis of the lecture's main argument and primary concepts (approx 150-200 words).",
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
            description: "The top 5 most critical technical terms identified from the notes.",
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
            description: "3 practice questions that require critical thinking based on the provided text.",
          }
        },
        required: ["title", "summary", "vocabulary", "quiz"]
      }
    },
  });

  const text = response.text;
  if (!text) throw new Error("Failed to generate study data.");
  return JSON.parse(text) as StudyData;
};

export const generateSpeech = async (text: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `Read this academic summary clearly and at a moderate pace: ${text}` }] }],
    config: {
      responseModalities: ["AUDIO"],
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
          data: contextFile.data,
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