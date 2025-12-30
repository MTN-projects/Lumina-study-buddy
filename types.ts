export interface VocabularyItem {
  word: string;
  definition: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswerIndex: number;
}

export interface StudyData {
  summary: string;
  vocabulary: VocabularyItem[];
  quiz: QuizQuestion[];
}

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

export interface StudySession {
  id: string;
  timestamp: number;
  fileName: string;
  studyData: StudyData;
  chatMessages: ChatMessage[];
  originalNotes: string;
}

export enum AppState {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}