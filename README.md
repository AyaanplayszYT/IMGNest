# IMGNest V1

IMGNest is a self-hosted image API. A Scrapy spider runs in Scrapy Cloud, the Node.js worker starts it and reads its bounded image-URL results, and the Node.js VPS downloads/processes permitted images into local WebP files. API requests never scrape websites or start cloud jobs.

## Architecture

```text
Discord bots / websites → Fastify API on your VPS → SQLite + local WebP files
                                  ↑
Scrapy Cloud → bounded image URL results → Node worker → validate/download/Sharp
```

There is one crawler in V1: `imgnest_images`, deployed to your Scrapy Cloud project. The project API key is used by the VPS worker to start a spider job and retrieve its results; it is not a Zyte API key. The default source is Wikimedia Commons' CC-Zero file category. The spider obeys Commons robots rules, samples a small randomized slice, verifies CC0 on file pages, and keeps only metadata-classified historical images or animals.

## Requirements

- Node.js **20.11 or newer** (Node 22 LTS recommended) and npm **10 or newer**
- A Scrapy Cloud project and Scrapy Cloud API key (a separate Zyte API subscription is not used by this setup)
- Python 3.10+ on the computer used to deploy the cloud spider
- Windows is supported for development; production instructions target Ubuntu

Check the installed versions:

```bash
node -v
npm -v
```

## Local setup (Windows or Linux)

