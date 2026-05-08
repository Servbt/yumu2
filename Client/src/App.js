import React, { useCallback, useEffect, useState } from 'react';
// import VideoDownloader from './components/video-downloader';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';

const createEmptyDownloadStatus = () => ({
  active: false,
  mode: null,
  title: null,
  message: '',
  videoId: null,
  downloadMode: 'best',
  currentIndex: null,
  totalVideos: null,
  completedVideos: 0,
  progress: {
    stage: null,
    percent: null,
    speed: null,
    eta: null,
    total: null,
  },
});

const getProgressPercent = (progress) => (
  Number.isFinite(progress?.percent)
    ? Math.max(0, Math.min(100, Math.round(progress.percent)))
    : null
);

const isStatusForVideo = (status, video) => {
  if (!status?.active || !video) {
    return false;
  }

  if (status.videoId) {
    return status.videoId === video.id;
  }

  return status.title === video.title;
};

const PLAYLIST_PART_SIZE_PRESETS = [25, 50, 100];
const DOWNLOAD_MODES = [
  { value: 'fast-mp4', label: 'Fast MP4' },
  { value: 'best', label: 'Best Quality' },
];

const normalizePartSize = (value, fallback = 50) => {
  const parsedValue = Number.parseInt(value, 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
};

const splitVideosIntoParts = (videos, partSize) => {
  const normalizedPartSize = normalizePartSize(partSize);
  const parts = [];

  for (let startIndex = 0; startIndex < videos.length; startIndex += normalizedPartSize) {
    const endIndex = Math.min(startIndex + normalizedPartSize, videos.length);
    parts.push({
      index: parts.length + 1,
      startIndex,
      endIndex,
      videos: videos.slice(startIndex, endIndex),
    });
  }

  return parts;
};

const formatPartNumber = (value, total) => (
  String(value).padStart(String(total).length, '0')
);

const buildPlaylistZipName = (playlistTitle, suffix) => {
  const baseName = playlistTitle?.trim() || 'playlist_videos';
  return suffix ? `${baseName}-${suffix}.zip` : `${baseName}.zip`;
};

const getResponseFilename = (response, fallbackFilename) => {
  const contentDisposition = response.headers.get('content-disposition');
  const quotedMatch = contentDisposition?.match(/filename="([^"]+)"/i);
  const plainMatch = contentDisposition?.match(/filename=([^;]+)/i);
  return (quotedMatch?.[1] || plainMatch?.[1] || fallbackFilename).trim();
};

const saveBlobResponse = async (response, fallbackFilename) => {
  const blob = await response.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = getResponseFilename(response, fallbackFilename);
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(downloadUrl);
};

