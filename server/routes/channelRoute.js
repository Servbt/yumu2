import express from "express";
import axios from "axios"; 
import dotenv from 'dotenv';
dotenv.config();
// import fs from 'fs';
// import ytdl from '@distube/ytdl-core';
// const { UnrecoverableError } = ytdl; // Extract UnrecoverableError from the default export

// import ffmpeg from 'fluent-ffmpeg';
// import path from 'path';
// import ffmpegStatic from 'ffmpeg-static'; // Required for ffmpeg to work properly
// import { fileURLToPath } from 'url';
// import { google } from 'googleapis';
// import archiver from "archiver";

const router = express.Router();
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY; 
// Endpoint to fetch playlists from a YouTube channel

router.get('/playlists/:channelId', async (req, res) => {
    const { channelId } = req.params;
    let allPlaylists = [];
    let nextPageToken = '';
    
    try {
        do {
            // Fetch playlists from the YouTube Data API
            const response = await axios.get(
                `https://www.googleapis.com/youtube/v3/playlists`,
                {
                    params: {
                        part: 'snippet',
                        channelId: channelId,
                        maxResults: 50, // Set the maximum number of items per page
                        pageToken: nextPageToken, // Handle pagination using nextPageToken
                        key: YOUTUBE_API_KEY,
                    }
                }
            );

            // Add the fetched playlists to the allPlaylists array
            if (response.data.items) {
                const playlists = response.data.items.map((playlist) => ({
                    id: playlist.id,
                    title: playlist.snippet.title,
                    thumbnails: playlist.snippet.thumbnails,
                }));

                allPlaylists = [...allPlaylists, ...playlists];
            }

            // Update the nextPageToken for the next iteration
            nextPageToken = response.data.nextPageToken;
        } while (nextPageToken);

        if (allPlaylists.length > 0) {
            console.log(allPlaylists);
            res.json({ playlists: allPlaylists });
        } else {
            res.status(404).json({ error: "No playlists found for this channel." });
        }
    } catch (error) {
        console.error('Error fetching playlists:', error);
        res.status(500).json({ error: 'Failed to fetch playlists' });
    }
});




export default router;
