import React, { useEffect, useState } from 'react';

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
        <button onClick={handleLogin}>Login with Google</button>
      )}
    </div>
  );
}

function Playlists() {
  const [playlists, setPlaylists] = useState([]);

  useEffect(() => {
    
    fetch('/api/playlists', {
      credentials: 'include',
    })
      .then(response => {
        if (response.status === 401) {
          // Not authenticated
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
          </li>
        ))}
      </ul>
    </div>
  );
}

export default App;
