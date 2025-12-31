import React, { useState, useEffect } from 'react';
import { QuizQuestion } from '../types';
import { Button } from './Button';

interface QuizProps {
  questions: QuizQuestion[];
  theme?: 'light' | 'dark';
}

/**
 * Fisher-Yates Shuffle Algorithm
 */
function shuffleArray<T>(array: T[]): T[] {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

export const Quiz: React.FC<QuizProps> = ({ questions, theme = 'dark' }) => {
  const [shuffledQuestions, setShuffledQuestions] = useState<QuizQuestion[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [showResults, setShowResults] = useState(false);

  // Initialize and shuffle questions on mount or when source questions change
  useEffect(() => {
    handleShuffleAndReset();
  }, [questions]);

  const handleShuffleAndReset = () => {
    // 1. Shuffle the order of questions
    const questionOrder = shuffleArray(questions);

    // 2. For each question, shuffle its options while maintaining the correct answer reference
    const fullyShuffled = questionOrder.map(q => {
      const optionsWithMetadata = q.options.map((opt, idx) => ({
        text: opt,
        isCorrect: idx === q.correctAnswerIndex
      }));

      const shuffledOptions = shuffleArray(optionsWithMetadata);
      const newCorrectIndex = shuffledOptions.findIndex(o => o.isCorrect);

      return {
        ...q,
        options: shuffledOptions.map(o => o.text),
        correctAnswerIndex: newCorrectIndex
      };
    });

    setShuffledQuestions(fullyShuffled);
    setCurrentQuestionIndex(0);
    setSelectedAnswers({});
    setShowResults(false);
  };

  const isDark = theme === 'dark';
  const currentQuestion = shuffledQuestions[currentQuestionIndex];
  const isLastQuestion = currentQuestionIndex === shuffledQuestions.length - 1;

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

  const score = shuffledQuestions.reduce((acc, q, idx) => {
    return selectedAnswers[idx] === q.correctAnswerIndex ? acc + 1 : acc;
  }, 0);

  const glassClass = isDark 
    ? "bg-zinc-900/60 backdrop-blur-xl border border-white/10 shadow-2xl shadow-black/40 neon-glow" 
    : "bg-white border border-[#E0E4F0] shadow-[0_2px_4px_rgba(0,0,0,0.05)] neon-glow";

  if (!currentQuestion && shuffledQuestions.length === 0) return null;

  if (showResults) {
    return (
      <div className={`${glassClass} p-6 rounded-[2.5rem] transition-all duration-300 max-h-[85vh] flex flex-col`}>
        <div className="text-center mb-6">
          <div className={`w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center ${score === shuffledQuestions.length ? 'bg-green-500/20 text-green-600' : 'bg-[#5C6BC0]/20 text-[#5C6BC0]'}`}>
            <span className="text-2xl font-black">{Math.round((score / shuffledQuestions.length) * 100)}%</span>
          </div>
          <h3 className={`text-2xl font-black ${isDark ? 'text-zinc-100' : 'text-[#1A237E]'}`}>Review Performance</h3>
          <p className={`mt-1 font-medium ${isDark ? 'text-zinc-400' : 'text-[#1A237E]/60'}`}>
            You correctly answered {score} of {shuffledQuestions.length} questions
          </p>
        </div>
        
        <div className="flex-1 overflow-y-auto pr-2 space-y-6 mb-6 custom-scrollbar">
          {shuffledQuestions.map((q, qIdx) => {
            const isCorrect = selectedAnswers[qIdx] === q.correctAnswerIndex;
            return (
              <div key={qIdx} className={`p-5 rounded-3xl border ${isDark ? 'bg-zinc-800/30 border-white/5' : 'bg-[#F4F4F9] border-[#E0E4F0]'}`}>
                <div className="flex gap-3 mb-4">
                  <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5 ${isCorrect ? 'bg-green-600 text-white' : 'bg-rose-600 text-white'}`}>
                    {isCorrect ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                  <p className={`font-bold leading-tight ${isDark ? 'text-zinc-200' : 'text-[#2D2D2D]'}`}>
                    {qIdx + 1}. {q.question}
                  </p>
                </div>
                
                <div className="space-y-2 ml-9">
                  {q.options.map((option, optIdx) => {
                    const isSelected = selectedAnswers[qIdx] === optIdx;
                    const isAnswer = q.correctAnswerIndex === optIdx;
                    
                    let bgColor = isDark ? 'bg-black/20' : 'bg-white';
                    let borderColor = isDark ? 'border-white/5' : 'border-[#E0E4F0]';
                    let textColor = isDark ? 'text-zinc-500' : 'text-[#2D2D2D]';

                    if (isAnswer) {
                      bgColor = isDark ? 'bg-green-500/10' : 'bg-green-50';
                      borderColor = 'border-green-500/30';
                      textColor = 'text-green-700';
                    } else if (isSelected && !isCorrect) {
                      bgColor = isDark ? 'bg-rose-500/10' : 'bg-rose-50';
                      borderColor = 'border-rose-500/30';
                      textColor = 'text-rose-700';
                    }

                    return (
                      <div 
                        key={optIdx} 
                        className={`p-3 rounded-xl border text-sm flex items-center justify-between ${bgColor} ${borderColor} ${textColor}`}
                      >
                        <span className="flex items-center gap-2">
                          <span className={`opacity-50 font-bold ${isDark ? '' : 'text-[#1A237E]'}`}>{String.fromCharCode(65 + optIdx)}.</span>
                          {option}
                        </span>
                        {isAnswer && (
                          <span className="text-[10px] font-black uppercase tracking-tighter">Correct</span>
                        )}
                        {isSelected && !isCorrect && (
                          <span className="text-[10px] font-black uppercase tracking-tighter">Your Choice</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <button 
          className="w-full bg-[#1A237E] text-white rounded-2xl py-4 font-black uppercase tracking-widest text-xs shadow-xl hover:shadow-[0_0_20px_rgba(26,35,126,0.6)] transition-all active:scale-95" 
          onClick={handleShuffleAndReset}
        >
          Retake Practice Quiz (Shuffle)
        </button>
      </div>
    );
  }

  return (
    <div className={`${glassClass} p-6 rounded-[2.5rem] shadow-2xl transition-all duration-300`}>
      <div className="flex justify-between items-center mb-6">
        <h3 className={`text-lg font-bold ${isDark ? 'text-zinc-100' : 'text-[#1A237E]'}`}>Practice Quiz</h3>
        <span className={`text-[10px] font-black uppercase tracking-widest ${isDark ? 'text-zinc-500 bg-white/5' : 'text-[#1A237E] bg-[#5C6BC0]/10'} px-2.5 py-1 rounded-full`}>
          Q{currentQuestionIndex + 1} OF {shuffledQuestions.length}
        </span>
      </div>

      <div className="mb-8">
        <p className={`text-lg ${isDark ? 'text-zinc-200' : 'text-[#2D2D2D]'} font-bold mb-6 leading-relaxed`}>{currentQuestion.question}</p>
        <div className="space-y-3">
          {currentQuestion.options.map((option, idx) => (
            <button
              key={idx}
              onClick={() => handleSelectOption(idx)}
              className={`w-full p-4 text-left rounded-2xl border transition-all duration-300 active:scale-[0.98] ${
                selectedAnswers[currentQuestionIndex] === idx
                  ? 'border-[#5C6BC0] bg-[#5C6BC0]/10 text-[#1A237E]'
                  : isDark 
                    ? 'border-white/5 hover:border-white/10 bg-white/5 text-zinc-400 hover:text-zinc-200'
                    : 'border-[#E0E4F0] hover:border-[#5C6BC0]/30 bg-white text-[#2D2D2D] hover:bg-[#5C6BC0]/5'
              }`}
            >
              <span className="flex items-center gap-3">
                <span className={`w-7 h-7 rounded-full flex items-center justify-center border transition-all font-bold ${
                   selectedAnswers[currentQuestionIndex] === idx ? 'bg-[#5C6BC0] border-[#5C6BC0] text-white' : (isDark ? 'border-zinc-700 text-zinc-500' : 'border-[#E0E4F0] text-[#1A237E]')
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
        <button 
          disabled={selectedAnswers[currentQuestionIndex] === undefined} 
          onClick={handleNext}
          className="w-full bg-[#1A237E] text-white rounded-2xl py-4 font-black uppercase tracking-widest text-xs shadow-lg hover:shadow-[0_0_20px_rgba(26,35,126,0.6)] transition-all active:scale-95 disabled:opacity-50"
        >
          {isLastQuestion ? 'Finish Quiz' : 'Next Question'}
        </button>
      </div>
    </div>
  );
};