function DownloadProgress({ status, compact = false }) {
  const percent = getProgressPercent(status.progress);
  const isIndeterminate = percent === null;
  const meta = [
    percent !== null ? `${percent}%` : status.message,
    status.progress?.speed,
    status.progress?.eta ? `ETA ${status.progress.eta}` : null,
    status.progress?.total,
  ].filter(Boolean);

  return (
    <div className={compact ? 'download-progress compact' : 'download-progress'}>
      <div
        className={`download-progress-track ${isIndeterminate ? 'is-indeterminate' : ''}`}
        aria-label="Download progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        role="progressbar"
      >
        <div
          className="download-progress-fill"
          style={{ width: isIndeterminate ? '45%' : `${percent}%` }}
        />
      </div>
      <div className="download-progress-meta">
        {meta.join(' | ')}
      </div>
    </div>
  );
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authMessage, setAuthMessage] = useState('');

  useEffect(() => {
    fetch('/api/authenticated', {
      credentials: 'include',
    })
      .then(response => {
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          return response.json();
        } else {
          throw new Error('Received non-JSON response');
        }
      })
      .then(data => {
        setIsAuthenticated(data.isAuthenticated);
      })
      .catch(error => {
        console.error('Error checking authentication:', error);
      });
  }, []);

  const handleLogin = () => {
    setAuthMessage('');
    const baseURL =
      window.location.hostname === 'localhost'
        ? 'http://localhost:5000'
        : 'https://yumu-4843fa0b7770.herokuapp.com';
    
    window.location.href = `${baseURL}/auth/google`;
  };

  const handleAuthExpired = useCallback((message) => {
    setIsAuthenticated(false);
    setAuthMessage(message || 'Please sign in again.');
  }, []);

  return (
    <div>
      <div className="container mt-5">
        {isAuthenticated ? (
          <Playlists
            onAuthExpired={handleAuthExpired}
          />
        ) : (
          <div className="hero">
            <h1>Yumu</h1>
            <p className='select'>Your simple way to download YouTube playlists. No hassle, No BS. 🎶</p>
            {authMessage && <p className="select text-danger">{authMessage}</p>}
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

function Playlists({ onAuthExpired }) {
  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [videos, setVideos] = useState([]);
  const [activePlaylistDownloadKey, setActivePlaylistDownloadKey] = useState(null);
  const [playlistPartSize, setPlaylistPartSize] = useState(50);
  const [downloadMode, setDownloadMode] = useState('fast-mp4');
  const [downloadingVideos, setDownloadingVideos] = useState([]);
  const [errorVideos, setErrorVideos] = useState([]); // State to track videos with errors
  const [playlistError, setPlaylistError] = useState('');
  const [skippedVideos, setSkippedVideos] = useState([]);
  const [downloadStatus, setDownloadStatus] = useState(createEmptyDownloadStatus);
  const selectedPlaylistDetails = playlists.find((playlist) => playlist.id === selectedPlaylist);
  const playlistParts = splitVideosIntoParts(videos, playlistPartSize);
  const isDownloadingPlaylist = Boolean(activePlaylistDownloadKey);

  useEffect(() => {
    fetch('/api/playlists', {
      credentials: 'include',
    })
      .then(response => {
        if (response.status === 401) {
          return response.json().then((data) => {
            onAuthExpired(data?.error || 'Google login expired. Please sign in again.');
            return null;
          });
        }
        if (!response.ok) {
          throw new Error('Failed to fetch playlists');
        }
        return response.json();
      })
      .then(data => {
        if (!data) {
          return;
        }
        if (Array.isArray(data.playlists)) {
          setPlaylists(data.playlists);
          setPlaylistError('');
        } else {
          setPlaylists([]);
          setPlaylistError(data.error || 'Playlists were unavailable.');
        }
      })
      .catch(error => {
        console.error('Error fetching playlists:', error);
        setPlaylists([]);
        setPlaylistError('Unable to load playlists right now.');
      });
  }, [onAuthExpired]);

  useEffect(() => {
    if (!isDownloadingPlaylist && downloadingVideos.length === 0) {
      setDownloadStatus(createEmptyDownloadStatus());
      return undefined;
    }

    const pollStatus = () => {
      fetch('/api/download-status', {
        credentials: 'include',
      })
        .then(response => {
          if (!response.ok) {
            throw new Error('Failed to fetch download status');
          }
          return response.json();
        })
        .then(data => {
          setDownloadStatus({
            active: Boolean(data?.active),
            mode: data?.mode || null,
            title: data?.title || null,
            message: data?.message || '',
            videoId: data?.videoId || null,
            downloadMode: data?.downloadMode || 'best',
            currentIndex: data?.currentIndex || null,
            totalVideos: data?.totalVideos || null,
            completedVideos: data?.completedVideos || 0,
            progress: {
              stage: data?.progress?.stage || null,
              percent: Number.isFinite(data?.progress?.percent) ? data.progress.percent : null,
              speed: data?.progress?.speed || null,
              eta: data?.progress?.eta || null,
              total: data?.progress?.total || null,
            },
          });
        })
        .catch(error => {
          console.error('Error fetching download status:', error);
        });
    };

    pollStatus();
    const intervalId = window.setInterval(pollStatus, 1000);
    return () => window.clearInterval(intervalId);
  }, [isDownloadingPlaylist, downloadingVideos]);

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
          setSkippedVideos([]);
        } else {
          setVideos([]); // Set an empty array if videos are not available
        }
      })
      .catch(error => {
        console.error('Error fetching videos:', error);
        setVideos([]); // Set an empty array in case of error
      });
  };

  const refreshSkippedVideos = () => {
    fetch('/api/skipped-videos', {
      credentials: 'include',
    })
      .then(response => {
        if (!response.ok) {
          throw new Error('Failed to fetch skipped videos');
        }
        return response.json();
      })
      .then(data => {
        setSkippedVideos(Array.isArray(data?.skippedVideos) ? data.skippedVideos : []);
      })
      .catch(error => {
        console.error('Error fetching skipped videos:', error);
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
        setDownloadStatus({
          active: true,
          mode: 'single',
          title: videoTitle,
          videoId,
          downloadMode,
          message: `Downloading ${videoTitle}`,
          currentIndex: null,
          totalVideos: null,
          completedVideos: 0,
          progress: {
            stage: 'starting',
            percent: 0,
            speed: null,
            eta: null,
            total: null,
          },
        });
    

        try {
          const response = await fetch(`/api/download`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ videoUrl: `https://www.youtube.com/watch?v=${videoId}`, videoTitle, videoId, downloadMode }),
          });
    
          if (!response.ok) throw new Error('Failed to download video');
          await saveBlobResponse(response, `${videoTitle}.mp4`);
        } catch (error) {
          console.error(`Error downloading video "${videoTitle}":`, error);
    
          // Add the video to the errorVideos state if there's an error
          setErrorVideos((prev) => [...prev, videoId]);
        } finally {
          // Remove video from the downloadingVideos state after the download is finished
          setDownloadingVideos((prev) => prev.filter((id) => id !== videoId));
          setDownloadStatus((prev) => (
            prev.mode === 'single' && prev.title === videoTitle
              ? createEmptyDownloadStatus()
              : prev
          ));
        }
      };
  
      const downloadPlaylistVideos = async ({
        batchVideos,
        downloadKey,
        startIndex = 0,
        statusMessage = 'Preparing playlist download...',
        zipName = 'playlist_videos.zip',
      }) => {
        if (batchVideos.length === 0) return;

        setActivePlaylistDownloadKey(downloadKey);
        setErrorVideos([]); // Clear any previous errors before downloading playlist videos
        setSkippedVideos([]);
        setDownloadStatus({
          active: true,
          mode: 'playlist',
          title: null,
          message: statusMessage,
          videoId: null,
          downloadMode,
          currentIndex: null,
          totalVideos: batchVideos.length,
          completedVideos: 0,
          progress: {
            stage: 'preparing',
            percent: null,
            speed: null,
            eta: null,
            total: null,
          },
        });

        try {
          const response = await fetch('/api/download-zip', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              zipName,
              downloadMode,
              videos: batchVideos.map((video, index) => ({
                videoUrl: `https://www.youtube.com/watch?v=${video.id}`,
                videoTitle: video.title,
                videoId: video.id,
                playlistIndex: startIndex + index + 1,
                playlistTotalVideos: videos.length,
              })),
            }),
          });

          if (!response.ok) throw new Error('Failed to download ZIP file');
          await saveBlobResponse(response, zipName);
        } catch (error) {
          console.error('Error downloading ZIP file:', error);
        } finally {
          refreshSkippedVideos();
          setActivePlaylistDownloadKey(null);
          setDownloadStatus(createEmptyDownloadStatus());
        }
      };

      const downloadAllVideos = async () => {
        await downloadPlaylistVideos({
          batchVideos: videos,
          downloadKey: 'all',
          zipName: buildPlaylistZipName(selectedPlaylistDetails?.title, 'full-playlist'),
        });
      };

      const downloadPlaylistPart = async (part) => {
        const totalParts = playlistParts.length;
        const partNumber = formatPartNumber(part.index, totalParts);
        const totalPartNumber = formatPartNumber(totalParts, totalParts);

        await downloadPlaylistVideos({
          batchVideos: part.videos,
          downloadKey: `part-${part.index}`,
          startIndex: part.startIndex,
          statusMessage: `Preparing part ${part.index} of ${totalParts}...`,
          zipName: buildPlaylistZipName(
            selectedPlaylistDetails?.title,
            `part-${partNumber}-of-${totalPartNumber}`,
          ),
        });
      };
  
  const playlistProgressText = downloadStatus.mode === 'playlist' && downloadStatus.totalVideos
    ? `${downloadStatus.completedVideos || 0}/${downloadStatus.totalVideos} saved`
    : '';
  const playlistPartSummaryText = videos.length
    ? `${videos.length} videos | ${playlistParts.length} ZIP${playlistParts.length === 1 ? '' : 's'}`
    : '';
  const isDownloadModeLocked = isDownloadingPlaylist || downloadingVideos.length > 0;
  
  return (
    <div className="d-flex flex-row container left-container">
      <div className="playlists-container fade-in">
        <h2 className="mb-4 mt-4 text-center" style={{ color: '#4CC9F0' }}>Your YouTube Playlists</h2>
        {playlistError && <p className="select text-danger">{playlistError}</p>}
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
        {downloadStatus.active && (
          <div className="download-status-panel mb-3" aria-live="polite">
            <div className="download-status-heading">
              <span>
                {downloadStatus.title
                  ? `Now downloading: ${downloadStatus.title}`
                  : downloadStatus.message}
              </span>
              {playlistProgressText && (
                <span className="download-status-count">{playlistProgressText}</span>
              )}
            </div>
            <DownloadProgress status={downloadStatus} />
          </div>
        )}
        {selectedPlaylist && videos.length > 0 ? (
          <>
            <div className="playlist-actions mb-3">
              <div className="download-mode-panel">
                <span>Download mode</span>
                <div className="download-mode-options" role="group" aria-label="Download mode">
                  {DOWNLOAD_MODES.map((mode) => (
                    <button
                      key={mode.value}
                      type="button"
                      aria-pressed={downloadMode === mode.value}
                      className={`download-mode-option ${downloadMode === mode.value ? 'is-active' : ''}`}
                      onClick={() => setDownloadMode(mode.value)}
                      disabled={isDownloadModeLocked}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                className="btn btn-success playlist-download-all"
                onClick={downloadAllVideos}
                disabled={isDownloadingPlaylist}
              >
                {activePlaylistDownloadKey === 'all' ? 'Downloading...' : 'Download All Videos'}
              </button>

              <div className="playlist-split-panel">
                <div className="playlist-split-header">
                  <div>
                    <h3>Playlist parts</h3>
                    <span>{playlistPartSummaryText}</span>
                  </div>
                  <div className="playlist-part-size">
                    <span>Videos per part</span>
                    <div className="playlist-part-size-controls">
                      <div className="playlist-part-size-presets" role="group" aria-label="Videos per part">
                        {PLAYLIST_PART_SIZE_PRESETS.map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            className={`playlist-size-preset ${playlistPartSize === preset ? 'is-active' : ''}`}
                            onClick={() => setPlaylistPartSize(preset)}
                            disabled={isDownloadingPlaylist}
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                      <input
                        aria-label="Custom videos per part"
                        className="playlist-part-size-input"
                        max={Math.max(videos.length, 1)}
                        min="1"
                        onChange={(event) => setPlaylistPartSize(normalizePartSize(event.target.value))}
                        type="number"
                        value={playlistPartSize}
                        disabled={isDownloadingPlaylist}
                      />
                    </div>
                  </div>
                </div>
                <div className="playlist-part-grid">
                  {playlistParts.map((part) => {
                    const partKey = `part-${part.index}`;
                    const isPartDownloading = activePlaylistDownloadKey === partKey;

                    return (
                      <button
                        key={`${partKey}-${part.startIndex}`}
                        type="button"
                        className={`playlist-part-button ${isPartDownloading ? 'is-active' : ''}`}
                        onClick={() => downloadPlaylistPart(part)}
                        disabled={isDownloadingPlaylist}
                      >
                        <span className="playlist-part-title">
                          {isPartDownloading
                            ? 'Downloading...'
                            : `Part ${formatPartNumber(part.index, playlistParts.length)}`}
                        </span>
                        <span className="playlist-part-range">
                          Videos {part.startIndex + 1}-{part.endIndex}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            {skippedVideos.length > 0 && (
              <details className="mb-3">
                <summary className="select">
                  Couldn&apos;t download {skippedVideos.length} video{skippedVideos.length === 1 ? '' : 's'}
                </summary>
                <div className="list-group mt-2">
                  {skippedVideos.map((title, index) => (
                    <div key={`${title}-${index}`} className="list-group-item">
                      {title}
                    </div>
                  ))}
                </div>
              </details>
            )}
            <div className="list-group">
              {videos.map((video, index) => {
                const isActiveVideo = isStatusForVideo(downloadStatus, video);

                return (
                  <div key={video.id} className={`list-group-item video-list-item d-flex align-items-center fade-in ${isActiveVideo ? 'is-active-download' : ''}`}>
                    <img src={video.thumbnail} alt={`${video.title} Thumbnail`} className="img-thumbnail mr-3 video-thumbnail" />
                    <div className="video-details flex-grow-1 p-2">
                      <div>{video.title}</div>
                      {isActiveVideo && <DownloadProgress status={downloadStatus} compact />}
                    </div>
                    <button
                      className={`btn ml-auto video-download-button ${errorVideos.includes(video.id) ? 'btn-danger' : 'btn-primary'}`}
                      onClick={() => downloadVideo(video.id, video.title)}
                      disabled={downloadingVideos.includes(video.id) || isDownloadingPlaylist} // Disable button while downloading
                    >
                      {downloadingVideos.includes(video.id)
                        ? 'Downloading...'
                        : errorVideos.includes(video.id)
                        ? 'Unavailable'
                        : 'Download Video'}
                    </button>
                  </div>
                );
              })}
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
