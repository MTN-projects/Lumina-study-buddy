
import React, { useState, useRef } from 'react';
import { AppState, StudyData } from './types';
import { processLectureNotes } from './services/geminiService';
import { Button } from './components/Button';
import { Quiz } from './components/Quiz';

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(AppState.IDLE);
  const [notes, setNotes] = useState<string>('');
  const [studyData, setStudyData] = useState<StudyData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setNotes(content);
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
    <div className="min-h-screen pb-20">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.394 2.827a1 1 0 00-.788 0l-7 3a1 1 0 000 1.848l7 3a1 1 0 00.788 0l7-3a1 1 0 000-1.848l-7-3zM14 9.528v2.736a1 1 0 01-.529.883L10 14.613l-3.471-1.466A1 1 0 016 12.264V9.528l4 1.714 4-1.714z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-slate-800 tracking-tight">Lumina Study Buddy</h1>
          </div>
          {state !== AppState.IDLE && (
            <Button variant="ghost" onClick={reset}>New Session</Button>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 mt-8">
        {state === AppState.IDLE || state === AppState.ERROR ? (
          <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in duration-500">
            <div className="text-center space-y-2">
              <h2 className="text-3xl font-extrabold text-slate-900">Transform your notes.</h2>
              <p className="text-slate-500 text-lg">Upload your lecture materials and get a personalized study guide in seconds.</p>
            </div>

            <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-xl shadow-slate-200/50 space-y-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Paste your lecture notes here</label>
                <textarea
                  className="w-full h-48 p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none resize-none text-slate-700"
                  placeholder="Paste text from your lectures or PDFs..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-4">
                <div className="flex-1 h-px bg-slate-100"></div>
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">or</span>
                <div className="flex-1 h-px bg-slate-100"></div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4">
                <Button 
                  variant="outline" 
                  className="flex-1 py-3"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Upload TXT File
                </Button>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept=".txt" 
                  onChange={handleFileUpload}
                />
                
                <Button 
                  className="flex-1 py-3" 
                  onClick={handleSubmit}
                  disabled={!notes.trim()}
                >
                  Generate Study Guide
                </Button>
              </div>

              {error && (
                <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  {error}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-8">
              {[
                { title: "Smart Summary", desc: "Get the essence of long lectures instantly.", icon: "📝" },
                { title: "Key Vocabulary", desc: "Master the essential terms of your subject.", icon: "📖" },
                { title: "Quick Quiz", desc: "Test your knowledge with 3 targeted MCQs.", icon: "⚡" }
              ].map((item, i) => (
                <div key={i} className="text-center p-4">
                  <div className="text-3xl mb-2">{item.icon}</div>
                  <h4 className="font-bold text-slate-800 mb-1">{item.title}</h4>
                  <p className="text-sm text-slate-500">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        ) : state === AppState.LOADING ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6">
            <div className="relative">
              <div className="w-20 h-20 border-4 border-indigo-100 rounded-full animate-pulse"></div>
              <div className="absolute top-0 left-0 w-20 h-20 border-t-4 border-indigo-600 rounded-full animate-spin"></div>
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-xl font-bold text-slate-800">Processing Your Notes...</h3>
              <p className="text-slate-500">Gemini is extracting the most important insights.</p>
            </div>
          </div>
        ) : studyData ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pb-20 animate-in slide-in-from-bottom-4 duration-700">
            {/* Left Column: Summary & Vocab */}
            <div className="lg:col-span-2 space-y-8">
              <section className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <h2 className="text-2xl font-bold text-slate-800">Lecture Summary</h2>
                  </div>
                  <Button 
                    variant="ghost" 
                    className={`text-xs gap-2 ${isCopied ? 'text-green-600' : 'text-slate-500'}`}
                    onClick={handleCopySummary}
                  >
                    {isCopied ? (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        Copied!
                      </>
                    ) : (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m-3 8h3m-3 4h3" />
                        </svg>
                        Copy
                      </>
                    )}
                  </Button>
                </div>
                <div className="prose prose-slate max-w-none text-slate-600 leading-relaxed">
                  {studyData.summary}
                </div>
              </section>

              <section className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-amber-50 text-amber-600 rounded-lg">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-bold text-slate-800">Key Vocabulary</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
                  {studyData.vocabulary.map((item, idx) => (
                    <div key={idx} className="flex flex-col md:flex-row gap-2 md:gap-6 p-4 rounded-2xl bg-slate-50 group hover:bg-white hover:shadow-md transition-all duration-300 border border-transparent hover:border-slate-100">
                      <div className="md:w-1/4">
                        <span className="font-bold text-indigo-600 uppercase text-sm tracking-wider">{item.word}</span>
                      </div>
                      <div className="md:w-3/4">
                        <p className="text-slate-600">{item.definition}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {/* Right Column: Quiz */}
            <div className="lg:col-span-1 space-y-6">
              <div className="sticky top-24">
                <Quiz questions={studyData.quiz} />
                
                <div className="mt-8 p-6 bg-indigo-900 rounded-3xl text-white overflow-hidden relative">
                  <div className="relative z-10">
                    <h4 className="font-bold text-lg mb-2">Ready for more?</h4>
                    <p className="text-indigo-200 text-sm mb-4">You can always refresh your notes or upload new ones to keep learning.</p>
                    <Button variant="outline" className="w-full !border-indigo-400 !text-white hover:!bg-indigo-800" onClick={reset}>
                      Start New Session
                    </Button>
                  </div>
                  <div className="absolute top-0 right-0 -mr-8 -mt-8 w-32 h-32 bg-indigo-700 rounded-full opacity-50 blur-2xl"></div>
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
