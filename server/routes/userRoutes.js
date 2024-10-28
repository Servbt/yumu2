// authRoutes.js
import express from "express";
import fs from 'fs';
import ytdl from '@distube/ytdl-core';
const { UnrecoverableError } = ytdl; // Extract UnrecoverableError from the default export

import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import ffmpegStatic from 'ffmpeg-static'; // Required for ffmpeg to work properly
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import archiver from "archiver";
const youtubeCookies = '__Secure-3PSID=g.a000nAhmL430KfGTC1aaC7AugYI0JSopptyYvaQlfKEJqgKKBUEyghMfjOQ5fe105CJlVSEg5AACgYKAfISARESFQHGX2MiHKKdg7zoYMl1deBAHoJhzBoVAUF8yKr6_aCvw-gp4igcUHUwJDyz0076;__Secure-1PSIDTS=sidts-CjIBQT4rX6qm3s8eYAI1YQeg0M_sf0Y_tlFhgQcc8buob8RoB9jHwkJ1HI6sPItsMyzr6xAA;CONSISTENCY=AKreu9vy5wQvVmLl6WN7QAEYm8LJ5jOscjaB8NL6Tl5tD9XCyzgxur4GYsYh6sbQgqM6hpNXZj_Wczo841vNyv56cCIM-kZWYQ_0rUvOmh2KZCxrKJlbG4SHERk;__Secure-3PAPISID=va_4ErOk65wO3PID/AB-ph7lABzFc5Thio;__Secure-3PSIDCC=AKEyXzWkA4vP67f32yOVGJBTnoweF3IdWO7k36koJrip78Ym9z6SA-nSrQxcoA98TvqUz-atpgI;__Secure-3PSIDTS=sidts-CjIBQT4rX6qm3s8eYAI1YQeg0M_sf0Y_tlFhgQcc8buob8RoB9jHwkJ1HI6sPItsMyzr6xAA;LOGIN_INFO=AFmmF2swRQIhAIzdWM_7ljhwtkV2Q27UMX_uW-a0QNBW64ajmG4fueiLAiAXPYXbDutMrcTVlP7hHgM_EvaVQ9QnFc3jYP_dCFdLyA:QUQ3MjNmeVJZQTZiRlpoWjM1YjU5RTZVMDByc1RRRzVCdFljTUVRWUw2ZWE4Mk84b2FuQTQtbkplYW1zU0tjNmNlYVR1ak8yR2FvLVlMSGVqRllVVk9ZMDVkc0FmTXpQUlFZeFNScWZCR1Q3aHlxRUJkTmc3aDBwazVoUVBPdWpRRmRuTlY3czNjNlIyLXFiOVpwRkRkNm53Q25iWFpzZjB3;PREF=f6=40000080&f7=1c100&tz=America.New_York&f5=30000;YT_CL={"loctok":"ACih6ZNLdo_vEOcdtf4y82WR5lJtG-wco3u61yNpuAUr-59GT_4rqVIlcK64C99stiw_uoa8ZQ_x0Wu-tA5p9bGG0iyNHv2jeJc"}';



const router = express.Router();
ffmpeg.setFfmpegPath(ffmpegStatic); // Set the path for ffmpeg

// Define __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const downloadDir = path.join(__dirname, 'downloads');

