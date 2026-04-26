import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import archiver from 'archiver';
import ffmpegStatic from 'ffmpeg-static';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 8787;
const apiKey = process.env.WORKER_SHARED_SECRET || '';
const ffmpegPath = ffmpegStatic;
const workRoot = process.env.WORKER_DOWNLOAD_DIR || path.join(os.homedir(), 'yumu-worker-downloads');

app.use(express.json({ limit: '1mb' }));

function requireWorkerAuth(req, res, next) {
  if (!apiKey) {
    return res.status(500).json({ error: 'WORKER_SHARED_SECRET is not configured on the worker.' });
  }

  const authHeader = req.get('x-worker-secret');
  if (!authHeader || authHeader !== apiKey) {
    return res.status(401).json({ error: 'Unauthorized worker request.' });
  }

  next();
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function sanitizeFileName(fileName) {
  if (!fileName) {
    return 'untitled';
  }
  return fileName.replace(/[^a-z0-9\-\. ]/gi, ' ').trim() || 'untitled';
}

function createJobDir(prefix) {
  ensureDir(workRoot);
  return fs.mkdtempSync(path.join(workRoot, `${prefix}-`));
}

function getYtDlpCookiesArgs() {
  const cookiesPath = process.env.YT_DLP_COOKIES_PATH?.trim();
  if (cookiesPath) {
    return ['--cookies', cookiesPath];
  }

  const encodedCookies = process.env.YT_DLP_COOKIES_B64?.trim();
  if (!encodedCookies) {
    return [];
  }

  ensureDir(workRoot);
  const decodedCookiesPath = path.join(workRoot, 'youtube-cookies.txt');
  const normalizedBase64 = encodedCookies.replace(/\s+/g, '');
  fs.writeFileSync(decodedCookiesPath, Buffer.from(normalizedBase64, 'base64'));
  fs.chmodSync(decodedCookiesPath, 0o600);
  return ['--cookies', decodedCookiesPath];
}

function findDownloadedFile(jobDir, outputTemplate) {
  const expectedMp4 = outputTemplate.replace('.%(ext)s', '.mp4');
  if (fs.existsSync(expectedMp4)) {
    return expectedMp4;
  }

  const prefix = path.basename(outputTemplate).replace('.%(ext)s', '');
  const matches = fs.readdirSync(jobDir)
    .filter((file) => file.startsWith(prefix))
    .map((file) => path.join(jobDir, file));

  if (!matches.length) {
    throw new Error(`yt-dlp did not create an output file for ${prefix}`);
  }

  return matches[0];
}

function runYtDlpWithFormat(videoUrl, outputTemplate, format, jobDir) {
  return new Promise((resolve, reject) => {
    const args = [
      '-m',
      'yt_dlp',
      '--no-progress',
      '--no-warnings',
      '--format',
      format,
      '--output',
      outputTemplate,
      ...getYtDlpCookiesArgs(),
      videoUrl,
    ];

    const child = spawn(process.env.PYTHON_BIN || 'python3', args, {
      cwd: jobDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
        return;
      }

      try {
        resolve(findDownloadedFile(jobDir, outputTemplate));
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function runYtDlp(videoUrl, outputTemplate, jobDir) {
  try {
    return await runYtDlpWithFormat(videoUrl, outputTemplate, 'bv*+ba/best', jobDir);
  } catch (error) {
    if (!error.message.includes('Requested format is not available')) {
      throw error;
    }

    return runYtDlpWithFormat(videoUrl, outputTemplate, 'bestvideo*+bestaudio/best', jobDir);
  }
}

function transcodeToCompatibleMp4(inputPath, outputPath, jobDir) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-i', inputPath,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '192k',
      outputPath,
    ];

    const child = spawn(ffmpegPath, args, {
      cwd: jobDir,
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

async function downloadSingleVideo(videoUrl, videoTitle, jobDir) {
  const sanitizedTitle = sanitizeFileName(videoTitle);
  const outputTemplate = path.join(jobDir, `${sanitizedTitle}.%(ext)s`);
  const downloadedPath = await runYtDlp(videoUrl, outputTemplate, jobDir);
  const outputFilePath = path.join(jobDir, `${sanitizedTitle}.compatible.mp4`);
  await transcodeToCompatibleMp4(downloadedPath, outputFilePath, jobDir);

  if (fs.existsSync(downloadedPath) && downloadedPath !== outputFilePath) {
    fs.unlinkSync(downloadedPath);
  }

  return {
    outputFilePath,
    fileName: `${sanitizedTitle}.mp4`,
    sanitizedTitle,
  };
}

async function createPlaylistZip(videos, jobDir) {
  const downloadedFiles = [];
  const skippedVideos = [];

  for (const video of videos) {
    try {
      const result = await downloadSingleVideo(video.videoUrl, video.videoTitle, jobDir);
      downloadedFiles.push(result);
    } catch (error) {
      if (error.message.includes('Video unavailable') || error.message.includes('Private video') || error.message.includes('Sign in to confirm')) {
        skippedVideos.push(video.videoTitle);
        continue;
      }
      throw error;
    }
  }

  const zipPath = path.join(jobDir, 'playlist_videos.zip');
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);

    downloadedFiles.forEach((file) => {
      archive.file(file.outputFilePath, { name: file.fileName });
    });

    if (skippedVideos.length) {
      archive.append(
        `The following videos could not be downloaded:\n\n${skippedVideos.map((title, index) => `${index + 1}. ${title}`).join('\n')}\n`,
        { name: 'skipped-videos.txt' }
      );
    }

    archive.finalize();
  });

  return {
    zipPath,
    skippedVideos,
  };
}

function streamAndCleanup(res, filePath, fileName, cleanupDir) {
  res.download(filePath, fileName, (error) => {
    try {
      fs.rmSync(cleanupDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error('Failed to clean worker job directory:', cleanupError);
    }

    if (error && !res.headersSent) {
      res.status(500).json({ error: error.message || 'Failed to send file.' });
    }
  });
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    pythonBin: process.env.PYTHON_BIN || 'python3',
    hasCookies: Boolean(process.env.YT_DLP_COOKIES_PATH || process.env.YT_DLP_COOKIES_B64),
    workRoot,
  });
});

app.post('/download', requireWorkerAuth, async (req, res) => {
  const { videoUrl, videoTitle } = req.body || {};
  if (!videoUrl || !videoTitle) {
    return res.status(400).json({ error: 'videoUrl and videoTitle are required.' });
  }

  const jobDir = createJobDir('single');

  try {
    const { outputFilePath, fileName } = await downloadSingleVideo(videoUrl, videoTitle, jobDir);
    streamAndCleanup(res, outputFilePath, fileName, jobDir);
  } catch (error) {
    console.error('Worker single download failed:', error);
    fs.rmSync(jobDir, { recursive: true, force: true });
    res.status(500).json({ error: error.message || 'Worker download failed.' });
  }
});

app.post('/download-zip', requireWorkerAuth, async (req, res) => {
  const { videos } = req.body || {};
  if (!Array.isArray(videos) || videos.length === 0) {
    return res.status(400).json({ error: 'videos is required.' });
  }

  const jobDir = createJobDir('playlist');

  try {
    const { zipPath, skippedVideos } = await createPlaylistZip(videos, jobDir);
    res.setHeader('x-skipped-videos', JSON.stringify(skippedVideos));
    streamAndCleanup(res, zipPath, 'playlist_videos.zip', jobDir);
  } catch (error) {
    console.error('Worker playlist download failed:', error);
    fs.rmSync(jobDir, { recursive: true, force: true });
    res.status(500).json({ error: error.message || 'Worker playlist download failed.' });
  }
});

app.listen(port, () => {
  console.log(`Yumu downloader worker listening on port ${port}`);
});
