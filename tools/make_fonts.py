#!/usr/bin/env python3
"""Make the page's own fonts (no Google Fonts at runtime).

Subsets DotGothic16 and Noto Sans JP (400 / 700) to exactly the characters the maker page uses, as WOFF files in
maker/fonts/, plus charset.txt (what the subsets cover). maker/build.js inlines them into the page and checks that
every character on the page is covered.

  python3 tools/make_fonts.py <google/fonts checkout>      # needs fontTools; run after changing page text
  (the fonts: ofl/dotgothic16/DotGothic16-Regular.ttf, ofl/notosansjp/NotoSansJP[wght].ttf, both SIL OFL 1.1)
"""
import os, shutil, subprocess, sys
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
gf = sys.argv[1]
out = os.path.join(root, "maker", "fonts")
os.makedirs(out, exist_ok=True)

# characters: everything in the built page (without the fonts) + printable ASCII
subprocess.run(["node", os.path.join(root, "maker", "build.js"), "--no-fonts", "--out", "/tmp/_page.html"], check=True,
               stdout=subprocess.DEVNULL)
text = open("/tmp/_page.html", encoding="utf-8").read()
chars = sorted(set(c for c in text if ord(c) > 126) | set(chr(c) for c in range(32, 127)))
charset = "".join(chars)

def make(src, dst, wght=None):
    f = TTFont(src)
    if wght is not None:
        f = instancer.instantiateVariableFont(f, {"wght": wght})
    opt = subset.Options()
    opt.flavor = "woff"
    opt.layout_features = ["*"]
    opt.name_IDs = ["*"]
    opt.notdef_outline = True
    s = subset.Subsetter(opt)
    s.populate(text=charset)
    s.subset(f)
    f.flavor = "woff"
    f.save(os.path.join(out, dst))
    print(dst, os.path.getsize(os.path.join(out, dst)), "bytes")

make(os.path.join(gf, "ofl/dotgothic16/DotGothic16-Regular.ttf"), "dotgothic16.woff")
make(os.path.join(gf, "ofl/notosansjp/NotoSansJP[wght].ttf"), "notosansjp-400.woff", 400)
make(os.path.join(gf, "ofl/notosansjp/NotoSansJP[wght].ttf"), "notosansjp-700.woff", 700)
open(os.path.join(out, "charset.txt"), "w", encoding="utf-8").write(charset)
shutil.copy(os.path.join(gf, "ofl/dotgothic16/OFL.txt"), os.path.join(out, "OFL-DotGothic16.txt"))
shutil.copy(os.path.join(gf, "ofl/notosansjp/OFL.txt"), os.path.join(out, "OFL-NotoSansJP.txt"))
print(len(charset), "characters")
