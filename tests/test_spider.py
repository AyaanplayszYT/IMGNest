import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

from scrapy.exceptions import IgnoreRequest
from scrapy.http import HtmlResponse, Request

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "cloud_crawler"))
from imgnest.spiders.image_spider import ImageSpider  # noqa: E402
from imgnest.middlewares import RequestBudgetMiddleware  # noqa: E402


class ImageSpiderTests(unittest.TestCase):
    def test_test_mode_stops_at_three_on_a_page_with_thousands_of_images(self):
        spider = ImageSpider(
            source_url="https://fixtures.example.test/page",
            mode="test",
            max_items="10000",
            max_pages="100",
            max_requests="100",
        )
        markup = "".join(
            f'<img src="/image-{index}.png" alt="fixture {index}">' for index in range(10000)
        )
        request = Request(spider.source_url)
        response = HtmlResponse(spider.source_url, request=request, body=markup, encoding="utf-8")
        results = list(spider.parse(response))
        items = [value for value in results if isinstance(value, dict)]

        self.assertEqual(spider.max_items, 3)
        self.assertEqual(spider.max_pages, 1)
        self.assertEqual(spider.max_requests, 2)
        self.assertEqual(len(items), 3)
        self.assertEqual(items[0]["url"], "https://fixtures.example.test/image-0.png")

    def test_zero_limit_fails_instead_of_becoming_unlimited(self):
        with self.assertRaises(ValueError):
            ImageSpider(source_url="https://fixtures.example.test/page", mode="test", max_items="0")

    def test_commons_category_returns_random_bounded_cc0_fallbacks_in_test_mode(self):
        spider = ImageSpider(
            source_url="https://commons.wikimedia.org/wiki/Category:CC-Zero",
            mode="test",
            max_items="3",
            max_requests="2",
            contact_email="crawler@example.test",
        )
        self.assertIn("filefrom=", spider.source_url)
        gallery = "".join(
            f'<li class="gallerybox"><div class="thumb"><a href="/wiki/File:Rare-bird-{i}.jpg" class="mw-file-description">'
            f'<img src="https://thumb.wikimedia.org/test-{i}.jpg"></a></div>'
            f'<div class="gallerytext"><a class="galleryfilename" href="/wiki/File:Rare-bird-{i}.jpg" '
            f'title="File:Rare-bird-{i}.jpg">Rare bird {i}.jpg</a></div></li>'
            for i in range(200)
        )
        html = f'<div id="mw-category-media"><ul class="gallery">{gallery}</ul></div>'
        request = Request(spider.source_url)
        response = HtmlResponse(spider.source_url, request=request, body=html, encoding="utf-8")
        spider.request_count = 2  # robots.txt and the category page used the test request budget
        items = list(spider.parse(response))

        self.assertEqual(len(items), 3)
        self.assertTrue(all(item["license"] == "CC0 1.0" for item in items))
        self.assertTrue(all(item["url"].startswith("https://thumb.wikimedia.org/") for item in items))

    def test_commons_file_page_extracts_original_metadata_and_rejects_non_cc0(self):
        spider = ImageSpider(
            source_url="https://commons.wikimedia.org/wiki/Category:CC-Zero",
            contact_email="crawler@example.test",
        )
        file_url = "https://commons.wikimedia.org/wiki/File:Sample.jpg"
        html = """
        <h1 id="firstHeading"><span class="mw-page-title-main">Sample photo</span></h1>
        <div class="fullMedia"><a class="internal" href="https://upload.wikimedia.org/sample.jpg">Original</a></div>
        <table>
          <tr><td id="fileinfotpl_desc">Description</td><td class="description">A rare bird in flight.</td></tr>
          <tr><td id="fileinfotpl_aut">Author</td><td><a>Example Photographer</a></td></tr>
        </table>
        <span class="licensetpl_short">CC0</span>
        <div id="mw-normal-catlinks"><ul><li><a>Rare birds</a></li></ul></div>
        """
        response = HtmlResponse(file_url, body=html, encoding="utf-8")
        item = list(spider.parse_commons_file(response, fallback={"title": "fallback"}))[0]

        self.assertEqual(item["url"], "https://upload.wikimedia.org/sample.jpg")
        self.assertEqual(item["author"], "Example Photographer")
        self.assertEqual(item["license"], "CC0 1.0")
        self.assertEqual(item["category"], "animals")
        self.assertIn("rare bird", item["description"])
        self.assertIn("Rare birds", item["tags"])

        copyrighted = HtmlResponse(file_url, body=html.replace("CC0", "CC BY-SA 4.0"), encoding="utf-8")
        self.assertEqual(list(spider.parse_commons_file(copyrighted, fallback={"title": "fallback"})), [])

        religious = HtmlResponse(file_url, body=html.replace("Rare birds", "Jesus Christ"), encoding="utf-8")
        self.assertEqual(list(spider.parse_commons_file(religious, fallback={"title": "fallback"})), [])

        non_animal = HtmlResponse(file_url, body=html.replace("Rare birds", "Railway stations").replace("A rare bird in flight.", "A train at a railway station."), encoding="utf-8")
        self.assertEqual(list(spider.parse_commons_file(non_animal, fallback={"title": "fallback"})), [])

    def test_outbound_request_budget_includes_retries(self):
        middleware = RequestBudgetMiddleware()
        spider = SimpleNamespace(max_requests=1, request_count=0, contact_email="crawler@example.test")
        request = Request("https://commons.wikimedia.org/wiki/Category:CC-Zero")
        middleware.process_request(request, spider)
        self.assertIn(b"mailto:crawler@example.test", request.headers.get(b"User-Agent"))
        with self.assertRaises(IgnoreRequest):
            middleware.process_request(request, spider)
        self.assertEqual(spider.request_count, 1)


if __name__ == "__main__":
    unittest.main()
