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
    const baseURL =
      window.location.hostname === 'localhost'
        ? 'http://localhost:5000'
        : 'https://yumu-4843fa0b7770.herokuapp.com/';
    
    window.location.href = `${baseURL}/auth/google`;
  };

  return (
    <div>
      <div className="container mt-5">
        {isAuthenticated ? (
          <Playlists />
        ) : (
          <div className="hero">
            <h1>Yumu</h1>
            <p className='select'>Your simple way to download YouTube playlists. No hassle, No BS. 🎶</p>
            <button className="login-button" onClick={handleLogin}>
              Login with Google
            </button>

            {/* Instructions Section */}
            <div className="instructions">
              <h2>How to Use Yumu</h2>
              <div className="steps select">
                <div className="step">
                  <div className="step-number">Step 1:</div>
                  <div className="step-description">Log in with your Google account.</div>
                </div>
                <div className="step">
                  <div className="step-number">Step 2:</div>
                  <div className="step-description">Select a playlist you want to download.</div>
                </div>
                <div className="step">
                  <div className="step-number">Step 3:</div>
                  <div className="step-description">Download your videos (MP4 format only) and enjoy!</div>
                </div>
              </div>
            </div>
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
  const [downloadingVideos, setDownloadingVideos] = useState([]);
  const [errorVideos, setErrorVideos] = useState([]); // State to track videos with errors

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

  const downloadVideo = async (videoId, videoTitle) => {
    if (!videoId || !videoTitle) {
      console.error('Invalid video ID or title:', videoId, videoTitle);
      return;
    }

        // Add video to the downloadingVideos state and remove it from errorVideos state if retrying
        setDownloadingVideos((prev) => [...prev, videoId]);
        setErrorVideos((prev) => prev.filter((id) => id !== videoId));
    

        try {
          const response = await fetch(`/api/download`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ videoUrl: `https://www.youtube.com/watch?v=${videoId}`, videoTitle }),
          });
    
          if (!response.ok) throw new Error('Failed to download video');
          const blob = await response.blob();
    
          // Download the video
          const downloadUrl = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = downloadUrl;
          a.download = `${videoTitle}.mp4`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          window.URL.revokeObjectURL(downloadUrl);
        } catch (error) {
          console.error(`Error downloading video "${videoTitle}":`, error);
    
          // Add the video to the errorVideos state if there's an error
          setErrorVideos((prev) => [...prev, videoId]);
        } finally {
          // Remove video from the downloadingVideos state after the download is finished
          setDownloadingVideos((prev) => prev.filter((id) => id !== videoId));
        }
      };
  
      const downloadAllVideos = async () => {
        if (videos.length === 0) return;
    
        setIsDownloadingAll(true);
        setErrorVideos([]); // Clear any previous errors before downloading all videos
    
        try {
          const response = await fetch('/api/download-zip', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ videos: videos.map(video => ({ videoUrl: `https://www.youtube.com/watch?v=${video.id}`, videoTitle: video.title })) }),
          });
    
          if (!response.ok) throw new Error('Failed to download ZIP file');
    
          const blob = await response.blob();
          const downloadUrl = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = downloadUrl;
          a.download = 'playlist_videos.zip';
          document.body.appendChild(a);
          a.click();
          a.remove();
          window.URL.revokeObjectURL(downloadUrl);
        } catch (error) {
          console.error('Error downloading ZIP file:', error);
        } finally {
          setIsDownloadingAll(false);
        }
      };
  
  
  return (
    <div className="d-flex flex-row container left-container">
      <div className="playlists-container fade-in">
        <h2 className="mb-4 mt-4 text-center" style={{ color: '#4CC9F0' }}>Your YouTube Playlists</h2>
        <div className="row">
          {playlists.map((playlist, index) => (
            <div key={playlist.id} className="col-md-4 col-lg-4 mb-4 d-flex align-items-stretch fade-in">
              <div className="card w-100">
                <img src={playlist.thumbnails?.high?.url} className="card-img" alt={`${playlist.title} Thumbnail`} />
                <div className="card-body select">
                  <h5 className="card-title text-center">{playlist.title}</h5>
                  <button className="btn card-button mt-2" onClick={() => fetchVideos(playlist.id)}>
                    View Playlist
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right Section: Videos in Playlist */}
      <div className="videos-container fade-in">
        <h2 className='row ps-2' style={{ color: '#F72585' }}>Videos in Playlist</h2>
        {selectedPlaylist && videos.length > 0 ? (
          <>
            <button className="btn btn-success mb-3" onClick={downloadAllVideos} disabled={isDownloadingAll}>
              {isDownloadingAll ? 'Downloading...' : 'Download All Videos'}
            </button>
            <div className="list-group">
              {videos.map((video, index) => (
                <div key={video.id} className="list-group-item d-flex align-items-center fade-in">
                  <img src={video.thumbnail} alt={`${video.title} Thumbnail`} className="img-thumbnail mr-3" style={{ width: '80px' }} />
                  <div className="flex-grow-1 p-2">{video.title}</div>
                  <button
                    className={`btn ml-auto col-3 ${errorVideos.includes(video.id) ? 'btn-danger' : 'btn-primary'}`}
                    onClick={() => downloadVideo(video.id, video.title)}
                    disabled={downloadingVideos.includes(video.id)} // Disable button while downloading
                  >
                    {downloadingVideos.includes(video.id)
                      ? 'Downloading...'
                      : errorVideos.includes(video.id)
                      ? 'Unavailable'
                      : 'Download Video'}
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="select">Select a playlist to view its videos.</p>
        )}
      </div>
    </div>
  );
}


export default App;
