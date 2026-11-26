# Export the IID Punks part tables + sprites to JSON for the avatar builder,
# plus test vectors (Python roll()+render() output) to check the JS port pixel-for-pixel.
import sys, json, random
sys.path.insert(0, sys.argv[1])
import generate_punks as G
from punks_sprites import SPRITES
sys.path.insert(0, sys.argv[3] if len(sys.argv) > 3 else ".")
from maker_sprites import EXTRA_SPRITES, EXTRA_HEAD, EXTRA_NECK, EXTRA_MOUTH, EXTRA_SKULL_MOUTH, EXTRA_NO_MIC, EXTRA_FACE_M, EXTRA_FACE_F, EXTRA_HAIR_COLORS   # maker-only parts, appended at the end

out_dir = sys.argv[2]

def tbl(t):
    # (sprite, name, wM, wF, color)
    return [list(x) for x in t]

parts = {
    "sprites": {k: v.strip("\n").split("\n") for k, v in {**SPRITES, **EXTRA_SPRITES}.items()},
    "FIXED": G.FIXED, "NO_OUTLINE": sorted(G.NO_OUTLINE),
    "SKINS": G.SKINS, "CAT_FUR": G.CAT_FUR, "TYPE_SKIN": G.TYPE_SKIN,
    "DOG_BREEDS": [list(b) for b in G.DOG_BREEDS], "DOG_MOUTH": tbl(G.DOG_MOUTH),
    "CAT_PATTERNS": [list(c) for c in G.CAT_PATTERNS], "TYPE_SPRITE": G.TYPE_SPRITE,
    "HAIR_COLORS": [list(c) for c in G.HAIR_COLORS] + [list(c) for c in EXTRA_HAIR_COLORS], "HAT_COLORS": G.HAT_COLORS, "LENS_COLORS": G.LENS_COLORS,
    "LIP_COLORS": G.LIP_COLORS, "LASER_COLORS": G.LASER_COLORS, "BEARD_COLORS": G.BEARD_COLORS,
    "NATURAL_HAIR": sorted(G.NATURAL_HAIR), "SHADOW_COLORS": G.SHADOW_COLORS, "CAT_EYES": G.CAT_EYES,
    "METALS": G.METALS, "IRIS_COLORS": G.IRIS_COLORS,
    "HEAD": tbl(G.HEAD) + tbl(EXTRA_HEAD), "ROBOT_HEAD": [h[0] for h in G.ROBOT_HEAD if h[0]],
    "DOG_HEAD": [h[0] for h in G.DOG_HEAD if h[0]],
    "EYES": tbl(G.EYES), "MOUTH": tbl(G.MOUTH) + tbl(EXTRA_MOUTH), "MASK_OK_MOUTHS": sorted(G.MASK_OK_MOUTHS),
    "SKULL_MOUTH": tbl(G.SKULL_MOUTH) + tbl(EXTRA_SKULL_MOUTH), "FACIAL": tbl(G.FACIAL), "EAR": tbl(G.EAR),
    "NECK": tbl(G.NECK) + tbl(EXTRA_NECK), "FACE": tbl(G.FACE), "GEAR": tbl(G.GEAR), "HAIR_ACC": tbl(G.HAIR_ACC),
    "HIDES_EAR": sorted(G.HIDES_EAR), "HIDES_NECK": sorted(G.HIDES_NECK), "NO_MIC": sorted(set(G.NO_MIC) | set(EXTRA_NO_MIC)),
    "HAIR_ACC_OK": sorted(G.HAIR_ACC_OK), "HIDES_FACE": sorted(G.HIDES_FACE), "BIG_BEARDS": sorted(G.BIG_BEARDS),
    "FACE_SHAPES_M": tbl(G.FACE_SHAPES_M) + tbl(EXTRA_FACE_M), "FACE_SHAPES_F": tbl(G.FACE_SHAPES_F) + tbl(EXTRA_FACE_F),
    "NOSES": tbl(G.NOSES), "EXPRESSIONS": tbl(G.EXPRESSIONS), "ANGRY_OK": sorted(G.ANGRY_OK),
    "CLIP_LAYERS": sorted(G.CLIP_LAYERS),
}
json.dump(parts, open(f"{out_dir}/parts.json", "w"), separators=(",", ":"))

# test vectors
rng = random.Random(7)
vec = []
types = ["Male", "Female", "Gold", "Ghost", "Skeleton", "Robot", "Cat", "Dog"]
for i in range(3000):
    t = types[i % len(types)]
    attrs, rc, _ = G.roll(rng, t)
    img = G.render(rc)
    px = img.load()
    grid = ["".join("%02x%02x%02x" % px[x, y][:3] if px[x, y][3] else "------" for x in range(24)) for y in range(24)]
    vec.append({"attrs": attrs, "recipe": rc, "px": grid})
json.dump(vec, open(f"{out_dir}/vectors.json", "w"))
print("ok", len(parts["sprites"]), len(vec))
