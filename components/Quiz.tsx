
import React, { useState } from 'react';
import { QuizQuestion } from '../types';
import { Button } from './Button';

interface QuizProps {
  questions: QuizQuestion[];
  theme?: 'light' | 'dark';
}

export const Quiz: React.FC<QuizProps> = ({ questions, theme = 'dark' }) => {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [showResults, setShowResults] = useState(false);

  const isDark = theme === 'dark';
  const currentQuestion = questions[currentQuestionIndex];
  const isLastQuestion = currentQuestionIndex === questions.length - 1;

  const handleSelectOption = (index: number) => {
    if (showResults) return;
    setSelectedAnswers(prev => ({ ...prev, [currentQuestionIndex]: index }));
  };

  const handleNext = () => {
    if (isLastQuestion) {
      setShowResults(true);
    } else {
      setCurrentQuestionIndex(prev => prev + 1);
    }
  };

  const score = questions.reduce((acc, q, idx) => {
    return selectedAnswers[idx] === q.correctAnswerIndex ? acc + 1 : acc;
  }, 0);

  if (showResults) {
    return (
      <div className={`${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-slate-200'} p-6 rounded-2xl border text-center shadow-2xl transition-colors`}>
        <div className="mb-4">
          <div className="w-16 h-16 bg-indigo-500/10 text-indigo-400 rounded-full flex items-center justify-center mx-auto mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className={`text-xl font-bold ${isDark ? 'text-zinc-100' : 'text-slate-900'}`}>Quiz Completed!</h3>
          <p className={`${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>You scored {score} out of {questions.length}</p>
        </div>
        
        <div className="space-y-4 mb-6 text-left max-h-[400px] overflow-y-auto pr-2">
          {questions.map((q, idx) => (
            <div key={idx} className={`p-4 rounded-lg ${isDark ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-slate-50 border-slate-100'} border`}>
              <p className={`font-medium ${isDark ? 'text-zinc-200' : 'text-slate-700'} mb-2`}>{idx + 1}. {q.question}</p>
              <p className={`text-sm ${selectedAnswers[idx] === q.correctAnswerIndex ? 'text-green-500' : 'text-rose-500'}`}>
                Your answer: {q.options[selectedAnswers[idx]] || 'No answer'}
              </p>
              {selectedAnswers[idx] !== q.correctAnswerIndex && (
                <p className="text-sm text-green-500 mt-1">Correct answer: {q.options[q.correctAnswerIndex]}</p>
              )}
            </div>
          ))}
        </div>

        <Button theme={theme} className="w-full" onClick={() => {
          setShowResults(false);
          setCurrentQuestionIndex(0);
          setSelectedAnswers({});
        }}>
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className={`${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-slate-200'} p-6 rounded-2xl border shadow-2xl transition-colors`}>
      <div className="flex justify-between items-center mb-6">
        <h3 className={`text-lg font-bold ${isDark ? 'text-zinc-100' : 'text-slate-900'}`}>Practice Quiz</h3>
        <span className={`text-xs font-medium ${isDark ? 'text-zinc-500 bg-zinc-800' : 'text-slate-400 bg-slate-100'} px-2 py-1 rounded-md`}>
          Q{currentQuestionIndex + 1} of {questions.length}
        </span>
      </div>

      <div className="mb-8">
        <p className={`text-lg ${isDark ? 'text-zinc-200' : 'text-slate-800'} font-medium mb-6 leading-relaxed`}>{currentQuestion.question}</p>
        <div className="space-y-3">
          {currentQuestion.options.map((option, idx) => (
            <button
              key={idx}
              onClick={() => handleSelectOption(idx)}
              className={`w-full p-4 text-left rounded-xl border-2 transition-all duration-200 active:scale-[0.99] ${
                selectedAnswers[currentQuestionIndex] === idx
                  ? 'border-indigo-500 bg-indigo-500/10 text-indigo-400'
                  : isDark 
                    ? 'border-zinc-800 hover:border-zinc-700 bg-zinc-800/30 text-zinc-400 hover:text-zinc-200'
                    : 'border-slate-100 hover:border-slate-200 bg-slate-50/50 text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className="flex items-center gap-3">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center border text-xs ${
                   selectedAnswers[currentQuestionIndex] === idx ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-zinc-700 text-zinc-500'
                }`}>
                  {String.fromCharCode(65 + idx)}
                </span>
                {option}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <Button 
          theme={theme}
          disabled={selectedAnswers[currentQuestionIndex] === undefined} 
          onClick={handleNext}
          className="w-full sm:w-auto"
        >
          {isLastQuestion ? 'Finish' : 'Next Question'}
        </Button>
      </div>
    </div>
  );
};