1. Clone or open the project, then enter its directory:

   ```bash
   cd IMGNest
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create the local environment file.

   Windows PowerShell:

   ```powershell
   copy .env.example .env
   ```

   Linux/macOS:

   ```bash
   cp .env.example .env
   ```

4. Open **Mcrappy → Code & Deploys** in Scrapy Cloud. The screenshots show that no spider/code is deployed yet. From the project URL, note the numeric ID in `/p/PROJECT_ID/...`. Deploy the spider from `cloud_crawler/` as described in [Deploy the Scrapy Cloud spider](#deploy-the-scrapy-cloud-spider).

5. Edit `.env`. Use your **Scrapy Cloud API key** (not a Zyte API key), the numeric project ID, and a contact email for Wikimedia's crawler identification policy:

   ```env
   SCRAPY_CLOUD_API_KEY=YOUR_SCRAPY_CLOUD_KEY
   SCRAPY_CLOUD_PROJECT_ID=123456
   SCRAPY_CLOUD_SPIDER=imgnest_images
   CRAWLER_SOURCE_URL=https://commons.wikimedia.org/wiki/Category:CC-Zero
   CRAWLER_SOURCE_NAME=Wikimedia Commons
   CRAWLER_SOURCE_LICENSE=CC0 1.0
   CRAWLER_CONTACT_EMAIL=you@example.com
   ```

   Do not commit `.env` or share the key. `.env` is excluded by `.gitignore`. The spider only accepts files marked CC0, labels records as `historical` or `animals`, and blocks metadata tagged with religious or mature/graphic terms. It records the Commons file page, author, description, categories, and attribution. Commons asks crawlers to identify themselves, so set a real contact email. An unset Scrapy Cloud setting causes a clear crawler error; the API can still run.

6. Create storage directories and initialize the development database:

   ```bash
   npm run db:init
   ```

   The command creates `data/dev.db`, `data/images/`, and `data/tmp/` as needed.

7. Start the API:

   ```bash
   npm run dev
   ```

   Visit <http://localhost:3000/api/health>. A healthy response includes `"status":"ok"`, `"database":"connected"`, and `"storage":"ok"`.

Starting the API does **not** run the crawler. The local scheduler is disabled by default (`ENABLE_SCHEDULER=false`).

## Safe crawler testing

Crawler activity is always explicit. Development has code-enforced limits: at most 5 image items/download attempts, 1 source category page, and 5 outbound requests. Test mode is clamped to 3 items/download attempts, 1 category page, and 2 outbound requests (enough for `robots.txt` and the category listing). In test mode, Commons category thumbnails provide a CC0 fallback; normal and dry modes spend remaining requests on file pages for richer metadata. The Python spider also applies its own hard caps. Invalid, zero, negative, or non-integer limits fail safely; zero never means unlimited.

### Test 1: Dry run

```bash
npm run crawl:dry
```

Dry run launches a bounded Scrapy Cloud job and prints its image URLs. It does not download images to the VPS or open/modify local SQLite. It does create a Scrapy Cloud job, so it may consume your Scrapy Cloud allowance. It needs a valid Scrapy Cloud key/project/spider and `CRAWLER_SOURCE_URL`.

### Test 2: At most three images

```bash
npm run crawl:test
```

Test mode cannot exceed 3 image download attempts, 3 items, 1 page, or 2 outbound Scrapy requests, even if the page contains thousands of image tags or configuration asks for more. The Scrapy Cloud job returns at most three candidates; the Node worker independently clamps what it accepts. Invalid images are skipped and each attempt consumes a download slot. Each run still consumes Scrapy Cloud usage.

### Test 3: Check the API

After a successful test crawl, run `npm run dev`, then request:

```text
GET http://localhost:3000/api/images
GET http://localhost:3000/api/images/random
GET http://localhost:3000/api/stats
```

The database is `data/dev.db` on development, separate from the production `/data/app.db` path. Run the same crawler again to exercise source-URL duplicate detection.

### Other crawler commands

```bash
npm run crawl                 # normal mode; still hard-limited in development
npm run crawl -- --limit=5    # request a smaller custom cap; code hard limits still apply
npm run crawl:dry             # Scrapy Cloud discovery, no local downloads or DB writes
```

`--limit` must be a positive integer. The effective item and download caps can only be lowered by it, never raised above the mode's hard limits.

Crawler integration tests mock Scrapy Cloud and use local generated images, so `npm test` needs no credentials and makes no external requests. Real cloud execution needs your deployed spider, Scrapy Cloud key/project ID, and permitted source.

## Environment variables

| Variable | Local default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Development uses conservative hard limits and `data/dev.db`. |
| `ENABLE_SCHEDULER` | `false` | The worker exits without scheduling unless explicitly enabled. |
| `PORT`, `HOST` | `3000`, `0.0.0.0` | API listen address. |
| `SCRAPY_CLOUD_API_KEY` | empty | Scrapy Cloud project/account API key; never logged or committed. Not a Zyte API key. |
| `SCRAPY_CLOUD_PROJECT_ID` | empty | Numeric ID from the Mcrappy project URL. |
| `SCRAPY_CLOUD_SPIDER` | `imgnest_images` | Deployed Scrapy spider name. |
| `SCRAPY_CLOUD_TIMEOUT_MS` | `120000` | Maximum time to wait for a Scrapy Cloud job. |
| `SCRAPY_CLOUD_POLL_INTERVAL_MS` | `1000` | Interval between bounded job-status polls. |
| `DATABASE_PATH` | `./data/dev.db` | SQLite metadata path. |
| `IMAGE_STORAGE_PATH` | `./data/images` | Processed WebP storage root. |
| `TEMP_STORAGE_PATH` | `./data/tmp` | Temporary downloads and processed files. |
| `MAX_STORAGE_MB` | `9000` | Stop saving when recorded image storage reaches this cap. |
| `CRAWLER_SOURCE_URL` | Commons CC-Zero category | Wikimedia category page; change only to another permitted source supported by the spider. |
| `CRAWLER_SOURCE_NAME` | `Wikimedia Commons CC-Zero` | Source name stored with image records. |
| `CRAWLER_SOURCE_LICENSE` | `CC0 1.0` | Fallback license; Commons file pages are checked individually. |
| `CRAWLER_CONTACT_EMAIL` | empty | Required for Wikimedia's crawler User-Agent/contact identification. |
| `CRAWLER_HISTORICAL_BEFORE_YEAR` | `1990` | A Commons date at or before this year can classify an image as historical. |
| `CRAWLER_MAX_ITEMS` | `5` | Normal-mode item cap, additionally clamped in code. |
| `CRAWLER_MAX_DOWNLOADS` | `5` | Normal-mode download-attempt cap, additionally clamped in code. |
| `CRAWLER_MAX_PAGES` | `1` | Normal-mode page cap. |
| `CRAWLER_MAX_REQUESTS` | `5` | Normal-mode Scrapy request cap. |
| `TEST_MAX_ITEMS`, `TEST_MAX_DOWNLOADS` | `3`, `3` | Test mode caps, both hard-clamped to 3. |
| `TEST_MAX_PAGES` | `1` | Test mode page cap, hard-clamped to 1. |
| `MAX_FILE_SIZE_MB` | `10` | Maximum downloaded image size. |
| `MAX_IMAGE_WIDTH`, `MAX_IMAGE_HEIGHT` | `3000`, `3000` | Maximum output dimensions; larger images are resized. |
| `IMAGE_DOWNLOAD_TIMEOUT_MS` | `15000` | Timeout for the VPS image downloader. |
| `CRAWLER_INTERVAL_MINUTES` | `60` | Scheduler interval when explicitly enabled. |

The Commons spider selects file pages from a randomly chosen alphabetical position within the CC-Zero category, then samples only up to the current item limit. It obeys `robots.txt`; it does not call Wikimedia's disallowed Action API or Special:Random route. A metadata keyword blocklist excludes religious terms (including Jesus/Christ) and mature/graphic terms, and only records classified as `historical` or `animals` are accepted. This is metadata-based filtering, not visual image recognition, so it cannot identify untagged content by looking at pixels. Image downloads require HTTP(S), reject private/local network addresses and unsupported content types, follow at most three validated redirects, and enforce the byte limit while streaming. Sharp inspects file contents (not the URL extension), accepts JPEG/PNG/WebP/GIF/AVIF, resizes, and writes WebP. Output filenames are SHA-256-derived and sharded under `data/images/`.

## API

All JSON endpoints are under `/api`:

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | Database/storage health and process uptime. |
| `GET /api/images?page=1&limit=20` | Newest-first paginated images with description, author, attribution, license, and source; `limit` is 1–100. |
| `GET /api/images/random` | Select any stored row; optional `?category=animals` or `?category=historical`; never starts a crawl. |
| `GET /api/images/:id` | One image's metadata. |
| `GET /api/images/search?q=rare%20bird` | Searches all query terms across title, description, author, category, Commons tags, and source. |
| `GET /api/images/category/:category` | Category listing (maximum 100). |
| `GET /api/stats` | Image count, recorded image storage, DB file size, and crawl run count. |

Image URLs use `/media/images/<generated-hash>.webp`. The media endpoint serves only filenames matching the generated WebP format and present in SQLite; it never exposes the `data/` directory. It streams the file with `image/webp` and immutable cache headers.

Example:

```bash
curl "http://localhost:3000/api/images?page=1&limit=20"
curl "http://localhost:3000/api/images/search?q=gaming"
curl "http://localhost:3000/api/images/search?q=rare%20bird"
curl "http://localhost:3000/api/images/random?category=animals"
```

A Discord command such as `/imgnest find=rare bird` can call `/api/images/search?q=rare%20bird` and choose one returned item. `/api/images/random?category=animals` returns a random animal already stored in SQLite; neither endpoint starts a crawl.

## Database and storage

SQLite stores image metadata and crawler-run summaries only; image bytes stay in local files. Tables are initialized idempotently by `npm run db:init` and at API startup. Development uses `data/dev.db`; production should use `/data/app.db`. Files are kept under the configured image root in two-character hash directories. Temporary inputs and WebP conversions are removed after each item, including failures and duplicates.

The current storage cap uses the sum of saved file sizes in SQLite. Set `MAX_STORAGE_MB` to a positive integer. A full store stops the current crawl without adding another image.

## Deploy the Scrapy Cloud spider

The project currently has no deployed code, as shown in the Mcrappy dashboard. Deploy the included spider once from your development computer:

1. Install Python 3.10+ and open PowerShell in the IMGNest folder.
2. Create an isolated Python environment and install the Scrapy Cloud deploy tool:

   ```powershell
   cd cloud_crawler
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m pip install --upgrade pip shub -r requirements.txt
   ```

3. Log in using your **Scrapy Cloud API key** (do not use a Zyte API key):

   ```powershell
   shub login
   ```

4. While still in `cloud_crawler`, deploy to the numeric Mcrappy project ID from the browser URL (`/p/PROJECT_ID/`):

   ```powershell
   shub deploy PROJECT_ID
   ```

   On first deploy, `shub` saves the target in `scrapinghub.yml`; its message about migrating configuration from `scrapy.cfg` is expected. After a successful deployment, `imgnest_images` should appear under **Mcrappy → Spiders**. IMGNest starts that spider remotely and fetches its result items; the Scrapy Cloud key stays on the VPS in `.env`.

The spider receives its category URL and limits from the Node worker as job arguments. It returns Commons file URLs and metadata; the VPS performs direct image downloads, validates content, converts to WebP, and stores image data locally.

## Tests and build

```bash
npm test
npm run build
npm run test:spider
```

The Node tests use in-memory SQLite, a mocked Scrapy Cloud job/API, and generated local images. The Python spider tests parse a generated page containing 10,000 image tags and verify test mode yields at most three. They make no external requests.

## Ubuntu VPS deployment

The example below uses Ubuntu 22.04/24.04, an `imgnest` service account, an app checkout at `/opt/IMGNest`, and persistent data in `/data`. Replace `YOUR_GITHUB_NAME` and `img.example.com` with your repository and domain. Run the relevant commands over SSH.

1. **SSH to the VPS** from your computer:

   ```bash
   ssh YOUR_SSH_USER@YOUR_SERVER_IP
   ```

2. **Update Ubuntu and install base tools:**

   ```bash
   sudo apt update
   sudo apt upgrade -y
   sudo apt install -y ca-certificates curl git build-essential python3 nginx
   ```

3. **Install Node.js 22 and verify Node/npm:**

   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt install -y nodejs
   node -v
   npm -v
   ```

