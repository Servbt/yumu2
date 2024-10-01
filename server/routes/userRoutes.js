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

import axios from "axios"; 
import dotenv from 'dotenv';
dotenv.config();


const router = express.Router();
ffmpeg.setFfmpegPath(ffmpegStatic); // Set the path for ffmpeg

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY; 
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

  // Define paths outside of the try block to make them accessible for cleanup
  const sanitizedTitle = sanitizeFileName(videoTitle);
  const videoFilePath = path.join(downloadDir, `${sanitizedTitle}_video.mp4`);
  const audioFilePath = path.join(downloadDir, `${sanitizedTitle}_audio.m4a`);
  const outputFilePath = path.join(downloadDir, `${sanitizedTitle}.mp4`);

  let videoFile, audioFile; // Declare variables to hold stream references

  try {
    // Use YouTube Data API to verify video details before downloading
    const videoId = ytdl.getVideoID(videoUrl);
    const apiResponse = await axios.get(`https://www.googleapis.com/youtube/v3/videos`, {
      params: {
        part: 'snippet,contentDetails,status',
        id: videoId,
        key: process.env.YOUTUBE_API_KEY, // Make sure your API key is set in the .env file
      },
    });

    const videoData = apiResponse.data.items[0];
    if (!videoData || videoData.status.embeddable === false || videoData.status.privacyStatus !== 'public') {
      return res.status(403).json({ error: 'This video cannot be downloaded as it is either private or unavailable.' });
    }

    // Ensure the downloads directory exists
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir);
    }

    // Download video-only stream
    const videoStream = ytdl(videoUrl, { filter: 'videoonly' });
    videoFile = fs.createWriteStream(videoFilePath);

    videoStream.on('error', (error) => {
      console.error('Error downloading video stream:', error.message);
      videoFile.close(); // Ensure the stream is closed on error
      cleanUpFile(videoFilePath);
      cleanUpFile(audioFilePath);
      if (!res.headersSent) {
        return res.status(500).json({ error: `Failed to download video stream: ${videoTitle}` });
      }
    });

    videoStream.pipe(videoFile);

    await new Promise((resolve, reject) => {
      videoFile.on('finish', () => {
        videoFile.close(resolve); // Ensure the file stream is fully closed
      });
      videoFile.on('error', (error) => {
        cleanUpFile(videoFilePath);
        reject(error);
      });
    });

    // Download audio-only stream
    const audioStream = ytdl(videoUrl, { filter: 'audioonly', quality: 'highestaudio' });
    audioFile = fs.createWriteStream(audioFilePath);

    audioStream.on('error', (error) => {
      console.error('Error downloading audio stream:', error.message);
      audioFile.close(); // Ensure the stream is closed on error
      cleanUpFile(videoFilePath);
      cleanUpFile(audioFilePath);
      if (!res.headersSent) {
        return res.status(500).json({ error: `Failed to download audio stream: ${videoTitle}` });
      }
    });

    audioStream.pipe(audioFile);

    await new Promise((resolve, reject) => {
      audioFile.on('finish', () => {
        audioFile.close(resolve); // Ensure the file stream is fully closed
      });
      audioFile.on('error', (error) => {
        cleanUpFile(audioFilePath);
        reject(error);
      });
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
          cleanUpFile(videoFilePath);
          cleanUpFile(audioFilePath);
          resolve();
        })
        .on('error', (err) => {
          console.error('Error merging video and audio:', err);
          cleanUpFile(videoFilePath);
          cleanUpFile(audioFilePath);
          cleanUpFile(outputFilePath);
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
      cleanUpFile(outputFilePath);
    });
  } catch (err) {
    console.error('Error processing video:', err);
    cleanUpFile(videoFilePath);
    cleanUpFile(audioFilePath);
    cleanUpFile(outputFilePath);
    if (!res.headersSent) {
      return res.status(500).json({ error: `An error occurred while processing the video: ${videoTitle}` });
    }
  } finally {
    // Close file streams if they are still open
    if (videoFile) videoFile.close();
    if (audioFile) audioFile.close();
  }
});


// Route to fetch videos from a specific playlist
router.get('/playlist/:playlistId/videos', async (req, res) => {
  const { playlistId } = req.params;
  let allVideos = [];
  let nextPageToken = '';

  try {
      // Check if OAuth is required or if we're using public API access
      do {
          const response = await axios.get(
              `https://www.googleapis.com/youtube/v3/playlistItems`,
              {
                  params: {
                      part: 'snippet',
                      playlistId: playlistId,
                      maxResults: 50, // Fetch up to 50 videos per page
                      pageToken: nextPageToken,
                      key: YOUTUBE_API_KEY, // Use your public API key
                  }
              }
          );

          if (response.data.items) {
              const videos = response.data.items.map((item) => ({
                  id: item.snippet.resourceId.videoId,
                  title: item.snippet.title,
                  thumbnail: item.snippet.thumbnails?.default?.url, // Handle missing thumbnails
              }));

              allVideos = [...allVideos, ...videos];
          }

          nextPageToken = response.data.nextPageToken;
      } while (nextPageToken);

      if (allVideos.length > 0) {
          res.json({ videos: allVideos });
      } else {
          res.status(404).json({ error: "No videos found for this playlist." });
      }
  } catch (error) {
      console.error('Error fetching videos:', error);
      res.status(500).json({ error: 'Failed to fetch videos from the playlist' });
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
        const videoStream = ytdl(videoUrl, { filter: 'videoonly' });
        const videoFile = fs.createWriteStream(videoFilePath);

        videoStream.on('error', (error) => {
          console.warn(`Skipping unavailable or unauthorized video: ${videoTitle}`);
          skippedVideos.push(videoTitle);
          videoFile.close();
          cleanUpFile(videoFilePath);
          return;
        });

        videoStream.pipe(videoFile);
        await new Promise((resolve, reject) => {
          videoFile.on('finish', resolve);
          videoFile.on('error', reject);
        });

        // Download audio-only stream
        const audioStream = ytdl(videoUrl, { filter: 'audioonly', quality: 'highestaudio' });
        const audioFile = fs.createWriteStream(audioFilePath);

        audioStream.on('error', (error) => {
          console.warn(`Skipping unavailable or unauthorized audio for video: ${videoTitle}`);
          skippedVideos.push(videoTitle);
          audioFile.close();
          cleanUpFile(audioFilePath);
          return;
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
              cleanUpFile(videoFilePath);
              cleanUpFile(audioFilePath);
              downloadedFiles.push({ path: outputFilePath, name: `${sanitizedTitle}.mp4` });
              resolve();
            })
            .on('error', (error) => {
              cleanUpFile(videoFilePath);
              cleanUpFile(audioFilePath);
              cleanUpFile(outputFilePath);
              reject(error);
            })
            .run();
        });
      } catch (err) {
        skippedVideos.push(videoTitle);
        continue; // Skip to the next video
      }
    }

    const zipFilePath = path.join(downloadDir, `playlist_videos.zip`);
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
      downloadedFiles.forEach(file => cleanUpFile(file.path));
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

// Function to clean up a file if it exists
function cleanUpFile(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

// Helper function to sanitize file names
function sanitizeFileName(fileName) {
  if (!fileName) {
    return 'untitled'; // Fallback to a default name if fileName is undefined or null
  }
  return fileName.replace(/[^a-z0-9\-\. ]/gi, ' '); // Replace illegal characters with spaces
}


export default router;
