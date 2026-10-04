# IMGNest

A self-hosted image collection and REST API. A Scrapy spider runs in Scrapy Cloud, the Node.js worker triggers it and reads its bounded image-URL results, and the Node.js server downloads, validates, and converts images to local WebP files. API requests never scrape websites or trigger cloud jobs.

<img width="1983" height="793" alt="0d017d95-0e2f-44a6-95d1-0553bcadf7fa" src="https://github.com/user-attachments/assets/664adc88-d139-4e39-915c-8de8870c79d3" />

---

## How it works

```
Discord bots / websites / scripts
        |
        v
  Fastify REST API  (Node.js, your VPS)
        |
    SQLite + local WebP files
        ^
  Node.js worker --> Scrapy Cloud --> Wikimedia Commons
                     (spider job)      (CC-Zero images)
```

1. The **Scrapy Cloud spider** (`imgnest_images`) crawls Wikimedia Commons' CC-Zero category. It returns image URLs and metadata â€” it does not download images itself.
2. The **Node.js worker** (`npm run worker`) triggers a spider job, reads the bounded results, validates metadata, downloads each image, converts it to WebP with Sharp, and stores it locally alongside a SQLite record.
3. The **Fastify API** (`npm start`) serves everything over HTTP â€” paginated lists, random picks, search, category fetch â€” all from local SQLite and local files. API requests are instant; they never start a crawl.

---

## Requirements

