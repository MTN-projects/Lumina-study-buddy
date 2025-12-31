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
  title?: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

export interface StudySession {
  id: string;
  timestamp: number;
  fileName: string;
  title: string;
  studyData: StudyData;
  chatLog: ChatMessage[];
  originalNotes: string;
  isPinned?: boolean;
}

export enum AppState {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}