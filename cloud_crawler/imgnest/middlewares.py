from urllib.parse import urlsplit

from scrapy.exceptions import IgnoreRequest


class RequestBudgetMiddleware:
    """Count actual outbound Scrapy requests, including retries, against each job cap."""

    @classmethod
    def from_crawler(cls, crawler):
        middleware = cls()
        middleware.crawler = crawler
        return middleware

    def process_request(self, request, spider=None):
        if spider is None:
            spider = self.crawler.spider
        if urlsplit(request.url).hostname == "commons.wikimedia.org" and spider.contact_email:
            request.headers.setdefault(
                b"User-Agent", f"IMGNest/1.0 (mailto:{spider.contact_email})".encode("utf-8")
            )
        used = getattr(spider, "request_count", 0)
        if used >= spider.max_requests:
            raise IgnoreRequest("IMGNest Scrapy request limit reached")
        spider.request_count = used + 1