- Node.js **20.11+** (22 LTS recommended)
- npm **10+**
- A [Scrapy Cloud](https://app.zyte.com) project + API key *(not a Zyte Data API key)*
- Python **3.10+** â€” only needed once to deploy the spider

---

## Local setup

```bash
# 1. Clone and enter the project
git clone https://github.com/YOUR_GITHUB/IMGNest.git
cd IMGNest

# 2. Install dependencies
npm install

# 3. Copy the example environment file
cp .env.example .env   # Linux/macOS
copy .env.example .env # Windows PowerShell

# 4. Fill in your credentials in .env (see Environment variables below)

# 5. Create storage directories and init the dev database
npm run db:init

# 6. Start the dev server
npm run dev
```

Visit `http://localhost:3000/api/health` â€” you should get `"status":"ok"`.

The banner in your terminal shows the IMGNest ASCII art, version, and mode on every start.

---

## Running in production (Ubuntu VPS)

### 1. System setup

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl git build-essential python3 nginx

# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2. Create a service user and clone

```bash
sudo adduser --disabled-password --gecos "" imgnest
sudo install -d -o imgnest -g imgnest /opt/IMGNest
sudo -u imgnest git clone https://github.com/YOUR_GITHUB/IMGNest.git /opt/IMGNest
```

### 3. Build

```bash
cd /opt/IMGNest
sudo -u imgnest npm install
sudo -u imgnest npm run build
```

### 4. Persistent storage

```bash
sudo install -d -o imgnest -g imgnest -m 750 /data /data/images /data/tmp
```

### 5. Production `.env`

```bash
sudo -u imgnest cp .env.example .env
sudo -u imgnest nano .env
```

Minimum production values:

```env
NODE_ENV=production
ENABLE_SCHEDULER=true
HOST=127.0.0.1
PORT=3000
DATABASE_PATH=/data/app.db
IMAGE_STORAGE_PATH=/data/images
TEMP_STORAGE_PATH=/data/tmp
PUBLIC_BASE_URL=https://img.example.com

SCRAPY_CLOUD_API_KEY=YOUR_KEY
SCRAPY_CLOUD_PROJECT_ID=123456
SCRAPY_CLOUD_SPIDER=imgnest_images
CRAWLER_SOURCE_URL=https://commons.wikimedia.org/wiki/Category:CC-Zero
CRAWLER_CONTACT_EMAIL=you@example.com
CRAWLER_MAX_ITEMS=20
CRAWLER_MAX_DOWNLOADS=20

FETCH_RATE_LIMIT_MAX=5
FETCH_RATE_LIMIT_WINDOW_MS=10000
```

### 6. Initialize DB, verify, then start with PM2

```bash
sudo -u imgnest npm run db:init

# Quick smoke test (Ctrl+C after)
sudo -u imgnest npm start

# PM2
sudo npm install --global pm2
cd /opt/IMGNest
sudo -u imgnest pm2 start ecosystem.config.js
sudo -u imgnest pm2 save
sudo env PATH="$PATH:/usr/bin" pm2 startup systemd -u imgnest --hp /home/imgnest
```

### 7. Nginx reverse proxy

Create `/etc/nginx/sites-available/imgnest`:

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

```bash
sudo ln -s /etc/nginx/sites-available/imgnest /etc/nginx/sites-enabled/imgnest
sudo nginx -t && sudo systemctl reload nginx
```

### 8. HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d img.example.com
```

### Updating

```bash
cd /opt/IMGNest
sudo -u imgnest git pull
sudo -u imgnest npm install
sudo -u imgnest npm run build
sudo -u imgnest pm2 reload ecosystem.config.js
```

---

## Deploy the Scrapy Cloud spider

Only needed once, from your development machine:

```bash
cd cloud_crawler
python -m venv .venv

# Windows
.\.venv\Scripts\Activate.ps1
# Linux/macOS
source .venv/bin/activate

pip install --upgrade pip shub -r requirements.txt
shub login          # enter your Scrapy Cloud API key
shub deploy PROJECT_ID
```

After a successful deploy, `imgnest_images` appears under **Mcrappy > Spiders**.

---

## API reference

All endpoints are under `/api`. Image files are served from `/media/images/`.

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Returns `status`, `database`, `storage`, and process `uptime`. |

```bash
curl http://localhost:3000/api/health
# {"status":"ok","database":"connected","storage":"ok","uptime":42}
```

---

### Images

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/images` | Paginated image list, newest first. |
| `GET` | `/api/images/:id` | Single image by ID. |
| `GET` | `/api/images/random` | Random image. Optional `?category=animals`. |
| `GET` | `/api/images/search` | Full-text search. Required `?q=`. Optional `?category=`. |
| `GET` | `/api/images/category/:category` | All images in a category (max 100). |

**Pagination** (`/api/images`):

| Param | Default | Max |
|-------|---------|-----|
| `page` | `1` | 10,000,000 |
| `limit` | `20` | `100` |

```bash
curl "http://localhost:3000/api/images?page=1&limit=20"
curl "http://localhost:3000/api/images/5"
curl "http://localhost:3000/api/images/random"
curl "http://localhost:3000/api/images/random?category=animals"
curl "http://localhost:3000/api/images/search?q=rare+bird"
curl "http://localhost:3000/api/images/category/animals"
```

**Image object:**

```json
{
  "id": 12,
  "title": "Snowy Owl in Flight",
  "category": "birds",
  "description": "...",
  "author": "...",
  "attribution": "...",
  "tags": ["bird", "owl", "snow"],
  "image": "/media/images/abc123.webp",
  "source": "Wikimedia Commons",
  "sourceUrl": "https://commons.wikimedia.org/wiki/File:...",
  "originalImageUrl": "https://upload.wikimedia.org/...",
  "license": "CC0 1.0"
}
```

---

### Fetch (Discord bot endpoint)

```
GET /api/images/fetch?category=birds&limit=5
```

Returns up to **5** random images from any available category. Built for Discord slash commands like `/imgnest category:birds limit:5`.

| Param | Required | Values | Default |
|-------|----------|--------|---------|
| `category` | Yes | Any category with stored images | - |
| `limit` | No | `1`-`5` | `1` |

**Rate limit:** `FETCH_RATE_LIMIT_MAX` requests per `FETCH_RATE_LIMIT_WINDOW_MS` milliseconds per IP. Exceeding the limit returns `429` with a `Retry-After` header.

```bash
curl "http://localhost:3000/api/images/fetch?category=birds&limit=3"
```

```json
{
  "category": "birds",
  "limit": 3,
  "count": 3,
  "results": [
    {
      "id": 7,
      "title": "Snowy Owl",
      "image": "/media/images/abc123.webp",
      "absoluteImage": "https://img.example.com/media/images/abc123.webp",
      "license": "CC0 1.0"
    }
  ]
}
```

`absoluteImage` is a ready-to-use full URL built from `PUBLIC_BASE_URL`. Paste it directly into a Discord embed.

**Error responses:**

| Status | Reason |
|--------|--------|
| `400` | `category` missing or unknown. Response body lists available categories. |
| `400` | `limit` is not 1-5. |
| `404` | Category exists but has no images yet. |
| `429` | Rate limit exceeded. `retryAfterSeconds` tells you how long to wait. |

---

### Categories

```
GET /api/categories
```

Returns all categories and their image counts. Use this to populate dropdowns or autocomplete.

```json
{
  "categories": [
    { "name": "animals", "label": "Animals", "imageCount": 312 }
  ]
}
```

---

### Stats

```
GET /api/stats
```

```json
{
  "totalImages": 312,
  "storageUsed": "1.4 GB",
  "databaseSize": "2.1 MB",
  "crawlerRuns": 48
}
```

---

### Media files

```
GET /media/images/<filename>.webp
```

Streams the WebP file with `Cache-Control: public, max-age=31536000, immutable`. Only filenames recorded in SQLite are served.

---

## Using IMGNest in your projects

### Discord.js bot

```js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('imgnest')
    .setDescription('Get a random image')
    .addStringOption(opt =>
      opt.setName('category').setDescription('Image category').setRequired(true))
    .addIntegerOption(opt =>
      opt.setName('limit').setDescription('How many (max 5)').setMinValue(1).setMaxValue(5)),

  async execute(interaction) {
    const category = interaction.options.getString('category');
    const limit    = interaction.options.getInteger('limit') ?? 1;
    const base     = 'https://img.example.com';

    const res  = await fetch(`${base}/api/images/fetch?category=${category}&limit=${limit}`);
    const data = await res.json();

    if (!res.ok) {
      return interaction.reply({ content: data.error, ephemeral: true });
    }

    const img   = data.results[0];
    const embed = new EmbedBuilder()
      .setTitle(img.title)
      .setImage(img.absoluteImage)
      .setFooter({ text: `${img.license} | ${img.source}` });

    return interaction.reply({ embeds: [embed] });
  }
};
```

### JavaScript / TypeScript

```ts
const BASE = 'https://img.example.com';

// Random animal
const res = await fetch(`${BASE}/api/images/random?category=animals`);
const img = await res.json();
console.log(img.absoluteImage ?? `${BASE}${img.image}`);

// Search
const search = await fetch(`${BASE}/api/images/search?q=owl`);
const { results } = await search.json();
results.forEach(img => console.log(img.title, img.image));

// Fetch (bot-style, up to 5 images)
const fetchRes = await fetch(`${BASE}/api/images/fetch?category=birds&limit=5`);
const { results: birds } = await fetchRes.json();
```

### Python

```python
import requests

BASE = "https://img.example.com"

# Random image
img = requests.get(f"{BASE}/api/images/random").json()
print(img.get("absoluteImage") or BASE + img["image"])

# Fetch endpoint
data = requests.get(f"{BASE}/api/images/fetch", params={"category": "birds", "limit": 3}).json()
for item in data["results"]:
    print(item["title"], item["absoluteImage"])
```

---

## Crawler commands

| Command | What it does |
|---------|-------------|
| `npm run crawl` | Normal mode â€” hard-limited to 100 items/downloads, 10 pages |
| `npm run crawl:test` | Test mode â€” max 3 items, safe to run anytime |
| `npm run crawl:dry` | Dry run â€” discovers URLs only, no downloads, no DB writes |
| `npm run worker` | Starts the scheduled worker (respects `ENABLE_SCHEDULER`) |

```bash
npm run crawl -- --limit=5   # custom cap (cannot exceed mode hard limit)
```

---

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `NODE_ENV` | `development` | `production` enables strict paths and production limits |
| `PORT` | `3000` | API listen port |
| `HOST` | `0.0.0.0` | API listen host. Use `127.0.0.1` behind Nginx |
| `PUBLIC_BASE_URL` | *(empty)* | Full public URL of your server, used for `absoluteImage` in `/api/images/fetch` |
| `DATABASE_PATH` | `./data/dev.db` | SQLite file path |
| `IMAGE_STORAGE_PATH` | `./data/images` | Where WebP files are stored |
| `TEMP_STORAGE_PATH` | `./data/tmp` | Temp files during download/conversion |
| `MAX_STORAGE_MB` | `9000` | Stop crawling when stored files exceed this MB |
| `ENABLE_SCHEDULER` | `false` | Set to `true` on production for scheduled crawls |
| `CRAWLER_INTERVAL_MINUTES` | `60` | How often the scheduler triggers a crawl |
| `SCRAPY_CLOUD_API_KEY` | *(empty)* | Scrapy Cloud project API key (not a Zyte Data API key) |
| `SCRAPY_CLOUD_PROJECT_ID` | *(empty)* | Numeric project ID from the Mcrappy dashboard URL |
| `SCRAPY_CLOUD_SPIDER` | `imgnest_images` | Spider name as it appears in Mcrappy |
| `SCRAPY_CLOUD_TIMEOUT_MS` | `120000` | Max ms to wait for a spider job |
| `CRAWLER_SOURCE_URL` | Wikimedia CC-Zero | Source category page for the spider |
| `CRAWLER_SOURCE_NAME` | `Wikimedia Commons CC-Zero` | Stored with each image record |
| `CRAWLER_SOURCE_LICENSE` | `CC0 1.0` | Fallback license (file pages checked individually) |
| `CRAWLER_CONTACT_EMAIL` | *(empty)* | Required by Wikimedia's User-Agent policy |
| `CRAWLER_MAX_ITEMS` | `5` | Normal mode item cap |
| `CRAWLER_MAX_DOWNLOADS` | `5` | Normal mode download-attempt cap |
| `CRAWLER_MAX_PAGES` | `1` | Normal mode page cap |
| `CRAWLER_MAX_REQUESTS` | `10` | Normal mode Scrapy request cap |
| `MAX_FILE_SIZE_MB` | `10` | Max image file size to download |
| `MAX_IMAGE_WIDTH` | `3000` | Max output width; larger images are resized |
| `MAX_IMAGE_HEIGHT` | `3000` | Max output height |
| `IMAGE_DOWNLOAD_TIMEOUT_MS` | `15000` | Timeout for image downloads |
| `FETCH_RATE_LIMIT_MAX` | `5` | Max `/api/images/fetch` requests per window per IP |
| `FETCH_RATE_LIMIT_WINDOW_MS` | `10000` | Rate limit window in ms (default 10 s) |

---

## Tests

```bash
npm test              # Node.js tests (in-memory DB, mocked Scrapy Cloud, no credentials needed)
npm run test:spider   # Python spider unit tests (no external requests)
npm run build         # TypeScript compile check
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `No crawler source configured` | Set `CRAWLER_SOURCE_URL` in `.env` |
| Scrapy Cloud key/project errors | Use the Scrapy Cloud API key (not Zyte Data API key). Verify project ID from `/p/PROJECT_ID/` in the dashboard URL |
| Spider not found | Deploy `cloud_crawler/` and confirm `SCRAPY_CLOUD_SPIDER=imgnest_images` |
| Dry/test exits without fetching | Confirm spider is deployed, credentials are correct, and `CRAWLER_SOURCE_URL` is set |
| Images skipped | Check content-type, file-size cap, image format, and whether the source allows direct downloads |
| Storage limit reached | Free disk space or raise `MAX_STORAGE_MB` |
| `storage: unavailable` in health | Ensure `IMAGE_STORAGE_PATH` exists and is writable by the service account |
| SQLite permission errors | Verify `/data`, `/data/app.db`, and all storage paths are writable by `imgnest` |
| Worker online but no crawl logs | It waits one full interval before the first run. Confirm `ENABLE_SCHEDULER=true` and check `pm2 logs imgnest-worker` |
| `429` from `/api/images/fetch` | Rate limit hit. Read `retryAfterSeconds` in the response and back off |
| `absoluteImage` is `null` | Set `PUBLIC_BASE_URL` in `.env` to your server public URL |

---

## Architecture notes

- **No runtime scraping.** The API never starts a cloud job or scrapes during a request.
- **CC0 only.** The spider checks per-file Commons license metadata. Only CC0-marked files are stored.
- **Content filtering.** A metadata keyword blocklist excludes religious and mature terms. Only records classified as animals are accepted. This is metadata-based, not pixel-level detection.
- **Safe downloads.** HTTP/HTTPS only, no private/local addresses, max 3 validated redirects, byte-limit enforced while streaming.
- **WebP everywhere.** Sharp accepts JPEG, PNG, WebP, GIF, and AVIF as input and always writes WebP. Output filenames are SHA-256-derived.
- **Deduplication.** Both SHA-256 hash and source URL are unique-indexed in SQLite; the same image is never stored twice.
- **Storage cap.** The crawler checks stored file sizes before each download. A full store stops the current run cleanly.
