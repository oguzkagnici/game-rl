"""The 8 terrains of Toy Battle as graphs.

Each terrain: bases (some special), headquarters, paths, and regions (the bases around them and the
medals inside).  Player 0 is Blue (H.Q. drawn at the bottom), player 1 is Red.

The graphs were not read off the boards by us: they follow the transcription in the GrosBill project
(github.com/zorgluf/GrosBill, pull request 23), whose author notes that the medal counts of
Volcanic Jungle and Caribbean Sea come from a third-party source and deserve a check against the
physical boards.  Coordinates are only used for drawing (frame 100 x 166).
"""
import numpy as np

MB, MR, NT = 15, 14, 8                     # max bases, max regions, troop types
TROOPS = ["Kwak", "Skully", "Cap'n", "Jumbo", "Hook", "XB-42", "Star", "Roxy"]   # index = strength, Kwak = joker
EFFECTS = ["none", "recall", "gate", "draw", "erupt", "exhume", "shield", "sniper"]

# node line: name x y kind [gate]; kind = base / special / blue / red
RAW = [
    ("Castle Field", "recall", 7, """
        R 50 12 red; a1 16.5 15.5 base; a2 83.5 15.5 base; b1 37 37.5 base; b2 63 37.5 base;
        s1 15 51 special; s2 85 51 special; m1 20 83 base; m2 50 83 base; m3 80 83 base;
        s3 15 115 special; s4 85 115 special; c1 37 128.5 base; c2 63 128.5 base;
        d1 16.5 150.5 base; d2 83.5 150.5 base; B 50 154 blue""",
     """R-a1 R-a2 a1-b1 a2-b2 b1-s1 b2-s2 s1-m1 s2-m3 b1-m1 b1-m2 b2-m2 b2-m3 m1-s3 m3-s4 m1-c1 m2-c1
        m2-c2 m3-c2 c1-s3 c2-s4 c1-d1 c2-d2 d1-B d2-B""",
     "3:a1 a2 b1 b2 m2; 1:s1 b1 m1; 1:s2 b2 m3; 2:b1 m1 c1 m2; 2:b2 m3 c2 m2; 1:s3 c1 m1; 1:s4 c2 m3; 3:d1 d2 c1 c2 m2"),
    ("Tropical Pool", "gate", 6, """
        R1 15 19 red 67; R2 85 19 red; t 51 20 base; l1 16.5 46 base; c1 51 47 base; r1 84 45 special 12;
        l2 16.5 73 special 345; r2 82.5 69 base; c2 50 83 special 67; l3 17.5 97 base; r3 83.5 93 special 345;
        l4 16 121 special 12; c3 49 119 base; r4 83.5 120 base; b 49 146 base; B1 15 147 blue; B2 85 147 blue 67""",
     """R1-c1 t-c1 t-R2 t-r1 l1-c1 c1-r1 l1-l2 l1-c2 c1-c2 r1-r2 r2-c2 l2-l3 l3-c2 c2-c3 c2-r4 r2-r3 r3-r4
        l3-l4 l4-c3 c3-r4 l4-b c3-b c3-B2 B1-b""",
     "1:t c1 r1; 1:l1 c1 c2; 2:c1 r1 r2 c2; 2:l1 l2 l3 c2; 2:c2 r2 r3 r4; 2:l3 l4 c3 c2; 1:c2 c3 r4; 1:l4 c3 b"),
    ("City of Clouds", "draw", 8, """
        R 50 12 red; l1 11.5 25 base; r1 88.5 25 base; s1 50 39 special; l2 11.5 54 base; r2 88.5 54 base;
        s2 50 68.5 special; l3 11.5 83 base; r3 88.5 83 base; s3 50 97.5 special; l4 11.5 112 base;
        r4 88.5 112 base; s4 50 127 special; l5 11.5 141 base; r5 88.5 141 base; B 50 154 blue""",
     """R-l1 R-r1 l1-s1 r1-s1 l1-l2 r1-r2 l2-s1 r2-s1 l2-s2 r2-s2 l2-l3 r2-r3 l3-s2 r3-s2 l3-s3 r3-s3 l3-l4
        r3-r4 l4-s3 r4-s3 l4-s4 r4-s4 l4-l5 r4-r5 l5-s4 r5-s4 l5-B r5-B""",
     "1:l1 s1 r1; 1:l1 l2 s1; 1:r1 r2 s1; 2:s1 l2 s2 r2; 1:l2 l3 s2; 1:r2 r3 s2; 2:s2 l3 s3 r3; 1:l3 l4 s3; "
     "1:r3 r4 s3; 2:s3 l4 s4 r4; 1:l4 l5 s4; 1:r4 r5 s4; 1:l5 s4 r5"),
    ("Volcanic Jungle", "erupt", 7, """
        a 16 15 base; b 51.5 15 base; R 88 15 red; v1 12 49 special; c 51.5 49 base; d 84 49 base;
        e 14 83 base; f 50 83 base; g 86 83 base; h 16 117 base; i 48.5 117 base; v2 88 117 special;
        B 12 151 blue; j 48.5 151 base; k 84 151 base""",
     "a-b b-R a-v1 v1-e v1-c b-c c-f b-d R-d d-g e-f f-g e-h f-i g-v2 v2-k v2-i h-B h-j i-j B-j j-k",
     "2:a b c v1; 2:v1 c f e; 3:b c f g d; 3:h j i f e; 2:i f g v2; 2:j i v2 k"),
    ("Cursed Cemetery", "exhume", 7, """
        a 31 16 base; R 83 12 red; p1 14 38 special; b 53 38 base; p2 86 38 special; c 33 59.5 base;
        d 68 59.5 base; e 13 83 base; f 50 83 base; g 87 83 base; h 32 106.5 base; i 67 106.5 base;
        p3 14 128 special; j 47 128 base; p4 86 128 special; B 17 154 blue; k 69 150 base""",
     """a-R a-p1 a-c a-b b-R b-p2 b-d p1-c p2-d c-d c-e c-f d-f d-g k-B k-p4 k-i k-j j-B j-p3 j-h p4-i p3-h
        i-h i-g i-f h-f h-e""",
     "1:a p1 c; 2:a b d c; 1:b p2 d; 1:c d f; 2:c e h f; 2:d g i f; 1:h i f; 1:j p3 h; 2:k j h i; 1:k p4 i"),
    ("Caribbean Sea", "none", 5, """
        R 50.5 17 red; a 16.5 19.5 base; b 77 31.5 base; c 16.5 50 base; d 49.5 50 base; e 86.5 66 base;
        f 16.5 84 base; g 50 84 base; h 86.5 103.5 base; i 16.5 114.5 base; j 41.5 114.5 base;
        k 66 123.5 base; l 49.5 151 base; B1 16.5 150.5 blue; B2 87.5 150.5 blue""",
     "a-R a-c R-d d-b c-d c-f d-g b-e b-k f-g f-j g-k e-h h-k h-B2 i-j i-B1 j-l k-l B1-l",
     "1:a c d; 2:c d g f; 2:d b k g; 2:b e h k; 3:f g k l j; 1:i j l"),
    ("Station Metal-X", "shield", 7, """
        a 11 11 base; R 89 11 red; b 56 26 base; c 11 48 base; d 90 48 base; e 50 58.5 base;
        s1 29 83 special; s2 50 83 special; s3 71 83 special; f 50 107.5 base; g 10 118 base;
        h 89 118 base; i 44 140 base; B 11 155 blue; j 89 155 base""",
     """a-R a-c a-e b-R b-e b-d c-e d-e c-s1 e-s1 e-s2 e-s3 d-s3 s1-s2 s2-s3 s1-g s1-f s2-f s3-f s3-h f-g
        f-h f-i f-j g-i h-j i-B j-B""",
     "1:a b e; 1:a c e; 1:b d e; 1:c e s1; 1:d e s3; 1:e s1 s2; 1:e s2 s3; 1:f s1 s2; 1:f s2 s3; 1:g f s1; "
     "1:h f s3; 1:g f i; 1:h f j; 1:i f j"),
    ("Battlefield", "sniper", 8, """
        a1 21 16.5 base; R 50 16.5 red; a2 79 16.5 base; b1 21 44 base; st 50 43 special; b2 79 44 base;
        sl 10 83 special; m1 37 83 base; m2 63 83 base; sr 90 83 special; c1 21 122 base; sb 50 123 special;
        c2 79 122 base; d1 21 149.5 base; B 50 149.5 blue; d2 79 149.5 base""",
     """a1-R R-a2 a1-b1 a2-b2 b1-st st-b2 b1-sl b1-m1 st-m1 st-m2 b2-m2 b2-sr sl-c1 m1-c1 m1-sb m2-sb m2-c2
        sr-c2 c1-sb sb-c2 c1-d1 c2-d2 d1-B B-d2""",
     "3:a1 a2 b1 st b2; 1:b1 st m1; 1:st b2 m2; 2:b1 sl c1 m1; 2:st m1 sb m2; 2:b2 m2 c2 sr; 1:m1 c1 sb; "
     "1:m2 sb c2; 3:c1 sb c2 d1 d2"),
]


