
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

export enum AppState {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}