4. **Create the service user and clone the project:**

   ```bash
   sudo adduser --disabled-password --gecos "" imgnest
   sudo install -d -o imgnest -g imgnest /opt/IMGNest
   sudo -u imgnest git clone https://github.com/YOUR_GITHUB_NAME/IMGNest.git /opt/IMGNest
   ```

5. **Install project dependencies and build TypeScript:**

   ```bash
   cd /opt/IMGNest
   sudo -u imgnest npm install
   sudo -u imgnest npm run build
   ```

6. **Create persistent storage and permissions:**

   ```bash
   sudo install -d -o imgnest -g imgnest -m 750 /data /data/images /data/tmp
   ```

7. **Create production environment file:**

   ```bash
   sudo -u imgnest cp .env.example .env
   sudo -u imgnest nano .env
   ```

   Set at least these values in `.env` (also set the Scrapy Cloud key/project ID, contact email, and conservative production caps):

   ```env
   NODE_ENV=production
   ENABLE_SCHEDULER=true
   HOST=127.0.0.1
   PORT=3000
   DATABASE_PATH=/data/app.db
   IMAGE_STORAGE_PATH=/data/images
   TEMP_STORAGE_PATH=/data/tmp
   SCRAPY_CLOUD_API_KEY=YOUR_SCRAPY_CLOUD_KEY
   SCRAPY_CLOUD_PROJECT_ID=123456
   SCRAPY_CLOUD_SPIDER=imgnest_images
   CRAWLER_SOURCE_URL=https://commons.wikimedia.org/wiki/Category:CC-Zero
   CRAWLER_CONTACT_EMAIL=you@example.com
   CRAWLER_MAX_ITEMS=20
   CRAWLER_MAX_DOWNLOADS=20
   CRAWLER_MAX_PAGES=2
   CRAWLER_MAX_REQUESTS=4
   ```

   The Node worker uses the Scrapy Cloud API key to start a job and retrieve its items. Production hard caps are 100 items/download attempts, 10 source pages, and 20 outbound requests per run. Store the Scrapy Cloud key only in this server's `.env` and keep that file private.