def _gate(text):
    m = 1                                   # Kwak (the joker) passes every gate
    for ch in text:
        m |= 1 << int(ch)
    return m


def build():
    out = []
    for name, effect, objective, nodes, edges, regions in RAW:
        bases, hqs = [], []
        for line in nodes.replace("\n", " ").split(";"):
            p = line.split()
            node = {"name": p[0], "x": float(p[1]), "y": float(p[2]), "gate": _gate(p[4]) if len(p) > 4 else 255}
            if p[3] in ("blue", "red"):
                hqs.append({**node, "owner": 0 if p[3] == "blue" else 1, "adj": []})
            else:
                bases.append({**node, "special": p[3] == "special", "adj": []})
        bi = {b["name"]: i for i, b in enumerate(bases)}
        hi = {h["name"]: h for h in hqs}
        for e in edges.split():
            a, b = e.split("-")
            if a in hi or b in hi:
                h, o = (a, b) if a in hi else (b, a)
                hi[h]["adj"].append(bi[o])
            else:
                bases[bi[a]]["adj"].append(bi[b])
                bases[bi[b]]["adj"].append(bi[a])
        regs = []
        for r in regions.split(";"):
            medals, names = r.split(":")
            regs.append({"medals": int(medals), "bases": [bi[n] for n in names.split()]})
        assert len(bases) <= MB and len(regs) <= MR and sum(r["medals"] for r in regs) == 2 * objective + (name == "Caribbean Sea")
        out.append({"name": name, "effect": EFFECTS.index(effect), "objective": objective, "bases": bases,
                    "hqs": [[h for h in hqs if h["owner"] == p] for p in (0, 1)], "regions": regs,
                    "edges": [tuple(e.split("-")) for e in edges.split()]})
    return out


