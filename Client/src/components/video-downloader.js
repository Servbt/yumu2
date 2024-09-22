import React, { useState } from 'react';

function VideoDownloader() {
  const [videoUrl, setVideoUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleDownload = async () => {
    if (!videoUrl) {
      setError('Please enter a YouTube video URL');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('http://localhost:5000/api/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ videoUrl }),
      });

      if (!response.ok) {
        throw new Error('Failed to download video');
      }

      // Extract the filename from the Content-Disposition header
      const contentDisposition = response.headers.get('content-disposition');
      console.log('Content-Disposition Header:', contentDisposition);
      
      let filename = 'downloaded_video.mp4'; // Default filename

      if (contentDisposition) {
        const match = contentDisposition.match(/filename="(.+)"/);
        if (match && match[1]) {
          filename = match[1];
        }
      }

      // Create a blob from the response and download it
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename; // Set the correct filename here
      document.body.appendChild(a);
      a.click();
      a.remove();

      // Clean up the URL object
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error('Error downloading video:', err);
      setError('Error downloading video');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <h1>YouTube Video Downloader</h1>
      <input
        type="text"
        value={videoUrl}
        onChange={(e) => setVideoUrl(e.target.value)}
        placeholder="Enter YouTube video URL"
      />
      <button onClick={handleDownload} disabled={isLoading}>
        {isLoading ? 'Downloading...' : 'Download Video'}
      </button>
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}

export default VideoDownloader;
