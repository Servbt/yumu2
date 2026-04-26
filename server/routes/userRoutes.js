// authRoutes.js
import express from "express";
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import archiver from "archiver";
import ffmpegStatic from 'ffmpeg-static';



const router = express.Router();
// Define __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const downloadDir = path.join(__dirname, 'downloads');
const desktopDir = path.join(os.homedir(), 'Desktop');
const ffmpegPath = ffmpegStatic;
const downloadStatuses = new Map();
let decodedCookiesPath = null;
let loggedCookieStatus = false;
const skippedVideosBySession = new Map();

function getWorkerConfig() {
  const workerUrl = process.env.DOWNLOADER_WORKER_URL?.trim();
  const workerSecret = process.env.DOWNLOADER_WORKER_SECRET?.trim();
  if (!workerUrl || !workerSecret || typeof fetch !== 'function') {
    return null;
  }

  return {
    workerUrl: workerUrl.replace(/\/$/, ''),
    workerSecret,
  };
}

function setSkippedVideos(sessionId, videos) {
  if (!sessionId) {
    return;
  }
  skippedVideosBySession.set(sessionId, Array.isArray(videos) ? videos : []);
}

function getSkippedVideos(sessionId) {
  return skippedVideosBySession.get(sessionId) || [];
}

async function proxyWorkerDownload(req, res, workerPath, payload, fallbackFilename) {
  const config = getWorkerConfig();
  if (!config) {
    return false;
  }

  const response = await fetch(`${config.workerUrl}${workerPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-worker-secret': config.workerSecret,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Worker request failed with status ${response.status}`);
  }

  const skippedHeader = response.headers.get('x-skipped-videos');
  if (skippedHeader) {
    try {
      setSkippedVideos(req.sessionID, JSON.parse(skippedHeader));
    } catch (error) {
      console.warn('Failed to parse worker skipped videos header:', error.message);
    }
  }

  const contentDisposition = response.headers.get('content-disposition');
  const fileName = contentDisposition?.match(/filename="?([^";]+)"?/i)?.[1] || fallbackFilename;
  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  const arrayBuffer = await response.arrayBuffer();
  const fileBuffer = Buffer.from(arrayBuffer);

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Length', fileBuffer.length);
  res.send(fileBuffer);
  return true;
}


