import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore';

// 1. BURAYA FIREBASE PANELİNDEN ALDIĞIN AYARLARI YAPIŞTIR:
const firebaseConfig = {
  apiKey: "AIzaSyBHgN52ilukU_J8SUJmj1JK4_-pyhaOA3M",
  authDomain: "reader-c44f0.firebaseapp.com",
  projectId: "reader-c44f0",
  storageBucket: "reader-c44f0.firebasestorage.app",
  messagingSenderId: "494949473242",
  appId: "1:494949473242:web:8e8ed51b3b6239ea69fee3",
  measurementId: "G-JE37YBSX6V"
};

  const cleanWordLength = word.replace(/[.,!?;\-]/g, '').length;
  if (cleanWordLength > 10) multiplier += 0.4;
  else if (cleanWordLength > 6) multiplier += 0.2;
  else if (cleanWordLength <= 3) multiplier -= 0.1;

  if (word.endsWith('.')) multiplier += 1.0;
  else if (word.endsWith('?') || word.endsWith('!')) multiplier += 1.0;
  else if (word.endsWith(',')) multiplier += 0.5;
  else if (word.endsWith(';')) multiplier += 0.5;

  return baseDelayMs * multiplier;
};

// ORP İndeksi
const getOrpIndex = (word) => {
  const len = word.length;
  if (len <= 1) return 0;
  if (len <= 5) return 1;
  if (len <= 9) return 2;
  if (len <= 13) return 3;
  return 4;
};

