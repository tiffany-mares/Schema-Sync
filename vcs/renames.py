"""Rename detection: tells a rename apart from a drop-plus-add.

One MiniLM model (384-dim, CPU) serves both this and Atlas Vector Search.
Loaded lazily so vcs startup stays fast; the first /tools/renames call
pays the ~2s model load once.
"""

from functools import lru_cache

THRESHOLD = 0.60


@lru_cache(maxsize=1)
def _model():
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer("all-MiniLM-L6-v2")


def _text(col: dict) -> str:
    # The column NAME is the rename signal; underscores split into words so
    # "grand_total" lands near "total". Table and type only add faint context.
    words = col["column"].replace("_", " ")
    return f"column {words}"


def detect_renames(drops: list[dict], adds: list[dict]) -> list[dict]:
    """Greedy best-first matching of dropped columns to added columns by
    embedding similarity. Same-table pairs only; type changes allowed
    (a rename often changes type too)."""
    if not drops or not adds:
        return []
    model = _model()
    d_emb = model.encode([_text(c) for c in drops], normalize_embeddings=True)
    a_emb = model.encode([_text(c) for c in adds], normalize_embeddings=True)
    sims = d_emb @ a_emb.T  # cosine, since normalized

    candidates = []
    for i, d in enumerate(drops):
        for j, a in enumerate(adds):
            if d.get("table") != a.get("table"):
                continue
            score = float(sims[i][j])
            if score >= THRESHOLD:
                candidates.append((score, i, j))

    pairs = []
    used_d: set[int] = set()
    used_a: set[int] = set()
    for score, i, j in sorted(candidates, reverse=True):
        if i in used_d or j in used_a:
            continue
        used_d.add(i)
        used_a.add(j)
        pairs.append({
            "from": f"{drops[i]['table']}.{drops[i]['column']}",
            "to": f"{adds[j]['table']}.{adds[j]['column']}",
            "score": round(score, 4),
        })
    return pairs
