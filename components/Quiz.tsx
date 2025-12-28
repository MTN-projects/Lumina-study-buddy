
import React, { useState } from 'react';
import { QuizQuestion } from '../types';
import { Button } from './Button';

interface QuizProps {
  questions: QuizQuestion[];
}

export const Quiz: React.FC<QuizProps> = ({ questions }) => {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [showResults, setShowResults] = useState(false);

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
      <div className="bg-white p-6 rounded-2xl border border-slate-200 text-center">
        <div className="mb-4">
          <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-xl font-bold text-slate-800">Quiz Completed!</h3>
          <p className="text-slate-500">You scored {score} out of {questions.length}</p>
        </div>
        
        <div className="space-y-4 mb-6 text-left">
          {questions.map((q, idx) => (
            <div key={idx} className="p-4 rounded-lg bg-slate-50 border border-slate-100">
              <p className="font-medium text-slate-800 mb-2">{idx + 1}. {q.question}</p>
              <p className={`text-sm ${selectedAnswers[idx] === q.correctAnswerIndex ? 'text-green-600' : 'text-red-600'}`}>
                Your answer: {q.options[selectedAnswers[idx]] || 'No answer'}
              </p>
              {selectedAnswers[idx] !== q.correctAnswerIndex && (
                <p className="text-sm text-green-600">Correct answer: {q.options[q.correctAnswerIndex]}</p>
              )}
            </div>
          ))}
        </div>

        <Button onClick={() => {
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
    <div className="bg-white p-6 rounded-2xl border border-slate-200">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-lg font-bold text-slate-800">Practice Quiz</h3>
        <span className="text-sm text-slate-400">Question {currentQuestionIndex + 1} of {questions.length}</span>
      </div>

      <div className="mb-8">
        <p className="text-lg text-slate-700 font-medium mb-4">{currentQuestion.question}</p>
        <div className="space-y-3">
          {currentQuestion.options.map((option, idx) => (
            <button
              key={idx}
              onClick={() => handleSelectOption(idx)}
              className={`w-full p-4 text-left rounded-xl border-2 transition-all duration-200 ${
                selectedAnswers[currentQuestionIndex] === idx
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                  : 'border-slate-100 hover:border-slate-200 text-slate-600'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <Button 
          disabled={selectedAnswers[currentQuestionIndex] === undefined} 
          onClick={handleNext}
        >
          {isLastQuestion ? 'Finish' : 'Next Question'}
        </Button>
      </div>
    </div>
  );
};
