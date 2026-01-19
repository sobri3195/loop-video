import JSZip from 'jszip';

export const createZip = async (clips) => {
  const zip = new JSZip();
  
  for (const clip of clips) {
    const response = await fetch(clip.url);
    const blob = await response.blob();
    zip.file(clip.name, blob);
  }
  
  return await zip.generateAsync({ type: 'blob' });
};