// Endpoint to handle video download requests
router.post('/download', async (req, res, next) => {
  const { videoUrl, videoTitle } = req.body;
  console.log('Received video URL:', videoUrl);
  console.log('Received video title:', videoTitle);

  if (!videoUrl || !ytdl.validateURL(videoUrl)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }

  try {
    // Sanitize the video title for a valid filename
    const sanitizedTitle = sanitizeFileName(videoTitle);
    const downloadDir = path.join(__dirname, 'downloads');

    // Ensure the downloads directory exists
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir);
    }

    const videoFilePath = path.join(downloadDir, `${sanitizedTitle}_video.mp4`);
    const audioFilePath = path.join(downloadDir, `${sanitizedTitle}_audio.m4a`);
    const outputFilePath = path.join(downloadDir, `${sanitizedTitle}.mp4`);

    // Download video-only stream
    const videoStream = ytdl(videoUrl, {
      filter: 'videoonly',
      requestOptions: {
        headers: {
          'Cookie': youtubeCookies,
          referer: 'https://www.youtube.com/',
          // 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        }
      }
    });
    const videoFile = fs.createWriteStream(videoFilePath);

    videoStream.on('error', (error) => {
      console.error('Error downloading video stream:', error.message);
      if (!res.headersSent) {
        return res.status(500).json({ error: `Failed to download video stream: ${videoTitle}` });
      }
    });

    videoStream.pipe(videoFile);

    await new Promise((resolve, reject) => {
      videoFile.on('finish', resolve);
      videoFile.on('error', reject);
    });

    // Download audio-only stream
    const audioStream = ytdl(videoUrl, {
      filter: 'audioonly',
      quality: 'highestaudio',
      requestOptions: {
        headers: {
          'Cookie': youtubeCookies,
          referer: 'https://www.youtube.com/',
          // 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        }
      }
    });
    const audioFile = fs.createWriteStream(audioFilePath);

    audioStream.on('error', (error) => {
      console.error('Error downloading audio stream:', error.message);
      if (!res.headersSent) {
        return res.status(500).json({ error: `Failed to download audio stream: ${videoTitle}` });
      }
    });

    audioStream.pipe(audioFile);

    await new Promise((resolve, reject) => {
      audioFile.on('finish', resolve);
      audioFile.on('error', reject);
    });

    // Merge video and audio using ffmpeg
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(videoFilePath)
        .input(audioFilePath)
        .output(outputFilePath)
        .videoCodec('copy')
        .audioCodec('aac')
        .on('end', () => {
          // Clean up temporary files
          fs.unlinkSync(videoFilePath);
          fs.unlinkSync(audioFilePath);
          resolve();
        })
        .on('error', (err) => {
          console.error('Error merging video and audio:', err);
          reject(new Error('Error merging video and audio'));
        })
        .run();
    });

    // Set the Content-Disposition header with the correct filename
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizedTitle}.mp4"`);
    res.download(outputFilePath, (err) => {
      if (err) {
        console.error('Error sending file:', err);
        return next(err); // Pass the error to the global error handler
      }
      // Optionally delete the file after download
      fs.unlinkSync(outputFilePath);
    });
  } catch (err) {
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
    const oauth2Client = new google.auth.OAuth2();
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
    res.status(500).json({ error: 'Error fetching videos' });
  }
});



// Variable to store skipped videos temporarily
let skippedVideos = [];