8. **Initialize the production SQLite database:**

   ```bash
   sudo -u imgnest npm run db:init
   ```

9. **Test the API locally on the server before starting PM2:**

   ```bash
   sudo -u imgnest npm start
   ```

   In another SSH session, run `curl http://127.0.0.1:3000/api/health`. Stop the foreground API with Ctrl+C.

10. **Test crawler access safely:**

    ```bash
    cd /opt/IMGNest
    sudo -u imgnest npm run crawl:dry
    sudo -u imgnest npm run crawl:test
    ```

    Inspect `/api/images` after starting the API again. Dry run does not write; test mode cannot save more than three images.

11. **Install PM2 and start the API and separate worker:**

    ```bash
    sudo npm install --global pm2
    cd /opt/IMGNest
    sudo -u imgnest pm2 start ecosystem.config.js
    sudo -u imgnest pm2 status
    sudo -u imgnest pm2 logs --lines 50
    ```

    The `imgnest-api` and `imgnest-worker` processes are independent. PM2 restarts a crashed process; the API remains online if the worker stops. The worker waits one configured interval before its first scheduled crawl.

12. **Save the PM2 process list and enable boot startup:**

    ```bash
    sudo -u imgnest pm2 save
    sudo env PATH="$PATH:/usr/bin" pm2 startup systemd -u imgnest --hp /home/imgnest
    ```

    PM2 prints a `sudo ...` command for the system startup service. Copy and run the exact command it prints, then check `sudo systemctl status pm2-imgnest`.

