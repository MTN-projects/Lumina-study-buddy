
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { AppState, StudyData, ChatMessage, StudySession } from './types';
import { processLectureNotes, generateSpeech, FileData, askQuestionAboutDocumentStream } from './services/geminiService';
import { Button } from './components/Button';
import { Quiz } from './components/Quiz';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

// Helper functions for audio processing
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const App: React.FC = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [state, setState] = useState<AppState>(AppState.IDLE);
  const [notes, setNotes] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<{ name: string; base64: string; mimeType: string } | null>(null);
  const [studyData, setStudyData] = useState<StudyData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  
  // Sidebar & History State
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [savedSessions, setSavedSessions] = useState<StudySession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Export Menu State
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);

  // Chat State
  const [chatLog, setChatLog] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Playback State
  const [playbackState, setPlaybackState] = useState<'idle' | 'playing' | 'paused'>('idle');
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [prefetchedBuffer, setPrefetchedBuffer] = useState<AudioBuffer | null>(null);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const playedOffsetRef = useRef<number>(0);
  
  const exportRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isDark = theme === 'dark';

  // Load History Effect
  useEffect(() => {
    const history = localStorage.getItem('lumina_history_v2');
    if (history) {
      try {
        setSavedSessions(JSON.parse(history));
      } catch (e) {
        console.error("Failed to load study history", e);
      }
    }
  }, []);

  // Sync Chat History to Local Storage when chatLog changes
  useEffect(() => {
    if (activeSessionId && chatLog.length > 0) {
      const updated = savedSessions.map(s => 
        s.id === activeSessionId ? { ...s, chatLog: chatLog } : s
      );
      setSavedSessions(updated);
      localStorage.setItem('lumina_history_v2', JSON.stringify(updated));
    }
  }, [chatLog, activeSessionId]);

  const saveSessionToHistory = (data: StudyData, originalNotes: string, fileName: string) => {
    const newSession: StudySession = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      fileName: fileName || "Untitled Note",
      title: data.title || "AI Generated Study Guide",
      studyData: data,
      chatLog: [],
      originalNotes: originalNotes,
      isPinned: false
    };
    const updatedSessions = [newSession, ...savedSessions];
    setSavedSessions(updatedSessions);
    setActiveSessionId(newSession.id);
    localStorage.setItem('lumina_history_v2', JSON.stringify(updatedSessions));
  };

  const updateHistory = (updated: StudySession[]) => {
    setSavedSessions(updated);
    localStorage.setItem('lumina_history_v2', JSON.stringify(updated));
  };

  const togglePin = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = savedSessions.map(s => s.id === id ? { ...s, isPinned: !s.isPinned } : s);
    updateHistory(updated);
    setActiveMenuId(null);
  };

  const startRename = (session: StudySession, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(session.id);
    setRenameValue(session.title);
    setActiveMenuId(null);
  };

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingId) return;
    const updated = savedSessions.map(s => s.id === renamingId ? { ...s, title: renameValue } : s);
    updateHistory(updated);
    setRenamingId(null);
  };

  const deleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = savedSessions.filter(s => s.id !== id);
    if (activeSessionId === id) reset();
    updateHistory(updated);
    setActiveMenuId(null);
  };

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  const summaryText = useMemo(() => studyData?.summary || "", [studyData?.summary]);

  const prefetchAudio = async (text: string, instruction: string) => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      const base64 = await generateSpeech(text, instruction);
      const audioData = decode(base64);
      const buffer = await decodeAudioData(audioData, audioContextRef.current, 24000, 1);
      setPrefetchedBuffer(buffer);
    } catch (err: any) {
      console.warn("Retrying Premium Voice connection...");
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setError("Please select a PDF file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64String = (reader.result as string).split(',')[1];
      setSelectedFile({ name: file.name, base64: base64String, mimeType: file.type });
      setError(null);
    };
    reader.onerror = () => setError("Failed to read file.");
    reader.readAsDataURL(file);
  };

  const handleCopySummary = async () => {
    if (summaryText) {
      try {
        await navigator.clipboard.writeText(summaryText);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      } catch (err) {}
    }
  };

  const stopAllPlayback = () => {
    if (sourceRef.current) {
      try { 
        sourceRef.current.onended = null; 
        sourceRef.current.stop(); 
      } catch (e) {}
      sourceRef.current = null;
    }
    playedOffsetRef.current = 0;
    setPlaybackState('idle');
  };

  const togglePremiumVoice = async () => {
    const ctx = audioContextRef.current || new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    if (!audioContextRef.current) audioContextRef.current = ctx;

    if (playbackState === 'playing') {
      if (sourceRef.current) {
        const elapsed = ctx.currentTime - startTimeRef.current;
        playedOffsetRef.current += elapsed;
        sourceRef.current.onended = null;
        sourceRef.current.stop();
        sourceRef.current = null;
        setPlaybackState('paused');
      }
      return;
    } else if (playbackState === 'paused' && prefetchedBuffer) {
      playFromBuffer(prefetchedBuffer, playedOffsetRef.current);
      return;
    }

    if (!summaryText) return;

    if (prefetchedBuffer) {
      playFromBuffer(prefetchedBuffer, 0);
      return;
    }

    setIsAudioLoading(true);
    try {
      const base64 = await generateSpeech(summaryText, studyData?.audioInstruction || "");
      const audioData = decode(base64);
      const audioBuffer = await decodeAudioData(audioData, ctx, 24000, 1);
      setPrefetchedBuffer(audioBuffer);
      playFromBuffer(audioBuffer, 0);
    } catch (err: any) {
      console.error("Premium voice busy, retrying...");
    } finally { 
      setIsAudioLoading(false); 
    }
  };

  const playFromBuffer = (buffer: AudioBuffer, offset: number) => {
    if (!audioContextRef.current) return;
    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      if (playbackState === 'playing') {
        playedOffsetRef.current = 0;
        setPlaybackState('idle');
      }
    };
    sourceRef.current = source;
    startTimeRef.current = ctx.currentTime;
    source.start(0, offset % buffer.duration);
    setPlaybackState('playing');
  };

  const handleSendChatMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || isChatLoading) return;
    const userMsg = chatInput.trim();
    setChatInput('');
    
    const newChatHistory: ChatMessage[] = [...chatLog, { role: 'user', content: userMsg }];
    setChatLog(newChatHistory);
    
    setIsChatLoading(true);
    try {
      const fileData: FileData | undefined = selectedFile ? { data: selectedFile.base64, mimeType: selectedFile.mimeType } : undefined;
      const responseStream = await askQuestionAboutDocumentStream(userMsg, newChatHistory.slice(0, -1), notes, fileData);
      
      let fullAnswer = "";
      setChatLog(prev => [...prev, { role: 'model', content: "" }]);
      
      for await (const chunk of responseStream) {
        const text = chunk.text;
        if (text) {
          fullAnswer += text;
          setChatLog(prev => {
            const next = [...prev];
            next[next.length - 1] = { role: 'model', content: fullAnswer };
            return next;
          });
        }
      }
    } catch (err) {
      setChatLog(prev => [...prev, { role: 'model', content: "I encountered a processing error. Could you rephrase your question?" }]);
    } finally { 
      setIsChatLoading(false); 
    }
  };

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [chatLog, isChatLoading]);

  const renderWaterfallMessage = (content: string, role: string) => {
    if (role === 'user') return content;
    const blocks = content.split('\n').filter(b => b.trim().length > 0);
    return blocks.map((block, i) => (
      <div 
        key={i} 
        className="waterfall-block mb-3" 
        style={{ animationDelay: `${i * 150}ms` }}
      >
        {block}
      </div>
    ));
  };

  const handleDownloadPDF = async () => {
    if (!studyData || !exportRef.current) return;
    setIsDownloading(true);
    setIsExportMenuOpen(false);
    try {
      const element = exportRef.current;
      element.style.display = 'block';
      const canvas = await html2canvas(element, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      pdf.addImage(imgData, 'PNG', 0, 0, pdf.internal.pageSize.getWidth(), (canvas.height * pdf.internal.pageSize.getWidth()) / canvas.width);
      pdf.save(`${studyData.title || 'Lumina_Study_Guide'}.pdf`);
      element.style.display = 'none';
    } catch (err) {
      console.error(err);
    } finally { setIsDownloading(false); }
  };

  const handleExportToNotion = () => {
    if (!studyData) return;
    setIsExportMenuOpen(false);
    const title = studyData.title || 'Study Guide';
    const content = `# ${title}\n\n## Summary\n${summaryText}\n\n## Key Vocabulary\n${studyData.vocabulary.map(v => `- **${v.word}**: ${v.definition}`).join('\n')}`;
    
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/\s+/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportToAnki = () => {
    if (!studyData) return;
    setIsExportMenuOpen(false);
    const title = studyData.title || 'Study_Guide';
    let csv = "Front,Back\n";
    studyData.vocabulary.forEach(v => {
      const front = v.word.replace(/"/g, '""');
      const back = v.definition.replace(/"/g, '""');
      csv += `"${front}","${back}"\n`;
    });
    studyData.quiz.forEach((q, i) => {
      const front = `Question ${i+1}: ${q.question}`.replace(/"/g, '""');
      const back = `Correct Answer: ${q.options[q.correctAnswerIndex]}`.replace(/"/g, '""');
      csv += `"${front}","${back}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    // Fix: Declare the 'a' variable to resolve the "Cannot find name 'a'" error
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/\s+/g, '_')}_Anki.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSubmit = async () => {
    if (!notes.trim() && !selectedFile) return;
    setState(AppState.LOADING);
    setError(null);
    setPrefetchedBuffer(null);
    setChatLog([]);
    setActiveSessionId(null);
    stopAllPlayback();
    try {
      const fileData: FileData | undefined = selectedFile ? { data: selectedFile.base64, mimeType: selectedFile.mimeType } : undefined;
      const data = await processLectureNotes(notes, fileData);
      setStudyData(data);
      setState(AppState.SUCCESS);
      prefetchAudio(data.summary, data.audioInstruction);
      saveSessionToHistory(data, notes, selectedFile?.name || "Text Snippet");
    } catch (err) {
      setError("An error occurred while processing your material.");
      setState(AppState.ERROR);
    }
  };

  const loadSession = (session: StudySession) => {
    stopAllPlayback();
    setStudyData(session.studyData);
    setNotes(session.originalNotes);
    setChatLog(session.chatLog || []);
    setActiveSessionId(session.id);
    setState(AppState.SUCCESS);
    prefetchAudio(session.studyData.summary, session.studyData.audioInstruction);
    setIsSidebarOpen(false);
  };

  const reset = () => {
    stopAllPlayback();
    setState(AppState.IDLE);
    setNotes('');
    setSelectedFile(null);
    setStudyData(null);
    setError(null);
    setChatLog([]);
    setActiveSessionId(null);
    setPrefetchedBuffer(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const glassCardClass = isDark 
    ? "bg-zinc-900/40 backdrop-blur-xl border border-white/10 shadow-2xl" 
    : "bg-white/70 backdrop-blur-xl border border-slate-200 shadow-xl";

  const getPlaybackLabel = () => {
    if (isAudioLoading) return '✨ GENERATING...';
    if (playbackState === 'playing') return 'PAUSE AUDIO';
    if (playbackState === 'paused') return 'RESUME AUDIO';
    return 'PLAY SUMMARY';
  };

  const pinnedSessions = savedSessions.filter(s => s.isPinned);
  const recentSessions = savedSessions.filter(s => !s.isPinned);

  const SessionItem: React.FC<{ session: StudySession }> = ({ session }) => (
    <div className="relative group/item mb-3">
      <button 
        onClick={() => loadSession(session)}
        className={`w-full text-left p-5 rounded-3xl border transition-all duration-300 hover:scale-[1.02] ${isDark ? 'bg-white/5 border-white/5 hover:border-white/10 hover:bg-white/10' : 'bg-slate-50 border-slate-100 hover:bg-slate-100/50'} ${activeSessionId === session.id ? (isDark ? 'bg-white/10 border-indigo-500/50' : 'bg-slate-100 border-indigo-500/50') : ''}`}
      >
        {renamingId === session.id ? (
          <form onSubmit={handleRenameSubmit} className="relative z-10" onClick={e => e.stopPropagation()}>
            <input 
              autoFocus
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onBlur={handleRenameSubmit}
              className={`w-full bg-transparent border-b outline-none text-sm font-bold ${isDark ? 'border-indigo-500 text-white' : 'border-indigo-600 text-slate-900'}`}
            />
          </form>
        ) : (
          <>
            <div className="font-bold text-sm truncate mb-1 pr-6">{session.title}</div>
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-widest opacity-40 font-black">{new Date(session.timestamp).toLocaleDateString()}</div>
              {session.isPinned && (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-indigo-400" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z" />
                </svg>
              )}
            </div>
          </>
        )}
      </button>

      <button 
        onClick={(e) => { e.stopPropagation(); setActiveMenuId(activeMenuId === session.id ? null : session.id); }}
        className={`absolute top-4 right-3 p-1 rounded-md opacity-0 group-hover/item:opacity-100 transition-opacity ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
        </svg>
      </button>

      {activeMenuId === session.id && (
        <div className={`absolute right-3 top-10 z-[60] w-40 py-2 rounded-2xl shadow-2xl backdrop-blur-3xl animate-spring-up origin-top-right border ${isDark ? 'bg-indigo-950/80 border-white/10 shadow-black' : 'bg-white/95 border-slate-200 shadow-slate-200'}`}>
          <button onClick={(e) => togglePin(session.id, e)} className={`w-full px-4 py-2 text-left text-xs font-bold flex items-center gap-3 transition-colors ${isDark ? 'hover:bg-white/10 text-zinc-300' : 'hover:bg-slate-100 text-slate-700'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg>
            {session.isPinned ? 'Unpin' : 'Pin'}
          </button>
          <button onClick={(e) => startRename(session, e)} className={`w-full px-4 py-2 text-left text-xs font-bold flex items-center gap-3 transition-colors ${isDark ? 'hover:bg-white/10 text-zinc-300' : 'hover:bg-slate-100 text-slate-700'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
            Rename
          </button>
          <button onClick={(e) => deleteSession(session.id, e)} className={`w-full px-4 py-2 text-left text-xs font-bold flex items-center gap-3 transition-colors hover:bg-rose-500/10 text-rose-500`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            Delete
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className={`min-h-screen pb-20 transition-all duration-700 relative overflow-hidden flex ${isDark ? 'bg-[#0a0a0c] text-slate-200' : 'bg-slate-50 text-slate-900'}`}>
      <aside 
        onClick={() => setActiveMenuId(null)}
        className={`fixed inset-y-0 left-0 z-50 w-80 transform transition-transform duration-500 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} ${isDark ? 'bg-indigo-950/40 border-r border-white/5 shadow-indigo-900/20' : 'bg-white/95 border-r border-slate-200 shadow-slate-200'} backdrop-blur-3xl shadow-2xl overflow-hidden flex flex-col`}
      >
        <div className="p-6 border-b border-white/5 flex items-center justify-between">
          <h2 className="font-black text-xs uppercase tracking-[0.3em] opacity-40">History</h2>
          <button onClick={() => setIsSidebarOpen(false)} className="opacity-40 hover:opacity-100 transition-opacity">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
          </button>
        </div>
        
        <div className="p-4 flex-1 overflow-y-auto space-y-6 custom-scrollbar">
          <Button theme={theme} variant="outline" className="w-full py-4 rounded-2xl border-white/10 bg-indigo-500/5 hover:bg-indigo-500/10 transition-all font-black text-[10px] tracking-widest" onClick={reset}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" /></svg>
            NEW SESSION
          </Button>
          
          {pinnedSessions.length > 0 && (
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] opacity-30 mb-4 px-2">Pinned</h3>
              {pinnedSessions.map(session => <SessionItem key={session.id} session={session} />)}
            </div>
          )}

          <div>
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] opacity-30 mb-4 px-2">Recent</h3>
            {recentSessions.length === 0 && pinnedSessions.length === 0 ? (
              <div className="text-center py-20 opacity-20 italic text-sm">Empty History</div>
            ) : (
              recentSessions.map(session => <SessionItem key={session.id} session={session} />)
            )}
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0" onClick={() => { setActiveMenuId(null); setIsExportMenuOpen(false); }}>
        {isDark && (
          <>
            <div className="glow-orb animate-float fixed top-[-10%] left-[-5%] w-[500px] h-[500px] bg-purple-600/20 rounded-full blur-[120px] pointer-events-none -z-10" />
            <div className="glow-orb animate-float-delayed fixed bottom-[-10%] right-[-5%] w-[600px] h-[600px] bg-indigo-600/20 rounded-full blur-[120px] pointer-events-none -z-10" />
          </>
        )}

        <header className={`backdrop-blur-2xl border-b sticky top-0 z-30 transition-all duration-500 ${isDark ? 'bg-black/40 border-white/5' : 'bg-white/70 border-slate-200'}`}>
          <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={(e) => { e.stopPropagation(); setIsSidebarOpen(true); }} className="p-2 hover:bg-white/5 rounded-xl transition-all">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
              </button>
              <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/30">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 20 20" fill="currentColor"><path d="M10.394 2.827a1 1 0 00-.788 0l-7 3a1 1 0 000 1.848l7 3a1 1 0 00.788 0l7-3a1 1 0 000-1.848l-7-3zM14 9.528v2.736a1 1 0 01-.529.883L10 14.613l-3.471-1.466A1 1 0 016 12.264V9.528l4 1.714 4-1.714z" /></svg>
              </div>
              <h1 className={`breakthrough-text text-xl font-bold tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>Lumina</h1>
            </div>
            
            <div className="flex items-center gap-3">
              <button onClick={toggleTheme} className={`p-2.5 rounded-full transition-all active:scale-90 ${isDark ? 'bg-white/5 text-yellow-400' : 'bg-slate-100 text-indigo-600'}`}>
                {isDark ? <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" /></svg> : <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" /></svg>}
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 mt-16 relative z-10 w-full">
          {state === AppState.IDLE || state === AppState.ERROR ? (
            <div className="max-w-3xl mx-auto space-y-16 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <div className="text-center space-y-6">
                <h2 className={`text-5xl md:text-6xl font-black leading-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>Study Smarter.</h2>
                <p className={`text-xl md:text-2xl opacity-80 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>Transform notes into synthesized study material in seconds.</p>
              </div>

              <div className={`p-10 rounded-[3rem] shadow-2xl space-y-10 ${glassCardClass}`}>
                <div className="space-y-4">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-black uppercase tracking-[0.2em] opacity-40 ml-1">Notes or PDF</label>
                    {selectedFile && (
                      <div className="flex items-center gap-2 px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded-full">
                         <span className="text-[10px] font-bold text-indigo-400 uppercase truncate max-w-[150px]">{selectedFile.name}</span>
                         <button onClick={() => setSelectedFile(null)} className="text-indigo-400 hover:text-white transition-colors"><svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l18 18" /></svg></button>
                      </div>
                    )}
                  </div>
                  <textarea className={`w-full h-64 p-8 border rounded-[2rem] focus:ring-2 focus:ring-indigo-500/50 outline-none resize-none text-lg leading-relaxed ${isDark ? 'bg-black/30 border-white/5 text-zinc-100 placeholder-zinc-700' : 'bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400'}`} placeholder="Paste notes here..." value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
                <div className="flex flex-col sm:flex-row gap-4 justify-center items-stretch">
                  <input type="file" accept="application/pdf" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                  <Button theme={theme} variant="outline" className="w-full sm:max-w-[200px] py-5 text-lg rounded-2xl border-indigo-600/30 text-indigo-400" onClick={() => fileInputRef.current?.click()}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg> Upload PDF
                  </Button>
                  <Button theme={theme} className="w-full sm:max-w-md py-5 text-lg rounded-2xl bg-indigo-600 font-black tracking-widest text-xs uppercase" onClick={handleSubmit} disabled={!notes.trim() && !selectedFile}>Generate Guide</Button>
                </div>
                {error && <div className="p-5 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-400 text-sm">{error}</div>}
              </div>
            </div>
          ) : state === AppState.LOADING ? (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-10">
              <div className="relative">
                <div className={`w-32 h-32 border-4 rounded-full ${isDark ? 'border-white/5' : 'border-slate-200'}`}></div>
                <div className="absolute top-0 left-0 w-32 h-32 border-t-4 border-indigo-500 rounded-full animate-spin"></div>
              </div>
              <h3 className={`text-3xl font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Crafting Material...</h3>
            </div>
          ) : studyData ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 pb-20">
              <div className="lg:col-span-2 space-y-12">
                <section className={`p-10 md:p-12 rounded-[3.5rem] relative overflow-hidden transition-all animate-spring-up ${glassCardClass}`}>
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10 relative z-10">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-indigo-500/20 text-indigo-400 rounded-2xl">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      </div>
                      <h2 className={`text-3xl font-black tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>Summary</h2>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-2 p-1 bg-black/10 rounded-2xl border border-white/5 backdrop-blur-md">
                        <button 
                          onClick={togglePremiumVoice} 
                          disabled={isAudioLoading} 
                          className={`px-6 py-2.5 rounded-xl transition-all flex items-center gap-3 text-[10px] font-black tracking-widest uppercase relative overflow-hidden ${playbackState === 'playing' ? 'bg-indigo-600 text-white shadow-lg' : 'hover:bg-white/5 text-zinc-400'}`}
                        >
                          {isAudioLoading ? <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> : (playbackState === 'playing' ? <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 011-1h2a1 1 0 110 2H8a1 1 0 01-1-1zm4 0a1 1 0 011-1h2a1 1 0 110 2h-2a1 1 0 01-1-1z" clipRule="evenodd" /></svg> : <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>)}
                          <span>{getPlaybackLabel()}</span>
                        </button>
                        {playbackState !== 'idle' && (
                          <button onClick={stopAllPlayback} className="w-9 h-9 flex items-center justify-center rounded-xl bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 transition-all">
                             <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><rect x="6" y="6" width="8" height="8" rx="1" /></svg>
                          </button>
                        )}
                      </div>
                      <Button theme={theme} variant="secondary" className={`px-5 py-2.5 text-xs font-black rounded-full border ${isCopied ? 'text-green-400 border-green-500/30' : ''}`} onClick={handleCopySummary}>{isCopied ? 'COPIED' : 'COPY'}</Button>
                    </div>
                  </div>
                  <div className={`text-xl leading-relaxed relative z-10 whitespace-pre-wrap ${isDark ? 'text-zinc-200' : 'text-slate-700'}`}>
                    {summaryText}
                  </div>
                </section>

                <section className={`p-10 md:p-12 rounded-[3.5rem] transition-all animate-spring-up delay-200 ${glassCardClass}`}>
                  <div className="flex items-center gap-5 mb-8">
                    <div className="p-3 bg-purple-500/20 text-purple-400 rounded-2xl">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                    </div>
                    <h2 className={`text-3xl font-black tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>Interactive Chat</h2>
                  </div>
                  
                  <div className={`flex flex-col h-[550px] border rounded-[2.5rem] overflow-hidden ${isDark ? 'bg-black/20 border-white/5 shadow-inner' : 'bg-white/50 border-slate-200 shadow-inner'}`}>
                    <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar scroll-smooth">
                      {chatLog.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center opacity-30 text-center px-10">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                          <p className="text-lg font-medium">Lumina is ready. Ask anything about your notes or the summary above.</p>
                        </div>
                      ) : (
                        chatLog.map((msg, i) => (
                          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-message`}>
                            <div className={`max-w-[85%] px-5 py-3.5 rounded-2xl text-[15px] leading-relaxed shadow-lg ${msg.role === 'user' ? 'bg-indigo-600 text-white' : isDark ? 'bg-zinc-800/80 text-zinc-200 border border-white/5' : 'bg-white text-slate-800 border border-slate-200'}`}>
                              {renderWaterfallMessage(msg.content, msg.role)}
                            </div>
                          </div>
                        ))
                      )}
                      {isChatLoading && (
                        <div className="flex justify-start animate-message">
                          <div className={`px-5 py-4 rounded-2xl flex gap-1.5 items-center ${isDark ? 'bg-zinc-800/80 border border-white/5' : 'bg-white border border-slate-200'}`}>
                            <span className="typing-dot"></span><span className="typing-dot"></span><span className="typing-dot"></span>
                          </div>
                        </div>
                      )}
                    </div>
                    <form onSubmit={handleSendChatMessage} className={`p-6 border-t ${isDark ? 'border-white/5 bg-black/40' : 'border-slate-200 bg-white/40'}`}>
                      <div className="flex gap-4">
                        <input 
                          type="text" 
                          value={chatInput} 
                          onChange={(e) => setChatInput(e.target.value)} 
                          disabled={isChatLoading} 
                          placeholder="Type a question..." 
                          className={`flex-1 px-6 py-4 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all input-glow-pulse ${isDark ? 'bg-white/5 border border-white/10 text-zinc-100' : 'bg-slate-50 border border-slate-200 text-slate-800'}`} 
                        />
                        <button 
                          type="submit" 
                          disabled={!chatInput.trim() || isChatLoading} 
                          className={`w-14 h-14 rounded-2xl transition-all flex items-center justify-center hover:scale-[1.05] active:scale-95 ${!chatInput.trim() || isChatLoading ? 'opacity-30 bg-zinc-700' : 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'}`}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" /></svg>
                        </button>
                      </div>
                    </form>
                  </div>
                </section>

                <section className={`p-10 md:p-12 rounded-[3.5rem] transition-all animate-spring-up delay-400 ${glassCardClass}`}>
                  <div className="flex items-center gap-5 mb-12">
                    <div className="p-3 bg-amber-500/20 text-amber-500 rounded-2xl">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                    </div>
                    <h2 className={`text-3xl font-black tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>Key Terms</h2>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {studyData.vocabulary.map((item, idx) => (
                      <div key={idx} className={`animate-vocab flex flex-col gap-4 p-8 rounded-3xl border transition-all duration-500 ${isDark ? 'bg-white/5 border-white/5 hover:border-white/10' : 'bg-slate-50 border-slate-100'}`} style={{ animationDelay: `${idx * 150}ms` }}>
                        <span className={`font-black uppercase text-xs tracking-[0.3em] ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`}>{item.word}</span>
                        <p className={`text-sm transition-colors opacity-80 leading-relaxed ${isDark ? 'text-zinc-300' : 'text-slate-600'}`}>{item.definition}</p>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <div className="lg:col-span-1 space-y-10 animate-spring-up delay-200">
                <div className="sticky top-28">
                  <Quiz questions={studyData.quiz} theme={theme} />
                  <div className="mt-10 p-10 bg-gradient-to-br from-indigo-600 to-indigo-900 rounded-[3rem] text-white shadow-2xl relative overflow-hidden group border border-white/10">
                    <div className="relative z-10">
                      <h4 className="font-black text-2xl mb-4 tracking-tight">Review Session</h4>
                      <div className="space-y-4">
                        <Button theme={theme} variant="outline" className="w-full py-4 !border-white/20 !bg-white/10 !text-white hover:!bg-white/20 rounded-2xl font-black text-[10px] tracking-widest" onClick={reset}>NEW SESSION</Button>
                        <Button theme={theme} variant="primary" className="w-full py-4 bg-white text-indigo-900 hover:bg-slate-100 rounded-2xl border-none font-black text-[10px] tracking-widest flex items-center gap-2 justify-center" onClick={(e) => { e.stopPropagation(); setIsExportMenuOpen(!isExportMenuOpen); }} isLoading={isDownloading}>
                          {!isDownloading && <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>} EXPORT GUIDE
                        </Button>
                        {isExportMenuOpen && (
                          <div className={`absolute bottom-full mb-2 left-0 w-full rounded-2xl shadow-2xl backdrop-blur-3xl animate-spring-up border flex flex-col overflow-hidden ${isDark ? 'bg-indigo-950/90 border-white/10' : 'bg-white/95 border-slate-200'}`}>
                            <button onClick={handleDownloadPDF} className={`w-full px-5 py-4 text-left text-xs font-black flex items-center gap-4 transition-colors tracking-widest uppercase ${isDark ? 'hover:bg-white/10 text-zinc-300' : 'hover:bg-slate-100 text-slate-700'}`}>PDF Document</button>
                            <button onClick={handleExportToNotion} className="w-full px-5 py-4 text-left text-xs font-black flex items-center gap-4 transition-colors tracking-widest uppercase border-t border-white/5">Notion (.md)</button>
                            <button onClick={handleExportToAnki} className="w-full px-5 py-4 text-left text-xs font-black flex items-center gap-4 transition-colors tracking-widest uppercase border-t border-white/5">Flashcards (.csv)</button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          <div ref={exportRef} style={{ display: 'none', width: '800px', padding: '40px', backgroundColor: '#ffffff', color: '#000000', fontFamily: 'Inter, sans-serif' }}>
            <h1 style={{ fontSize: '32px', margin: '0', fontWeight: '800', borderBottom: '4px solid #000', paddingBottom: '20px', marginBottom: '30px' }}>STUDY GUIDE</h1>
            <h2 style={{ fontSize: '20px', borderBottom: '2px solid #000', display: 'inline-block', marginBottom: '15px', paddingBottom: '5px' }}>SUMMARY</h2>
            <p style={{ fontSize: '14px', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>{summaryText}</p>
            <h2 style={{ fontSize: '20px', borderBottom: '2px solid #000', display: 'inline-block', marginBottom: '15px', paddingBottom: '5px' }}>KEY TERMS</h2>
            {studyData?.vocabulary.map((v, i) => (<div key={i} style={{ marginBottom: '15px' }}><div style={{ fontWeight: 'bold', fontSize: '14px', textTransform: 'uppercase' }}>{v.word}</div><div style={{ fontSize: '13px', lineHeight: '1.4' }}>{v.definition}</div></div>))}
            <h2 style={{ fontSize: '20px', borderBottom: '2px solid #000', display: 'inline-block', marginBottom: '15px', paddingBottom: '5px' }}>QUIZ</h2>
            {studyData?.quiz.map((q, i) => (<div key={i} style={{ marginBottom: '20px' }}><div style={{ fontWeight: '600', fontSize: '14px', marginBottom: '8px' }}>{i + 1}. {q.question}</div>{q.options.map((opt, optI) => (<div key={optI} style={{ fontSize: '13px', marginLeft: '15px', marginBottom: '4px' }}>[{String.fromCharCode(65 + optI)}] {opt}</div>))}</div>))}
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;
