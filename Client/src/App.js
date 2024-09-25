import React, { useEffect, useState } from 'react';
import VideoDownloader from './components/video-downloader';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    fetch('/api/authenticated', {
      credentials: 'include',
    })
      .then(response => response.json())
      .then(data => {
        setIsAuthenticated(data.isAuthenticated);
      })
      .catch(error => {
        console.error('Error checking authentication:', error);
      });
  }, []);

  const handleLogin = () => {
    window.location.href = 'http://localhost:5000/auth/google';
  };

  return (
    <div>
      {isAuthenticated ? (
        <Playlists />
      ) : (
        <><button onClick={handleLogin}>Login with Google</button><VideoDownloader /></>
      )}
    </div>
  );
}

function Playlists() {
  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [videos, setVideos] = useState([]);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);

  useEffect(() => {
    fetch('/api/playlists', {
      credentials: 'include',
    })
      .then(response => {
        if (response.status === 401) {
          window.location.href = '/auth/google';
        }
        return response.json();
      })
      .then(data => {
        setPlaylists(data.playlists);
      })
      .catch(error => {
        console.error('Error fetching playlists:', error);
      });
  }, []);

  const fetchVideos = (playlistId) => {
    fetch(`/api/playlist/${playlistId}/videos`, {
      credentials: 'include',
    })
      .then(response => {
        if (!response.ok) {
          throw new Error('Failed to fetch videos');
        }
        return response.json();
      })
      .then(data => {
        if (data && data.videos) {
          setVideos(data.videos);
          setSelectedPlaylist(playlistId);
        } else {
          setVideos([]); // Set an empty array if videos are not available
        }
      })
      .catch(error => {
        console.error('Error fetching videos:', error);
        setVideos([]); // Set an empty array in case of error
      });
  };

  const downloadVideo = (videoId, videoTitle) => {
    if (!videoId || !videoTitle) {
      console.error('Invalid video ID or title:', videoId, videoTitle);
      return;
    }

    fetch(`/api/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
        videoTitle // Pass the video title to the backend
      }),
    })
      .then(response => {
        if (!response.ok) {
          throw new Error('Failed to download video');
        }
        return response.blob();
      })
      .then(blob => {
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `${videoTitle}.mp4`; // Use the video title for the filename
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(downloadUrl);
      })
      .catch(error => {
        console.error('Error downloading video:', error);
      });
  };
  
  const downloadAllVideos = async () => {
    if (videos.length === 0) return;
  
    setIsDownloadingAll(true);
  
    try {
      const response = await fetch('/api/download-zip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ videos: videos.map(video => ({ videoUrl: `https://www.youtube.com/watch?v=${video.id}`, videoTitle: video.title })) }),
      });
  
      if (!response.ok) {
        throw new Error('Failed to download ZIP file');
      }
  
      // Download the ZIP file
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = 'playlist_videos.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
  
      // Fetch skipped videos after the download is complete
      const skippedResponse = await fetch('/api/skipped-videos');
      const skippedData = await skippedResponse.json();
      const { skippedVideos } = skippedData;
  
      if (skippedVideos && skippedVideos.length > 0) {
        alert(`The following videos could not be downloaded:\n${skippedVideos.join('\n')}`);
      } else {
        alert('All videos downloaded successfully!');
      }
    } catch (error) {
      console.error('Error downloading ZIP file:', error);
    } finally {
      setIsDownloadingAll(false);
    }
  };
  
  
  
  return (
    <div>
      <h1>Your YouTube Playlists</h1>
      <ul>
        {playlists.map(playlist => (
          <li key={playlist.id}>
            <h2>{playlist.title}</h2>
            {playlist.thumbnails && playlist.thumbnails.default && (
              <img
                src={playlist.thumbnails.default.url}
                alt={`${playlist.title} Thumbnail`}
              />
            )}
            <button onClick={() => fetchVideos(playlist.id)}>View Videos</button>
          </li>
        ))}
      </ul>

      {selectedPlaylist && (
        <div>
          <h2>Videos in Playlist</h2>
          <button onClick={downloadAllVideos} disabled={isDownloadingAll}>
            {isDownloadingAll ? 'Downloading...' : 'Download All Videos'}
          </button>
          {videos.length > 0 ? (
            <ul>
              {videos.map(video => (
                <li key={video.id}>
                  <h3>{video.title}</h3>
                  {video.thumbnail ? (
                    <img src={video.thumbnail} alt={`${video.title} Thumbnail`} />
                  ) : (
                    <p>No thumbnail available</p>
                  )}
                  {/* Disable the download button if video ID is not available */}
                  <button
                    onClick={() => downloadVideo(video.id, video.title)}
                    disabled={!video.id || !video.thumbnail}
                    style={{ opacity: !video.id || !video.thumbnail ? 0.5 : 1, cursor: !video.id || !video.thumbnail ? 'not-allowed' : 'pointer' }}
                  >
                    {video.id ? 'Download Video' : 'Unavailable'}
                  </button>


                </li>
              ))}


            </ul>
          ) : (
            <p>No videos available in this playlist.</p>
          )}
        </div>
      )}

    </div>
  );
}


export default App;
