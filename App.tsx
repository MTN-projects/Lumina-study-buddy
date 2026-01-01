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
  
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [savedSessions, setSavedSessions] = useState<StudySession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);

  const [chatLog, setChatLog] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const [playbackState, setPlaybackState] = useState<'idle' | 'playing' | 'paused'>('idle');
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [isQuotaExceeded, setIsQuotaExceeded] = useState(false);
  const [prefetchedBuffer, setPrefetchedBuffer] = useState<AudioBuffer | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const playedOffsetRef = useRef<number>(0);

  const [readerStatus, setReaderStatus] = useState<'idle' | 'playing' | 'paused'>('idle');
  const [readerCharIndex, setReaderCharIndex] = useState(-1);
  const readerUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const exportRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isDark = theme === 'dark';

  const pinnedSessions = useMemo(() => savedSessions.filter(s => s.isPinned), [savedSessions]);
  const recentSessions = useMemo(() => savedSessions.filter(s => !s.isPinned), [savedSessions]);

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

  useEffect(() => {
    if (activeSessionId && chatLog.length > 0) {
      const updated = savedSessions.map(s => 
        s.id === activeSessionId ? { ...s, chatLog: chatLog } : s
      );
      setSavedSessions(updated);
      localStorage.setItem('lumina_history_v2', JSON.stringify(updated));
    }
  }, [chatLog, activeSessionId]);

  const resetAudio = (clearPrefetch = true) => {
    if (sourceRef.current) {
      try {
        sourceRef.current.onended = null;
        sourceRef.current.stop();
      } catch (e) {}
      sourceRef.current = null;
    }
    playedOffsetRef.current = 0;
    setPlaybackState('idle');

    // Safe Speech Synthesis Cancellation
    if (window.speechSynthesis.speaking) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {
        console.debug("Silent catch: Speech synthesis cancel failed", e);
      }
    }
    setReaderStatus('idle');
    setReaderCharIndex(-1);
    readerUtteranceRef.current = null;

    if (clearPrefetch) {
      setPrefetchedBuffer(null);
    }
  };

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  const summaryText = useMemo(() => studyData?.summary || "", [studyData?.summary]);

  const prefetchAudio = async (text: string, instruction: string) => {
    if (isQuotaExceeded) return;
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      const base64 = await generateSpeech(text, instruction);
      const audioData = decode(base64);
      const buffer = await decodeAudioData(audioData, audioContextRef.current, 24000, 1);
      setPrefetchedBuffer(buffer);
      setIsQuotaExceeded(false);
    } catch (err: any) {
      if (err?.message?.includes('429')) {
        setIsQuotaExceeded(true);
      }
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

  const handleToggleReader = () => {
    if (readerStatus === 'playing') {
      window.speechSynthesis.pause();
      setReaderStatus('paused');
      return;
    }

    if (readerStatus === 'paused') {
      window.speechSynthesis.resume();
      setReaderStatus('playing');
      return;
    }

    if (!summaryText) return;

    if (playbackState === 'playing') {
      resetAudio(false);
    }

    // Pass the text to SpeechSynthesis, it handles basic markers but we map the indices manually
    const utterance = new SpeechSynthesisUtterance(summaryText);
    utterance.lang = studyData?.languageCode || 'en-US';
    
    utterance.onboundary = (event) => {
      if (event.name === 'word') {
        setReaderCharIndex(event.charIndex);
      }
    };

    utterance.onend = () => {
      setReaderStatus('idle');
      setReaderCharIndex(-1);
      readerUtteranceRef.current = null;
    };

    utterance.onerror = (err) => {
      // Ignore 'interrupted' errors caused by manual cancellation
      if ((err as any).error === 'interrupted') return;
      console.error("Speech Synthesis Error:", err);
      setReaderStatus('idle');
      setReaderCharIndex(-1);
      readerUtteranceRef.current = null;
    };

    readerUtteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    setReaderStatus('playing');
  };

  /**
   * Word-level and Paragraph segmenting.
   * Tracks absolute global character offsets to ensure perfect sync with TTS boundary events.
   */
  const wordSegments = useMemo(() => {
    if (!summaryText) return [];
    // Split by markers, newline patterns, or word tokens
    const parts = summaryText.split(/(\*\*|\n\n|\n|\w+)/g);
    let currentPos = 0;
    let isBold = false;
    
    return parts.filter(p => p !== undefined && p.length > 0).map(part => {
      const start = currentPos;
      const end = currentPos + part.length;
      currentPos = end;
      
      if (part === '**') {
        isBold = !isBold;
        return { text: part, start, end, type: 'marker', isBold };
      }
      
      if (part === '\n\n') return { text: part, start, end, type: 'parabreak' };
      if (part === '\n') return { text: part, start, end, type: 'linebreak' };

      const isWord = /\w/.test(part);
      return { text: part, start, end, type: isWord ? 'word' : 'text', isBold };
    });
  }, [summaryText]);

  /**
   * Re-groups content segments into separate paragraphs for structured display.
   */
  const summaryParagraphs = useMemo(() => {
    const p: any[][] = [[]];
    wordSegments.forEach(seg => {
      if (seg.type === 'parabreak') {
        p.push([]);
      } else {
        p[p.length - 1].push(seg);
      }
    });
    // Remove empty paragraphs
    return p.filter(para => para.length > 0);
  }, [wordSegments]);

  const renderSummaryWithHighlight = () => {
    if (!summaryText) return null;
    
    return (
      <div className="space-y-8">
        {summaryParagraphs.map((para, pIdx) => (
          <p key={pIdx} className={`leading-relaxed relative z-10 ${pIdx === 0 ? 'text-2xl font-medium' : 'text-xl'}`}>
            {para.map((seg, sIdx) => {
              const isActive = seg.type === 'word' && readerCharIndex >= seg.start && readerCharIndex < seg.end;
              
              // Hide formatting markers but keep them in DOM for index alignment
              if (seg.type === 'marker') {
                return <span key={sIdx} className="hidden">{seg.text}</span>;
              }

              return (
                <span 
                  key={sIdx} 
                  className={`
                    ${seg.type === 'word' ? `word-span ${isActive ? (isDark ? 'active-word' : 'active-word-light') : ''}` : ''} 
                    ${seg.isBold ? (isDark ? 'text-indigo-400 font-black' : 'text-[#1A237E] font-black') : ''}
                  `}
                >
                  {seg.text}
                </span>
              );
            })}
          </p>
        ))}
      </div>
    );
  };

  const playFromBuffer = (buffer: AudioBuffer, offset: number) => {
    if (!audioContextRef.current) return;
    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    
    source.onended = () => {
      if (sourceRef.current === source) {
        playedOffsetRef.current = 0;
        setPlaybackState('idle');
        sourceRef.current = null;
      }
    };

    sourceRef.current = source;
    startTimeRef.current = ctx.currentTime;
    source.start(0, offset % buffer.duration);
    setPlaybackState('playing');
  };

  const togglePremiumVoice = async () => {
    if (isQuotaExceeded) return;

    if (readerStatus !== 'idle') {
      if (window.speechSynthesis.speaking) {
        try {
          window.speechSynthesis.cancel();
        } catch (e) {}
      }
      setReaderStatus('idle');
      setReaderCharIndex(-1);
    }

    const ctx = audioContextRef.current || new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    if (!audioContextRef.current) audioContextRef.current = ctx;

    if (playbackState === 'playing') {
      if (sourceRef.current) {
        const elapsed = ctx.currentTime - startTimeRef.current;
        playedOffsetRef.current += elapsed;
        sourceRef.current.onended = null;
        try { sourceRef.current.stop(); } catch (e) {}
        sourceRef.current = null;
        setPlaybackState('paused');
      }
      return;
    }

    if (playbackState === 'paused' && prefetchedBuffer) {
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
      setIsQuotaExceeded(false);
      playFromBuffer(audioBuffer, 0);
    } catch (err: any) {
      console.error("Premium voice failed:", err);
      if (err?.message?.includes('429')) {
        setIsQuotaExceeded(true);
      }
      setPlaybackState('idle');
    } finally { 
      setIsAudioLoading(false); 
    }
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
      const responseStream = await askQuestionAboutDocumentStream(userMsg, newChatHistory.slice(0, -1), studyData?.summary || "", fileData);
      
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

  const handleDownloadPDF = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!studyData || !exportRef.current) return;
    setIsDownloading(true);
    setIsExportMenuOpen(false);
    
    try {
      const element = exportRef.current;
      element.style.position = 'fixed';
      element.style.top = '0';
      element.style.left = '0';
      element.style.width = '794px';
      element.style.transform = 'translateX(-200%)';
      element.style.display = 'block';
      element.style.background = '#ffffff';
      
      await new Promise(r => setTimeout(r, 200));

      const canvas = await html2canvas(element, { 
        scale: 2, 
        useCORS: true, 
        backgroundColor: '#ffffff',
        logging: false,
        windowWidth: 794
      });
      
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const pdf = new jsPDF('p', 'pt', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pdfWidth;
      const imgHeight = (canvas.height * pdfWidth) / canvas.width;
      
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pdfHeight;

      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
        heightLeft -= pdfHeight;
      }
      
      pdf.save(`${studyData.title?.replace(/\s+/g, '_') || 'Lumina_Study_Guide'}.pdf`);
      
      element.style.display = 'none';
      element.style.position = '';
      element.style.transform = '';
    } catch (err) {
      console.error("PDF Export failed:", err);
      setError("Failed to generate PDF.");
    } finally { 
      setIsDownloading(false); 
    }
  };

  const handleExportToNotion = () => {
    if (!studyData) return;
    const content = `# ${studyData.title}\n\n## Summary\n${studyData.summary}\n\n## Vocabulary\n${studyData.vocabulary.map(v => `- **${v.word}**: ${v.definition}`).join('\n')}`;
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${studyData.title?.replace(/\s+/g, '_') || 'Lumina_Study_Guide'}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setIsExportMenuOpen(false);
  };

  const handleExportToAnki = () => {
    if (!studyData) return;
    const csvContent = studyData.quiz.map(q => 
      `"${q.question}","${q.options[q.correctAnswerIndex]} (Options: ${q.options.join('|')})"`
    ).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${studyData.title?.replace(/\s+/g, '_') || 'Lumina_Flashcards'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setIsExportMenuOpen(false);
  };

  const saveSessionToHistory = (data: StudyData, originalNotes: string, fileName: string) => {
    const newSession: StudySession = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      fileName: fileName,
      title: data.title || "Untitled Session",
      studyData: data,
      chatLog: [],
      originalNotes: originalNotes,
      isPinned: false
    };
    const updated = [newSession, ...savedSessions];
    setSavedSessions(updated);
    localStorage.setItem('lumina_history_v2', JSON.stringify(updated));
    setActiveSessionId(newSession.id);
  };

  const handleSubmit = async () => {
    if (!notes.trim() && !selectedFile) return;
    resetAudio();
    setState(AppState.LOADING);
    setError(null);
    setChatLog([]);
    setActiveSessionId(null);
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
    resetAudio();
    setStudyData(session.studyData);
    setNotes(session.originalNotes);
    setChatLog(session.chatLog || []);
    setActiveSessionId(session.id);
    setState(AppState.SUCCESS);
    prefetchAudio(session.studyData.summary, session.studyData.audioInstruction);
    setIsSidebarOpen(false);
  };

  const reset = () => {
    resetAudio();
    setState(AppState.IDLE);
    setNotes('');
    setSelectedFile(null);
    setStudyData(null);
    setError(null);
    setChatLog([]);
    setActiveSessionId(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const togglePin = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = savedSessions.map(s => 
      s.id === id ? { ...s, isPinned: !s.isPinned } : s
    );
    setSavedSessions(updated);
    localStorage.setItem('lumina_history_v2', JSON.stringify(updated));
    setActiveMenuId(null);
  };

  const deleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = savedSessions.filter(s => s.id !== id);
    setSavedSessions(updated);
    localStorage.setItem('lumina_history_v2', JSON.stringify(updated));
    if (activeSessionId === id) {
      reset();
    }
    setActiveMenuId(null);
  };

  const startRename = (session: StudySession, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(session.id);
    setRenameValue(session.title);
    setActiveMenuId(null);
  };

  const handleRenameSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!renamingId) return;
    
    const updated = savedSessions.map(s => 
      s.id === renamingId ? { ...s, title: renameValue || s.title } : s
    );
    setSavedSessions(updated);
    localStorage.setItem('lumina_history_v2', JSON.stringify(updated));
    setRenamingId(null);
    setRenameValue('');
  };

  const glassCardClass = isDark 
    ? "bg-zinc-900/40 backdrop-blur-xl border border-white/10 shadow-2xl neon-glow" 
    : "bg-[#f8fafc] border border-[#e2e8f0] shadow-xl shadow-slate-200/50 neon-glow";

  const getPlaybackLabel = () => {
    if (isAudioLoading) return '✨ GENERATING...';
    if (isQuotaExceeded) return 'SERVICE BUSY';
    if (playbackState === 'playing') return 'PAUSE AUDIO';
    if (playbackState === 'paused') return 'RESUME AUDIO';
    return 'PREMIUM VOICE';
  };

  const SessionItem: React.FC<{ session: StudySession }> = ({ session }) => (
    <div className="relative group/item mb-3">
      <button 
        onClick={() => loadSession(session)}
        className={`w-full text-left p-5 rounded-3xl border transition-all duration-300 hover:scale-[1.02] ${isDark ? 'bg-white/5 border-white/5 hover:border-white/10 hover:bg-white/10' : 'bg-white border-[#E0E4F0] hover:bg-slate-50 shadow-sm'} ${activeSessionId === session.id ? (isDark ? 'bg-white/10 border-indigo-500/50' : 'bg-indigo-50 border-[#5C6BC0]/50 shadow-none') : ''}`}
      >
        {renamingId === session.id ? (
          <form onSubmit={handleRenameSubmit} className="relative z-10" onClick={e => e.stopPropagation()}>
            <input 
              autoFocus
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onBlur={() => handleRenameSubmit()}
              className={`w-full bg-transparent border-b outline-none text-sm font-bold ${isDark ? 'border-indigo-500 text-white' : 'border-[#5C6BC0] text-[#2D2D2D]'}`}
            />
          </form>
        ) : (
          <>
            <div className={`font-bold text-sm truncate mb-1 pr-6 ${isDark ? 'text-white' : 'text-[#2D2D2D]'}`}>{session.title}</div>
            <div className="flex items-center justify-between">
              <div className={`text-[10px] uppercase tracking-widest opacity-40 font-black ${isDark ? '' : 'text-[#2D2D2D]'}`}>{new Date(session.timestamp).toLocaleDateString()}</div>
              {session.isPinned && (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-[#5C6BC0]" viewBox="0 0 20 20" fill="currentColor">
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
        <div className={`absolute right-3 top-10 z-[60] w-40 py-2 rounded-2xl shadow-2xl backdrop-blur-3xl animate-spring-up origin-top-right border ${isDark ? 'bg-indigo-950/80 border-white/10 shadow-black' : 'bg-white border-[#E0E4F0] shadow-xl'}`}>
          <button onClick={(e) => togglePin(session.id, e)} className={`w-full px-4 py-2 text-left text-xs font-bold flex items-center gap-3 transition-colors ${isDark ? 'hover:bg-white/10 text-zinc-300' : 'hover:bg-slate-50 text-[#2D2D2D]'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg>
            {session.isPinned ? 'Unpin' : 'Pin'}
          </button>
          <button onClick={(e) => startRename(session, e)} className={`w-full px-4 py-2 text-left text-xs font-bold flex items-center gap-3 transition-colors ${isDark ? 'hover:bg-white/10 text-zinc-300' : 'hover:bg-slate-50 text-[#2D2D2D]'}`}>
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

  const isRTL = studyData?.languageCode?.startsWith('ar') || false;

  return (
    <div className={`min-h-screen pb-20 transition-all duration-700 relative overflow-hidden flex ${isDark ? 'bg-[#0a0a0c] text-slate-200' : 'bg-[#F4F4F9] text-[#2D2D2D]'}`}>
      <aside 
        onClick={() => setActiveMenuId(null)}
        className={`fixed inset-y-0 left-0 z-50 w-80 transform transition-transform duration-500 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} ${isDark ? 'bg-indigo-950/40 border-r border-white/5 shadow-indigo-900/20' : 'bg-white border-r border-[#E0E4F0] shadow-lg'} backdrop-blur-3xl overflow-hidden flex flex-col`}
      >
        <div className="p-6 border-b border-white/5 flex items-center justify-between">
          <h2 className={`font-black text-xs uppercase tracking-[0.3em] opacity-40 ${isDark ? '' : 'text-[#1A237E]'}`}>History</h2>
          <button onClick={() => setIsSidebarOpen(false)} className="opacity-40 hover:opacity-100 transition-opacity">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
          </button>
        </div>
        
        <div className="p-4 flex-1 overflow-y-auto space-y-6 custom-scrollbar">
          <Button theme={theme} variant="outline" className="w-full py-4 rounded-2xl border-[#5C6BC0]/20 bg-[#5C6BC0]/5 hover:bg-[#5C6BC0]/10 transition-all font-black text-[10px] tracking-widest" onClick={reset}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" /></svg>
            NEW SESSION
          </Button>
          
          {pinnedSessions.length > 0 && (
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] opacity-30 mb-4 px-2 text-[#1A237E]">Pinned</h3>
              {pinnedSessions.map(session => <SessionItem key={session.id} session={session} />)}
            </div>
          )}

          <div>
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] opacity-30 mb-4 px-2 text-[#1A237E]">Recent</h3>
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

        <header className={`backdrop-blur-2xl border-b sticky top-0 z-30 transition-all duration-500 ${isDark ? 'bg-black/40 border-white/5' : 'bg-white/90 border-[#E0E4F0]'}`}>
          <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={(e) => { e.stopPropagation(); setIsSidebarOpen(true); }} className={`p-2 rounded-xl transition-all ${isDark ? 'hover:bg-white/5' : 'hover:bg-[#5C6BC0]/5'}`}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
              </button>
              <div className="w-9 h-9 bg-[#5C6BC0] rounded-xl flex items-center justify-center shadow-lg shadow-[#5C6BC0]/30">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 20 20" fill="currentColor"><path d="M10.394 2.827a1 1 0 00-.788 0l-7 3a1 1 0 000 1.848l7 3a1 1 0 00.788 0l7-3a1 1 0 000-1.848l-7-3zM14 9.528v2.736a1 1 0 01-.529.883L10 14.613l-3.471-1.466A1 1 0 016 12.264V9.528l4 1.714 4-1.714z" /></svg>
              </div>
              <h1 className={`breakthrough-text text-xl font-bold tracking-tight ${isDark ? 'text-white' : 'text-[#1A237E]'}`}>Lumina</h1>
            </div>
            
            <div className="flex items-center gap-3">
              <button onClick={toggleTheme} className={`p-2.5 rounded-full transition-all active:scale-90 ${isDark ? 'bg-white/5 text-yellow-400' : 'bg-[#5C6BC0]/10 text-[#5C6BC0]'}`}>
                {isDark ? <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" /></svg> : <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" /></svg>}
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 mt-16 relative z-10 w-full">
          {state === AppState.IDLE || state === AppState.ERROR ? (
            <div className="max-w-3xl mx-auto space-y-16 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <div className="text-center space-y-6">
                <h2 className={`text-5xl md:text-6xl font-black leading-tight ${isDark ? 'text-white' : 'text-[#1A237E]'}`}>Study Smarter.</h2>
                <p className={`text-xl md:text-2xl opacity-80 ${isDark ? 'text-zinc-400' : 'text-[#1A237E]/60'}`}>Transform notes into synthesized study material in seconds.</p>
              </div>

              <div className={`p-10 rounded-[3rem] space-y-10 ${glassCardClass}`}>
                <div className="space-y-4">
                  <div className="flex justify-between items-center mb-1">
                    <label className={`text-xs font-black uppercase tracking-[0.2em] opacity-40 ml-1 ${isDark ? '' : 'text-[#1A237E]'}`}>Notes or PDF</label>
                    {selectedFile && (
                      <div className="flex items-center gap-2 px-3 py-1 bg-[#5C6BC0]/10 border border-[#5C6BC0]/20 rounded-full">
                         <span className="text-[10px] font-bold text-[#5C6BC0] uppercase truncate max-w-[150px]">{selectedFile.name}</span>
                         <button onClick={() => setSelectedFile(null)} className="text-[#5C6BC0] hover:text-[#1A237E] transition-colors"><svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l18 18" /></svg></button>
                      </div>
                    )}
                  </div>
                  <textarea className={`w-full h-64 p-8 border rounded-[2rem] focus:ring-2 focus:ring-[#5C6BC0]/50 outline-none resize-none text-lg leading-relaxed ${isDark ? 'bg-black/30 border-white/5 text-zinc-100 placeholder-zinc-700' : 'bg-white border-[#E0E4F0] text-[#2D2D2D] placeholder-slate-400'}`} placeholder="Paste notes here..." value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
                <div className="flex flex-col sm:flex-row gap-4 justify-center items-stretch">
                  <input type="file" accept="application/pdf" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                  <Button theme={theme} variant="outline" className="w-full sm:max-w-[200px] py-5 text-lg rounded-2xl border-[#5C6BC0]/30 text-[#5C6BC0] font-bold" onClick={() => fileInputRef.current?.click()}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg> Upload PDF
                  </Button>
                  <Button theme={theme} className="w-full sm:max-w-md py-5 text-lg rounded-2xl bg-[#5C6BC0] font-black tracking-widest text-xs uppercase shadow-xl shadow-[#5C6BC0]/20" onClick={handleSubmit} disabled={!notes.trim() && !selectedFile}>Generate Guide</Button>
                </div>
                {error && <div className="p-5 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-400 text-sm">{error}</div>}
              </div>
            </div>
          ) : state === AppState.LOADING ? (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-10">
              <div className="relative">
                <div className={`w-32 h-32 border-4 rounded-full ${isDark ? 'border-white/5' : 'border-slate-200'}`}></div>
                <div className="absolute top-0 left-0 w-32 h-32 border-t-4 border-[#5C6BC0] rounded-full animate-spin"></div>
              </div>
              <h3 className={`text-3xl font-bold ${isDark ? 'text-white' : 'text-[#1A237E]'}`}>Crafting Material...</h3>
            </div>
          ) : studyData ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 pb-20">
              <div className="lg:col-span-2 space-y-12">
                <section className={`p-10 md:p-12 rounded-[3.5rem] relative overflow-hidden transition-all animate-spring-up ${glassCardClass}`}>
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10 relative z-10">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-[#5C6BC0]/20 text-[#5C6BC0] rounded-2xl">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      </div>
                      <h2 className={`text-3xl font-black tracking-tight ${isDark ? 'text-white' : 'text-[#1A237E]'}`}>Summary</h2>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className={`flex items-center gap-2 p-1 rounded-2xl border backdrop-blur-md ${isDark ? 'bg-black/10 border-white/5' : 'bg-[#F4F4F9] border-[#E0E4F0]'}`}>
                        <button 
                          onClick={togglePremiumVoice} 
                          disabled={isAudioLoading || isQuotaExceeded} 
                          className={`px-5 py-2.5 rounded-xl transition-all flex items-center gap-3 text-[10px] font-black tracking-widest uppercase relative overflow-hidden ${playbackState === 'playing' ? 'bg-[#5C6BC0] text-white shadow-lg' : isDark ? 'hover:bg-white/5 text-zinc-400' : 'bg-white hover:bg-slate-50 text-[#5C6BC0] border border-[#5C6BC0]/20'}`}
                        >
                          {isAudioLoading ? <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> : (playbackState === 'playing' ? <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 011-1h2a1 1 0 110 2H8a1 1 0 01-1-1zm4 0a1 1 0 011-1h2a1 1 0 110 2h-2a1 1 0 01-1-1z" clipRule="evenodd" /></svg> : <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>)}
                          <span>{getPlaybackLabel()}</span>
                        </button>

                        <button 
                          onClick={handleToggleReader} 
                          className={`px-5 py-2.5 rounded-xl transition-all flex items-center gap-3 text-[10px] font-black tracking-widest uppercase ${readerStatus === 'playing' ? 'bg-[#5C6BC0] text-white shadow-lg' : isDark ? 'hover:bg-white/5 text-zinc-400' : 'bg-white hover:bg-slate-50 text-[#5C6BC0] border border-[#5C6BC0]/20'}`}
                        >
                          {readerStatus === 'playing' ? (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 011-1h2a1 1 0 110 2H8a1 1 0 01-1-1zm4 0a1 1 0 011-1h2a1 1 0 110 2h-2a1 1 0 01-1-1z" clipRule="evenodd" /></svg>
                          ) : (
                            readerStatus === 'paused' ? (
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>
                            ) : (
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                            )
                          )}
                          <span>
                            {readerStatus === 'playing' ? 'PAUSE' : (readerStatus === 'paused' ? 'RESUME' : 'READER')}
                          </span>
                        </button>

                        {(playbackState !== 'idle' || readerStatus !== 'idle') && (
                          <button onClick={() => resetAudio(false)} className="w-9 h-9 flex items-center justify-center rounded-xl bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 transition-all">
                             <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><rect x="6" y="6" width="8" height="8" rx="1" /></svg>
                          </button>
                        )}
                      </div>
                      <Button theme={theme} variant="secondary" className={`px-5 py-2.5 text-xs font-black rounded-full border ${isCopied ? 'text-green-600 border-green-500/30 bg-green-50' : isDark ? '' : 'text-[#5C6BC0] border-[#5C6BC0]/20 bg-white'}`} onClick={handleCopySummary}>{isCopied ? 'COPIED' : 'COPY'}</Button>
                    </div>
                  </div>
                  {renderSummaryWithHighlight()}
                </section>

                <section className={`p-10 md:p-12 rounded-[3.5rem] transition-all animate-spring-up delay-200 ${glassCardClass}`}>
                  <div className="flex items-center gap-5 mb-8">
                    <div className="p-3 bg-purple-500/20 text-[#5C6BC0] rounded-2xl">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                    </div>
                    <h2 className={`text-3xl font-black tracking-tight ${isDark ? 'text-white' : 'text-[#1A237E]'}`}>Interactive Chat</h2>
                  </div>
                  
                  <div className={`flex flex-col h-[550px] border rounded-[2.5rem] overflow-hidden ${isDark ? 'bg-black/20 border-white/5 shadow-inner' : 'bg-[#f8fafc] border-[#e2e8f0] shadow-inner'}`}>
                    <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar scroll-smooth">
                      {chatLog.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center opacity-30 text-center px-10">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                          <p className={`text-lg font-medium ${isDark ? '' : 'text-[#1A237E]'}`}>Lumina is ready. Ask anything about your notes or the summary above.</p>
                        </div>
                      ) : (
                        chatLog.map((msg, i) => (
                          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-message`}>
                            <div className={`max-w-[85%] px-5 py-3.5 rounded-2xl text-[15px] leading-relaxed shadow-lg ${msg.role === 'user' ? 'bg-[#1A237E] text-white shadow-[0_0_15px_rgba(26,35,126,0.3)]' : isDark ? 'bg-zinc-800/80 text-zinc-200 border border-white/5' : 'bg-white text-[#2D2D2D] border border-[#E0E4F0]'}`}>
                              {renderWaterfallMessage(msg.content, msg.role)}
                            </div>
                          </div>
                        ))
                      )}
                      {isChatLoading && (
                        <div className="flex justify-start animate-message">
                          <div className={`px-5 py-4 rounded-2xl flex gap-1.5 items-center ${isDark ? 'bg-zinc-800/80 border border-white/5' : 'bg-white border border-[#E0E4F0]'}`}>
                            <span className="typing-dot"></span><span className="typing-dot"></span><span className="typing-dot"></span>
                          </div>
                        </div>
                      )}
                    </div>
                    <form onSubmit={handleSendChatMessage} className={`p-6 border-t ${isDark ? 'border-white/5 bg-black/40' : 'border-[#e2e8f0] bg-white'}`}>
                      <div className="flex gap-4">
                        <input 
                          type="text" 
                          value={chatInput} 
                          onChange={(e) => setChatInput(e.target.value)} 
                          disabled={isChatLoading} 
                          placeholder="Type a question..." 
                          className={`flex-1 px-6 py-4 rounded-2xl outline-none focus:ring-2 focus:ring-[#5C6BC0]/50 transition-all input-glow-pulse ${isDark ? 'bg-white/5 border border-white/10 text-zinc-100' : 'bg-white border border-[#E0E4F0] text-[#2D2D2D]'}`} 
                        />
                        <button 
                          type="submit" 
                          disabled={!chatInput.trim() || isChatLoading} 
                          className={`w-14 h-14 rounded-2xl transition-all flex items-center justify-center hover:scale-[1.05] active:scale-95 ${!chatInput.trim() || isChatLoading ? 'opacity-30 bg-zinc-700' : 'bg-[#1A237E] text-white shadow-lg hover:shadow-[0_0_20px_rgba(26,35,126,0.6)]'}`}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" /></svg>
                        </button>
                      </div>
                    </form>
                  </div>
                </section>

                <section className={`p-10 md:p-12 rounded-[3.5rem] transition-all animate-spring-up delay-400 ${glassCardClass}`}>
                  <div className="flex items-center gap-5 mb-12">
                    <div className="p-3 bg-amber-500/20 text-amber-600 rounded-2xl">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                    </div>
                    <h2 className={`text-3xl font-black tracking-tight ${isDark ? 'text-white' : 'text-[#1A237E]'}`}>Key Terms</h2>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {studyData.vocabulary.map((item, idx) => (
                      <div key={idx} className={`animate-vocab flex flex-col gap-4 p-10 rounded-3xl border transition-all duration-500 ${isDark ? 'bg-white/5 border-white/5 hover:border-white/10' : 'bg-white border-[#E0E4F0] hover:bg-[#F4F4F9]'}`} style={{ animationDelay: `${idx * 150}ms` }}>
                        <span className={`font-black uppercase text-xs tracking-[0.3em] ${isDark ? 'text-[#5C6BC0]' : 'text-[#5C6BC0]'}`}>{item.word}</span>
                        <p className={`text-sm transition-colors opacity-80 leading-relaxed ${isDark ? 'text-zinc-300' : 'text-[#2D2D2D]'}`}>{item.definition}</p>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <div className="lg:col-span-1 space-y-10 animate-spring-up delay-200">
                <div className="sticky top-28">
                  <Quiz questions={studyData.quiz} theme={theme} />
                  <div className="mt-10 p-10 bg-gradient-to-br from-[#5C6BC0] to-[#1A237E] rounded-[3rem] text-white shadow-2xl relative group border border-white/10">
                    <div className="relative z-10">
                      <h4 className="font-black text-2xl mb-4 tracking-tight">Review Session</h4>
                      <div className="space-y-4 relative">
                        <Button theme={theme} variant="outline" className={`w-full py-4 rounded-2xl font-black text-[10px] tracking-widest ${isDark ? '!border-white/20 !bg-white/10 !text-white hover:!bg-white/20' : '!bg-white/10 !border-white/20 !text-white hover:!bg-white/20'}`} onClick={reset}>NEW SESSION</Button>
                        <div className="relative">
                          <button 
                            className="w-full py-4 bg-white/80 border-[1.5px] border-[#1A237E] backdrop-blur-md text-[#1A237E] hover:bg-white rounded-2xl font-black text-[10px] tracking-widest flex items-center gap-2 justify-center shadow-lg transition-all active:scale-95 disabled:opacity-50" 
                            onClick={(e) => { e.stopPropagation(); setIsExportMenuOpen(!isExportMenuOpen); }} 
                            disabled={isDownloading}
                          >
                            {isDownloading ? (
                              <svg className="animate-spin h-5 w-5 text-indigo-900" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                            ) : (
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                            )}
                            EXPORT GUIDE
                          </button>
                          
                          {isExportMenuOpen && (
                            <div className={`absolute bottom-full mb-3 left-0 w-full rounded-2xl shadow-2xl backdrop-blur-3xl animate-spring-up border flex flex-col overflow-hidden z-[100] ${isDark ? 'bg-indigo-950/95 border-white/10' : 'bg-white border-[#e2e8f0]'}`}>
                              <button onClick={handleDownloadPDF} className={`w-full px-5 py-4 text-left text-[10px] font-black flex items-center gap-4 transition-colors tracking-widest uppercase ${isDark ? 'hover:bg-white/10 text-zinc-300' : 'hover:bg-slate-50 text-[#2D2D2D]'}`}>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                                PDF Document
                              </button>
                              <button onClick={handleExportToNotion} className={`w-full px-5 py-4 text-left text-[10px] font-black flex items-center gap-4 transition-colors tracking-widest uppercase border-t ${isDark ? 'hover:bg-white/10 border-white/5 text-zinc-300' : 'hover:bg-slate-50 border-[#E0E4F0] text-[#2D2D2D]'}`}>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                Notion (.md)
                              </button>
                              <button onClick={handleExportToAnki} className={`w-full px-5 py-4 text-left text-[10px] font-black flex items-center gap-4 transition-colors tracking-widest uppercase border-t ${isDark ? 'hover:bg-white/10 border-white/5 text-zinc-300' : 'hover:bg-slate-50 border-[#E0E4F0] text-[#2D2D2D]'}`}>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                                Flashcards (.csv)
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          
          <div 
            ref={exportRef} 
            dir={isRTL ? "rtl" : "ltr"}
            style={{ 
              display: 'none', 
              width: '794px', 
              padding: '50pt', 
              backgroundColor: '#ffffff', 
              color: '#000000', 
              fontFamily: "'Inter', sans-serif",
              textAlign: isRTL ? 'right' : 'left'
            }}
          >
            <div style={{ borderBottom: '3pt solid #1A237E', paddingBottom: '20pt', marginBottom: '30pt' }}>
              <h1 style={{ fontSize: '28pt', margin: '0', fontWeight: '900', color: '#1a1a1a', letterSpacing: '-0.02em', textTransform: 'uppercase' }}>
                {studyData?.title || 'Academic Study Guide'}
              </h1>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10pt', opacity: 0.5, fontSize: '10pt', fontWeight: '700' }}>
                <span>{new Date().toLocaleDateString()}</span>
                <span>Generated by Lumina AI</span>
              </div>
            </div>
            
            <div style={{ marginBottom: '40pt' }}>
              <h2 style={{ fontSize: '16pt', color: '#1A237E', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: '900', marginBottom: '15pt', borderLeft: isRTL ? 'none' : '4pt solid #1A237E', borderRight: isRTL ? '4pt solid #1A237E' : 'none', paddingLeft: isRTL ? '0' : '10pt', paddingRight: isRTL ? '10pt' : '0' }}>
                Executive Summary
              </h2>
              <div style={{ fontSize: '11pt', lineHeight: '1.7', color: '#2D2D2D', whiteSpace: 'pre-wrap' }}>
                {studyData?.summary}
              </div>
            </div>
            
            <div style={{ marginBottom: '40pt' }}>
              <h2 style={{ fontSize: '16pt', color: '#1A237E', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: '900', marginBottom: '15pt', borderLeft: isRTL ? 'none' : '4pt solid #1A237E', borderRight: isRTL ? '4pt solid #1A237E' : 'none', paddingLeft: isRTL ? '0' : '10pt', paddingRight: isRTL ? '10pt' : '0' }}>
                Key Technical Vocabulary
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15pt' }}>
                {studyData?.vocabulary.map((v, i) => (
                  <div key={i} style={{ breakInside: 'avoid' }}>
                    <div style={{ fontWeight: '800', fontSize: '10pt', color: '#1a1a1a', marginBottom: '3pt', textTransform: 'uppercase' }}>
                      {i + 1}. {v.word}
                    </div>
                    <div style={{ fontSize: '10pt', lineHeight: '1.5', color: '#555555' }}>
                      {v.definition}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ breakBefore: 'page', marginTop: '40pt' }}>
              <h2 style={{ fontSize: '16pt', color: '#1A237E', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: '900', marginBottom: '15pt', borderLeft: isRTL ? 'none' : '4pt solid #1A237E', borderRight: isRTL ? '4pt solid #1A237E' : 'none', paddingLeft: isRTL ? '0' : '10pt', paddingRight: isRTL ? '10pt' : '0' }}>
                Practice Assessment
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '25pt' }}>
                {studyData?.quiz.map((q, i) => (
                  <div key={i} style={{ breakInside: 'avoid', padding: '15pt', backgroundColor: '#f8f9fa', borderRadius: '8pt' }}>
                    <div style={{ fontWeight: '800', fontSize: '11pt', marginBottom: '10pt', color: '#111827' }}>
                      {i + 1}. {q.question}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5pt', marginLeft: isRTL ? '0' : '20pt', marginRight: isRTL ? '20pt' : '0' }}>
                      {q.options.map((opt, optI) => (
                        <div key={optI} style={{ fontSize: '10pt', color: '#4b5563' }}>
                          <span style={{ fontWeight: '700', color: '#6366f1', marginRight: '5pt' }}>{String.fromCharCode(65 + optI)}.</span>
                          {opt}
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: '10pt', paddingTop: '10pt', borderTop: '1px solid #e5e7eb', fontSize: '9pt', fontWeight: '700', color: '#059669', textTransform: 'uppercase' }}>
                      Correct Option: {String.fromCharCode(65 + q.correctAnswerIndex)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;