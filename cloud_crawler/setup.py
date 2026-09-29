from setuptools import find_packages, setup

setup(
    name="imgnest-cloud-crawler",
    version="1.0.0",
    packages=find_packages(),
    install_requires=["Scrapy>=2.11,<3.0"],
    entry_points={"scrapy": ["settings = imgnest.settings"]},
)
