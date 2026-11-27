"""Inline the drill's scripts into one self-contained page.

Writes two files next to the Field Manual:
  ../sparring.html           full document, open it directly in a browser
  ../sparring-artifact.html  the same page without the document skeleton (the form the artifact viewer expects)
"""
from pathlib import Path

here = Path(__file__).resolve().parent
page = (here / "page.html").read_text()
for key, name in [("ENGINE", "engine.js"), ("BOTS", "bots.js"), ("LESSONS", "lessons.js"), ("APP", "app.js")]:
    src = (here / name).read_text()
    assert "</script" not in src.lower(), name
    page = page.replace("/*@%s@*/" % key, src)
assert "/*@" not in page

# The artifact is published on its own, so relative links to sibling pages would not resolve there.
import re
(here.parent / "sparring-artifact.html").write_text(re.sub(r'\s*<a href="[^"]+" data-local="1">[^<]*</a>', "", page))

head, body = page.split("</style>", 1)
skeleton = (
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    "<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}"
    "body{margin:0}[hidden]{display:none!important}</style>\n"
)
full = skeleton + head + "</style>\n</head>\n<body>\n" + body.lstrip("\n") + "\n</body>\n</html>\n"
(here.parent / "sparring.html").write_text(full)
print("wrote sparring.html (%d KB) and sparring-artifact.html" % (len(full) // 1024))
