import React, { useEffect, useState } from 'react';
// import VideoDownloader from './components/video-downloader';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';

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
      {/* <nav className="navbar navbar-expand-lg ">
        <a className="navbar-brand" href="/">Yumu</a>
      </nav> */}
      <div className="container mt-5">
        {isAuthenticated ? (
          <Playlists />
        ) : (
          <div className="hero">
            <h1>Yumu</h1>
            <p>Your simple way to download YouTube playlists. No hassle, No BS. 🎶</p>
            <button className="login-button" onClick={handleLogin}>
              Login with Google
            </button>
          </div>
        )}
      </div>
      <footer>
        <p>© 2024 Yumu. All rights reserved.</p>
      </footer>
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
    <div className="d-flex flex-row container left-container">
      {/* Left Section: Playlists */}
      <div className="playlists-container">
        <h2 className="mb-4 text-center" style={{ color: '#4CC9F0' }}>Your YouTube Playlists</h2>
        <div className="row">
          {playlists.map((playlist, index) => (
            <div
              key={playlist.id}
              className={`col-md-4 col-lg-4 mb-4 d-flex align-items-stretch fade-in`}
              style={{ animationDelay: `${index * 0.1}s`, opacity: playlist.isVisible ? 1 : 0 }}
            >
              <div className="card w-100">
                <img
                  src={playlist.thumbnails?.high.url}
                  className="card-img"
                  alt={`${playlist.title} Thumbnail`}
                />
                <div className="card-body">
                  <h5 className="card-title">{playlist.title}</h5>
                  <button
                    className="btn card-button mt-2"
                    onClick={() => fetchVideos(playlist.id)}
                  >
                    View Playlist
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right Section: Videos in Playlist */}
      <div className="videos-container">
        <h2 style={{ color: '#F72585' }}>Videos in Playlist</h2>
        {selectedPlaylist && videos.length > 0 ? (
          <>
            <button
              className="btn btn-success mb-3"
              onClick={downloadAllVideos}
              disabled={isDownloadingAll}
            >
              {isDownloadingAll ? 'Downloading...' : 'Download All Videos'}
            </button>
            <div className="list-group">
              {videos.map((video, index) => (
                <div
                  key={video.id}
                  className={`list-group-item d-flex align-items-center fade-in`}
                  style={{ animationDelay: `${index * 0.1}s`, opacity: video.isVisible ? 1 : 0 }}
                >
                  <img
                    src={video.thumbnail}
                    alt={`${video.title} Thumbnail`}
                    className="img-thumbnail mr-3"
                    style={{ width: '80px' }}
                  />
                  <div className="flex-grow-1">{video.title}</div>
                  <button className="btn btn-primary ml-auto" onClick={() => downloadVideo(video.id, video.title)}>
                    Download Video
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-center text-muted">Select a playlist to view its videos.</p>
        )}
      </div>
    </div>
  );
}


export default App;
