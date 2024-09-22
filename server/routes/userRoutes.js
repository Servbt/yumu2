// authRoutes.js
import express from "express";
import fs from 'fs';
import ytdl from '@distube/ytdl-core';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import ffmpegStatic from 'ffmpeg-static'; // Required for ffmpeg to work properly
import { fileURLToPath } from 'url';

const router = express.Router();
ffmpeg.setFfmpegPath(ffmpegStatic); // Set the path for ffmpeg

// Define __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const downloadDir = path.join(__dirname, 'downloads');

// Endpoint to handle video download requests
router.post('/download', async (req, res) => {
    const { videoUrl } = req.body; // The URL will be sent in the POST request
    console.log(videoUrl);
    
    if (!videoUrl || !ytdl.validateURL(videoUrl)) {
        return res.status(400).json({ error: 'Invalid YouTube URL' });
    }
    
    try {
        if (!fs.existsSync(downloadDir)) {
            fs.mkdirSync(downloadDir);
          }
      // Get video information
      const info = await ytdl.getBasicInfo(videoUrl);
      const videoTitle = sanitizeFileName(info.videoDetails.title);
      const videoFilePath = path.join(__dirname, `${videoTitle}_video.mp4`);
      const audioFilePath = path.join(__dirname, `${videoTitle}_audio.m4a`);
      const outputFilePath = path.join(__dirname, `${videoTitle}.mp4`);
  
      // Download video-only stream
      const videoStream = ytdl(videoUrl, { filter: 'videoonly' });
      const videoFile = fs.createWriteStream(videoFilePath);
      videoStream.pipe(videoFile);
  
      await new Promise((resolve, reject) => {
        videoFile.on('finish', resolve);
        videoFile.on('error', reject);
      });
  
      // Download audio-only stream
      const audioStream = ytdl(videoUrl, { filter: 'audioonly', quality: 'highestaudio' });
      const audioFile = fs.createWriteStream(audioFilePath);
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
          .on('error', reject)
          .run();
      });
  
      // Send the merged file as a download
      res.download(outputFilePath, `${videoTitle}.mp4`, (err) => {
        if (err) {
          console.error('Error sending file:', err);
          return res.status(500).json({ error: 'Error downloading file' });
        }
        // Optionally delete the file after download
        fs.unlinkSync(outputFilePath);
      });
    } catch (err) {
      console.error('Error processing video:', err);
      res.status(500).json({ error: 'Error processing video' });
    }
  });
  
  // Helper function to sanitize file names
  function sanitizeFileName(fileName) {
    return fileName.replace(/[^a-z0-9\-\. ]/gi, ' ');
  }

export default router;
