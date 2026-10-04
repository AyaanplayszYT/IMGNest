import random
import re
import string
from html import unescape
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

import scrapy


def positive_int(value, default, maximum):
    if value is None or value == "":
        return default
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise ValueError("Crawler limits must be positive integers")
    if parsed < 1:
        raise ValueError("Crawler limits must be positive integers")
    return min(maximum, parsed) if parsed > 0 else default


BLOCKED_CONTENT = re.compile(
    r"\b(jesus|christ|christian(?:s|ity)?|religions?|religious|bible|biblical|church(?:es)?|worship|prayers?|"
    r"saints?|nude|nudity|naked|porn|pornography|sexual|sex|erotic|genital|explicit|nsfw|mature|"
    r"gore|blood|corpse|torture|rape|suicide|self[- ]harm|graphic violence|crucifixion)\b",
    re.IGNORECASE,
)
ANIMAL_CONTENT = re.compile(
    r"\b(animal|animals|wildlife|fauna|bird|birds|aves|mammal|mammals|reptile|reptiles|"
    r"amphibian|amphibians|fish|fishes|insect|insects|arachnid|arachnids|spider|spiders|"
    r"butterflies|butterfly|moth|moths|crustacean|crustaceans|mollusc|molluscs)\b",
    re.IGNORECASE,
)
def classify_commons_image(title, description, author, categories):
    metadata = " ".join([title, description, author, *categories])
    if BLOCKED_CONTENT.search(metadata):
        return None
    if ANIMAL_CONTENT.search(metadata):
        return "animals"
    return None


