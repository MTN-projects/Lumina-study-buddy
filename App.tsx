
import React, { useState, useRef, useEffect } from 'react';
import { AppState, StudyData } from './types';
import { processLectureNotes } from './services/geminiService';
import { Button } from './components/Button';
import { Quiz } from './components/Quiz';

const App: React.FC = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [state, setState] = useState<AppState>(AppState.IDLE);
  const [notes, setNotes] = useState<string>('');
  const [studyData, setStudyData] = useState<StudyData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isDark = theme === 'dark';

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setNotes(content);
      setError(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const handleCopySummary = async () => {
    if (studyData?.summary) {
      try {
        await navigator.clipboard.writeText(studyData.summary);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy text: ', err);
      }
    }
  };

  const handleSubmit = async () => {
    if (!notes.trim()) return;
    
    setState(AppState.LOADING);
    setError(null);
    try {
      const data = await processLectureNotes(notes);
      setStudyData(data);
      setState(AppState.SUCCESS);
    } catch (err) {
      console.error(err);
      setError("An error occurred while processing your notes. Please try again.");
      setState(AppState.ERROR);
    }
  };

  const reset = () => {
    setState(AppState.IDLE);
    setNotes('');
    setStudyData(null);
    setError(null);
  };

  return (
    <div className={`min-h-screen pb-20 transition-colors duration-300 ${isDark ? 'bg-[#121212] text-slate-200' : 'bg-slate-50 text-slate-900'}`}>
      {/* Header */}
      <header className={`backdrop-blur-lg border-b sticky top-0 z-20 transition-colors duration-300 ${isDark ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white/80 border-slate-200'}`}>
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/20">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.394 2.827a1 1 0 00-.788 0l-7 3a1 1 0 000 1.848l7 3a1 1 0 00.788 0l7-3a1 1 0 000-1.848l-7-3zM14 9.528v2.736a1 1 0 01-.529.883L10 14.613l-3.471-1.466A1 1 0 016 12.264V9.528l4 1.714 4-1.714z" />
              </svg>
            </div>
            <h1 className={`text-xl font-bold tracking-tight transition-colors ${isDark ? 'text-white' : 'text-slate-900'}`}>Lumina Study Buddy</h1>
          </div>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={toggleTheme}
              className={`p-2 rounded-full transition-colors ${isDark ? 'bg-zinc-800 text-yellow-400 hover:bg-zinc-700' : 'bg-slate-100 text-indigo-600 hover:bg-slate-200'}`}
              aria-label="Toggle Theme"
            >
              {isDark ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
                </svg>
              )}
            </button>
            {state !== AppState.IDLE && (
              <Button theme={theme} variant="ghost" onClick={reset}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Guide
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 mt-12">
        {state === AppState.IDLE || state === AppState.ERROR ? (
          <div className="max-w-3xl mx-auto space-y-12 animate-in fade-in duration-700">
            <div className="text-center space-y-4">
              <h2 className={`text-4xl md:text-5xl font-extrabold leading-tight transition-colors ${isDark ? 'text-white' : 'text-slate-900'}`}>Master your lectures with AI.</h2>
              <p className={`text-lg md:text-xl max-w-xl mx-auto transition-colors ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>Transform dense notes into clear summaries, vital vocabulary, and interactive quizzes.</p>
            </div>

            <div className={`p-8 rounded-[2rem] border shadow-2xl space-y-8 transition-colors ${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-slate-200'}`}>
              <div>
                <label className={`block text-sm font-semibold mb-3 ml-1 flex items-center gap-2 transition-colors ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                  Paste your lecture notes
                </label>
                <textarea
                  className={`w-full h-56 p-6 border rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none resize-none text-base leading-relaxed ${isDark ? 'bg-zinc-800/50 border-zinc-700/50 text-zinc-100 placeholder-zinc-600' : 'bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400'}`}
                  placeholder="Insert your notes, transcripts, or research snippets here..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-6">
                <div className={`flex-1 h-px ${isDark ? 'bg-zinc-800' : 'bg-slate-100'}`}></div>
                <span className={`text-[10px] font-black uppercase tracking-[0.2em] transition-colors ${isDark ? 'text-zinc-500' : 'text-slate-400'}`}>or upload a file</span>
                <div className={`flex-1 h-px ${isDark ? 'bg-zinc-800' : 'bg-slate-100'}`}></div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4">
                <Button 
                  theme={theme}
                  variant="outline" 
                  className="flex-1 py-4 text-base"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Select TXT File
                </Button>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept=".txt" 
                  onChange={handleFileUpload}
                />
                
                <Button 
                  theme={theme}
                  className="flex-1 py-4 text-base" 
                  onClick={handleSubmit}
                  disabled={!notes.trim()}
                >
                  Generate Study Guide
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 ml-2" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </Button>
              </div>

              {error && (
                <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm flex items-center gap-3 animate-in slide-in-from-top-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  {error}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-8 opacity-80">
              {[
                { title: "Concise Summaries", desc: "Complex concepts distilled into easy-to-read guides.", icon: "✨" },
                { title: "Vocabulary Builder", desc: "Instantly extract and define key terminology.", icon: "📚" },
                { title: "Active Recall", desc: "Automated quizzes to reinforce long-term memory.", icon: "🧠" }
              ].map((item, i) => (
                <div key={i} className={`text-center p-6 rounded-3xl border transition-colors ${isDark ? 'bg-zinc-900/40 border-zinc-800/50' : 'bg-white border-slate-100'}`}>
                  <div className="text-3xl mb-3">{item.icon}</div>
                  <h4 className={`font-bold mb-2 ${isDark ? 'text-zinc-100' : 'text-slate-800'}`}>{item.title}</h4>
                  <p className={`text-sm leading-relaxed ${isDark ? 'text-zinc-500' : 'text-slate-500'}`}>{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        ) : state === AppState.LOADING ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-8">
            <div className="relative">
              <div className={`w-24 h-24 border-4 rounded-full transition-colors ${isDark ? 'border-zinc-800' : 'border-slate-200'}`}></div>
              <div className="absolute top-0 left-0 w-24 h-24 border-t-4 border-indigo-500 rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-12 h-12 bg-indigo-500/20 rounded-full animate-pulse"></div>
              </div>
            </div>
            <div className="text-center space-y-3">
              <h3 className={`text-2xl font-bold transition-colors ${isDark ? 'text-white' : 'text-slate-900'}`}>Synthesizing Your Material</h3>
              <p className={`text-lg transition-colors ${isDark ? 'text-zinc-500' : 'text-slate-500'}`}>AI is extracting insights, terms, and test questions...</p>
            </div>
          </div>
        ) : studyData ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-10 pb-20 animate-in slide-in-from-bottom-8 duration-700">
            {/* Left Column: Summary & Vocab */}
            <div className="lg:col-span-2 space-y-10">
              <section className={`p-8 md:p-10 rounded-[2.5rem] border shadow-xl overflow-hidden relative transition-colors ${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-slate-200'}`}>
                <div className="flex items-center justify-between mb-8 relative z-10">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-2xl">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <h2 className={`text-3xl font-bold tracking-tight transition-colors ${isDark ? 'text-white' : 'text-slate-900'}`}>Summary</h2>
                  </div>
                  <Button 
                    theme={theme}
                    variant="secondary" 
                    className={`px-4 py-2 text-xs font-bold rounded-full transition-all ${isCopied ? 'text-green-500 border-green-500/30 bg-green-500/5' : ''}`}
                    onClick={handleCopySummary}
                  >
                    {isCopied ? (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        COPIED
                      </>
                    ) : (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m-3 8h3m-3 4h3" />
                        </svg>
                        COPY
                      </>
                    )}
                  </Button>
                </div>
                <div className={`text-lg leading-relaxed whitespace-pre-line relative z-10 font-normal opacity-95 transition-colors ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
                  {studyData.summary}
                </div>
                <div className={`absolute top-0 right-0 w-64 h-64 blur-[100px] -mr-32 -mt-32 transition-colors ${isDark ? 'bg-indigo-500/5' : 'bg-indigo-500/10'}`}></div>
              </section>

              <section className={`p-8 md:p-10 rounded-[2.5rem] border shadow-xl transition-colors ${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-slate-200'}`}>
                <div className="flex items-center gap-4 mb-10">
                  <div className="p-3 bg-amber-500/10 text-amber-500 rounded-2xl">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                  </div>
                  <h2 className={`text-3xl font-bold tracking-tight transition-colors ${isDark ? 'text-white' : 'text-slate-900'}`}>Vocabulary</h2>
                </div>
                <div className="grid grid-cols-1 gap-6">
                  {studyData.vocabulary.map((item, idx) => (
                    <div 
                      key={idx} 
                      className={`animate-vocab flex flex-col md:flex-row gap-4 md:gap-8 p-6 rounded-2xl border transition-all duration-300 ${isDark ? 'bg-zinc-800/30 border-zinc-800 hover:border-zinc-700/80 hover:bg-zinc-800/50' : 'bg-slate-50 border-slate-100 hover:bg-slate-100/50 hover:border-slate-200'}`}
                      style={{ animationDelay: `${idx * 150}ms` }}
                    >
                      <div className="md:w-1/3">
                        <span className={`font-bold uppercase text-sm tracking-widest ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`}>{item.word}</span>
                      </div>
                      <div className="md:w-2/3">
                        <p className={`text-base leading-relaxed transition-colors ${isDark ? 'text-zinc-400' : 'text-slate-600'}`}>{item.definition}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {/* Right Column: Quiz */}
            <div className="lg:col-span-1 space-y-8">
              <div className="sticky top-28">
                <Quiz questions={studyData.quiz} theme={theme} />
                
                <div className="mt-8 p-8 bg-gradient-to-br from-indigo-600 to-indigo-900 rounded-[2rem] text-white shadow-2xl relative overflow-hidden group">
                  <div className="relative z-10">
                    <h4 className="font-bold text-xl mb-3">Study Progress</h4>
                    <p className="text-indigo-100 text-sm mb-6 leading-relaxed">Great job reviewing this material. Ready to move on to the next chapter?</p>
                    <Button 
                      theme={theme}
                      variant="outline" 
                      className="w-full !border-white/20 !bg-white/10 !text-white hover:!bg-white/20 backdrop-blur-sm" 
                      onClick={reset}
                    >
                      Process New Lecture
                    </Button>
                  </div>
                  <div className="absolute top-0 right-0 -mr-16 -mt-16 w-48 h-48 bg-white/10 rounded-full blur-3xl transition-transform group-hover:scale-125 duration-1000"></div>
                  <div className="absolute bottom-0 left-0 -ml-10 -mb-10 w-32 h-32 bg-indigo-400/20 rounded-full blur-2xl"></div>
                </div>

                <div className="mt-6 flex justify-center">
                  <p className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${isDark ? 'text-zinc-600' : 'text-slate-400'}`}>Powered by Gemini 2.0</p>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
};

export default App;
