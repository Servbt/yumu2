import React, { useState, useEffect } from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';

function App() {
  const [channelId, setChannelId] = useState('');
  const [playlists, setPlaylists] = useState([]);
  const [error, setError] = useState('');
  const [isFetched, setIsFetched] = useState(false);

  // Fetch the channel ID from localStorage when the component mounts
  useEffect(() => {
    const savedChannelId = localStorage.getItem('channelId');
    if (savedChannelId) {
      setChannelId(savedChannelId);
    }
  }, []);

  const handleFetchPlaylists = async () => {
    if (!channelId) {
      setError('Please enter a YouTube Channel ID.');
      return;
    }

    setError('');
    try {
      // const response = await fetch(`http://localhost:5000/channel/playlists/${channelId}`);
      const response = await fetch(`/channel/playlists/${channelId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch playlists. Please check the channel ID.');
      }
      const data = await response.json();
      setPlaylists(data.playlists);
      setIsFetched(true);

      // Store the channel ID in localStorage
      localStorage.setItem('channelId', channelId);
    } catch (err) {
      console.error('Error fetching playlists:', err);
      setError('Failed to fetch playlists. Please try again.');
    }
  };

  return (
    <div>
      <div className="container mt-5">
        {/* Conditionally render the hero and instructions */}
        {!isFetched && (
          <div className="hero">
            <h1>Yumu</h1>
            <p className='select'>Your simple way to download YouTube playlists. No hassle, No BS. 🎶</p>

            {/* Input for Channel ID */}
            <div className="instructions mt-2">
              <h2>Enter Your Channel ID</h2>
              <input
                type="text"
                placeholder="Enter YouTube Channel ID"
                className="form-control mt-3 mb-2 text-center"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
              />
              <button className="btn btn-primary " onClick={handleFetchPlaylists}>
                Fetch Playlists
              </button>
              {error && <p style={{ color: 'red', marginTop: '10px' }}>{error}</p>}
              
              {/* Display the most recently used channel ID */}
              {localStorage.getItem('channelId') && (
                <p className="mt-2 select fs-5 text-muted d-none ">Last used Channel ID: {localStorage.getItem('channelId')}</p>
              )}
            </div>

            {/* Instructions Section */}
            <div className="instructions mt-5">
              <h2>How to Use Yumu</h2>
              <div className="steps select">
                <div className="step">
                  <div className="step-number">Step 1:</div>
                  <div className="step-description">Find your YouTube Channel ID (Go to YouTube → Settings → View Advanced Settings → Channel ID).</div>
                </div>
                <div className="step">
                  <div className="step-number">Step 2:</div>
                  <div className="step-description">Paste your Channel ID above and view your playlists (only public playlists are visible).</div>
                </div>
                <div className="step">
                  <div className="step-number">Step 3:</div>
                  <div className="step-description">Download Away! Videos are available as MP4s only.</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Display Playlists when fetched */}
        {playlists.length > 0 && (
          <Playlists playlists={playlists} />
        )}
      </div>

      <footer>
        <p>© 2024 Yumu. All rights reserved.</p>
      </footer>
    </div>
  );
}

function Playlists({ playlists }) {
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [videos, setVideos] = useState([]);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [downloadingVideos, setDownloadingVideos] = useState([]);
  const [errorVideos, setErrorVideos] = useState([]); // State to track videos with errors

  const fetchVideos = async (playlistId) => {
    try {
      const response = await fetch(`/api/playlist/${playlistId}/videos`);
      if (!response.ok) throw new Error('Failed to fetch videos');

      const data = await response.json();
      setVideos(data.videos);
      setSelectedPlaylist(playlistId);
    } catch (error) {
      console.error('Error fetching videos:', error);
    }
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
