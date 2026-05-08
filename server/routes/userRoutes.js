// authRoutes.js
import express from "express";
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import archiver from "archiver";
import ffmpegPath from "ffmpeg-static";



const router = express.Router();
// Define __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const downloadDir = path.join(__dirname, 'downloads');
const desktopDir = path.join(os.homedir(), 'Desktop');
const downloadStatuses = new Map();
const skippedVideosBySession = new Map();
const DOWNLOAD_MODE_BEST = 'best';
const DOWNLOAD_MODE_FAST_MP4 = 'fast-mp4';
const DOWNLOAD_FORMATS = {
  [DOWNLOAD_MODE_BEST]: 'bv*+ba/b',
  [DOWNLOAD_MODE_FAST_MP4]: [
    'bv*[vcodec^=avc1][ext=mp4]+ba[acodec^=mp4a][ext=m4a]',
    'b[vcodec^=avc1][acodec^=mp4a][ext=mp4]',
    'bv*[vcodec^=avc1]+ba[acodec^=mp4a]',
    'b[vcodec^=avc1][acodec^=mp4a]',
    'bv*+ba/b',
  ].join('/'),
};

function createEmptyProgress() {
  return {
    stage: null,
    percent: null,
    speed: null,
    eta: null,
    total: null,
  };
}

function createEmptyDownloadStatus() {
  return {
    active: false,
    mode: null,
    title: null,
    message: '',
    videoId: null,
    downloadMode: DOWNLOAD_MODE_BEST,
    currentIndex: null,
    totalVideos: null,
    completedVideos: 0,
    progress: createEmptyProgress(),
  };
}

function normalizeDownloadMode(downloadMode) {
  return downloadMode === DOWNLOAD_MODE_FAST_MP4
    ? DOWNLOAD_MODE_FAST_MP4
    : DOWNLOAD_MODE_BEST;
}

function getYtDlpFormat(downloadMode) {
  return DOWNLOAD_FORMATS[normalizeDownloadMode(downloadMode)];
}

function createGoogleOAuthClient() {
  const googleCallbackUrl = process.env.GOOGLE_CALLBACK_URL || (
    process.env.NODE_ENV === 'production'
      ? "https://yumu-4843fa0b7770.herokuapp.com/auth/google/secrets"
      : "http://localhost:5000/auth/google/secrets"
  );

  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    googleCallbackUrl
  );
}

function ensureDownloadDir() {
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }
}

function findDownloadedFile(outputTemplate) {
  const expectedMp4 = outputTemplate.replace('.%(ext)s', '.mp4');
  if (fs.existsSync(expectedMp4)) {
    return expectedMp4;
  }

  const prefix = path.basename(outputTemplate).replace('.%(ext)s', '');
  const matches = fs
    .readdirSync(downloadDir)
    .filter((file) => file.startsWith(prefix))
    .map((file) => path.join(downloadDir, file));

  if (!matches.length) {
    throw new Error(`yt-dlp did not create an output file for ${prefix}`);
  }

  return matches[0];
}

