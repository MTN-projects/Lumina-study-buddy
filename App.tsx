import React, { useState, useRef, useEffect, useMemo } from 'react';
import { AppState, StudyData } from './types';
import { processLectureNotes, generateSpeech, FileData } from './services/geminiService';
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

type PlaybackMode = 'premium' | 'active' | 'none';

const App: React.FC = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [state, setState] = useState<AppState>(AppState.IDLE);
  const [notes, setNotes] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<{ name: string; base64: string; mimeType: string } | null>(null);
  const [studyData, setStudyData] = useState<StudyData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  
  // Playback State
  const [activeMode, setActiveMode] = useState<PlaybackMode>('none');
  const [playbackState, setPlaybackState] = useState<'idle' | 'playing' | 'paused'>('idle');
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [prefetchedBuffer, setPrefetchedBuffer] = useState<AudioBuffer | null>(null);
  
  // Active Reader (Karaoke) State
  const [currentWordIndex, setCurrentWordIndex] = useState<number | null>(null);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const playedOffsetRef = useRef<number>(0);
  
  const exportRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isDark = theme === 'dark';

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  /**
   * Word Segmentation for Active Reader mode.
   * Tracks character offsets to sync with speech boundary events.
   */
  const wordSegments = useMemo(() => {
    if (!studyData?.summary) return [];
    const segments = [];
    const regex = /\S+/g;
    let match;
    while ((match = regex.exec(studyData.summary)) !== null) {
      segments.push({
        text: match[0],
        start: match.index,
        end: match.index + match[0].length
      });
    }
    return segments;
  }, [studyData?.summary]);

  // Background Pre-fetcher for Premium Voice
  const prefetchAudio = async (text: string) => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      const base64 = await generateSpeech(text);
      const audioData = decode(base64);
      const buffer = await decodeAudioData(audioData, audioContextRef.current, 24000, 1);
      setPrefetchedBuffer(buffer);
    } catch (err) {
      console.warn("Background TTS pre-fetch failed:", err);
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
      setSelectedFile({
        name: file.name,
        base64: base64String,
        mimeType: file.type
      });
      setError(null);
    };
    reader.onerror = () => setError("Failed to read file.");
    reader.readAsDataURL(file);
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

  // --- AUDIO LOGIC ---

  /**
   * Universal Stop Function
   * Strictly cancels both native speech synthesis and AudioContext sources.
   */
  const stopAllPlayback = () => {
    // 1. Stop Native Speech Synthesis (Active Reader)
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    // 2. Stop AudioContext Source (Premium Voice)
    if (sourceRef.current) {
      try { 
        sourceRef.current.onended = null; 
        sourceRef.current.stop(); 
      } catch (e) {
        // Source might already be stopped
      }
      sourceRef.current = null;
    }
    
    // 3. Reset state tracking
    playedOffsetRef.current = 0;
    setPlaybackState('idle');
    setActiveMode('none');
    setCurrentWordIndex(null);
  };

  /**
   * Premium Voice: High-quality Gemini TTS
   * Mutual Exclusion: Cancels Active Reader before starting.
   */
  const togglePremiumVoice = async () => {
    // Exclusive Check: If native reader is running, kill it first.
    if (activeMode === 'active') {
      stopAllPlayback();
    }

    const ctx = audioContextRef.current || new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    if (!audioContextRef.current) audioContextRef.current = ctx;

    if (activeMode === 'premium') {
      if (playbackState === 'playing') {
        // Pause current premium stream
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
        // Resume from offset
        playFromBuffer(prefetchedBuffer, playedOffsetRef.current);
        return;
      }
    }

    // Fresh start or buffer-not-ready logic
    if (!studyData?.summary) return;
    setActiveMode('premium');

    if (prefetchedBuffer) {
      playFromBuffer(prefetchedBuffer, 0);
      return;
    }

    setIsAudioLoading(true);
    try {
      const base64 = await generateSpeech(studyData.summary);
      const audioData = decode(base64);
      const audioBuffer = await decodeAudioData(audioData, ctx, 24000, 1);
      setPrefetchedBuffer(audioBuffer);
      playFromBuffer(audioBuffer, 0);
    } catch (err) {
      console.error("Premium Voice generation failed:", err);
      setError("Failed to generate premium audio.");
      setActiveMode('none');
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
      // Only reset if this source reached the end naturally
      if (activeMode === 'premium' && playbackState === 'playing') {
        playedOffsetRef.current = 0;
        setPlaybackState('idle');
        setActiveMode('none');
      }
    };
    sourceRef.current = source;
    startTimeRef.current = ctx.currentTime;
    // Safety check for offset
    const actualOffset = offset % buffer.duration;
    source.start(0, actualOffset);
    setPlaybackState('playing');
  };

  /**
   * Active Reader: Browser TTS with Word Sync Highlighting
   * Mutual Exclusion: Cancels Premium Voice before starting.
   */
  const toggleActiveReader = () => {
    // Exclusive Check: If premium voice is running, kill it first.
    if (activeMode === 'premium') {
      stopAllPlayback();
    }

    const synth = window.speechSynthesis;
    if (!synth) return;

    if (activeMode === 'active') {
      if (playbackState === 'playing') {
        synth.pause();
        setPlaybackState('paused');
      } else if (playbackState === 'paused') {
        synth.resume();
        setPlaybackState('playing');
      }
      return;
    }

    // Start fresh native reader
    if (!studyData?.summary) return;
    setActiveMode('active');
    
    // Strict stop of anything else on native synth
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(studyData.summary);
    utterance.rate = 1.0;
    
    const voices = synth.getVoices();
    // Prioritize natural/high quality local voices for Active Reader
    const bestVoice = voices.find(v => v.lang === 'en-US' && (v.name.includes('Natural') || v.name.includes('Google'))) || 
                      voices.find(v => v.lang.startsWith('en')) || 
                      voices[0];
    if (bestVoice) utterance.voice = bestVoice;

    utterance.onboundary = (event) => {
      if (event.name === 'word') {
        const charIdx = event.charIndex;
        const matchIdx = wordSegments.findIndex(seg => charIdx >= seg.start && charIdx <= seg.end);
        if (matchIdx !== -1) setCurrentWordIndex(matchIdx);
      }
    };

    utterance.onstart = () => setPlaybackState('playing');
    utterance.onend = () => {
      // Prevent state overlap if we stopped manually
      if (activeMode === 'active') {
        setPlaybackState('idle');
        setActiveMode('none');
        setCurrentWordIndex(null);
      }
    };
    utterance.onerror = (e) => {
      if (e.error !== 'interrupted') {
        setPlaybackState('idle');
        setActiveMode('none');
        setCurrentWordIndex(null);
      }
    };

    synth.speak(utterance);
  };

  // --- CORE APP LOGIC ---

  const handleDownloadPDF = async () => {
    if (!studyData || !exportRef.current) return;
    
    setIsDownloading(true);
    try {
      const element = exportRef.current;
      element.style.display = 'block';
      
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff'
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save('Lumina_Study_Guide.pdf');
      
      element.style.display = 'none';
    } catch (err) {
      console.error('Failed to generate PDF: ', err);
      alert('Failed to generate PDF. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleSubmit = async () => {
    if (!notes.trim() && !selectedFile) return;
    
    setState(AppState.LOADING);
    setError(null);
    setPrefetchedBuffer(null);
    stopAllPlayback();
    try {
      const fileData: FileData | undefined = selectedFile ? {
        data: selectedFile.base64,
        mimeType: selectedFile.mimeType
      } : undefined;

      const data = await processLectureNotes(notes, fileData);
      setStudyData(data);
      setState(AppState.SUCCESS);
      
      prefetchAudio(data.summary);
    } catch (err) {
      console.error(err);
      setError("An error occurred while processing your material. Please ensure your notes or PDF content are valid.");
      setState(AppState.ERROR);
    }
  };

  const reset = () => {
    stopAllPlayback();
    setState(AppState.IDLE);
    setNotes('');
    setSelectedFile(null);
    setStudyData(null);
    setError(null);
    setPrefetchedBuffer(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const glassCardClass = isDark 
    ? "bg-zinc-900/40 backdrop-blur-xl border border-white/10 shadow-2xl" 
    : "bg-white/70 backdrop-blur-xl border border-slate-200 shadow-xl";

  return (
    <div className={`min-h-screen pb-20 transition-all duration-700 relative overflow-hidden ${isDark ? 'bg-[#0a0a0c] text-slate-200' : 'bg-slate-50 text-slate-900'}`}>
      
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

            {(state !== AppState.IDLE || notes.trim().length > 0 || selectedFile) && (
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
                <div className="flex justify-between items-center mb-1">
                  <label className={`block text-xs font-black uppercase tracking-[0.2em] ml-1 transition-colors ${isDark ? 'text-zinc-500' : 'text-slate-500'}`}>
                    Input your notes or upload a PDF
                  </label>
                  {selectedFile && (
                    <div className="flex items-center gap-2 px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded-full animate-in fade-in slide-in-from-right-2">
                       <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-indigo-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                      </svg>
                      <span className="text-[10px] font-bold text-indigo-400 uppercase truncate max-w-[150px]">{selectedFile.name}</span>
                      <button onClick={() => setSelectedFile(null)} className="text-indigo-400 hover:text-white transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l18 18" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
                <textarea
                  className={`w-full h-64 p-8 border rounded-[2rem] focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all outline-none resize-none text-lg leading-relaxed ${isDark ? 'bg-black/30 border-white/5 text-zinc-100 placeholder-zinc-700' : 'bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400'}`}
                  placeholder="Paste your content here..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-4 justify-center items-stretch">
                <input 
                  type="file" 
                  accept="application/pdf" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  className="hidden" 
                />
                <Button 
                  theme={theme}
                  variant="outline"
                  className="w-full sm:max-w-[200px] py-5 text-lg rounded-2xl border-indigo-600/30 text-indigo-400 hover:bg-indigo-500/5"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  Upload PDF
                </Button>

                <Button 
                  theme={theme}
                  className="w-full sm:max-w-md py-5 text-lg rounded-2xl bg-indigo-600 hover:bg-indigo-500 shadow-xl shadow-indigo-600/30 font-bold" 
                  onClick={handleSubmit}
                  disabled={!notes.trim() && !selectedFile}
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
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10 relative z-10">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-500/20 text-indigo-400 rounded-2xl">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <h2 className={`text-3xl font-black tracking-tight transition-colors ${isDark ? 'text-white' : 'text-slate-900'}`}>Core Summary</h2>
                  </div>
                  
                  {/* TWO AUDIO MODES WITH EXCLUSIVE CONTROLS */}
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2 p-1 bg-black/10 rounded-2xl border border-white/5 backdrop-blur-md">
                      {/* Premium Voice Group */}
                      <div className="flex items-center gap-1 pr-2 border-r border-white/10">
                        <button 
                          onClick={togglePremiumVoice}
                          disabled={isAudioLoading}
                          title="High-quality AI voice"
                          className={`px-3 py-2 rounded-xl transition-all flex items-center gap-2 text-[10px] font-black tracking-widest uppercase ${
                            activeMode === 'premium' 
                            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30' 
                            : 'hover:bg-white/5 text-zinc-400'
                          }`}
                        >
                          {isAudioLoading ? (
                            <svg className="animate-spin h-3.5 w-3.5 text-white" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                          ) : (
                            playbackState === 'playing' && activeMode === 'premium' ? (
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 011-1h2a1 1 0 110 2H8a1 1 0 01-1-1zm4 0a1 1 0 011-1h2a1 1 0 110 2h-2a1 1 0 01-1-1z" clipRule="evenodd" />
                              </svg>
                            ) : (
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                              </svg>
                            )
                          )}
                          <span className="hidden sm:inline">{activeMode === 'premium' && playbackState === 'paused' ? 'Resume' : 'Premium'}</span>
                        </button>
                        
                        {activeMode === 'premium' && (
                          <button 
                            onClick={stopAllPlayback}
                            className="w-8 h-8 flex items-center justify-center rounded-lg bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 transition-all border border-rose-500/20"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <rect x="6" y="6" width="8" height="8" rx="1" />
                            </svg>
                          </button>
                        )}
                      </div>

                      {/* Active Reader Group */}
                      <div className="flex items-center gap-1 pl-1">
                        <button 
                          onClick={toggleActiveReader}
                          title="Local voice with highlight"
                          className={`px-3 py-2 rounded-xl transition-all flex items-center gap-2 text-[10px] font-black tracking-widest uppercase ${
                            activeMode === 'active' 
                            ? 'bg-teal-600 text-white shadow-lg shadow-teal-600/30' 
                            : 'hover:bg-white/5 text-zinc-400'
                          }`}
                        >
                          {playbackState === 'playing' && activeMode === 'active' ? (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 011-1h2a1 1 0 110 2H8a1 1 0 01-1-1zm4 0a1 1 0 011-1h2a1 1 0 110 2h-2a1 1 0 01-1-1z" clipRule="evenodd" />
                            </svg>
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                            </svg>
                          )}
                          <span className="hidden sm:inline">{activeMode === 'active' && playbackState === 'paused' ? 'Resume' : 'Reader'}</span>
                        </button>

                        {activeMode === 'active' && (
                          <button 
                            onClick={stopAllPlayback}
                            className="w-8 h-8 flex items-center justify-center rounded-lg bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 transition-all border border-rose-500/20"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <rect x="6" y="6" width="8" height="8" rx="1" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>

                    <Button 
                      theme={theme}
                      variant="secondary" 
                      className={`px-5 py-2.5 text-xs font-black rounded-full transition-all border ${isCopied ? 'text-green-400 border-green-500/30 bg-green-500/10' : (isDark ? 'border-white/5 bg-white/5 text-zinc-400' : '')}`}
                      onClick={handleCopySummary}
                    >
                      {isCopied ? 'COPIED' : 'COPY'}
                    </Button>
                  </div>
                </div>

                {/* Summary Rendering (with per-word spans for Active Reader) */}
                <div className={`text-xl leading-relaxed relative z-10 font-normal transition-colors ${isDark ? 'text-zinc-200' : 'text-slate-700'}`}>
                  {activeMode === 'active' ? (
                    wordSegments.map((word, idx) => (
                      <span 
                        key={idx} 
                        className={`word-span ${currentWordIndex === idx ? 'active-word' : ''}`}
                      >
                        {word.text}
                      </span>
                    ))
                  ) : (
                    <span className="whitespace-pre-line">{studyData.summary}</span>
                  )}
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

            {/* Right Column: Quiz */}
            <div className="lg:col-span-1 space-y-10 animate-spring-up delay-200">
              <div className="sticky top-28">
                <Quiz questions={studyData.quiz} theme={theme} />
                
                <div className="mt-10 p-10 bg-gradient-to-br from-indigo-600 to-indigo-900 rounded-[3rem] text-white shadow-2xl relative overflow-hidden group border border-white/10">
                  <div className="relative z-10">
                    <h4 className="font-black text-2xl mb-4 tracking-tight">Focus & Review</h4>
                    <p className="text-indigo-100 text-lg mb-8 leading-relaxed opacity-90">Ready for a fresh set of notes? Clear the current workspace and start again.</p>
                    <div className="space-y-4">
                      <Button 
                        theme={theme}
                        variant="outline" 
                        className="w-full py-4 !border-white/20 !bg-white/10 !text-white hover:!bg-white/20 backdrop-blur-md rounded-2xl" 
                        onClick={reset}
                      >
                        New Session
                      </Button>
                      
                      <Button 
                        theme={theme}
                        variant="primary" 
                        className="w-full py-4 bg-white text-indigo-900 hover:bg-slate-100 rounded-2xl border-none font-black text-xs uppercase tracking-widest flex items-center gap-2 shadow-xl shadow-black/20"
                        onClick={handleDownloadPDF}
                        isLoading={isDownloading}
                      >
                        {!isDownloading && (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                        )}
                        Export Study Guide
                      </Button>
                    </div>
                  </div>
                  <div className="absolute top-0 right-0 -mr-20 -mt-20 w-56 h-56 bg-white/10 rounded-full blur-3xl transition-transform group-hover:scale-150 duration-[2000ms]"></div>
                  <div className="absolute bottom-0 left-0 -ml-12 -mb-12 w-40 h-40 bg-indigo-400/20 rounded-full blur-2xl"></div>
                </div>

                <div className="mt-8 flex justify-center">
                  <p className={`text-[11px] font-black uppercase tracking-[0.4em] transition-colors ${isDark ? 'text-zinc-700' : 'text-slate-300'}`}>Powered by Gemini 3.0</p>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </main>

      {/* Hidden PDF Export Template */}
      <div 
        ref={exportRef} 
        style={{ 
          display: 'none', 
          width: '800px', 
          padding: '40px', 
          backgroundColor: '#ffffff', 
          color: '#000000',
          fontFamily: 'Inter, sans-serif'
        }}
      >
        <div style={{ borderBottom: '4px solid #000', paddingBottom: '20px', marginBottom: '30px' }}>
          <h1 style={{ fontSize: '32px', margin: '0', fontWeight: '800' }}>STUDY GUIDE</h1>
          <p style={{ margin: '5px 0 0', opacity: 0.6, fontSize: '14px', textTransform: 'uppercase', letterSpacing: '2px' }}>Generated by Lumina</p>
        </div>
        
        <div style={{ marginBottom: '40px' }}>
          <h2 style={{ fontSize: '20px', borderBottom: '2px solid #000', display: 'inline-block', marginBottom: '15px', paddingBottom: '5px' }}>SUMMARY</h2>
          <p style={{ fontSize: '14px', lineHeight: '1.6', whiteSpace: 'pre-line' }}>{studyData?.summary}</p>
        </div>

        <div style={{ marginBottom: '40px' }}>
          <h2 style={{ fontSize: '20px', borderBottom: '2px solid #000', display: 'inline-block', marginBottom: '15px', paddingBottom: '5px' }}>KEY TERMS</h2>
          {studyData?.vocabulary.map((v, i) => (
            <div key={i} style={{ marginBottom: '15px' }}>
              <div style={{ fontWeight: 'bold', fontSize: '14px', textTransform: 'uppercase' }}>{v.word}</div>
              <div style={{ fontSize: '13px', lineHeight: '1.4' }}>{v.definition}</div>
            </div>
          ))}
        </div>

        <div>
          <h2 style={{ fontSize: '20px', borderBottom: '2px solid #000', display: 'inline-block', marginBottom: '15px', paddingBottom: '5px' }}>PRACTICE QUESTIONS</h2>
          {studyData?.quiz.map((q, i) => (
            <div key={i} style={{ marginBottom: '20px' }}>
              <div style={{ fontWeight: '600', fontSize: '14px', marginBottom: '8px' }}>{i + 1}. {q.question}</div>
              {q.options.map((opt, optI) => (
                <div key={optI} style={{ fontSize: '13px', marginLeft: '15px', marginBottom: '4px' }}>
                  [{String.fromCharCode(65 + optI)}] {opt}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div style={{ marginTop: '50px', paddingTop: '20px', borderTop: '1px solid #eee', textAlign: 'center', fontSize: '10px', color: '#999' }}>
          LUMINA STUDY BUDDY • PRINTED ON {new Date().toLocaleDateString()}
        </div>
      </div>
    </div>
  );
};

export default App;