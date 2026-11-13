# Synthesises a soft ambient pad (no samples, no licence issue). Usage: python -I music.py out.wav seconds
# Slow chord changes (Am9, Fmaj7, Cmaj7, G6), detuned sine layers, gentle tremolo, and a synthetic room reverb.
import sys
import numpy as np
import soundfile as sf

sr = 48000
secs = float(sys.argv[2])
n = int(sr * secs)
t = np.arange(n) / sr
rng = np.random.default_rng(7)

def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)

chords = [[45, 52, 55, 59, 64], [41, 48, 52, 57, 64], [48, 55, 59, 64, 67], [43, 50, 55, 59, 64]]
seg = 14.0
out = np.zeros((2, n))
for i in range(int(secs // seg) + 2):
    ch = chords[i % len(chords)]
    start = i * seg - 3.0
    env = np.clip((t - start) / 5.0, 0, 1) * np.clip((start + seg + 5.0 - t) / 5.0, 0, 1)
    env = np.sin(env * np.pi / 2) ** 2
    if not env.any():
        continue
    for k, m in enumerate(ch):
        for side, det in ((0, -0.07), (1, 0.07)):
            f = hz(m) * (1 + det / 100 * (k + 1))
            tone = np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) + 0.35 * np.sin(2 * np.pi * 2 * f * t) + 0.12 * np.sin(2 * np.pi * 3 * f * t)
            out[side] += tone * env * (0.5 / (1 + 0.25 * k))
trem = 1 + 0.08 * np.sin(2 * np.pi * 0.11 * t)
out *= trem
# One-pole low-pass to keep it soft.
a = np.exp(-2 * np.pi * 1800 / sr)
for c in range(2):
    y = np.zeros(n); prev = 0.0
    x = out[c]
    for i in range(n):
        prev = (1 - a) * x[i] + a * prev
        y[i] = prev
    out[c] = y
# Reverb: exponentially decaying noise impulse, applied with FFT convolution.
ir_len = int(sr * 2.6)
decay = np.exp(-np.arange(ir_len) / (sr * 0.7))
for c in range(2):
    ir = rng.standard_normal(ir_len) * decay
    ir /= np.abs(ir).sum()
    size = 1 << int(np.ceil(np.log2(n + ir_len)))
    wet = np.fft.irfft(np.fft.rfft(out[c], size) * np.fft.rfft(ir, size), size)[:n]
    out[c] = 0.55 * out[c] + 0.9 * wet
out /= np.abs(out).max() * 1.2
sf.write(sys.argv[1], out.T.astype(np.float32), sr, subtype="FLOAT")
print("music ok", secs, "s")
