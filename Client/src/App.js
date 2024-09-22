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
  
  const downloadVideo = (videoId) => {
    fetch(`/api/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ videoUrl: `https://www.youtube.com/watch?v=${videoId}` }),
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
      a.download = `${videoId}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
    })
    .catch(error => {
      console.error('Error downloading video:', error);
    });
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
    {videos.length > 0 ? (
      <ul>
        {videos.map(video => (
          <li key={video.id}>
            <h3>{video.title}</h3>
            <img src={video.thumbnail} alt={`${video.title} Thumbnail`} />
            <button onClick={() => downloadVideo(video.id)}>Download Video</button>
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