function createGoogleOAuthClient() {
  const isProduction = process.env.NODE_ENV === 'production';
  const clientBaseUrl = process.env.APP_BASE_URL || (
    isProduction
      ? "https://yumu.onrender.com"
      : "http://localhost:3000"
  );
  const googleCallbackUrl = process.env.GOOGLE_CALLBACK_URL || (
    isProduction
      ? `${clientBaseUrl}/auth/google/secrets`
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

function getYtDlpCookiesPath() {
  if (process.env.YT_DLP_COOKIES_PATH) {
    logCookieStatus(process.env.YT_DLP_COOKIES_PATH, 'YT_DLP_COOKIES_PATH');
    return process.env.YT_DLP_COOKIES_PATH;
  }

  const encodedCookies = process.env.YT_DLP_COOKIES_B64?.trim();
  if (!encodedCookies) {
    logCookieStatus(null, 'none');
    return null;
  }

  ensureDownloadDir();

  if (!decodedCookiesPath) {
    decodedCookiesPath = path.join(downloadDir, 'youtube-cookies.txt');
    const normalizedBase64 = encodedCookies.replace(/\s+/g, '');
    fs.writeFileSync(decodedCookiesPath, Buffer.from(normalizedBase64, 'base64'));
    fs.chmodSync(decodedCookiesPath, 0o600);
  }

  logCookieStatus(decodedCookiesPath, 'YT_DLP_COOKIES_B64');
  return decodedCookiesPath;
}

function logCookieStatus(cookiesPath, source) {
  if (loggedCookieStatus) {
    return;
  }

  loggedCookieStatus = true;

  if (!cookiesPath) {
    console.warn('yt-dlp cookies are not configured. Set YT_DLP_COOKIES_B64 or YT_DLP_COOKIES_PATH on Render.');
    return;
  }

  try {
    const content = fs.readFileSync(cookiesPath, 'utf8');
    const nonCommentLines = content
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.startsWith('#'));

    const parsedRows = nonCommentLines
      .map((line) => {
        const fields = line.split(/\t+/);
        if (fields.length < 7) {
          return null;
        }

        return {
          domain: fields[0],
          name: fields[5],
        };
      })
      .filter(Boolean);

    const hasYoutubeCookie = parsedRows.some(({ domain }) => /(^|\.)youtube\.com$/i.test(domain));
    const hasGoogleCookie = parsedRows.some(({ domain }) => /(^|\.)google\.com$/i.test(domain) || /(^|\.)accounts\.google\.com$/i.test(domain));
    const hasYoutubeOrGoogleCookie = hasYoutubeCookie || hasGoogleCookie;
    const hasAuthCookie = parsedRows.some(({ name }) => /^(SID|LOGIN_INFO|SAPISID|APISID|HSID|SSID|__Secure-1PAPISID|__Secure-3PAPISID)$/.test(name));
    const sampleDomains = [...new Set(parsedRows.map(({ domain }) => domain))].slice(0, 8).join(', ');
    const sampleCookieNames = [...new Set(parsedRows.map(({ name }) => name))].slice(0, 12).join(', ');

    console.log(
      `yt-dlp cookies configured from ${source}: ${nonCommentLines.length} cookie rows, ` +
      `youtube/google domains=${hasYoutubeOrGoogleCookie}, auth-like cookies=${hasAuthCookie}, ` +
      `sample domains=${sampleDomains || 'none'}, sample cookie names=${sampleCookieNames || 'none'}`
    );
  } catch (err) {
    console.warn(`yt-dlp cookies configured from ${source}, but could not be read: ${err.message}`);
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

function hasJavaScriptRuntime() {
  for (const command of ['node', 'nodejs']) {
    const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
    if (!result.error && result.status === 0) {
      return true;
    }
  }

  return false;
}

async function runYtDlp(videoUrl, outputTemplate) {
  ensureDownloadDir();

  try {
    return await runYtDlpWithFormat(videoUrl, outputTemplate, 'bv*+ba/best');
  } catch (err) {
    if (!err.message.includes('Requested format is not available')) {
      throw err;
    }

    console.warn('Preferred yt-dlp format unavailable; retrying with broader fallback format.');
    return runYtDlpWithFormat(videoUrl, outputTemplate, 'bestvideo*+bestaudio/best');
  }
}

function runYtDlpWithFormat(videoUrl, outputTemplate, format) {
  return new Promise((resolve, reject) => {
    const cookiesPath = getYtDlpCookiesPath();
    const args = [
      '-m',
      'yt_dlp',
      '--no-progress',
      '--no-warnings',
      '--format',
      format,
      '--output',
      outputTemplate,
      ...(cookiesPath ? ['--cookies', cookiesPath] : []),
      videoUrl,
    ];

    if (!hasJavaScriptRuntime()) {
      console.warn('No JavaScript runtime detected for yt-dlp challenge solving. YouTube extraction may return only storyboard image formats.');
    }

    const child = spawn(process.env.PYTHON_BIN || 'python3', args, {
      cwd: downloadDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', async (code) => {
      if (code !== 0) {
        if (stderr.includes('Requested format is not available')) {
          const availableFormats = await probeYtDlpFormats(videoUrl, cookiesPath);
          reject(new Error(`${stderr.trim()}\nAvailable formats:\n${availableFormats}`));
          return;
        }

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

function probeYtDlpFormats(videoUrl, cookiesPath) {
  return new Promise((resolve) => {
    const args = [
      '-m',
      'yt_dlp',
      '--list-formats',
      ...(cookiesPath ? ['--cookies', cookiesPath] : []),
      videoUrl,
    ];

    const child = spawn(process.env.PYTHON_BIN || 'python3', args, {
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

    child.on('error', (error) => {
      resolve(`(format probe failed to start: ${error.message})`);
    });

    child.on('close', () => {
      const trimmed = output.trim();
      resolve(trimmed || '(no format list output)');
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

async function ensureCompatibleVideo(filePath, sanitizedTitle) {
  const compatiblePath = path.join(downloadDir, `${sanitizedTitle}.compatible.mp4`);
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
  downloadStatuses.set(sessionId, {
    active: false,
    mode: null,
    title: null,
    message: '',
    ...status,
  });
}

function clearDownloadStatus(sessionId) {
  if (!sessionId) {
    return;
  }
  downloadStatuses.set(sessionId, {
    active: false,
    mode: null,
    title: null,
    message: '',
  });
}

router.get('/download-status', (req, res) => {
  res.json(downloadStatuses.get(req.sessionID) || {
    active: false,
    mode: null,
    title: null,
    message: '',
  });
});

// Endpoint to handle video download requests
router.post('/download', async (req, res, next) => {
  const { videoUrl, videoTitle } = req.body;
  console.log('Received video URL:', videoUrl);
  console.log('Received video title:', videoTitle);

  if (!videoUrl || !videoUrl.includes('youtube.com/watch')) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }

    try {
      // Sanitize the video title for a valid filename
      const sanitizedTitle = sanitizeFileName(videoTitle);
      setSkippedVideos(req.sessionID, []);
      setDownloadStatus(req.sessionID, {
        active: true,
        mode: 'single',
        title: videoTitle,
        message: `Downloading ${videoTitle}`,
      });

      const proxied = await proxyWorkerDownload(
        req,
        res,
        '/download',
        { videoUrl, videoTitle },
        `${sanitizedTitle}.mp4`
      );

      if (proxied) {
        clearDownloadStatus(req.sessionID);
        return;
      }

      const outputTemplate = path.join(downloadDir, `${sanitizedTitle}.%(ext)s`);
      const downloadedPath = await runYtDlp(videoUrl, outputTemplate);
      const outputFilePath = await ensureCompatibleVideo(downloadedPath, sanitizedTitle);

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
  const { videos } = req.body;
  console.log('Received videos:', videos);

  if (!videos || !Array.isArray(videos) || videos.length === 0) {
    return res.status(400).json({ error: 'No videos provided for download.' });
  }

  try {
    ensureDownloadDir();
    setSkippedVideos(req.sessionID, []);
    setDownloadStatus(req.sessionID, {
      active: true,
      mode: 'playlist',
      title: null,
      message: 'Preparing playlist download...',
    });

    const proxied = await proxyWorkerDownload(
      req,
      res,
      '/download-zip',
      { videos },
      'playlist_videos.zip'
    );

    if (proxied) {
      clearDownloadStatus(req.sessionID);
      return;
    }

    const downloadedFiles = [];
    const skippedVideos = [];
    setSkippedVideos(req.sessionID, skippedVideos);

    for (const video of videos) {
      const { videoUrl, videoTitle } = video;
      console.log(`Processing video: ${videoTitle}`);

      try {
        setDownloadStatus(req.sessionID, {
          active: true,
          mode: 'playlist',
          title: videoTitle,
          message: `Downloading ${videoTitle}`,
        });
        const sanitizedTitle = sanitizeFileName(videoTitle);
        const outputTemplate = path.join(downloadDir, `${sanitizedTitle}.%(ext)s`);
        const downloadedPath = await runYtDlp(videoUrl, outputTemplate);
        const outputFilePath = await ensureCompatibleVideo(downloadedPath, sanitizedTitle);
        downloadedFiles.push({ path: outputFilePath, name: `${sanitizedTitle}.mp4` });

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
      message: 'Creating playlist ZIP...',
    });
    const archive = archiver('zip', { zlib: { level: 9 } });
    res.setHeader('Content-Disposition', `attachment; filename="playlist_videos.zip"`);
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


// Helper function to sanitize file names
function sanitizeFileName(fileName) {
  if (!fileName) {
    return 'untitled'; // Fallback to a default name if fileName is undefined or null
  }
  return fileName.replace(/[^a-z0-9\-\. ]/gi, ' '); // Replace illegal characters with spaces
}


export default router;
