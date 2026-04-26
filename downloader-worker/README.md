# Yumu Downloader Worker

Runs the YouTube download/transcode pipeline outside Render.

## Environment variables

- `PORT` — worker port, default `8787`
- `WORKER_SHARED_SECRET` — required shared secret; Render sends it in `x-worker-secret`
- `YT_DLP_COOKIES_B64` or `YT_DLP_COOKIES_PATH` — cookies for the local worker environment
- `WORKER_DOWNLOAD_DIR` — optional temp work directory
- `PYTHON_BIN` — optional Python executable override

## Install

```bash
cd downloader-worker
npm install
python3 -m pip install yt-dlp
```

## Run

```bash
export WORKER_SHARED_SECRET='replace-me'
export YT_DLP_COOKIES_B64='...'
npm start
```

## Test health

```bash
curl http://localhost:8787/health
```

## Notes

- Keep this worker private; do not expose it publicly without network controls.
- The main Yumu app can proxy `/api/download` and `/api/download-zip` requests to this worker when `DOWNLOADER_WORKER_URL` is configured.
