"""Inline the campaign's scripts into one self-contained page.

Writes ../campaign.html (full document) and ../campaign-artifact.html (artifact form, without the
document skeleton and without links to sibling pages, which don't exist where it is published).
"""
import re
from pathlib import Path

here = Path(__file__).resolve().parent
page = (here / "page.html").read_text()
for key, name in [("ENGINE", "engine.js"), ("BOTS", "bots.js"), ("LESSONS", "lessons.js"), ("APP", "app.js")]:
    src = (here / name).read_text()
    assert "</script" not in src.lower(), name
    page = page.replace("/*@%s@*/" % key, src)
assert "/*@" not in page

artifact = re.sub(r'\s*<a href="[^"]+" data-local="1">[^<]*</a>', "", page)
(here.parent / "campaign-artifact.html").write_text(artifact)

head, body = page.split("</style>", 1)
skeleton = (
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    "<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}"
    "body{margin:0}[hidden]{display:none!important}</style>\n"
)
(here.parent / "campaign.html").write_text(skeleton + head + "</style>\n</head>\n<body>\n" + body.lstrip("\n") + "\n</body>\n</html>\n")
print("wrote campaign.html and campaign-artifact.html (%d KB)" % (len(page) // 1024))