TERRAINS = build()
NAMES = [t["name"] for t in TERRAINS]


def packed(t):
    """Flat int32 description handed to the C++ engine."""
    mask = lambda xs: sum(1 << x for x in xs)
    a = [len(t["bases"]), t["effect"], t["objective"], len(t["regions"])]
    for i in range(MB):
        b = t["bases"][i] if i < len(t["bases"]) else None
        a += [mask(b["adj"]), int(b["special"]), b["gate"]] if b else [0, 0, 0]
    for p in (0, 1):
        a.append(len(t["hqs"][p]))
        for k in range(2):
            h = t["hqs"][p][k] if k < len(t["hqs"][p]) else None
            a += [mask(h["adj"]), h["gate"]] if h else [0, 0]
    for i in range(MR):
        r = t["regions"][i] if i < len(t["regions"]) else None
        a += [mask(r["bases"]), r["medals"]] if r else [0, 0]
    return np.array(a, np.int32)


def static_masks():
    """adj[t, i, j] and share[t, i, j] (bases i and j border a common region) for the network."""
    adj = np.zeros((len(TERRAINS), MB, MB), np.float32)
    share = np.zeros_like(adj)
    for k, t in enumerate(TERRAINS):
        for i, b in enumerate(t["bases"]):
            adj[k, i, b["adj"]] = 1
        for r in t["regions"]:
            for i in r["bases"]:
                share[k, i, r["bases"]] = 1
    return adj, share