class ImageSpider(scrapy.Spider):
    """Extract a bounded list of image URLs from one configured permitted source."""

    name = "imgnest_images"
    def __init__(self, source_url=None, mode="normal", max_items="5", max_pages="1", max_requests="5", contact_email="", **kwargs):
        super().__init__(**kwargs)
        if not source_url:
            raise ValueError("Pass source_url for a permitted source page")
        parsed = urlsplit(source_url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError("source_url must be an absolute HTTP(S) URL")

        self.mode = mode if mode in ("normal", "test", "dry") else "normal"
        item_hard_limit = 3 if self.mode == "test" else 100
        page_hard_limit = 1 if self.mode == "test" else 10
        self.max_items = positive_int(max_items, 3 if self.mode == "test" else 5, item_hard_limit)
        self.max_pages = positive_int(max_pages, 1, page_hard_limit)
        self.max_requests = positive_int(max_requests, 2 if self.mode == "test" else 5, 20)
        if self.mode == "test":
            self.max_requests = min(self.max_requests, 2)
        self.max_pages = min(self.max_pages, self.max_requests)
        self.request_count = 0
        self.contact_email = contact_email.strip()
        self.is_commons_category = (
            parsed.hostname.lower() == "commons.wikimedia.org"
            and parsed.path.startswith("/wiki/Category:")
        )
        if self.is_commons_category:
            if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", self.contact_email):
                raise ValueError("Pass a valid contact_email so Wikimedia can identify the crawler")
            query = dict(parse_qsl(parsed.query, keep_blank_values=True))
            query.setdefault("filefrom", random.choice(string.ascii_uppercase))
            source_url = urlunsplit(parsed._replace(query=urlencode(query)))
        self.source_url = source_url
        self.start_urls = [source_url]
        self.seen_urls = set()
        self.allowed_origin = (parsed.scheme.lower(), parsed.netloc.lower())

    def parse(self, response, items_found=0, pages_seen=1):
        if self.is_commons_category:
            yield from self.parse_commons_category(response)
            return

        root = response.selector.root
        next_page = None
        page_items = []
        remaining = self.max_items - items_found
        if remaining <= 0:
            return

        # Walk the parsed document incrementally; retain at most the remaining item cap.
        for element in root.iter():
            if len(page_items) >= remaining:
                break
            tag = getattr(element, "tag", "")
            if not isinstance(tag, str):
                continue
            tag = tag.lower()
            attributes = getattr(element, "attrib", {})

            if tag == "a" and next_page is None:
                rel = attributes.get("rel", "").lower().split()
                href = attributes.get("href")
                if "next" in rel and href:
                    candidate = urljoin(response.url, href)
                    parts = urlsplit(candidate)
                    if (parts.scheme.lower(), parts.netloc.lower()) == self.allowed_origin:
                        next_page = candidate

            if tag != "img":
                continue

            value = (attributes.get("src") or attributes.get("data-src")
                     or attributes.get("data-lazy-src") or attributes.get("data-original"))
            if not value and attributes.get("srcset"):
                value = attributes["srcset"].split(",", 1)[0].strip().split()[0]
            if not value:
                continue

            image_url = urljoin(response.url, value)
            parsed = urlsplit(image_url)
            if parsed.scheme not in ("http", "https") or not parsed.netloc:
                continue
            image_url = image_url.split("#", 1)[0]
            if image_url in self.seen_urls:
                continue
            self.seen_urls.add(image_url)
            page_items.append({
                "url": image_url,
                "title": (attributes.get("alt") or attributes.get("title") or "")[:200],
                "source_url": response.url,
            })

        for item in page_items:
            yield item
        items_found += len(page_items)
        self.logger.info("Collected %s/%s image URLs from page %s/%s", items_found, self.max_items, pages_seen, self.max_pages)

        if items_found >= self.max_items or pages_seen >= self.max_pages or not next_page:
            return
        yield response.follow(
            next_page,
            callback=self.parse,
            cb_kwargs={"items_found": items_found, "pages_seen": pages_seen + 1},
        )

    def parse_commons_category(self, response):
        """Sample a few file pages from the CC-Zero category without walking it exhaustively."""
        capacity = self.max_items
        sampled = []
        encountered = 0
        boxes = response.selector.root.xpath(
            '//*[@id="mw-category-media"]//li[contains(concat(" ", normalize-space(@class), " "), " gallerybox ")]'
        )
        supported_extensions = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}
        for box in boxes:
            anchors = box.xpath('.//a[contains(@href, "/wiki/File:")]')
            file_anchor = anchors[0] if anchors else None
            if file_anchor is None:
                continue
            href = file_anchor.get("href")
            name_anchors = box.xpath('.//a[contains(concat(" ", normalize-space(@class), " "), " galleryfilename ")]')
            name_anchor = name_anchors[0] if name_anchors else file_anchor
            title = name_anchor.get("title") or " ".join(name_anchor.xpath(".//text()").getall()) or file_anchor.get("title", "")
            if not href or not title:
                continue
            filename = title.removeprefix("File:").strip()
            if not any(filename.lower().endswith(ext) for ext in supported_extensions):
                continue
            file_page = urljoin(response.url, href)
            image = box.xpath(".//img[1]")
            thumbnail = image[0].get("src") if image else None
            if not thumbnail:
                continue
            entry = {
                "url": urljoin(response.url, thumbnail),
                "title": filename[:200],
                "source_url": file_page,
                "description": filename[:1000],
                "author": "",
                "license": "CC0 1.0",
                "attribution": f"{filename} — CC0 1.0, Wikimedia Commons: {file_page}",
                "category": classify_commons_image(filename, "", "", []),
                "tags": [],
            }
            if not entry["category"]:
                continue
            encountered += 1
            if len(sampled) < capacity:
                sampled.append(entry)
            else:
                index = random.randrange(encountered)
                if index < capacity:
                    sampled[index] = entry

        random.shuffle(sampled)
        if not sampled:
            self.logger.info("No supported image files found in this Commons category page")
            return

        # Robots.txt plus the category page consume requests too. Spend only the
        # remaining request budget on individual file pages for richer metadata.
        detail_budget = max(0, self.max_requests - self.request_count)
        for entry in sampled:
            if detail_budget > 0 and self.mode != "test":
                detail_budget -= 1
                yield response.follow(
                    entry["source_url"],
                    callback=self.parse_commons_file,
                    errback=self.parse_commons_file_error,
                    cb_kwargs={"fallback": entry},
                )
            else:
                yield entry

    def parse_commons_file(self, response, fallback):
        original = response.css(".fullMedia a.internal::attr(href)").get()
        title = response.css("#firstHeading .mw-page-title-main::text").get()
        description = response.xpath('//*[@id="fileinfotpl_desc"]/following-sibling::td[1]//text()').getall()
        author = response.xpath('//*[@id="fileinfotpl_aut"]/following-sibling::td[1]//text()').getall()
        license_name = response.css(".licensetpl_short::text").get(default="").strip()
        if not original or "cc0" not in license_name.lower():
            self.logger.info("Skipping Commons file without verified CC0 license: %s", response.url)
            return

        categories = [
            value.strip() for value in response.css("#mw-normal-catlinks li a::text").getall()
            if value.strip() and value.strip().lower() != "cc-zero"
        ]
        clean_description = self.clean_text(description)[:2000] or fallback["description"]
        clean_author = self.clean_text(author)[:300]
        clean_title = self.clean_text([title])[:200] or fallback["title"]
        topic = classify_commons_image(clean_title, clean_description, clean_author, categories)
        if not topic:
            self.logger.info("Skipping Commons file outside allowed history/animal topics or with blocked metadata: %s", response.url)
            return
        yield {
            "url": original,
            "title": clean_title,
            "source_url": response.url,
            "description": clean_description,
            "author": clean_author,
            "license": "CC0 1.0",
            "attribution": f"{clean_title} by {clean_author} — CC0 1.0, Wikimedia Commons: {response.url}" if clean_author else fallback["attribution"],
            "category": topic,
            "tags": categories[:30],
        }

    def parse_commons_file_error(self, failure):
        fallback = failure.request.cb_kwargs.get("fallback")
        if fallback:
            self.logger.info("Using CC-Zero category metadata after file-page request failed: %s", failure.request.url)
            yield fallback

    @staticmethod
    def clean_text(values):
        text = unescape(" ".join(value.strip() for value in values if isinstance(value, str) and value.strip()))
        return re.sub(r"\s+", " ", text).strip()