router.post('/download-zip', async (req, res) => {
  const { videos } = req.body;
  console.log('Received videos:', videos);

  if (!videos || !Array.isArray(videos) || videos.length === 0) {
    return res.status(400).json({ error: 'No videos provided for download.' });
  }

  try {
    const downloadDir = path.join(__dirname, 'downloads');
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir);
    }

    const downloadedFiles = [];
    skippedVideos = []; // Reset skippedVideos for this request

    for (const video of videos) {
      const { videoUrl, videoTitle } = video;
      console.log(`Processing video: ${videoTitle}`);
    
      try {
        const sanitizedTitle = sanitizeFileName(videoTitle);
        const videoFilePath = path.join(downloadDir, `${sanitizedTitle}_video.mp4`);
        const audioFilePath = path.join(downloadDir, `${sanitizedTitle}_audio.m4a`);
        const outputFilePath = path.join(downloadDir, `${sanitizedTitle}.mp4`);
    
        // Download video-only stream
        const videoStream = ytdl(videoUrl, {
          filter: 'videoonly',
          requestOptions: {
            headers: {
              'Cookie': youtubeCookies,
              referer: 'https://www.youtube.com/',
              // 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36', // Use a common user agent to mimic a browser
            }
          }
        });
        const videoFile = fs.createWriteStream(videoFilePath);
    
        videoStream.on('error', (error) => {
          // Check if error is a 401 (Unauthorized) error or other unrecoverable errors
          if (error && (error.statusCode === 401 || error.message.includes('This video is unavailable') || error.message.includes('Video unavailable'))) {
            console.warn(`Skipping unavailable or unauthorized video: ${videoTitle}`);
            skippedVideos.push(videoTitle);
            videoFile.close();
            if (fs.existsSync(videoFilePath)) {
              fs.unlinkSync(videoFilePath);
            }
            return;
          } else {
            console.error(`Error downloading video stream for ${videoTitle}:`, error);
            throw error; // Propagate other errors
          }
        });
    
        videoStream.pipe(videoFile);
    
        await new Promise((resolve, reject) => {
          videoFile.on('finish', resolve);
          videoFile.on('error', reject);
        });
    
        // Download audio-only stream
        const audioStream = ytdl(videoUrl, {
          filter: 'audioonly',
          quality: 'highestaudio',
          requestOptions: {
            headers: {
              'Cookie': youtubeCookies,
              referer: 'https://www.youtube.com/',
              // 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            }
          }
        });
        const audioFile = fs.createWriteStream(audioFilePath);
    
        audioStream.on('error', (error) => {
          if (error && (error.statusCode === 401 || error.message.includes('This video is unavailable') || error.message.includes('Video unavailable'))) {
            console.warn(`Skipping unavailable or unauthorized audio for video: ${videoTitle}`);
            skippedVideos.push(videoTitle);
            audioFile.close();
            if (fs.existsSync(audioFilePath)) {
              fs.unlinkSync(audioFilePath);
            }
            return;
          } else {
            console.error(`Error downloading audio stream for ${videoTitle}:`, error);
            throw error; // Propagate other errors
          }
        });
    
        audioStream.pipe(audioFile);
    
        await new Promise((resolve, reject) => {
          audioFile.on('finish', resolve);
          audioFile.on('error', reject);
        });
    
        // Merge video and audio using ffmpeg
        await new Promise((resolve, reject) => {
          ffmpeg()
            .input(videoFilePath)
            .input(audioFilePath)
            .output(outputFilePath)
            .videoCodec('copy')
            .audioCodec('aac')
            .on('end', () => {
              fs.unlinkSync(videoFilePath);
              fs.unlinkSync(audioFilePath);
              downloadedFiles.push({ path: outputFilePath, name: `${sanitizedTitle}.mp4` });
              resolve();
            })
            .on('error', reject)
            .run();
        });
    
      } catch (err) {
        // Additional error handling if needed
        if (err && (err.statusCode === 401 || err.message.includes('This video is unavailable') || err.message.includes('Video unavailable'))) {
          console.warn(`Skipping unavailable or unauthorized video: ${videoTitle}`);
          skippedVideos.push(videoTitle);
        } else {
          console.error(`Error processing video "${videoTitle}":`, err);
        }
        continue; // Skip to the next video
      }
    }
    

    const zipFilePath = path.join(downloadDir, `playlist_videos.zip`);
     // Create a ZIP archive of the downloaded files
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
       downloadedFiles.forEach(file => fs.unlinkSync(file.path));
     });
   } catch (err) {
     console.error('Error processing playlist:', err);
     res.status(500).json({ error: 'An error occurred while processing the playlist.' });
   }
 });

 // Endpoint to retrieve skipped videos
router.get('/skipped-videos', (req, res) => {
  res.json({ skippedVideos });
});


// Helper function to sanitize file names
function sanitizeFileName(fileName) {
  if (!fileName) {
    return 'untitled'; // Fallback to a default name if fileName is undefined or null
  }
  return fileName.replace(/[^a-z0-9\-\. ]/gi, ' '); // Replace illegal characters with spaces
}


export default router;