function parseYtDlpProgressLine(line) {
  const cleanLine = line
    .replace(/\u001b\[[0-9;]*m/g, '')
    .trim();

  if (!cleanLine) {
    return null;
  }

  if (cleanLine.includes('[Merger]')) {
    return {
      stage: 'merging',
      percent: 100,
      speed: null,
      eta: null,
      total: null,
      message: 'Merging video and audio...',
    };
  }

  if (cleanLine.includes('has already been downloaded')) {
    return {
      stage: 'downloaded',
      percent: 100,
      speed: null,
      eta: null,
      total: null,
      message: 'Already downloaded.',
    };
  }

  if (cleanLine.includes('[download] Destination:')) {
    return {
      stage: 'starting',
      percent: 0,
      speed: null,
      eta: null,
      total: null,
      message: 'Starting download...',
    };
  }

  const percentMatch = cleanLine.match(/\[download\]\s+([0-9.]+)%/);
  if (!percentMatch) {
    return null;
  }

  const percent = Math.min(100, Math.max(0, Number(percentMatch[1])));
  const totalMatch = cleanLine.match(/\bof\s+~?\s*([0-9.]+\s*[A-Za-z]+)/);
  const speedMatch = cleanLine.match(/\bat\s+([^\s]+\/s)/);
  const etaMatch = cleanLine.match(/\bETA\s+([0-9:]+)/);

  return {
    stage: percent >= 100 ? 'downloaded' : 'downloading',
    percent,
    speed: speedMatch?.[1] || null,
    eta: etaMatch?.[1] || null,
    total: totalMatch?.[1]?.replace(/\s+/g, '') || null,
    message: percent >= 100 ? 'Download finished.' : 'Downloading...',
  };
}

function runYtDlp(videoUrl, outputTemplate, onProgress = () => {}, downloadMode = DOWNLOAD_MODE_BEST) {
  ensureDownloadDir();

  return new Promise((resolve, reject) => {
    const args = [
      '-m',
      'yt_dlp',
      '--newline',
      '--no-warnings',
      '--format',
      getYtDlpFormat(downloadMode),
      '--merge-output-format',
      'mp4',
      '--output',
      outputTemplate,
      videoUrl,
    ];

    const child = spawn('python', args, {
      cwd: downloadDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let stdoutBuffer = '';
    let stderrBuffer = '';

    const handleOutput = (chunk, streamName) => {
      const text = chunk.toString();
      if (streamName === 'stderr') {
        stderrBuffer += text;
      } else {
        stdoutBuffer += text;
      }

      const buffer = streamName === 'stderr' ? stderrBuffer : stdoutBuffer;
      const lines = buffer.split(/\r?\n|\r/);
      const remaining = lines.pop() || '';

      if (streamName === 'stderr') {
        stderrBuffer = remaining;
      } else {
        stdoutBuffer = remaining;
      }

      for (const line of lines) {
        const progress = parseYtDlpProgressLine(line);
        if (progress) {
          onProgress(progress);
        } else if (streamName === 'stderr' && line.trim()) {
          stderr += `${line}\n`;
        }
      }
    };

    child.stdout.on('data', (chunk) => {
      handleOutput(chunk, 'stdout');
    });

    child.stderr.on('data', (chunk) => {
      handleOutput(chunk, 'stderr');
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      for (const [line, streamName] of [[stdoutBuffer, 'stdout'], [stderrBuffer, 'stderr']]) {
        const progress = parseYtDlpProgressLine(line);
        if (progress) {
          onProgress(progress);
        } else if (streamName === 'stderr' && line.trim()) {
          stderr += line;
        }
      }

      if (code !== 0) {
        reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
        return;
      }

      try {
        resolve(findDownloadedFile(outputTemplate));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function transcodeToCompatibleMp4(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-i',
      inputPath,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      outputPath,
    ];

    const child = spawn(ffmpegPath, args, {
      cwd: downloadDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
        return;
      }
      resolve(outputPath);
    });
  });
}

function getCodecFromFfmpegOutput(output, streamType) {
  const regex = new RegExp(`Stream #.*${streamType}:\\s*([^,\\s]+)`, 'i');
  return output.match(regex)?.[1]?.toLowerCase() || null;
}

function probeMp4Compatibility(inputPath) {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, [
      '-hide_banner',
      '-i',
      inputPath,
    ], {
      cwd: downloadDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.on('error', () => {
      resolve({
        compatible: false,
        videoCodec: null,
        audioCodec: null,
      });
    });

    child.on('close', () => {
      const videoCodec = getCodecFromFfmpegOutput(output, 'Video');
      const audioCodec = getCodecFromFfmpegOutput(output, 'Audio');
      const hasMp4Extension = path.extname(inputPath).toLowerCase() === '.mp4';
      const hasCompatibleVideo = videoCodec === 'h264';
      const hasCompatibleAudio = !audioCodec || audioCodec === 'aac';

      resolve({
        compatible: hasMp4Extension && hasCompatibleVideo && hasCompatibleAudio,
        videoCodec,
        audioCodec,
      });
    });
  });
}

async function ensureCompatibleVideo(filePath, sanitizedTitle, onProgress = () => {}) {
  const compatiblePath = path.join(downloadDir, `${sanitizedTitle}.compatible.mp4`);
  onProgress({
    stage: 'checking',
    percent: null,
    speed: null,
    eta: null,
    total: null,
    message: 'Checking MP4 compatibility...',
  });

  const compatibility = await probeMp4Compatibility(filePath);
  if (compatibility.compatible) {
    onProgress({
      stage: 'ready',
      percent: 100,
      speed: null,
      eta: null,
      total: null,
      message: 'MP4 already compatible. Skipping finalization...',
    });
    return filePath;
  }

  onProgress({
    stage: 'converting',
    percent: null,
    speed: null,
    eta: null,
    total: null,
    message: 'Finalizing MP4...',
  });
  await transcodeToCompatibleMp4(filePath, compatiblePath);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  return compatiblePath;
}

function writeSkippedVideosReport(skippedTitles) {
  ensureDownloadDir();

  if (!fs.existsSync(desktopDir)) {
    return null;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(desktopDir, `yumu-skipped-videos-${timestamp}.txt`);
  const lines = skippedTitles.length
    ? [
        'The following videos could not be downloaded:',
        '',
        ...skippedTitles.map((title, index) => `${index + 1}. ${title}`),
      ]
    : [
        'All videos in the playlist downloaded successfully.',
      ];

  fs.writeFileSync(reportPath, `${lines.join('\r\n')}\r\n`, 'utf8');
  return reportPath;
}

function setDownloadStatus(sessionId, status) {
  if (!sessionId) {
    return;
  }
  const progress = {
    ...createEmptyProgress(),
    ...(status.progress || {}),
  };
  downloadStatuses.set(sessionId, {
    ...createEmptyDownloadStatus(),
    ...status,
    progress,
  });
}

function updateDownloadStatus(sessionId, status) {
  if (!sessionId) {
    return;
  }

  const current = downloadStatuses.get(sessionId) || createEmptyDownloadStatus();
  const progress = status.progress
    ? {
        ...current.progress,
        ...status.progress,
      }
    : current.progress;

  downloadStatuses.set(sessionId, {
    ...current,
    ...status,
    progress,
  });
}

function clearDownloadStatus(sessionId) {
  if (!sessionId) {
    return;
  }
  downloadStatuses.set(sessionId, createEmptyDownloadStatus());
}

function setSkippedVideos(sessionId, skippedTitles) {
  if (!sessionId) {
    return;
  }
  skippedVideosBySession.set(sessionId, [...skippedTitles]);
}

function getSkippedVideos(sessionId) {
  return skippedVideosBySession.get(sessionId) || [];
}

router.get('/download-status', (req, res) => {
  res.json(downloadStatuses.get(req.sessionID) || createEmptyDownloadStatus());
});

// Endpoint to handle video download requests
router.post('/download', async (req, res, next) => {
  const { videoUrl, videoTitle, videoId } = req.body;
  const downloadMode = normalizeDownloadMode(req.body.downloadMode);
  console.log('Received video URL:', videoUrl);
  console.log('Received video title:', videoTitle);

  if (!videoUrl || !videoUrl.includes('youtube.com/watch')) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }

  try {
    // Sanitize the video title for a valid filename
    const sanitizedTitle = sanitizeFileName(videoTitle);
    setDownloadStatus(req.sessionID, {
      active: true,
      mode: 'single',
      title: videoTitle,
      videoId: videoId || null,
      downloadMode,
      message: `Downloading ${videoTitle}`,
      progress: {
        stage: 'starting',
        percent: 0,
      },
    });
    const outputTemplate = path.join(downloadDir, `${sanitizedTitle}.%(ext)s`);
    const downloadedPath = await runYtDlp(videoUrl, outputTemplate, (progress) => {
      updateDownloadStatus(req.sessionID, {
        active: true,
        mode: 'single',
        title: videoTitle,
        videoId: videoId || null,
        downloadMode,
        message: progress.message || `Downloading ${videoTitle}`,
        progress,
      });
    }, downloadMode);
    const outputFilePath = await ensureCompatibleVideo(downloadedPath, sanitizedTitle, (progress) => {
      updateDownloadStatus(req.sessionID, {
        active: true,
        mode: 'single',
        title: videoTitle,
        videoId: videoId || null,
        downloadMode,
        message: progress.message || 'Finalizing MP4...',
        progress,
      });
    });

    updateDownloadStatus(req.sessionID, {
      message: 'Ready to save...',
      progress: {
        stage: 'ready',
        percent: 100,
      },
    });

    // Set the Content-Disposition header with the correct filename
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizedTitle}.mp4"`);
    res.download(outputFilePath, (err) => {
      if (err) {
        clearDownloadStatus(req.sessionID);
        console.error('Error sending file:', err);
        return next(err); // Pass the error to the global error handler
      }
      // Optionally delete the file after download
      fs.unlinkSync(outputFilePath);
      clearDownloadStatus(req.sessionID);
    });
  } catch (err) {
    clearDownloadStatus(req.sessionID);
    console.error('Error processing video:', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: `An error occurred while processing the video: ${videoTitle}` });
    }
  }
});


// Endpoint to fetch all videos from a specific playlist
router.get('/playlist/:playlistId/videos', async (req, res) => {
  const { playlistId } = req.params;
  try {
    if (!req.isAuthenticated?.() || (!req.user?.accessToken && !req.user?.refreshToken)) {
      return res.status(401).json({ error: 'Google login expired. Please sign in again.' });
    }

    const oauth2Client = createGoogleOAuthClient();
    oauth2Client.setCredentials({
      access_token: req.user.accessToken,
      refresh_token: req.user.refreshToken,
    });

    const youtube = google.youtube({
      version: 'v3',
      auth: oauth2Client,
    });

    let allVideos = [];
    let nextPageToken = null;

    // Loop to fetch all pages
    do {
      const response = await youtube.playlistItems.list({
        part: 'snippet,contentDetails',
        maxResults: 50, // Fetch 50 items per request (max allowed)
        playlistId,
        pageToken: nextPageToken, // Use the nextPageToken to fetch the next page
      });

      // Map video details while handling potential missing data
      const videos = response.data.items.map((item) => {
        const videoId = item.contentDetails?.videoId;
        const title = item.snippet?.title || 'Untitled Video';
        const thumbnail = item.snippet?.thumbnails?.default?.url || '';

        return {
          id: videoId,
          title,
          thumbnail,
        };
      }).filter(video => video.id); // Filter out videos without a valid video ID

      // Add videos to the overall list
      allVideos = allVideos.concat(videos);

      // Get the nextPageToken for the next request
      nextPageToken = response.data.nextPageToken;
    } while (nextPageToken);

    res.json({ videos: allVideos });
  } catch (err) {
    console.error('Error fetching videos from playlist:', err);
    if (err?.code === 401 || err?.response?.status === 401) {
      return res.status(401).json({ error: 'Google login expired. Please sign in again.' });
    }
    res.status(500).json({ error: 'Error fetching videos' });
  }
});

router.post('/download-zip', async (req, res) => {
  const { videos, zipName } = req.body;
  const downloadMode = normalizeDownloadMode(req.body.downloadMode);
  console.log('Received videos:', videos);

  if (!videos || !Array.isArray(videos) || videos.length === 0) {
    return res.status(400).json({ error: 'No videos provided for download.' });
  }

  try {
    ensureDownloadDir();

    const downloadedFiles = [];
    const skippedVideos = [];
    const archiveFileName = createZipFileName(zipName);
    setSkippedVideos(req.sessionID, skippedVideos);
    setDownloadStatus(req.sessionID, {
      active: true,
      mode: 'playlist',
      title: null,
      downloadMode,
      message: 'Preparing playlist download...',
      currentIndex: null,
      totalVideos: videos.length,
      completedVideos: 0,
      progress: {
        stage: 'preparing',
        percent: null,
      },
    });

    for (const [index, video] of videos.entries()) {
      const { videoUrl, videoTitle } = video;
      console.log(`Processing video: ${videoTitle}`);
      const currentIndex = index + 1;
      const playlistFileBaseName = createPlaylistVideoFileBaseName(
        videoTitle,
        video.playlistIndex || currentIndex,
        video.playlistTotalVideos || videos.length,
      );

      try {
        setDownloadStatus(req.sessionID, {
          active: true,
          mode: 'playlist',
          title: videoTitle,
          videoId: video.videoId || null,
          downloadMode,
          currentIndex,
          totalVideos: videos.length,
          completedVideos: downloadedFiles.length,
          message: `Downloading ${currentIndex} of ${videos.length}: ${videoTitle}`,
          progress: {
            stage: 'starting',
            percent: 0,
          },
        });
        const outputTemplate = path.join(downloadDir, `${playlistFileBaseName}.%(ext)s`);
        const downloadedPath = await runYtDlp(videoUrl, outputTemplate, (progress) => {
          updateDownloadStatus(req.sessionID, {
            active: true,
            mode: 'playlist',
            title: videoTitle,
            videoId: video.videoId || null,
            downloadMode,
            currentIndex,
            totalVideos: videos.length,
            completedVideos: downloadedFiles.length,
            message: progress.message || `Downloading ${currentIndex} of ${videos.length}: ${videoTitle}`,
            progress,
          });
        }, downloadMode);
        const outputFilePath = await ensureCompatibleVideo(downloadedPath, playlistFileBaseName, (progress) => {
          updateDownloadStatus(req.sessionID, {
            active: true,
            mode: 'playlist',
            title: videoTitle,
            videoId: video.videoId || null,
            downloadMode,
            currentIndex,
            totalVideos: videos.length,
            completedVideos: downloadedFiles.length,
            message: progress.message || 'Finalizing MP4...',
            progress,
          });
        });
        downloadedFiles.push({ path: outputFilePath, name: `${playlistFileBaseName}.mp4` });
        updateDownloadStatus(req.sessionID, {
          completedVideos: downloadedFiles.length,
          progress: {
            stage: 'complete',
            percent: 100,
          },
        });

      } catch (err) {
        if (err && (err.message.includes('Video unavailable') || err.message.includes('Private video') || err.message.includes('Sign in to confirm'))) {
          console.warn(`Skipping unavailable or unauthorized video: ${videoTitle}`);
          skippedVideos.push(videoTitle);
          setSkippedVideos(req.sessionID, skippedVideos);
        } else {
          console.error(`Error processing video "${videoTitle}":`, err);
        }
        continue; // Skip to the next video
      }
    }

    // Create a ZIP archive of the downloaded files
    setDownloadStatus(req.sessionID, {
      active: true,
      mode: 'playlist',
      title: null,
      downloadMode,
      message: 'Creating playlist ZIP...',
      currentIndex: null,
      totalVideos: videos.length,
      completedVideos: downloadedFiles.length,
      progress: {
        stage: 'zipping',
        percent: null,
      },
    });
    const archive = archiver('zip', { zlib: { level: 9 } });
    res.setHeader('Content-Disposition', `attachment; filename="${archiveFileName}"`);
    res.setHeader('Content-Type', 'application/zip');

    archive.pipe(res);

    for (const file of downloadedFiles) {
      archive.file(file.path, { name: file.name });
    }

    archive.finalize();

    // Clean up downloaded files after sending the ZIP file
    archive.on('end', () => {
      const reportPath = writeSkippedVideosReport(skippedVideos);
      if (reportPath) {
        console.log(`Skipped videos report saved to ${reportPath}`);
      }
      downloadedFiles.forEach(file => fs.unlinkSync(file.path));
      clearDownloadStatus(req.sessionID);
    });
  } catch (err) {
    clearDownloadStatus(req.sessionID);
    console.error('Error processing playlist:', err);
    res.status(500).json({ error: 'An error occurred while processing the playlist.' });
  }
});

// Endpoint to retrieve skipped videos
router.get('/skipped-videos', (req, res) => {
  res.json({ skippedVideos: getSkippedVideos(req.sessionID) });
});


function createZipFileName(fileName) {
  const sanitizedName = sanitizeFileName(fileName || 'playlist_videos.zip')
    .trim()
    .replace(/\s+/g, ' ');
  const withoutExtension = sanitizedName.toLowerCase().endsWith('.zip')
    ? sanitizedName.slice(0, -4).trim()
    : sanitizedName;

  return `${withoutExtension || 'playlist_videos'}.zip`;
}

function createPlaylistVideoFileBaseName(videoTitle, playlistIndex, totalVideos) {
  const sanitizedTitle = sanitizeFileName(videoTitle);
  const parsedIndex = Number.parseInt(playlistIndex, 10);
  const parsedTotal = Number.parseInt(totalVideos, 10);

  if (!Number.isFinite(parsedIndex) || parsedIndex < 1) {
    return sanitizedTitle;
  }

  const indexWidth = Number.isFinite(parsedTotal) && parsedTotal > 0
    ? String(parsedTotal).length
    : String(parsedIndex).length;
  return `${String(parsedIndex).padStart(indexWidth, '0')} - ${sanitizedTitle}`;
}

// Helper function to sanitize file names
function sanitizeFileName(fileName) {
  if (!fileName) {
    return 'untitled'; // Fallback to a default name if fileName is undefined or null
  }
  return fileName.replace(/[^a-z0-9\-\. ]/gi, ' '); // Replace illegal characters with spaces
}


export default router;
