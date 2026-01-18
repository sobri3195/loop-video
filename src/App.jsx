import React, { useState, useRef, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

function App() {
  const [loaded, setLoaded] = useState(false);
  const [videoFile, setVideoFile] = useState(null);
  const [clips, setClips] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('Memuat ffmpeg...');
  const ffmpegRef = useRef(new FFmpeg());

  useEffect(() => {
    load();
    return () => {
      clips.forEach(clip => URL.revokeObjectURL(clip.url));
    };
  }, []);

  const load = async () => {
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    const ffmpeg = ffmpegRef.current;
    
    ffmpeg.on('log', ({ message }) => {
      console.log(message);
    });

    try {
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      setLoaded(true);
      setMessage('FFmpeg siap digunakan.');
    } catch (error) {
      console.error('Gagal memuat FFmpeg:', error);
      setMessage('Gagal memuat FFmpeg. Pastikan browser mendukung SharedArrayBuffer.');
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setVideoFile(file);
      setClips([]);
      setProgress(0);
      setMessage(`Video dipilih: ${file.name}`);
    }
  };

  const getDuration = (file) => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        window.URL.revokeObjectURL(video.src);
        resolve(video.duration);
      };
      video.src = URL.createObjectURL(file);
    });
  };

  const processVideo = async () => {
    if (!videoFile) return;
    
    // Cleanup previous clips
    clips.forEach(clip => URL.revokeObjectURL(clip.url));
    
    setIsProcessing(true);
    setClips([]);
    setProgress(0);
    setMessage('Mulai memproses video...');

    const ffmpeg = ffmpegRef.current;
    const { name } = videoFile;
    
    try {
      await ffmpeg.writeFile(name, await fetchFile(videoFile));

      const duration = await getDuration(videoFile);
      const clipDuration = 30;
      const numberOfClips = Math.ceil(duration / clipDuration);

      const generatedClips = [];

      for (let i = 0; i < numberOfClips; i++) {
        const startTime = i * clipDuration;
        const outputName = `clip-${i + 1}.mp4`;
        
        setMessage(`Memproses bagian ${i + 1} dari ${numberOfClips}...`);
        
        // Fast clip using -c copy
        await ffmpeg.exec([
          '-ss', startTime.toString(),
          '-i', name,
          '-t', clipDuration.toString(),
          '-c', 'copy',
          outputName
        ]);

        const data = await ffmpeg.readFile(outputName);
        const url = URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }));
        
        generatedClips.push({
          url,
          name: outputName,
          index: i,
          startTime,
          endTime: Math.min(startTime + clipDuration, duration)
        });
        
        // Update state to show clips as they are generated
        setClips([...generatedClips]);
        setProgress(((i + 1) / numberOfClips) * 100);
      }

      setMessage('Proses selesai! Semua bagian telah dipotong.');
    } catch (error) {
      console.error('Error saat memproses:', error);
      setMessage('Terjadi kesalahan saat memproses video.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="container">
      <h1>React Video Auto Clipper</h1>
      <p>Potong video secara otomatis menjadi bagian berdurasi 30 detik langsung di browser.</p>
      
      <div className="upload-section">
        <input 
          type="file" 
          accept="video/mp4,video/webm" 
          onChange={handleFileUpload}
          disabled={!loaded || isProcessing}
        />
        <div style={{ marginTop: '10px' }}>
          <button 
            onClick={processVideo} 
            disabled={!loaded || !videoFile || isProcessing}
          >
            {isProcessing ? 'Sedang Memproses...' : 'Mulai Potong Video'}
          </button>
        </div>
      </div>

      {message && <p className="status-message">{message}</p>}

      {(isProcessing || progress > 0) && (
        <div style={{ width: '100%', maxWidth: '500px', margin: '0 auto' }}>
          <p>Progress: {Math.round(progress)}%</p>
          <div className="progress-bar-container">
            <div 
              className="progress-bar" 
              style={{ width: `${progress}%` }}
            ></div>
          </div>
        </div>
      )}

      <div className="clips-grid">
        {clips.map((clip) => (
          <div key={clip.index} className="clip-card">
            <h3>Bagian {clip.index + 1}</h3>
            <p>{Math.round(clip.startTime)}s - {Math.round(clip.endTime)}s</p>
            <video src={clip.url} controls />
            <div style={{ marginTop: '10px' }}>
              <a href={clip.url} download={clip.name}>
                <button style={{ width: '100%' }}>Download</button>
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
