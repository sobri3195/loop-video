import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { 
  Upload, 
  Scissors, 
  Download, 
  Play, 
  Trash2, 
  Plus, 
  Settings, 
  CheckCircle2, 
  AlertCircle,
  X,
  FileArchive,
  Copy,
  LayoutGrid,
  List as ListIcon,
  RefreshCw,
  Clock,
  Zap,
  ShieldCheck,
  Type,
  Maximize,
  Volume2
} from 'lucide-react';
import { createZip } from './utils/zip';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

const DEFAULT_TRIM_SETTINGS = {
  duration: 30,
  autoFit: 'merge', // 'merge', 'discard'
  remainderThreshold: 5,
  mode: 'copy', // 'copy', 'encode'
  template: '{name}_part{index}_{start}-{end}',
};

const PREMIUM_SETTINGS = {
  watermark: '',
  resize: 'none', // 'none', '9:16'
  normalize: false,
  quality: 'Medium', // 'Low', 'Medium', 'High'
};

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [videoFile, setVideoFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [duration, setDuration] = useState(0);
  const [markers, setMarkers] = useState([]);
  const [clips, setClips] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTask, setCurrentTask] = useState('');
  const [message, setMessage] = useState({ text: 'Memuat ffmpeg...', type: 'info' });
  const [trimSettings, setTrimSettings] = useState(DEFAULT_TRIM_SETTINGS);
  const [premiumSettings, setPremiumSettings] = useState(PREMIUM_SETTINGS);
  const [history, setHistory] = useState([]);
  const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'list'
  const [isDragging, setIsDragging] = useState(false);

  const ffmpegRef = useRef(new FFmpeg());
  const videoRef = useRef(null);
  const shouldProcessRef = useRef(false);

  useEffect(() => {
    loadFFmpeg();
  }, []);

  const loadFFmpeg = async () => {
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    const ffmpeg = ffmpegRef.current;

    ffmpeg.on('log', ({ message }) => {
      console.log(message);
    });

    ffmpeg.on('progress', ({ progress }) => {
      // This is for internal ffmpeg progress (within a single exec)
      // We'll combine it with our manual clip progress
    });

    const loadWithRetry = async (retries = 3) => {
      for (let i = 0; i < retries; i++) {
        try {
          setMessage({ text: `Memuat FFmpeg... (${i + 1}/${retries})`, type: 'info' });
          await ffmpeg.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
          });
          setLoaded(true);
          setMessage({ text: 'FFmpeg siap!', type: 'success' });
          return true;
        } catch (error) {
          console.error(`Gagal memuat FFmpeg (percobaan ${i + 1}):`, error);
          if (i === retries - 1) {
            setMessage({
              text: 'Gagal memuat FFmpeg. Pastikan browser mendukung SharedArrayBuffer.',
              type: 'error'
            });
            return false;
          }
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      return false;
    };

    await loadWithRetry();
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setVideoFile(file);
      setVideoUrl(URL.createObjectURL(file));
      setMarkers([]);
      setClips([]);
      setProgress(0);
      setMessage({ text: `Video dimuat: ${file.name}`, type: 'success' });
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('video/')) {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setVideoFile(file);
      setVideoUrl(URL.createObjectURL(file));
      setMarkers([]);
      setClips([]);
      setProgress(0);
      setMessage({ text: `Video dimuat: ${file.name}`, type: 'success' });
    } else {
      setMessage({ text: 'Mohon upload file video (MP4, WebM)', type: 'error' });
    }
  };

  const onLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  const addMarker = () => {
    if (videoRef.current) {
      const time = videoRef.current.currentTime;
      if (!markers.includes(time)) {
        setMarkers([...markers, time].sort((a, b) => a - b));
      }
    }
  };

  const removeMarker = (index) => {
    setMarkers(markers.filter((_, i) => i !== index));
  };

  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return [h, m, s]
      .map(v => v.toString().padStart(2, '0'))
      .filter((v, i) => v !== '00' || i > 0)
      .join(':');
  };

  const generateClipName = (index, start, end) => {
    const baseName = videoFile.name.replace(/\.[^/.]+$/, "");
    return trimSettings.template
      .replace('{name}', baseName)
      .replace('{part}', (index + 1).toString().padStart(3, '0'))
      .replace('{index}', (index + 1).toString())
      .replace('{start}', Math.floor(start).toString())
      .replace('{end}', Math.floor(end).toString()) + '.mp4';
  };

  const processVideo = async () => {
    if (!videoFile || !loaded) return;

    shouldProcessRef.current = true;
    setIsProcessing(true);
    setProgress(0);
    setClips([]);

    const ffmpeg = ffmpegRef.current;
    const inputName = 'input_' + videoFile.name;

    try {
      setCurrentTask('Menyiapkan file...');
      await ffmpeg.writeFile(inputName, await fetchFile(videoFile));

      let intervals = [];
      if (markers.length > 0) {
        // Split by markers
        let lastTime = 0;
        const sortedMarkers = [...markers, duration].sort((a, b) => a - b);
        for (let m of sortedMarkers) {
          if (m > lastTime + 0.1) {
            intervals.push({ start: lastTime, end: m });
          }
          lastTime = m;
        }
      } else {
        // Auto split by duration
        const clipDur = parseFloat(trimSettings.duration);
        let current = 0;
        while (current < duration) {
          let end = Math.min(current + clipDur, duration);
          const remainder = duration - end;

          if (remainder > 0 && remainder < parseFloat(trimSettings.remainderThreshold)) {
            if (trimSettings.autoFit === 'merge') {
              end = duration;
            } else if (trimSettings.autoFit === 'discard') {
              intervals.push({ start: current, end: end });
              current = duration; // stop
              break;
            }
          }

          intervals.push({ start: current, end: end });
          current = end;
          if (current >= duration) break;
        }
      }

      if (intervals.length === 0) {
        setMessage({ text: 'Tidak ada klip yang dapat dibuat.', type: 'error' });
        setIsProcessing(false);
        return;
      }

      const generatedClips = [];
      for (let i = 0; i < intervals.length; i++) {
        // Check for cancellation using ref
        if (!shouldProcessRef.current && i > 0) {
          setMessage({ text: 'Proses dibatalkan.', type: 'info' });
          break;
        }

        const { start, end } = intervals[i];
        const clipDur = end - start;
        const outputName = generateClipName(i, start, end);

        setCurrentTask(`Memotong bagian ${i + 1} dari ${intervals.length}...`);

        let args = [
          '-ss', start.toFixed(3),
          '-i', inputName,
          '-t', clipDur.toFixed(3),
        ];

        if (trimSettings.mode === 'copy' && premiumSettings.resize === 'none' && !premiumSettings.normalize && !premiumSettings.watermark) {
          args.push('-c', 'copy');
        } else {
          // Encoding mode or premium features required
          let filterComplex = '';
          let lastLabel = '[0:v]';

          if (premiumSettings.resize === '9:16') {
             filterComplex += `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:10[bg];`;
             filterComplex += `[0:v]scale=1080:1920:force_original_aspect_ratio=decrease[fg];`;
             filterComplex += `[bg][fg]overlay=(W-w)/2:(H-h)/2[v];`;
             lastLabel = '[v]';
          }

          if (premiumSettings.watermark) {
            filterComplex += `${lastLabel}drawtext=text='${premiumSettings.watermark}':x=w-tw-20:y=h-th-20:fontsize=48:fontcolor=white:shadowcolor=black:shadowx=2:shadowy=2[v_out];`;
            lastLabel = '[v_out]';
          }

          if (filterComplex) {
            // Remove trailing semicolon
            if (filterComplex.endsWith(';')) filterComplex = filterComplex.slice(0, -1);
            args.push('-filter_complex', filterComplex);
            args.push('-map', lastLabel);
            args.push('-map', '0:a?');
          }

          if (premiumSettings.normalize) {
            args.push('-af', 'loudnorm');
          }

          args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', premiumSettings.quality === 'High' ? '18' : premiumSettings.quality === 'Medium' ? '23' : '28');
          args.push('-c:a', 'aac', '-b:a', '128k');
        }

        args.push(outputName);

        await ffmpeg.exec(args);

        const data = await ffmpeg.readFile(outputName);
        const url = URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }));

        // Generate thumbnail (first frame)
        const thumbName = `thumb_${i}.jpg`;
        try {
          await ffmpeg.exec([
              '-ss', start.toFixed(3),
              '-i', inputName,
              '-vframes', '1',
              '-q:v', '2',
              thumbName
          ]);
          const thumbData = await ffmpeg.readFile(thumbName);
          const thumbUrl = URL.createObjectURL(new Blob([thumbData.buffer], { type: 'image/jpeg' }));

          const newClip = {
            id: Math.random().toString(36).substr(2, 9),
            url,
            thumbUrl,
            name: outputName,
            index: i,
            startTime: start,
            endTime: end,
            duration: clipDur
          };

          generatedClips.push(newClip);
        } catch (thumbError) {
          console.error('Gagal membuat thumbnail:', thumbError);
          // Add clip without thumbnail if thumbnail generation fails
          const newClip = {
            id: Math.random().toString(36).substr(2, 9),
            url,
            thumbUrl: '',
            name: outputName,
            index: i,
            startTime: start,
            endTime: end,
            duration: clipDur
          };

          generatedClips.push(newClip);
        }

        setClips([...generatedClips]);
        setProgress(((i + 1) / intervals.length) * 100);
      }

      if (shouldProcessRef.current) {
        setHistory(prev => [{
            id: Date.now(),
            name: videoFile.name,
            date: new Date().toLocaleTimeString(),
            clipsCount: generatedClips.length
        }, ...prev]);

        setMessage({ text: 'Selesai! Semua klip telah diproses.', type: 'success' });
      }
    } catch (error) {
      console.error(error);
      setMessage({ text: 'Terjadi kesalahan saat memproses: ' + error.message, type: 'error' });
    } finally {
      setIsProcessing(false);
      setCurrentTask('');
      shouldProcessRef.current = false;
    }
  };

  const handleDownloadAll = async () => {
    if (clips.length === 0) return;
    try {
      setCurrentTask('Menyiapkan ZIP...');
      setMessage({ text: 'Menyiapkan ZIP...', type: 'info' });
      const zipBlob = await createZip(clips);
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${videoFile.name.split('.')[0]}_clips.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage({ text: 'ZIP berhasil didownload!', type: 'success' });
    } catch (error) {
      setMessage({ text: 'Gagal membuat ZIP: ' + error.message, type: 'error' });
    } finally {
      setCurrentTask('');
    }
  };

  const cancelProcessing = () => {
    shouldProcessRef.current = false;
    setMessage({ text: 'Membatalkan proses...', type: 'info' });
  };

  const copyCaptions = () => {
    const captions = clips.map(c => `Part ${c.index + 1} (${formatTime(c.startTime)} - ${formatTime(c.endTime)})`).join('\n');
    navigator.clipboard.writeText(captions);
    setMessage({ text: 'Caption disalin ke clipboard!', type: 'success' });
  };

  const removeClip = (id) => {
    setClips(clips.filter(c => c.id !== id));
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 p-4 md:p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-neutral-800 pb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
              Smart Video Clipper
            </h1>
            <p className="text-sm md:text-base text-neutral-500 mt-1">Potong video cerdas untuk TikTok, Shorts, dan Reels.</p>
          </div>
          
          <div className="flex items-center gap-3">
             {!loaded && (
                 <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-500/10 text-yellow-500 rounded-full text-sm border border-yellow-500/20">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Memuat FFmpeg...</span>
                 </div>
             )}
             {loaded && (
                 <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 text-green-500 rounded-full text-sm border border-green-500/20">
                    <ShieldCheck className="w-4 h-4" />
                    <span>FFmpeg Siap</span>
                 </div>
             )}
          </div>
        </header>

        <main className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column - Controls & Preview */}
          <div className="lg:col-span-7 space-y-6">
            {/* Upload Area */}
            {!videoFile ? (
              <label
                className={cn(
                  "flex flex-col items-center justify-center w-full min-h-[16rem] md:h-64 border-2 border-dashed rounded-2xl cursor-pointer transition-all duration-300",
                  isDragging
                    ? "border-blue-500 bg-blue-500/10 scale-[1.02]"
                    : "border-neutral-800 hover:border-blue-500/50 hover:bg-blue-500/5"
                )}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                }}
                onDrop={handleDrop}
              >
                <div className="flex flex-col items-center justify-center pt-5 pb-6 px-4 text-center">
                  <div className={cn(
                    "mb-4 transition-all duration-300",
                    isDragging ? "scale-110" : ""
                  )}>
                    <Upload className="w-10 h-10 md:w-12 md:h-12 text-neutral-600 group-hover:text-blue-500 transition-colors" />
                  </div>
                  <p className="mb-2 text-sm md:text-base text-neutral-400">
                    <span className="font-semibold text-neutral-200">Klik untuk upload</span> atau drag and drop
                  </p>
                  <p className="text-xs md:text-sm text-neutral-500">MP4, WebM (Maks 500MB)</p>
                </div>
                <input type="file" className="hidden" accept="video/*" onChange={handleFileUpload} />
              </label>
            ) : (
              <div className="space-y-4">
                <div className="relative aspect-video bg-black rounded-2xl overflow-hidden shadow-2xl border border-neutral-800 group">
                  <video 
                    ref={videoRef}
                    src={videoUrl} 
                    className="w-full h-full" 
                    controls 
                    onLoadedMetadata={onLoadedMetadata}
                  />
                  <button 
                    onClick={() => {
                        setVideoFile(null);
                        setMarkers([]);
                        setClips([]);
                        if (videoUrl) URL.revokeObjectURL(videoUrl);
                        setVideoUrl('');
                    }}
                    className="absolute top-2 right-2 md:top-4 md:right-4 p-2 bg-black/60 hover:bg-red-500 transition-colors rounded-full backdrop-blur-sm opacity-0 group-hover:opacity-100"
                    title="Hapus video"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                
                <div className="flex items-center justify-between gap-4">
                   <div className="flex items-center gap-2 text-sm text-neutral-400">
                      <Clock className="w-4 h-4" />
                      <span>Durasi: {formatTime(duration)}</span>
                   </div>
                   <button 
                    onClick={addMarker}
                    className="flex items-center gap-2 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-sm transition-colors"
                   >
                     <Plus className="w-4 h-4" />
                     Tambah Marker (Split)
                   </button>
                </div>

                {markers.length > 0 && (
                  <div className="flex flex-wrap gap-2 p-4 bg-neutral-900/50 rounded-xl border border-neutral-800">
                    <span className="text-xs font-semibold text-neutral-500 w-full mb-1">MARKER SPLIT ({markers.length}):</span>
                    {markers.map((m, i) => (
                      <div key={i} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-lg text-xs font-medium">
                        <span>{formatTime(m)}</span>
                        <button onClick={() => removeMarker(i)} className="hover:scale-110 transition-transform" title="Hapus marker"><X className="w-3 h-3 hover:text-red-400" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Smart Settings */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 md:p-6 space-y-6">
              <div className="flex items-center gap-2 border-b border-neutral-800 pb-4">
                <Settings className="w-5 h-5 text-blue-500 flex-shrink-0" />
                <h2 className="font-semibold text-base md:text-lg">Konfigurasi Pemotongan</h2>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-400">Durasi Per Klip</label>
                  <select 
                    value={trimSettings.duration}
                    onChange={(e) => setTrimSettings({...trimSettings, duration: e.target.value})}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 outline-none focus:border-blue-500 transition-colors"
                  >
                    <option value="15">15 Detik</option>
                    <option value="30">30 Detik</option>
                    <option value="60">60 Detik</option>
                    <option value="90">90 Detik</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-400">Penanganan Sisa</label>
                  <select 
                    value={trimSettings.autoFit}
                    onChange={(e) => setTrimSettings({...trimSettings, autoFit: e.target.value})}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 outline-none focus:border-blue-500 transition-colors"
                  >
                    <option value="merge">Gabung ke klip terakhir</option>
                    <option value="discard">Buang jika sisa sedikit</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-400">Mode Proses</label>
                  <div className="flex p-1 bg-neutral-800 rounded-lg">
                    <button 
                      onClick={() => setTrimSettings({...trimSettings, mode: 'copy'})}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all",
                        trimSettings.mode === 'copy' ? "bg-blue-600 text-white shadow-lg" : "text-neutral-400 hover:text-neutral-200"
                      )}
                    >
                      <Zap className="w-3 h-3" />
                      Instan (-c copy)
                    </button>
                    <button 
                      onClick={() => setTrimSettings({...trimSettings, mode: 'encode'})}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all",
                        trimSettings.mode === 'encode' ? "bg-blue-600 text-white shadow-lg" : "text-neutral-400 hover:text-neutral-200"
                      )}
                    >
                      <RefreshCw className="w-3 h-3" />
                      Re-encode (Rapi)
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-400">Template Nama</label>
                  <input 
                    type="text" 
                    value={trimSettings.template}
                    onChange={(e) => setTrimSettings({...trimSettings, template: e.target.value})}
                    placeholder="{name}_{part}"
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
              </div>

              {/* Premium Tools */}
              <div className="pt-4 border-t border-neutral-800">
                <div className="flex items-center gap-2 mb-4">
                  <ShieldCheck className="w-4 h-4 text-purple-500 flex-shrink-0" />
                  <span className="text-sm font-semibold text-neutral-300">Fitur Premium</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                  <button 
                    onClick={() => setPremiumSettings({...premiumSettings, resize: premiumSettings.resize === '9:16' ? 'none' : '9:16'})}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-xl border text-left transition-all",
                      premiumSettings.resize === '9:16' ? "bg-purple-500/10 border-purple-500/50 text-purple-400" : "bg-neutral-800 border-neutral-700 text-neutral-400 hover:border-neutral-600"
                    )}
                  >
                    <Maximize className="w-5 h-5" />
                    <div className="text-xs">
                      <div className="font-bold">Auto 9:16</div>
                      <div className="opacity-60 text-[10px]">Untuk Shorts/TikTok</div>
                    </div>
                  </button>

                  <button 
                    onClick={() => setPremiumSettings({...premiumSettings, normalize: !premiumSettings.normalize})}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-xl border text-left transition-all",
                      premiumSettings.normalize ? "bg-purple-500/10 border-purple-500/50 text-purple-400" : "bg-neutral-800 border-neutral-700 text-neutral-400 hover:border-neutral-600"
                    )}
                  >
                    <Volume2 className="w-5 h-5" />
                    <div className="text-xs">
                      <div className="font-bold">Normalisasi</div>
                      <div className="opacity-60 text-[10px]">Audio konsisten</div>
                    </div>
                  </button>

                  <div className="relative">
                    <Type className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                    <input 
                      type="text" 
                      placeholder="Watermark teks..."
                      value={premiumSettings.watermark}
                      onChange={(e) => setPremiumSettings({...premiumSettings, watermark: e.target.value})}
                      className="w-full bg-neutral-800 border border-neutral-700 rounded-xl pl-10 pr-3 py-3 text-xs outline-none focus:border-purple-500 transition-colors"
                    />
                  </div>
                </div>
              </div>
            </div>

            <button 
              disabled={!videoFile || isProcessing || !loaded}
              onClick={processVideo}
              className={cn(
                "w-full py-3 md:py-4 rounded-2xl font-bold text-base md:text-lg flex items-center justify-center gap-3 transition-all",
                isProcessing ? "bg-neutral-800 text-neutral-500 cursor-not-allowed" : 
                !videoFile || !loaded ? "bg-neutral-800 text-neutral-600 cursor-not-allowed" :
                "bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white shadow-lg shadow-blue-900/30 active:scale-[0.98]"
              )}
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-5 h-5 md:w-6 md:h-6 animate-spin" />
                  <span>Memproses {Math.round(progress)}%</span>
                </>
              ) : (
                <>
                  <Scissors className="w-5 h-5 md:w-6 md:h-6" />
                  <span>Mulai Potong Sekarang</span>
                </>
              )}
            </button>
            
            {isProcessing && (
              <div className="space-y-3 p-4 bg-neutral-900/50 rounded-xl border border-neutral-800 animate-in fade-in slide-in-from-top-2">
                <div className="flex justify-between text-sm items-center">
                  <span className="text-blue-400 font-medium truncate flex-1">{currentTask}</span>
                  <span className="text-neutral-400 ml-2 flex-shrink-0 font-mono">{Math.round(progress)}%</span>
                </div>
                <div className="w-full h-2 bg-neutral-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-600 to-purple-500 transition-all duration-300 ease-out shadow-[0_0_12px_rgba(59,130,246,0.6)] animate-pulse"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <button
                  onClick={cancelProcessing}
                  className="text-xs text-red-400 hover:text-red-300 hover:underline mx-auto block transition-colors"
                >
                  Batalkan Proses
                </button>
              </div>
            )}
          </div>

          {/* Right Column - Results */}
          <div className="lg:col-span-5 space-y-6">
             <div className="bg-neutral-900 border border-neutral-800 rounded-2xl flex flex-col h-[600px] lg:h-[calc(100vh-12rem)] transition-all duration-300">
                <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
                   <div className="flex items-center gap-2">
                      <LayoutGrid className="w-4 h-4 text-neutral-500" />
                      <h2 className="font-semibold">Hasil Potongan ({clips.length})</h2>
                   </div>
                   <div className="flex items-center gap-2">
                      <button
                        onClick={() => setViewMode('grid')}
                        className={cn("p-1.5 rounded-md transition-all duration-200", viewMode === 'grid' ? "bg-neutral-800 text-blue-400 scale-105" : "text-neutral-500 hover:text-neutral-300")}
                      >
                        <LayoutGrid className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setViewMode('list')}
                        className={cn("p-1.5 rounded-md transition-all duration-200", viewMode === 'list' ? "bg-neutral-800 text-blue-400 scale-105" : "text-neutral-500 hover:text-neutral-300")}
                      >
                        <ListIcon className="w-4 h-4" />
                      </button>
                   </div>
                </div>

                <div className="p-3 md:p-4 border-b border-neutral-800 bg-neutral-900/50 flex gap-2">
                   <button
                     disabled={clips.length === 0}
                     onClick={handleDownloadAll}
                     className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 disabled:from-neutral-800 disabled:to-neutral-800 disabled:text-neutral-600 text-white rounded-xl text-sm font-bold transition-all shadow-sm disabled:shadow-none hover:shadow-lg active:scale-[0.98]"
                   >
                      <FileArchive className="w-4 h-4" />
                      <span className="hidden sm:inline">Download ZIP</span>
                      <span className="sm:hidden">ZIP</span>
                   </button>
                   <button
                     disabled={clips.length === 0}
                     onClick={copyCaptions}
                     className="px-3 md:px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 disabled:text-neutral-600 disabled:cursor-not-allowed rounded-xl text-sm font-medium transition-all hover:shadow-md active:scale-[0.98]"
                     title="Copy Timestamp Caption"
                   >
                      <Copy className="w-4 h-4" />
                   </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                  {clips.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-neutral-600 space-y-3 animate-in fade-in duration-500">
                       <Scissors className="w-12 h-12 opacity-20" />
                       <p className="text-sm">Belum ada video yang diproses.</p>
                    </div>
                  ) : (
                    <div className={cn(
                        "grid gap-3 md:gap-4",
                        viewMode === 'grid' ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"
                    )}>
                       {clips.map((clip, idx) => (
                         <div key={clip.id} className="group bg-neutral-800/50 border border-neutral-700/50 rounded-xl overflow-hidden hover:border-blue-500/50 transition-all duration-300 shadow-sm hover:shadow-lg animate-in fade-in slide-in-from-bottom-2" style={{ animationDelay: `${idx * 50}ms` }}>
                            <div className="relative aspect-video bg-black">
                               {clip.thumbUrl ? (
                                 <img src={clip.thumbUrl} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity duration-300" alt={clip.name} />
                               ) : (
                                 <div className="w-full h-full flex items-center justify-center bg-neutral-800">
                                    <Play className="w-8 h-8 text-neutral-600" />
                                 </div>
                               )}
                               <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                  <a href={clip.url} target="_blank" rel="noreferrer" className="p-3 bg-blue-600 rounded-full shadow-xl transform scale-0 group-hover:scale-100 transition-transform duration-300">
                                    <Play className="w-5 h-5 fill-white" />
                                  </a>
                               </div>
                               <div className="absolute bottom-1 right-1 px-2 py-0.5 bg-black/80 rounded text-[10px] font-mono backdrop-blur-sm">
                                  {Math.round(clip.duration)}s
                               </div>
                            </div>
                            <div className="p-3 space-y-2">
                               <div className="text-[11px] font-medium text-neutral-300 truncate leading-tight" title={clip.name}>
                                 {clip.name}
                               </div>
                               <div className="flex items-center justify-between gap-2">
                                  <span className="text-[10px] text-neutral-500 flex-shrink-0">{formatTime(clip.startTime)} - {formatTime(clip.endTime)}</span>
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                     <button onClick={() => removeClip(clip.id)} className="p-1.5 hover:bg-red-500/10 hover:text-red-400 rounded transition-all duration-200 hover:scale-110" title="Hapus">
                                        <Trash2 className="w-3.5 h-3.5" />
                                     </button>
                                     <a href={clip.url} download={clip.name} className="p-1.5 hover:bg-blue-500/10 hover:text-blue-400 rounded transition-all duration-200 hover:scale-110" title="Download">
                                        <Download className="w-3.5 h-3.5" />
                                     </a>
                                  </div>
                               </div>
                            </div>
                         </div>
                       ))}
                    </div>
                  )}
                </div>

                {/* History Section */}
                {history.length > 0 && (
                   <div className="p-3 md:p-4 border-t border-neutral-800 bg-neutral-900/80 animate-in slide-in-from-bottom-2">
                      <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <Clock className="w-3 h-3" />
                        Riwayat Sesi
                      </h3>
                      <div className="space-y-2">
                         {history.slice(0, 3).map((item, idx) => (
                           <div key={item.id} className="flex items-center justify-between text-xs p-2.5 bg-neutral-800/30 rounded-lg hover:bg-neutral-800/50 transition-all duration-200 animate-in fade-in" style={{ animationDelay: `${idx * 100}ms` }}>
                              <span className="text-neutral-300 truncate max-w-[120px] flex-shrink" title={item.name}>{item.name}</span>
                              <span className="text-neutral-400 flex-shrink-0 px-2">{item.clipsCount} klip</span>
                              <span className="text-neutral-600 text-[10px] flex-shrink-0">{item.date}</span>
                           </div>
                         ))}
                      </div>
                   </div>
                )}
             </div>
          </div>
        </main>

        {/* Status Toast */}
        {message.text && (
           <div className={cn(
              "fixed bottom-4 md:bottom-8 left-4 right-4 md:left-1/2 md:right-auto md:-translate-x-1/2 px-4 md:px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4 transition-all duration-300 z-50 backdrop-blur-sm",
              message.type === 'success' ? "bg-green-600/95 text-white border border-green-400/20" :
              message.type === 'error' ? "bg-red-600/95 text-white border border-red-400/20" :
              "bg-neutral-800/95 text-white border border-neutral-700/50"
           )}>
              {message.type === 'success' ? <CheckCircle2 className="w-5 h-5 flex-shrink-0 animate-bounce" /> :
               message.type === 'error' ? <AlertCircle className="w-5 h-5 flex-shrink-0 animate-pulse" /> :
               <RefreshCw className="w-5 h-5 animate-spin flex-shrink-0" />}
              <span className="text-sm font-medium flex-1">{message.text}</span>
              <button
                onClick={() => setMessage({text: '', type: 'info'})}
                className="hover:bg-white/10 rounded-full p-1 transition-colors flex-shrink-0 active:scale-90"
              >
                <X className="w-4 h-4" />
              </button>
           </div>
        )}
      </div>

      <style>
        {`
        .custom-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: #404040 transparent;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #404040;
          border-radius: 10px;
          border: 2px solid transparent;
          background-clip: padding-box;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #525252;
          background-clip: padding-box;
        }
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes slideInFromTop {
          from {
            opacity: 0;
            transform: translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes slideInFromBottom {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-in {
          animation: slideIn 0.3s ease-out;
        }
        .fade-in {
          animation: fadeIn 0.4s ease-out;
        }
        .slide-in-from-top-2 {
          animation: slideInFromTop 0.4s ease-out;
        }
        .slide-in-from-bottom-2 {
          animation: slideInFromBottom 0.4s ease-out;
        }
        .slide-in-from-bottom-4 {
          animation: slideInFromBottom 0.5s ease-out;
        }
        @media (max-width: 768px) {
          .lg\\:h-\\[calc\\(100vh-12rem\\)\\] {
            height: 400px;
          }
        }
        `}
      </style>
    </div>
  );
}
