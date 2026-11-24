"""Write bga/terrains.json: the 8 terrains in the form the BGA bridge reads (no torch needed).

    python bga/export_terrains.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from toybattle.terrains import EFFECTS, TERRAINS, packed

out = []
for t in TERRAINS:
    out.append({
        "name": t["name"], "effect": EFFECTS[t["effect"]], "objective": t["objective"],
        "packed": packed(t).tolist(),
        "bases": [{"name": b["name"], "x": b["x"], "y": b["y"], "special": b["special"], "gate": b["gate"], "adj": b["adj"]}
                  for b in t["bases"]],
        "hqs": [[{"name": h["name"], "x": h["x"], "y": h["y"], "gate": h["gate"], "adj": h["adj"]} for h in t["hqs"][p]]
                for p in (0, 1)],
        "regions": t["regions"],
    })
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "terrains.json")
json.dump(out, open(path, "w"))
print("wrote", path)