13. **Configure Nginx as a reverse proxy.** Create `/etc/nginx/sites-available/imgnest`:

    ```nginx
    server {
        listen 80;
        server_name img.example.com;

        location / {
            proxy_pass http://127.0.0.1:3000;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_read_timeout 30s;
        }
    }
    ```

    Activate and check the configuration:

    ```bash
    sudo ln -s /etc/nginx/sites-available/imgnest /etc/nginx/sites-enabled/imgnest
    sudo nginx -t
    sudo systemctl reload nginx
    ```

14. **Enable HTTPS with Let's Encrypt.** Point the domain DNS A/AAAA record at the VPS first, then run:

    ```bash
    sudo apt install -y certbot python3-certbot-nginx
    sudo certbot --nginx -d img.example.com
    sudo certbot renew --dry-run
    ```

    Check `https://img.example.com/api/health`. Open only SSH, HTTP, and HTTPS in the firewall; do not expose port 3000 publicly. For UFW, for example:

    ```bash
    sudo ufw allow OpenSSH
    sudo ufw allow 'Nginx Full'
    sudo ufw enable
    ```

### Updating the VPS

```bash
cd /opt/IMGNest
sudo -u imgnest git pull
sudo -u imgnest npm install
sudo -u imgnest npm run build
sudo -u imgnest pm2 reload ecosystem.config.js
```

## Troubleshooting

- **`No crawler source configured`**: set `CRAWLER_SOURCE_URL` to a permitted page and restart the command.
- **Scrapy Cloud key/project errors**: use the Scrapy Cloud key (not a Zyte API key), and confirm the project ID from the `/p/PROJECT_ID/` part of the Mcrappy dashboard URL.
- **Spider not found**: deploy `cloud_crawler/` and confirm `SCRAPY_CLOUD_SPIDER=imgnest_images` matches the name under Mcrappy → Spiders.
- **Dry/test command exits without fetching**: confirm the cloud spider is deployed, the Scrapy Cloud key/project ID are correct, and the source URL is set.
- **Images are skipped**: check the response content type, file-size cap, format, and whether the source allows direct image downloads. The crawler records skips and continues within its limits.
- **Storage limit reached**: free disk space or raise `MAX_STORAGE_MB` after checking available disk; the crawler safely stops at the configured cap.
- **API health reports storage unavailable**: ensure `IMAGE_STORAGE_PATH` exists and the service account can read/write it.
- **SQLite permission errors**: verify `/data`, `/data/app.db`, and all storage paths are writable by `imgnest`.
- **PM2 worker is online but has no crawl logs**: it waits for `CRAWLER_INTERVAL_MINUTES` before the first scheduled run; check `ENABLE_SCHEDULER=true` and inspect `pm2 logs imgnest-worker`.

## Adding permitted sources later

Add a source object in `src/config/sources.ts` and keep the image crawler/service pipeline shared. Validate permission, source terms, and redistribution rights before enabling it. V1 deliberately includes only one crawler and has no user-facing feature that triggers a crawl.