export default function App() {
  // --- VERİ KALICILIĞI (LOCAL STORAGE) İÇİN BAŞLANGIÇ DEĞERLERİ ---
  const defaultText = "26reader'a hoş geldin. Uygulamayı yeniden başlatsan da yüklediğin kitap ve ayarların artık kaybolmaz. Kütüphaneden kendi PDF dosyanı yükleyerek okumaya başlayabilirsin. Yüklediğin dosya tamamen cihazının hafızasında tutulur. Bölüm 1 Bu bir deneme bölümüdür. Okumayı duraklattığında açılan ekranda veya kitap detaylarında Kindle tarzı menüyü görebilirsin. Bölüm 2 Sol menü, notlar ve istatistikler tamamen senin kullanımına göre güncellenecektir.";
  const defaultNotes = [
    { id: 1, bookTitle: "26reader Demo", text: "Hover-expand menü tasarımı uygulamaya tam bir native uygulama hissi kattı.", time: "14:25", date: "Bugün" }
  ];

  // Arayüz Durumları
  const [activeTab, setActiveTab] = useState('read'); 
  const [appMode, setAppMode] = useState('dashboard'); 
  const [kindleTab, setKindleTab] = useState('contents'); // 'contents' or 'notes'
  
  // Storage'dan veri çekme
  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem('26reader_settings');
    return saved ? JSON.parse(saved) : { redLetter: true, ghostWords: true, baseWpm: 350 };
  });

  const [text, setText] = useState(() => localStorage.getItem('26reader_text') || defaultText);
  const [currentBookTitle, setCurrentBookTitle] = useState(() => localStorage.getItem('26reader_title') || "26reader Demo");
  const [currentIndex, setCurrentIndex] = useState(() => parseInt(localStorage.getItem('26reader_index')) || 0);
  const [notes, setNotes] = useState(() => {
    const saved = localStorage.getItem('26reader_notes');
    return saved ? JSON.parse(saved) : defaultNotes;
  });

  const [words, setWords] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  
  // PDF/EPUB Durumları
  const [isProcessingPdf, setIsProcessingPdf] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const [chapters, setChapters] = useState([]);
  const [isTocOpen, setIsTocOpen] = useState(false);
  const fileInputRef = useRef(null);
  const currentWordRef = useRef(null);

  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [currentNoteText, setCurrentNoteText] = useState("");
  const [isBookDetailModalOpen, setIsBookDetailModalOpen] = useState(false);

  const timeoutRef = useRef(null);

  // --- VERİLERİ OTOMATİK KAYDETME (AUTO-SAVE) ---
  useEffect(() => {
    try {
      localStorage.setItem('26reader_text', text);
      localStorage.setItem('26reader_title', currentBookTitle);
      localStorage.setItem('26reader_index', currentIndex.toString());
      localStorage.setItem('26reader_notes', JSON.stringify(notes));
      localStorage.setItem('26reader_settings', JSON.stringify(settings));
    } catch (e) {
      console.warn("Hafıza limiti aşıldı, çok büyük dosya olabilir.", e);
    }
  }, [text, currentBookTitle, currentIndex, notes, settings]);

  // Motorların Yüklenmesi
  useEffect(() => {
    if (!window.pdfjsLib) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.async = true;
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      };
      document.body.appendChild(script);
    }
    if (!window.JSZip) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  // Metin Güncellemesi
  useEffect(() => {
    const parsedWords = text.split(/\s+/).filter(w => w.trim().length > 0);
    setWords(parsedWords);
  }, [text]);

  // Bölüm Ayrıştırıcı (HİYERARŞİK ALGORİTMA)
  useEffect(() => {
    if (words.length === 0) return;
    let extractedChapters = [];
    let currentMainChapter = null;

    const isRomanNumeral = (str) => {
      const romanRegex = /^M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/i;
      return romanRegex.test(str) && str.length > 0;
    };

    for(let i = 0; i < words.length; i++) {
      const w = words[i].replace(/[.,!?;\-]/g, '').trim();
      const lowerW = w.toLowerCase();

      // ANA BÖLÜM KONTROLÜ (Örn: "Altıncı Bölüm", "Kısım 1")
      if ((lowerW === 'bölüm' || lowerW === 'chapter' || lowerW === 'kısım') && i < words.length - 1) {
          const nextWord = words[i+1].replace(/[.,!?]/g, '').trim();
          
          if (/^[0-9]+$/.test(nextWord) || isRomanNumeral(nextWord) || ['bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz', 'on'].includes(nextWord.toLowerCase())) {
              const title = `${w} ${nextWord}`;
              const chapObj = { title: title, wordIndex: i, subChapters: [], isMain: true };
              extractedChapters.push(chapObj);
              currentMainChapter = chapObj;
              i += 10; 
              continue;
          }
      }

      // ALT BÖLÜM (ROMA RAKAMI) KONTROLÜ (Örn: "I", "II", "III")
      if (currentMainChapter && words[i] === w.toUpperCase() && isRomanNumeral(w)) {
        if (i === 0 || words[i-1].endsWith('.') || words[i-1].endsWith('\n')) {
             currentMainChapter.subChapters.push({ title: w, wordIndex: i, isMain: false });
             i += 2; 
        }
      }
    }

    if (extractedChapters.length === 0 && words.length > 500) {
       const partSize = Math.floor(words.length / 5);
       for(let i=0; i<5; i++) {
          extractedChapters.push({ title: `Kısım ${i+1} (%${i*20})`, wordIndex: i * partSize, subChapters: [], isMain: true });
       }
    } else if (extractedChapters.length === 0) {
       extractedChapters.push({ title: `Başlangıç`, wordIndex: 0, subChapters: [], isMain: true });
    }
    
    setChapters(extractedChapters);
  }, [words]);

  // Paragraf görünümüne geçildiğinde otomatik kaydırma
  useEffect(() => {
    if (appMode === 'context' && currentWordRef.current) {
      currentWordRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [appMode]);

  // Ana Okuma Döngüsü
  const playNextWord = useCallback(() => {
    if (!isPlaying) return;
    if (currentIndex >= words.length - 1) {
      setIsPlaying(false);
      setAppMode('context');
      return;
    }
    const delay = calculateDelay(words[currentIndex], settings.baseWpm);
    timeoutRef.current = setTimeout(() => {
      setCurrentIndex(prev => prev + 1);
    }, delay);
  }, [currentIndex, isPlaying, words, settings.baseWpm]);

  useEffect(() => {
    if (isPlaying) playNextWord();
    return () => clearTimeout(timeoutRef.current);
  }, [isPlaying, currentIndex, playNextWord]);

  // Kontroller
  const startReading = () => {
    setAppMode('playing');
    setIsPlaying(true);
  };

  const pauseToContext = () => {
    setIsPlaying(false);
    setAppMode('context');
  };

  const returnToDashboard = () => {
    setIsPlaying(false);
    setAppMode('dashboard');
  };

  const saveNote = () => {
    if (currentNoteText.trim() === "") {
      setIsNoteModalOpen(false);
      return;
    }
    const newNote = {
      id: Date.now(),
      bookTitle: currentBookTitle,
      text: currentNoteText,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      date: new Date().toLocaleDateString(),
      wordIndex: currentIndex
    };
    setNotes([newNote, ...notes]);
    setCurrentNoteText("");
    setIsNoteModalOpen(false);
  };

  // Dosya Yükleme
  const handleFileUploadClick = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();
    const isPdf = file.type === 'application/pdf' || fileName.endsWith('.pdf');
    const isEpub = file.type === 'application/epub+zip' || fileName.endsWith('.epub');

    if (!isPdf && !isEpub) {
      setPdfError("Lütfen PDF veya EPUB yükleyin.");
      setTimeout(() => setPdfError(""), 3000);
      return;
    }

    setIsProcessingPdf(true);
    setPdfError("");
    const title = file.name.replace(/\.[^/.]+$/, "");

    const reader = new FileReader();
    reader.onload = async (event) => {
      const arrayBuffer = event.target.result;
      try {
        let fullText = '';
        if (isPdf) {
          const typedarray = new Uint8Array(arrayBuffer);
          const pdf = await window.pdfjsLib.getDocument(typedarray).promise;
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            fullText += textContent.items.map(item => item.str).join(' ') + ' ';
          }
        } else if (isEpub) {
          const zip = await window.JSZip.loadAsync(arrayBuffer);
          const parser = new DOMParser();
          const containerFile = zip.file("META-INF/container.xml");
          if (!containerFile) throw new Error("Geçersiz EPUB formatı.");
          const containerXml = await containerFile.async("string");
          const containerDoc = parser.parseFromString(containerXml, "text/xml");
          const rootfile = containerDoc.querySelector("rootfile");
          const opfPath = rootfile.getAttribute("full-path");
          const opfFile = zip.file(opfPath);
          const opfXml = await opfFile.async("string");
          const opfDoc = parser.parseFromString(opfXml, "text/xml");
          const basePath = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : "";
          const manifest = {};
          opfDoc.querySelectorAll("manifest > item").forEach(item => manifest[item.getAttribute("id")] = item.getAttribute("href"));
          const spineRefs = opfDoc.querySelectorAll("spine > itemref");
          for (let i = 0; i < spineRefs.length; i++) {
             const href = manifest[spineRefs[i].getAttribute("idref")];
             if (href) {
                 const htmlFile = zip.file(basePath + decodeURIComponent(href));
                 if (htmlFile) {
                     const htmlDoc = parser.parseFromString(await htmlFile.async("string"), "text/html");
                     if (htmlDoc.body) fullText += htmlDoc.body.textContent + " \n\n ";
                 }
             }
          }
        }
        fullText = fullText.replace(/\s+/g, ' ').trim();
        if (fullText.length === 0) throw new Error("Okunabilir metin bulunamadı.");
        
        setText(fullText);
        setCurrentBookTitle(title);
        setCurrentIndex(0);
        setActiveTab('read');
      } catch (error) {
        setPdfError(error.message || "Bir hata oluştu. Dosya çok büyük olabilir.");
        setTimeout(() => setPdfError(""), 5000);
      } finally {
        setIsProcessingPdf(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Kelime Render Motoru
  const renderWord = (word, mode = 'large') => {
    if (!word) return null;
    if (!settings.redLetter) {
      if (mode === 'small') return <span>{word}</span>;
      return <div className="text-5xl md:text-7xl font-bold tracking-wide text-white text-center w-full">{word}</div>;
    }
    const orpIndex = getOrpIndex(word);
    const left = word.substring(0, orpIndex);
    const center = word.charAt(orpIndex);
    const right = word.substring(orpIndex + 1);

    if (mode === 'small') {
      return (
        <span className="inline-flex items-center">
          <span className="text-gray-300">{left}</span>
          <span className="text-red-500 font-bold">{center}</span>
          <span className="text-gray-300">{right}</span>
        </span>
      );
    }
    return (
      <div className="flex w-full items-center text-5xl md:text-7xl font-bold tracking-wide">
        <div className="flex-1 text-right text-gray-200">{left}</div>
        <div className="text-red-500 font-bold px-[1px]">{center}</div>
        <div className="flex-1 text-left text-gray-200">{right}</div>
      </div>
    );
  };

  const progress = words.length > 0 ? (currentIndex / (words.length - 1)) * 100 : 0;
  const prevWord = currentIndex > 0 ? words[currentIndex - 1] : "";
  const nextWord = currentIndex < words.length - 1 ? words[currentIndex + 1] : "";

  // ================= SEKME (TAB) İÇERİKLERİ =================

  const renderReadDashboard = () => (
    <div className="flex-1 flex flex-col p-6 md:p-10 overflow-y-auto">
      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight mb-2">Şu An Okunuyor</h1>
          <p className="text-gray-400 font-medium">{currentBookTitle}</p>
        </div>
        <button onClick={handleFileUploadClick} className="px-5 py-2.5 bg-[#1a1a1a] border border-white/10 text-gray-300 font-medium rounded-lg hover:bg-[#222] hover:text-white transition-all shadow-sm">
          PDF / EPUB Yükle
        </button>
      </div>

      <div className="w-full bg-[#0a0a0a] border border-white/10 rounded-[32px] overflow-hidden flex flex-col relative shadow-2xl">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-[1px] bg-gradient-to-r from-transparent via-gray-500 to-transparent opacity-30"></div>
        
        <div className="h-64 flex flex-col items-center justify-center relative">
           {settings.ghostWords && (
            <>
              <div className="absolute left-12 top-1/2 -translate-y-1/2 opacity-20 text-2xl blur-[1px] text-white hidden md:block">{prevWord}</div>
              <div className="absolute right-12 top-1/2 -translate-y-1/2 opacity-20 text-2xl blur-[1px] text-white hidden md:block">{nextWord}</div>
            </>
          )}
          {renderWord(words[currentIndex], 'large')}
        </div>

        <div className="flex justify-center -mt-8 relative z-10 mb-8">
           <div className="bg-[#111111] border border-white/10 rounded-full px-6 py-3 flex items-center gap-6 shadow-xl backdrop-blur-md">
             <button onClick={() => setCurrentIndex(prev => Math.max(0, prev - 10))} className="text-gray-500 hover:text-white"><Rewind size={20}/></button>
             <button onClick={startReading} className="w-14 h-14 bg-white text-black rounded-full flex items-center justify-center hover:scale-105 transition-transform shadow-[0_0_20px_rgba(255,255,255,0.1)]">
               <Play size={24} className="fill-current ml-1" />
             </button>
             <button onClick={() => setCurrentIndex(prev => Math.min(words.length - 1, prev + 10))} className="text-gray-500 hover:text-white"><FastForward size={20}/></button>
             <div className="w-px h-6 bg-gray-800 mx-2"></div>
             <button onClick={() => setIsNoteModalOpen(true)} className="flex items-center gap-2 text-gray-300 hover:text-white font-medium">
               <Edit3 size={16} /> Not Al
             </button>
           </div>
        </div>

        <div className="bg-[#111111] px-8 py-5 flex justify-between items-center border-t border-white/5">
          <div className="flex gap-8">
            <div>
              <div className="text-[10px] text-gray-500 font-bold tracking-widest uppercase mb-1">Hız (Speed)</div>
              <div className="text-white font-mono font-bold text-lg">{settings.baseWpm} <span className="text-xs text-gray-500">WPM</span></div>
            </div>
            <div>
              <div className="text-[10px] text-gray-500 font-bold tracking-widest uppercase mb-1">İlerleme</div>
              <div className="text-white font-mono font-bold text-lg">% {progress.toFixed(1)}</div>
            </div>
          </div>
          <div className="flex gap-3">
             <button onClick={() => setSettings({...settings, redLetter: !settings.redLetter})} className="flex items-center gap-2 px-3 py-1.5 bg-[#1a1a1a] rounded border border-white/5 text-xs font-medium text-gray-300 hover:bg-[#222]">
                Odak Harfi: <span className={settings.redLetter ? "text-red-500" : "text-gray-500"}>{settings.redLetter ? "AÇIK" : "KAPALI"}</span>
             </button>
             <button onClick={() => setSettings({...settings, ghostWords: !settings.ghostWords})} className="flex items-center gap-2 px-3 py-1.5 bg-[#1a1a1a] rounded border border-white/5 text-xs font-medium text-gray-300 hidden md:flex hover:bg-[#222]">
                Bağlam: <span className={settings.ghostWords ? "text-green-500" : "text-gray-500"}>{settings.ghostWords ? "AÇIK" : "KAPALI"}</span>
             </button>
          </div>
        </div>
      </div>

      <div className="mt-10">
         <div className="flex justify-between items-end mb-4">
            <h3 className="text-lg font-bold text-white">Kitaplık Özeti</h3>
            <button onClick={() => setActiveTab('library')} className="text-sm text-gray-400 hover:text-white">Tümünü Gör</button>
         </div>
         <div className="flex gap-4 overflow-x-auto pb-4 hide-scrollbar">
            <div onClick={() => setIsBookDetailModalOpen(true)} className="bg-[#0a0a0a] border border-white/20 p-4 rounded-2xl min-w-[240px] flex gap-4 cursor-pointer group hover:border-white/40 transition-colors">
              <div className="w-12 h-16 bg-[#1a1a1a] rounded flex items-center justify-center relative overflow-hidden flex-shrink-0">
                <BookOpen size={16} className="text-gray-300" />
                <div className="absolute bottom-0 w-full h-1 bg-gray-800"><div className="h-full bg-white" style={{width: `${progress}%`}}></div></div>
              </div>
              <div className="flex flex-col justify-center overflow-hidden">
                <div className="text-sm font-bold text-white truncate">{currentBookTitle}</div>
                <div className="text-xs text-gray-500 mt-1">% {progress.toFixed(1)} Okundu</div>
              </div>
            </div>
            <div onClick={handleFileUploadClick} className="bg-transparent border border-dashed border-gray-700 hover:border-gray-500 p-4 rounded-2xl min-w-[180px] flex items-center justify-center gap-3 cursor-pointer text-gray-500 hover:text-gray-300 transition-colors">
               <UploadCloud size={20} /> <span className="text-sm font-medium">Yeni Kitap</span>
            </div>
         </div>
      </div>
    </div>
  );

  const renderLibraryTab = () => (
    <div className="flex-1 flex flex-col p-6 md:p-10 overflow-y-auto">
      <h1 className="text-3xl font-bold text-white tracking-tight mb-8">Kütüphane</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div onClick={() => setIsBookDetailModalOpen(true)} className="bg-[#0a0a0a] border border-white/20 p-5 rounded-2xl flex gap-5 cursor-pointer hover:border-white/40 transition-all">
          <div className="w-16 h-24 bg-[#1a1a1a] rounded-lg flex items-center justify-center relative overflow-hidden flex-shrink-0">
            <BookOpen size={24} className="text-gray-300" />
            <div className="absolute bottom-0 w-full h-1 bg-gray-800"><div className="h-full bg-white" style={{width: `${progress}%`}}></div></div>
          </div>
          <div className="flex flex-col justify-center overflow-hidden">
            <div className="text-lg font-bold text-white truncate">{currentBookTitle}</div>
            <div className="text-sm text-gray-500 mb-2">Mevcut Kitap</div>
            <div className="text-xs text-gray-400">% {progress.toFixed(1)} Okundu</div>
          </div>
        </div>
        <div onClick={handleFileUploadClick} className="bg-[#0a0a0a] border border-dashed border-gray-700 p-5 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:border-gray-500 hover:bg-[#111] transition-all text-gray-400">
           <UploadCloud size={32} className="mb-2" />
           <span className="font-medium">Yeni PDF veya EPUB Yükle</span>
        </div>
      </div>
    </div>
  );

  const renderSettingsTab = () => (
    <div className="flex-1 flex flex-col p-6 md:p-10 overflow-y-auto">
      <h1 className="text-3xl font-bold text-white tracking-tight mb-8">Ayarlar</h1>
      
      {/* Hesap Ayarları */}
      <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-6 max-w-2xl mb-6 shadow-lg">
        <h3 className="text-lg font-medium text-white mb-6">Hesap Ayarları</h3>
        <div className="flex items-center gap-6 mb-6">
          <div className="w-20 h-20 rounded-full bg-[#111] border-2 border-white/10 overflow-hidden">
            <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix" alt="Profil" className="w-full h-full object-cover" />
          </div>
          <div>
            <h4 className="text-xl font-bold text-white">Efe</h4>
            <p className="text-sm text-gray-500 mb-2">efe@26reader.com</p>
            <span className="bg-white/10 text-white text-xs font-bold px-3 py-1 rounded-full border border-white/5">Pro Üye</span>
          </div>
        </div>
        <div className="w-full h-px bg-white/5 mb-6"></div>
        <button onClick={() => {
           localStorage.clear();
           window.location.reload();
        }} className="text-sm text-red-500 hover:text-red-400 font-medium transition-colors">Tüm Verileri Temizle (Çıkış Yap)</button>
      </div>

      {/* Okuma Deneyimi */}
      <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-6 max-w-2xl shadow-lg">
        <h3 className="text-lg font-medium text-white mb-6">Okuma Deneyimi</h3>
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-white font-medium mb-1">Kırmızı Odak Harfi</div>
            <div className="text-sm text-gray-500">Ortadaki harfi kırmızı yaparak göz takibini kolaylaştırır.</div>
          </div>
          <button onClick={() => setSettings({...settings, redLetter: !settings.redLetter})} className={`w-14 h-8 rounded-full transition-colors relative ${settings.redLetter ? 'bg-red-500' : 'bg-[#1a1a1a]'}`}>
            <div className={`w-6 h-6 bg-white rounded-full absolute top-1 transition-transform ${settings.redLetter ? 'left-7' : 'left-1'}`}></div>
          </button>
        </div>
        <div className="w-full h-px bg-white/5 mb-6"></div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-white font-medium mb-1">Hayalet Kelimeler (Bağlam)</div>
            <div className="text-sm text-gray-500">Önceki ve sonraki kelimeleri soluk göstererek bağlamı korur.</div>
          </div>
          <button onClick={() => setSettings({...settings, ghostWords: !settings.ghostWords})} className={`w-14 h-8 rounded-full transition-colors relative ${settings.ghostWords ? 'bg-white' : 'bg-[#1a1a1a]'}`}>
            <div className={`w-6 h-6 bg-black rounded-full absolute top-1 transition-transform ${settings.ghostWords ? 'left-7' : 'left-1'}`}></div>
          </button>
        </div>
      </div>
    </div>
  );

  // ================= UYGULAMA MODLARI =================

  // 1. TAM EKRAN OKUMA MODU
  if (appMode === 'playing') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col w-full h-full bg-black justify-center items-center cursor-pointer" onClick={pauseToContext}>
        <div className="absolute top-0 w-full p-6 flex justify-between items-center text-gray-600 z-10">
          <div className="text-sm font-medium tracking-widest uppercase truncate max-w-[60%]">{currentBookTitle}</div>
          <div className="text-sm px-3 py-1 bg-[#111] rounded-full font-mono">{settings.baseWpm} WPM</div>
        </div>

        <div className="w-full max-w-4xl flex flex-col items-center relative">
          {settings.ghostWords && (
            <>
              <div className="absolute left-4 md:left-24 top-1/2 -translate-y-1/2 opacity-20 text-2xl md:text-4xl blur-[1px] text-gray-400 max-w-[25%] truncate text-right">{prevWord}</div>
              <div className="absolute right-4 md:right-24 top-1/2 -translate-y-1/2 opacity-20 text-2xl md:text-4xl blur-[1px] text-gray-400 max-w-[25%] truncate text-left">{nextWord}</div>
            </>
          )}
          {renderWord(words[currentIndex], 'large')}
          <div className="absolute -bottom-8 left-1/2 transform -translate-x-1/2 w-16 h-[2px] bg-gray-800 rounded-full"></div>
        </div>
        
        <div className="absolute bottom-12 text-gray-700 text-sm animate-pulse tracking-wide">Duraklatmak için dokun</div>
        <div className="absolute bottom-0 left-0 w-full h-[2px] bg-[#111]">
          <div className="h-full bg-gray-400 transition-all duration-100 ease-linear" style={{ width: `${progress}%` }}></div>
        </div>
      </div>
    );
  }

  // 2. PARAGRAF (KAYDIRILABİLİR KİTAP) MODU
  if (appMode === 'context') {
    let startIdx = Math.max(0, currentIndex - 1500);
    const currentChap = [...chapters].reverse().find(c => c.wordIndex <= currentIndex);
    if (currentChap && currentChap.wordIndex >= startIdx) {
        startIdx = currentChap.wordIndex;
    }
    const endIdx = Math.min(words.length, startIdx + 3000); 
    const contextWords = words.slice(startIdx, endIdx);
    
    const chapterTitleIndexes = new Set();
    chapters.forEach(chap => {
        const wordCount = chap.title.split(' ').length;
        for(let i=0; i<wordCount; i++) chapterTitleIndexes.add(chap.wordIndex + i);
    });

    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-[#050505] p-6 md:p-12 overflow-hidden">
        <div className="flex justify-between items-center mb-8 border-b border-white/5 pb-6">
          <button onClick={returnToDashboard} className="flex items-center gap-2 text-gray-500 hover:text-white transition-colors group">
            <div className="p-2 bg-[#111] rounded-full group-hover:bg-gray-800 transition-colors"><ArrowLeft size={20} /></div>
            <span className="font-medium">Ana Ekran</span>
          </button>
          <div className="text-center absolute left-1/2 -translate-x-1/2 hidden md:block">
            <h2 className="text-lg font-bold text-gray-300 tracking-wide truncate max-w-md">{currentBookTitle}</h2>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setIsBookDetailModalOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-[#111] border border-white/10 text-gray-300 rounded-xl hover:bg-[#1a1a1a] transition-all">
              <List size={18} /> <span className="font-medium hidden sm:inline">Kitap Menüsü</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto mb-8 flex flex-col max-w-4xl mx-auto w-full pr-4 custom-scrollbar">
          <div className="text-gray-400 text-lg md:text-xl leading-relaxed font-serif text-justify p-4">
            {startIdx > 0 && <span className="block text-center text-gray-600 mb-6 italic">... önceki sayfalar ...</span>}
            {contextWords.map((word, idx) => {
              const absoluteIdx = startIdx + idx;
              const isCurrent = absoluteIdx === currentIndex;
              const isChapterTitleWord = chapterTitleIndexes.has(absoluteIdx);
              const isChapterStart = chapters.some(c => c.wordIndex === absoluteIdx);
              const breakElement = isChapterStart && absoluteIdx !== startIdx ? <><br/><br/><br/></> : null;
              const titleCss = isChapterTitleWord ? "text-gray-100 font-bold uppercase tracking-widest text-2xl md:text-3xl" : "";

              return (
                <React.Fragment key={absoluteIdx}>
                  {breakElement}
                  <span 
                    ref={isCurrent ? currentWordRef : null}
                    className={`cursor-pointer transition-all ${isCurrent ? 'bg-[#1a1a1a] text-white px-2 py-1 rounded shadow-lg border border-white/10' : 'hover:text-gray-100'} ${titleCss}`} 
                    onClick={() => setCurrentIndex(absoluteIdx)}
                  >
                    {isCurrent ? renderWord(word, 'small') : word}
                  </span>{" "}
                </React.Fragment>
              );
            })}
            {endIdx < words.length && <span className="block text-center text-gray-600 mt-6 italic">... sonraki sayfalar ...</span>}
          </div>
        </div>

        <div className="w-full max-w-2xl mx-auto bg-[#0a0a0a] border border-white/10 rounded-2xl p-3 flex items-center justify-between shadow-2xl">
          <button onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))} className="p-4 text-gray-500 hover:text-white rounded-xl hover:bg-[#111] transition-all"><ChevronLeft size={24} /></button>
          <button onClick={startReading} className="px-12 py-4 bg-white text-black rounded-xl flex items-center justify-center gap-3 hover:bg-gray-200 transition-all shadow-lg">
             <Play size={24} className="fill-current" />
             <span className="font-bold tracking-wide">Okumaya Devam Et</span>
          </button>
          <button onClick={() => setCurrentIndex(prev => Math.min(words.length - 1, prev + 1))} className="p-4 text-gray-500 hover:text-white rounded-xl hover:bg-[#111] transition-all"><ChevronRight size={24} /></button>
        </div>
      </div>
    );
  }

  // 3. ANA EKRAN (DASHBOARD)
  return (
    <div className="h-screen w-full flex bg-[#050505] font-sans overflow-hidden text-gray-300">
      <input type="file" accept="application/pdf,.epub,application/epub+zip" ref={fileInputRef} onChange={handleFileChange} className="hidden" />

      {isProcessingPdf && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[100] flex flex-col items-center justify-center">
          <Loader2 size={48} className="text-white animate-spin mb-4" />
          <h3 className="text-2xl font-bold text-white mb-2">Kitap İşleniyor</h3>
          <p className="text-gray-500">PDF/EPUB dosyası ayrıştırılıyor, lütfen bekleyin...</p>
        </div>
      )}

      {/* YENİ SOL MENÜ */}
      <div className="w-16 flex-shrink-0 z-40 relative">
        <div className="absolute top-0 left-0 h-full w-16 hover:w-56 bg-[#0a0a0a] border-r border-white/5 flex flex-col transition-all duration-300 ease-in-out group shadow-[10px_0_30px_rgba(0,0,0,0.8)] overflow-hidden">
          
          {/* Logo Alanı */}
          <div className="h-24 flex items-center justify-center group-hover:justify-start group-hover:px-4 border-b border-white/5 transition-all duration-300 w-56">
            <div className="flex items-center gap-3">
              <div className="bg-white text-black font-bold p-1 rounded text-base flex-shrink-0 w-8 h-8 flex items-center justify-center shadow-lg">26</div>
              <span className="text-white font-bold text-lg tracking-wide opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">reader</span>
            </div>
          </div>

          {/* Navigasyon */}
          <div className="flex flex-col py-6 gap-2 px-2 group-hover:px-4 transition-all duration-300 w-56">
            <button onClick={() => setActiveTab('read')} className={`flex items-center px-3 py-3 rounded-lg transition-all overflow-hidden ${activeTab === 'read' ? 'bg-[#1a1a1a] text-white border border-white/5' : 'text-gray-600 hover:text-gray-300 hover:bg-[#111]'}`}>
              <div className="w-6 flex justify-center flex-shrink-0">
                <BookOpen size={18} className={activeTab === 'read' ? 'fill-current opacity-20' : ''} />
              </div>
              <div className="overflow-hidden transition-all duration-300 opacity-0 group-hover:opacity-100 ml-0 group-hover:ml-4 flex items-center">
                <span className="font-medium text-sm whitespace-nowrap">Okuma</span>
              </div>
            </button>
            <button onClick={() => setActiveTab('library')} className={`flex items-center px-3 py-3 rounded-lg transition-all overflow-hidden ${activeTab === 'library' ? 'bg-[#1a1a1a] text-white border border-white/5' : 'text-gray-600 hover:text-gray-300 hover:bg-[#111]'}`}>
              <div className="w-6 flex justify-center flex-shrink-0">
                <Library size={18} className={activeTab === 'library' ? 'fill-current opacity-20' : ''} />
              </div>
              <div className="overflow-hidden transition-all duration-300 opacity-0 group-hover:opacity-100 ml-0 group-hover:ml-4 flex items-center">
                <span className="font-medium text-sm whitespace-nowrap">Kütüphane</span>
              </div>
            </button>
            <button onClick={() => setActiveTab('settings')} className={`flex items-center px-3 py-3 rounded-lg transition-all overflow-hidden ${activeTab === 'settings' ? 'bg-[#1a1a1a] text-white border border-white/5' : 'text-gray-600 hover:text-gray-300 hover:bg-[#111]'}`}>
              <div className="w-6 flex justify-center flex-shrink-0">
                <Settings size={18} />
              </div>
              <div className="overflow-hidden transition-all duration-300 opacity-0 group-hover:opacity-100 ml-0 group-hover:ml-4 flex items-center">
                <span className="font-medium text-sm whitespace-nowrap">Ayarlar</span>
              </div>
            </button>
          </div>

          {/* Profil */}
          <div className="mt-auto border-t border-white/5 p-4 flex items-center justify-center group-hover:justify-start transition-all duration-300 w-56">
             <div className="w-8 h-8 rounded-full bg-[#111] border border-gray-600 overflow-hidden flex-shrink-0 shadow-lg cursor-pointer">
                <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix" alt="Profil" className="w-full h-full object-cover" />
             </div>
             <div className="overflow-hidden transition-all duration-300 opacity-0 group-hover:opacity-100 ml-0 group-hover:ml-3 flex flex-col justify-center cursor-pointer">
               <span className="text-xs font-bold text-white whitespace-nowrap">Efe</span>
               <span className="text-[10px] text-gray-500 whitespace-nowrap">Pro</span>
             </div>
          </div>
        </div>
      </div>

      {/* ORTA & SAĞ ALAN */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* MERKEZ (Sekme İçerikleri) */}
        {activeTab === 'read' && renderReadDashboard()}
        {activeTab === 'library' && renderLibraryTab()}
        {activeTab === 'settings' && renderSettingsTab()}

        {/* SAĞ PANEL (İstatistikler & Notlar) */}
        <div className="w-56 bg-[#0a0a0a] border-l border-white/5 hidden lg:flex flex-col flex-shrink-0">
           <div className="p-5 pb-3">
              <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-4">İstatistikler</h3>
              
              <div className="bg-[#111111] border border-white/5 rounded-2xl p-5 mb-4 relative overflow-hidden group shadow-md">
                 <div className="absolute -right-4 -top-4 opacity-[0.03] text-white group-hover:scale-110 transition-transform"><Clock size={90} /></div>
                 <div className="text-[10px] text-gray-500 font-bold mb-2">KAZANILAN ZAMAN</div>
                 <div className="text-2xl font-bold text-white tracking-tight">12s <span className="text-gray-400 text-lg">43d</span></div>
                 <div className="inline-block mt-3 bg-green-500/10 border border-green-500/20 text-[10px] font-mono text-green-400 px-2.5 py-1 rounded-md">
                    Verimlilik: +%340
                 </div>
              </div>

              <div className="bg-[#111111] border border-white/5 rounded-2xl p-5 flex flex-col justify-between shadow-md">
                 <div className="flex justify-between items-center mb-3">
                   <div className="text-[10px] text-gray-500 font-bold">OKUNAN SÜRE</div>
                   <div className="w-8 h-8 rounded-full bg-[#1a1a1a] flex items-center justify-center text-gray-400"><BookOpen size={12}/></div>
                 </div>
                 <div className="text-xl font-bold text-white tracking-tight">4s 12d</div>
              </div>
           </div>

           <div className="flex-1 p-5 pt-2 overflow-y-auto custom-scrollbar">
              <div className="flex justify-between items-center mb-4 mt-2">
                 <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Son Notlar</h3>
                 <span className="text-[10px] text-gray-400 font-medium bg-white/5 px-2 py-1 rounded-md border border-white/5">{notes.length} Adet</span>
              </div>
              <div className="space-y-3">
                 {notes.slice(0,4).map(note => (
                   <div key={note.id} className="bg-[#111111] border border-white/5 p-4 rounded-xl flex flex-col gap-2 shadow-sm">
                      <div className="text-[9px] text-gray-400 truncate bg-[#1a1a1a] self-start px-2 py-1 rounded-md border border-white/5">📚 {note.bookTitle}</div>
                      <p className="text-xs text-gray-300 leading-relaxed line-clamp-4">{note.text}</p>
                   </div>
                 ))}
                 {notes.length === 0 && <div className="text-xs text-gray-600 text-center py-6 border border-dashed border-white/10 rounded-xl">Henüz not almadınız.</div>}
              </div>
           </div>
        </div>

      </div>

      {/* YENİ KINDLE TARZI KİTAP DETAY MODALI (SİYAH TEMA & HİYERARŞİK) */}
      {isBookDetailModalOpen && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 z-[100]">
            <div className="w-full max-w-4xl rounded-xl flex flex-col md:flex-row overflow-hidden shadow-2xl h-[85vh] md:h-[550px]">
               
               {/* Sol Taraf (Dark Theme - Kapak Özeti) */}
               <div className="bg-[#050505] w-full md:w-1/3 p-8 flex flex-col items-center justify-center border-r border-white/5 shadow-xl z-10">
                  <div className="w-36 h-52 bg-[#1a1a1a] rounded-md mb-6 flex items-center justify-center border border-white/10 shadow-2xl relative overflow-hidden">
                     <BookOpen size={48} className="text-gray-600" />
                     <div className="absolute bottom-0 left-0 w-full h-1.5 bg-gray-800">
                        <div className="h-full bg-white" style={{ width: `${progress}%` }}></div>
                     </div>
                  </div>
                  <h2 className="text-xl font-bold text-white text-center mb-2">{currentBookTitle}</h2>
                  <p className="text-gray-500 text-sm mb-8 font-mono">% {progress.toFixed(1)} Okundu</p>
                  <button 
                     onClick={() => {
                        setIsBookDetailModalOpen(false);
                        setActiveTab('read');
                        setAppMode('context');
                     }}
                     className="w-full py-3.5 bg-white text-black font-bold rounded-lg hover:bg-gray-200 transition-colors shadow-lg"
                  >
                     Kaldığın Yerden Devam Et
                  </button>
               </div>
               
               {/* Sağ Taraf (Karanlık Tema - Hiyerarşik İçindekiler) */}
               <div className="flex-1 flex flex-col bg-[#0a0a0a] text-gray-300">
                  
                  {/* Üst Sekmeler */}
                  <div className="flex border-b border-white/5 bg-[#111111]">
                     <button 
                        onClick={() => setKindleTab('contents')}
                        className={`flex-1 py-4 text-center font-bold text-sm tracking-wide transition-colors ${kindleTab === 'contents' ? 'border-b-2 border-white text-white' : 'text-gray-500 hover:text-gray-300'}`}
                     >
                        İçindekiler
                     </button>
                     <button 
                        onClick={() => setKindleTab('notes')}
                        className={`flex-1 py-4 text-center font-bold text-sm tracking-wide transition-colors ${kindleTab === 'notes' ? 'border-b-2 border-white text-white' : 'text-gray-500 hover:text-gray-300'}`}
                     >
                        Notlar & Vurgular
                     </button>
                     <button onClick={() => setIsBookDetailModalOpen(false)} className="px-5 text-gray-500 hover:text-white transition-colors border-l border-white/5">
                        <X size={20}/>
                     </button>
                  </div>

                  {/* Liste Alanı */}
                  <div className="flex-1 overflow-y-auto px-8 py-2 custom-scrollbar">
                     
                     {kindleTab === 'contents' && (
                        <div className="flex flex-col">
                           <button 
                              onClick={() => { setCurrentIndex(0); setIsBookDetailModalOpen(false); setActiveTab('read'); setAppMode('context'); }}
                              className="py-4 border-b border-white/5 font-medium text-base text-gray-300 text-left hover:text-white transition-colors"
                           >
                              Başlangıç
                           </button>
                           
                           {chapters.map((mainChap, idx) => {
                              // Ana Bölüm Aktif Mi?
                              const isNextChapExists = idx < chapters.length - 1;
                              const isMainCurrent = currentIndex >= mainChap.wordIndex && (!isNextChapExists || currentIndex < chapters[idx+1].wordIndex);

                              return (
                                 <React.Fragment key={idx}>
                                    {/* ANA BÖLÜM */}
                                    <button 
                                       onClick={() => { 
                                          setCurrentIndex(mainChap.wordIndex); 
                                          setIsBookDetailModalOpen(false);
                                          setActiveTab('read');
                                          setAppMode('context');
                                       }}
                                       className={`py-4 border-b border-white/5 flex justify-between items-center text-left transition-colors
                                         ${isMainCurrent ? 'text-white font-bold' : 'text-gray-300 hover:text-white'}`}
                                    >
                                       <span className="truncate pr-4 text-base">{mainChap.title}</span>
                                       <span className="text-gray-600 font-mono text-xs">{Math.floor(mainChap.wordIndex / 250) + 1}</span>
                                    </button>

                                    {/* ALT BÖLÜMLER (Roma Rakamları vs.) */}
                                    {mainChap.subChapters && mainChap.subChapters.map((subChap, subIdx) => {
                                        const isNextSubExists = subIdx < mainChap.subChapters.length - 1;
                                        const endIdx = isNextSubExists ? mainChap.subChapters[subIdx+1].wordIndex : (isNextChapExists ? chapters[idx+1].wordIndex : words.length);
                                        const isSubCurrent = currentIndex >= subChap.wordIndex && currentIndex < endIdx;

                                        return (
                                          <button 
                                             key={`sub-${idx}-${subIdx}`}
                                             onClick={() => { 
                                                setCurrentIndex(subChap.wordIndex); 
                                                setIsBookDetailModalOpen(false);
                                                setActiveTab('read');
                                                setAppMode('context');
                                             }}
                                             className={`py-3 pl-8 pr-0 border-b border-white/5 flex justify-between items-center text-left transition-colors
                                               ${isSubCurrent ? 'text-white font-medium' : 'text-gray-500 hover:text-gray-300'}`}
                                          >
                                             <span className="truncate pr-4 text-sm font-serif tracking-widest">{subChap.title}</span>
                                             <span className="text-gray-600 font-mono text-xs">{Math.floor(subChap.wordIndex / 250) + 1}</span>
                                          </button>
                                        )
                                    })}
                                 </React.Fragment>
                              )
                           })}
                        </div>
                     )}

                     {kindleTab === 'notes' && (
                        <div className="flex flex-col gap-4 py-6">
                           {notes.filter(n => n.bookTitle === currentBookTitle).length === 0 ? (
                              <p className="text-gray-600 text-center py-10 italic text-sm">Bu kitap için henüz not almadınız.</p>
                           ) : (
                              notes.filter(n => n.bookTitle === currentBookTitle).map((note, idx) => (
                                 <div key={idx} className="bg-[#111111] border border-white/5 p-5 rounded-xl shadow-sm">
                                    <div className="flex justify-between items-center mb-3">
                                       <span className="font-bold text-gray-300 bg-[#1a1a1a] px-2.5 py-1 rounded-md text-[10px] uppercase tracking-wider border border-white/5">Not</span>
                                       <span className="text-gray-600 text-xs font-mono">{note.date} - {note.time}</span>
                                    </div>
                                    <p className="text-gray-300 text-sm leading-relaxed">{note.text}</p>
                                 </div>
                              ))
                           )}
                        </div>
                     )}

                  </div>
               </div>
            </div>
          </div>
      )}

      {/* Not Modalı */}
      {isNoteModalOpen && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 z-[100]">
            <div className="bg-[#111111] border border-white/10 w-full max-w-lg rounded-2xl p-8 shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Edit3 size={18} className="text-gray-400"/> Okuma Notu
                </h3>
                <button onClick={() => setIsNoteModalOpen(false)} className="text-gray-500 hover:text-white bg-[#1a1a1a] p-2 rounded-full"><X size={16} /></button>
              </div>
              <textarea
                autoFocus
                className="w-full h-32 bg-[#050505] border border-white/10 rounded-xl p-4 text-white focus:outline-none focus:border-gray-500 focus:ring-1 focus:ring-gray-500 resize-none transition-all placeholder-gray-700 text-sm"
                placeholder="Bu kısım hakkında ne düşünüyorsun?"
                value={currentNoteText}
                onChange={(e) => setCurrentNoteText(e.target.value)}
              />
              <div className="mt-6 flex justify-end">
                <button onClick={saveNote} className="px-6 py-2.5 bg-white text-black font-bold rounded-lg hover:bg-gray-200 transition-colors shadow-lg text-sm">
                  Notu Kaydet
                </button>
              </div>
            </div>
          </div>
      )}
    </div>
  );
}
