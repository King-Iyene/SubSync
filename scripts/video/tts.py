# Generates one WAV per script line with Kokoro-82M (Apache-2.0), CPU only.
# Usage: python -I tts.py lines.json out_dir [voice]
import json, sys, os
import numpy as np, soundfile as sf
from kokoro import KPipeline

lines = json.load(open(sys.argv[1], encoding="utf-8"))
out = sys.argv[2]
voice = sys.argv[3] if len(sys.argv) > 3 else "af_heart"
os.makedirs(out, exist_ok=True)
pipe = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")
for l in lines:
    chunks = [a for _, _, a in pipe(l["text"], voice=voice, speed=l.get("speed", 0.95), split_pattern=r"\n+")]
    audio = np.concatenate([np.asarray(c, dtype=np.float32) for c in chunks])
    sf.write(os.path.join(out, f"{l['id']}.wav"), audio, 24000)
    print(l["id"], round(len(audio) / 24000, 2), "s", flush=True)
