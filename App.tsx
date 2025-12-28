
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
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const glassCardClass = isDark 
    ? "bg-zinc-900/40 backdrop-blur-xl border border-white/10 shadow-2xl" 
    : "bg-white/70 backdrop-blur-xl border border-slate-200 shadow-xl";

  return (
    <div className={`min-h-screen pb-20 transition-all duration-700 relative overflow-hidden ${isDark ? 'bg-[#0a0a0c] text-slate-200' : 'bg-slate-50 text-slate-900'}`}>
      
      {/* Background Ambient Glows */}
      {isDark && (
        <>
          <div className="glow-orb animate-float fixed top-[-10%] left-[-5%] w-[500px] h-[500px] bg-purple-600/20 rounded-full blur-[120px] pointer-events-none -z-10" />
          <div className="glow-orb animate-float-delayed fixed bottom-[-10%] right-[-5%] w-[600px] h-[600px] bg-indigo-600/20 rounded-full blur-[120px] pointer-events-none -z-10" />
        </>
      )}

      {/* Header */}
      <header className={`backdrop-blur-2xl border-b sticky top-0 z-30 transition-all duration-500 ${isDark ? 'bg-black/40 border-white/5' : 'bg-white/70 border-slate-200'}`}>
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/30">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.394 2.827a1 1 0 00-.788 0l-7 3a1 1 0 000 1.848l7 3a1 1 0 00.788 0l7-3a1 1 0 000-1.848l-7-3zM14 9.528v2.736a1 1 0 01-.529.883L10 14.613l-3.471-1.466A1 1 0 016 12.264V9.528l4 1.714 4-1.714z" />
              </svg>
            </div>
            <h1 className={`text-xl font-bold tracking-tight transition-colors ${isDark ? 'text-white' : 'text-slate-900'}`}>Lumina</h1>
          </div>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={toggleTheme}
              className={`p-2.5 rounded-full transition-all active:scale-90 ${isDark ? 'bg-white/5 text-yellow-400 hover:bg-white/10' : 'bg-slate-100 text-indigo-600 hover:bg-slate-200'}`}
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

            {/* Functional New Session Button */}
            {(state !== AppState.IDLE || notes.trim().length > 0) && (
              <Button 
                theme={theme} 
                variant="ghost" 
                onClick={reset} 
                className="rounded-full px-4 flex items-center gap-2 group border border-transparent hover:border-white/10 active:scale-95"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 transition-transform group-hover:rotate-180 duration-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span className="hidden sm:inline font-bold text-xs uppercase tracking-widest">New Session</span>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 mt-16 relative z-10">
        {state === AppState.IDLE || state === AppState.ERROR ? (
          <div className="max-w-3xl mx-auto space-y-16 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="text-center space-y-6">
              <h2 className={`text-5xl md:text-6xl font-black leading-tight transition-colors ${isDark ? 'text-white' : 'text-slate-900'}`}>Study Smarter.</h2>
              <p className={`text-xl md:text-2xl max-w-xl mx-auto opacity-80 transition-colors ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>Harness the power of AI to synthesize your lecture material in seconds.</p>
            </div>

            <div className={`p-10 rounded-[3rem] shadow-2xl space-y-10 transition-all duration-500 ${glassCardClass}`}>
              <div className="space-y-4">
                <label className={`block text-xs font-black uppercase tracking-[0.2em] ml-1 transition-colors ${isDark ? 'text-zinc-500' : 'text-slate-500'}`}>
                  Input your notes
                </label>
                <textarea
                  className={`w-full h-64 p-8 border rounded-[2rem] focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all outline-none resize-none text-lg leading-relaxed ${isDark ? 'bg-black/30 border-white/5 text-zinc-100 placeholder-zinc-700' : 'bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400'}`}
                  placeholder="Paste your content here..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-8">
                <div className={`flex-1 h-px ${isDark ? 'bg-white/5' : 'bg-slate-100'}`}></div>
                <span className={`text-[10px] font-black uppercase tracking-[0.3em] transition-colors ${isDark ? 'text-zinc-600' : 'text-slate-300'}`}>alternative</span>
                <div className={`flex-1 h-px ${isDark ? 'bg-white/5' : 'bg-slate-100'}`}></div>
              </div>

              <div className="flex flex-col sm:flex-row gap-5">
                <Button 
                  theme={theme}
                  variant="outline" 
                  className="flex-1 py-5 text-base rounded-2xl"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Select Document
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
                  className="flex-1 py-5 text-base rounded-2xl bg-indigo-600 hover:bg-indigo-500" 
                  onClick={handleSubmit}
                  disabled={!notes.trim()}
                >
                  Generate Study Guide
                </Button>
              </div>

              {error && (
                <div className="p-5 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-400 text-sm flex items-center gap-4 animate-in slide-in-from-top-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  {error}
                </div>
              )}
            </div>
          </div>
        ) : state === AppState.LOADING ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-10">
            <div className="relative">
              <div className={`w-32 h-32 border-4 rounded-full transition-colors ${isDark ? 'border-white/5' : 'border-slate-200'}`}></div>
              <div className="absolute top-0 left-0 w-32 h-32 border-t-4 border-indigo-500 rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-16 h-16 bg-indigo-500/30 rounded-full animate-pulse blur-xl"></div>
                <div className="w-4 h-4 bg-indigo-500 rounded-full"></div>
              </div>
            </div>
            <div className="text-center space-y-4">
              <h3 className={`text-3xl font-bold transition-colors ${isDark ? 'text-white' : 'text-slate-900'}`}>Analyzing Content</h3>
              <p className={`text-xl transition-colors opacity-60 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>Our AI is crafting your personalized study materials...</p>
            </div>
          </div>
        ) : studyData ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 pb-20">
            {/* Left Column: Summary & Vocab */}
            <div className="lg:col-span-2 space-y-12">
              <section className={`p-10 md:p-12 rounded-[3.5rem] relative overflow-hidden transition-all duration-500 animate-spring-up ${glassCardClass}`}>
                <div className="flex items-center justify-between mb-10 relative z-10">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-500/20 text-indigo-400 rounded-2xl">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <h2 className={`text-3xl font-black tracking-tight transition-colors ${isDark ? 'text-white' : 'text-slate-900'}`}>Core Summary</h2>
                  </div>
                  <Button 
                    theme={theme}
                    variant="secondary" 
                    className={`px-5 py-2.5 text-xs font-black rounded-full transition-all border ${isCopied ? 'text-green-400 border-green-500/30 bg-green-500/10' : (isDark ? 'border-white/5 bg-white/5 text-zinc-400' : '')}`}
                    onClick={handleCopySummary}
                  >
                    {isCopied ? 'COPIED TO CLIPBOARD' : 'COPY SUMMARY'}
                  </Button>
                </div>
                <div className={`text-xl leading-relaxed whitespace-pre-line relative z-10 font-normal opacity-90 transition-colors ${isDark ? 'text-zinc-200' : 'text-slate-700'}`}>
                  {studyData.summary}
                </div>
                <div className={`absolute top-0 right-0 w-80 h-80 blur-[120px] -mr-40 -mt-40 transition-colors ${isDark ? 'bg-indigo-500/10' : 'bg-indigo-500/10'}`}></div>
              </section>

              <section className={`p-10 md:p-12 rounded-[3.5rem] transition-all duration-500 animate-spring-up ${glassCardClass}`}>
                <div className="flex items-center gap-5 mb-12">
                  <div className="p-3 bg-amber-500/20 text-amber-500 rounded-2xl">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                  </div>
                  <h2 className={`text-3xl font-black tracking-tight transition-colors ${isDark ? 'text-white' : 'text-slate-900'}`}>Terminology</h2>
                </div>
                <div className="grid grid-cols-1 gap-8">
                  {studyData.vocabulary.map((item, idx) => (
                    <div 
                      key={idx} 
                      className={`animate-vocab flex flex-col md:flex-row gap-6 md:gap-10 p-8 rounded-3xl border transition-all duration-500 group ${isDark ? 'bg-white/5 border-white/5 hover:border-white/10 hover:bg-white/10' : 'bg-slate-50 border-slate-100 hover:bg-slate-100/50 hover:border-slate-200'}`}
                      style={{ animationDelay: `${idx * 150}ms` }}
                    >
                      <div className="md:w-1/3">
                        <span className={`font-black uppercase text-sm tracking-[0.3em] ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`}>{item.word}</span>
                      </div>
                      <div className="md:w-2/3">
                        <p className={`text-lg leading-relaxed transition-colors opacity-80 ${isDark ? 'text-zinc-300' : 'text-slate-600'}`}>{item.definition}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {/* Right Column: Quiz with 0.2s stagger delay */}
            <div className="lg:col-span-1 space-y-10 animate-spring-up delay-200">
              <div className="sticky top-28">
                <Quiz questions={studyData.quiz} theme={theme} />
                
                <div className="mt-10 p-10 bg-gradient-to-br from-indigo-600 to-indigo-900 rounded-[3rem] text-white shadow-2xl relative overflow-hidden group border border-white/10">
                  <div className="relative z-10">
                    <h4 className="font-black text-2xl mb-4 tracking-tight">Focus & Review</h4>
                    <p className="text-indigo-100 text-lg mb-8 leading-relaxed opacity-90">Ready for a fresh set of notes? Clear the current workspace and start again.</p>
                    <Button 
                      theme={theme}
                      variant="outline" 
                      className="w-full py-4 !border-white/20 !bg-white/10 !text-white hover:!bg-white/20 backdrop-blur-md rounded-2xl" 
                      onClick={reset}
                    >
                      Process New Content
                    </Button>
                  </div>
                  <div className="absolute top-0 right-0 -mr-20 -mt-20 w-56 h-56 bg-white/10 rounded-full blur-3xl transition-transform group-hover:scale-150 duration-[2000ms]"></div>
                  <div className="absolute bottom-0 left-0 -ml-12 -mb-12 w-40 h-40 bg-indigo-400/20 rounded-full blur-2xl"></div>
                </div>

                <div className="mt-8 flex justify-center">
                  <p className={`text-[11px] font-black uppercase tracking-[0.4em] transition-colors ${isDark ? 'text-zinc-700' : 'text-slate-300'}`}>Powered by Gemini 2.0</p>
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
