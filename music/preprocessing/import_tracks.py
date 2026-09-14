"""Analyze authorized audio and prepare pitch-preserving, reviewed pool renders."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import wave

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
KEYS_MAJOR = ['8B', '3B', '10B', '5B', '12B', '7B', '2B', '9B', '4B', '11B', '6B', '1B']
KEYS_MINOR = ['5A', '12A', '7A', '2A', '9A', '4A', '11A', '6A', '1A', '8A', '3A', '10A']


def ffmpeg_path():
    configured = os.environ.get('DJFLY_FFMPEG') or shutil.which('ffmpeg')
    if not configured or not Path(configured).is_file():
        raise ValueError('Set DJFLY_FFMPEG to an installed FFmpeg executable. No binary is downloaded.')
    return configured


def run_audio(args):
    result = subprocess.run([ffmpeg_path(), '-hide_banner', '-loglevel', 'error', '-nostdin', *args],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode:
        raise ValueError('FFmpeg could not process this audio. Check the input format and installed filters.')
    return result.stdout


def analyze(path):
    raw = run_audio(['-i', str(path), '-t', '600', '-ac', '1', '-ar', '11025', '-f', 'f32le', 'pipe:1'])
    samples = np.frombuffer(raw, dtype='<f4').astype(np.float64)
    if len(samples) < 11025 * 20 or not np.isfinite(samples).all():
        raise ValueError('Audio must contain at least 20 seconds of finite samples.')
    frames = np.lib.stride_tricks.sliding_window_view(samples, 2048)[::512]
    spectra = np.abs(np.fft.rfft(frames * np.hanning(2048), axis=1))
    frequencies = np.fft.rfftfreq(2048, 1 / 11025)
    power = np.mean(spectra ** 2, axis=0)
    total = max(float(power.sum()), 1e-12)
    bands = [float(power[(frequencies >= lo) & (frequencies < hi)].sum() / total)
             for lo, hi in [(20, 250), (250, 2000), (2000, 5513)]]
    flux = np.maximum(np.diff(spectra, axis=0), 0).sum(axis=1)
    flux -= flux.mean()
    hop_seconds = 512 / 11025
    scores = []
    for bpm in np.arange(80, 161, 0.5):
        lag = round(60 / bpm / hop_seconds)
        score = float(np.dot(flux[lag:], flux[:-lag]) / max(np.dot(flux, flux), 1e-12))
        scores.append((score, float(bpm)))
    score, bpm = max(scores)
    chroma = np.zeros(12)
    for frequency, magnitude in zip(frequencies, power):
        if 65 <= frequency <= 3000:
            chroma[round(69 + 12 * math.log2(frequency / 440)) % 12] += magnitude
    profiles = [np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]),
                np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])]
    correlations = [(float(np.corrcoef(chroma, np.roll(profile, note))[0, 1]), mode, note)
                    for mode, profile in enumerate(profiles) for note in range(12)]
    correlations = sorted((item for item in correlations if math.isfinite(item[0])), reverse=True)
    if not correlations:
        raise ValueError('No usable harmonic content detected.')
    key_score, mode, note = correlations[0]
    rms = float(np.sqrt(np.mean(samples ** 2)))
    density = float(np.clip(np.mean(flux > np.std(flux)) * 4, 0, 1))
    flatness = float(np.exp(np.mean(np.log(power[1:] + 1e-12))) / max(np.mean(power[1:]), 1e-12))
    bins = np.array_split(np.abs(samples), 192)
    return {'estimatedBpm': bpm, 'tempoConfidence': float(np.clip(score, 0, 1)),
            'estimatedCamelotKey': (KEYS_MINOR if mode else KEYS_MAJOR)[note],
            'keyConfidence': max(0, key_score - correlations[1][0]),
            'requiresReview': ['bpm', 'camelotKey', 'firstDownbeat', 'intro', 'outro'],
            'energy': float(np.clip(rms * 3 + density * .3 + bands[0] * .2, 0, 1)),
            'bassEnergy': bands[0], 'midEnergy': bands[1], 'highEnergy': bands[2],
            'rhythmicDensity': density, 'spectralCentroidHz': float(np.dot(frequencies, power) / total),
            'spectralFlatness': float(np.clip(flatness, 0, 1)),
            'waveform': [round(float(np.max(b)) if len(b) else 0, 4) for b in bins]}


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def import_track(args):
    if not args.authorized or not args.reviewed:
        raise ValueError('Import requires --authorized and --reviewed; estimates alone cannot approve music.')
    if not re.fullmatch(r'[\w-]{1,100}', args.id) or not re.fullmatch(r'(1[0-2]|[1-9])[AB]', args.key):
        raise ValueError('Use a safe track ID and a Camelot key.')
    if not 60 <= args.target_bpm <= 200 or not 40 <= args.bpm <= 240 or abs(args.target_bpm / args.bpm - 1) > .06:
        raise ValueError('Tempo render exceeds the six-percent correction limit.')
    if args.downbeat < 0 or not all(v in [4, 8, 16, 32] for v in [args.intro_bars, args.outro_bars]):
        raise ValueError('Invalid downbeat or transition length.')
    source_hash = hashlib.sha256(args.input.read_bytes()).hexdigest()
    render_id = hashlib.sha256(f'{source_hash}:{args.target_bpm}:{args.bpm}:{args.downbeat}:v2'.encode()).hexdigest()[:12]
    args.media_dir.mkdir(parents=True, exist_ok=True)
    destination = args.media_dir / f'{args.id}-{render_id}.wav'
    ratio = args.target_bpm / args.bpm
    filters = f'atrim=start={args.downbeat},asetpts=PTS-STARTPTS,atempo={ratio:.10f},loudnorm=I=-18:TP=-3:LRA=9,aresample=44100,alimiter=limit=0.707:level=false:latency=true'
    with tempfile.TemporaryDirectory(prefix='djfly-import-') as temp:
        rendered = Path(temp) / 'render.wav'
        run_audio(['-y', '-i', str(args.input), '-vn', '-af', filters, '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', str(rendered)])
        with wave.open(str(rendered), 'rb') as audio:
            duration = audio.getnframes() / audio.getframerate()
            decoded_bytes = audio.getnframes() * audio.getnchannels() * 4
        bar = 240 / args.target_bpm
        full_bars = math.floor((duration - .005) / bar)
        if duration > 600 or decoded_bytes > 200 * 1024 ** 2 or full_bars < args.intro_bars + args.outro_bars + 8:
            raise ValueError('Audio is too long for the decode budget or lacks usable intro/body/outro regions.')
        measured = analyze(rendered)
        loudness = subprocess.run([ffmpeg_path(), '-hide_banner', '-nostdin', '-i', str(rendered), '-af', 'ebur128', '-f', 'null', '-'],
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True).stderr.decode('utf-8', errors='replace')
        values = re.findall(r'I:\s*(-?\d+(?:\.\d+)?) LUFS', loudness)
        if not values:
            raise ValueError('Unable to verify rendered integrated loudness.')
        track = {key: measured[key] for key in ['energy', 'bassEnergy', 'midEnergy', 'highEnergy', 'rhythmicDensity', 'spectralCentroidHz', 'spectralFlatness', 'waveform']}
        track.update(id=args.id, title=args.title, artist=args.artist, artwork=None, bpm=args.bpm, playbackBpm=args.target_bpm,
                     camelotKey=args.key, loudnessLufs=float(values[-1]), duration=duration, decodedBytes=decoded_bytes,
                     audioFile=destination.name, cueIn=0, intro={'start': 0, 'end': args.intro_bars * bar},
                     outro={'start': (full_bars - args.outro_bars) * bar, 'end': full_bars * bar, 'loopSafe': args.loop_safe},
                     grid={'firstDownbeat': 0, 'beatsPerBar': 4, 'phraseBars': 8},
                     beatGridConfidence=1, availableBlendBars=min(args.intro_bars, args.outro_bars),
                     playable=True, prepared=True, tags=args.tags.split(','), weight=1,
                     rights={'authorized': True, 'source': 'operator-authorized local import'},
                     analysis={'reviewed': True, 'gridBasis': 'operator-reviewed constant BPM and first downbeat',
                               'method': 'FFmpeg atempo/loudnorm/ebur128 + numpy spectra', 'sourceHash': source_hash, 'renderRatio': ratio})
        pool = json.loads(args.pool.read_text(encoding='utf-8')) if args.pool.exists() else {'schemaVersion': 1, 'id': args.pool.stem, 'title': args.pool.stem, 'bpm': args.target_bpm, 'tracks': []}
        if pool['bpm'] != args.target_bpm:
            raise ValueError('All tracks in a pool must share the prepared playback BPM.')
        pool['tracks'] = [t for t in pool['tracks'] if t['id'] != args.id] + [track]
        shutil.copyfile(rendered, destination)
        write_json(args.pool, pool)
    return {'pool': str(args.pool), 'id': args.id, 'duration': round(duration, 2), 'audioFile': destination.name}


def demo(args):
    rate, bpm, bars = 22050, 120, 64
    duration = bars * 240 / bpm + .1
    pool = args.pool
    titles = ['Kırmızı Hat', 'Gece Servisi', 'Kampüs Yörüngesi', 'Son Durak', 'Ankara Frekansı', 'Sabah Çizgisi']
    with tempfile.TemporaryDirectory(prefix='djfly-original-audio-') as temp:
        for index, title in enumerate(titles):
            count = int(duration * rate)
            signal = np.zeros(count)
            rng = np.random.default_rng(9000 + index)
            for beat in range(bars * 4):
                start = int(beat * .5 * rate)
                t = np.arange(min(int(.3 * rate), count - start)) / rate
                kick = .45 * np.sin(2 * np.pi * (48 * t + 6 * (1 - np.exp(-t * 28)))) * np.exp(-t * 15)
                signal[start:start + len(t)] += kick
                for offset in [0, .25]:
                    hstart = start + int(offset * rate)
                    n = min(int(.055 * rate), count - hstart)
                    noise = rng.normal(0, .04 + index * .003, n)
                    noise[1:] -= noise[:-1].copy()
                    signal[hstart:hstart + n] += noise * np.exp(-np.arange(n) / rate * 80)
                if beat % 4 in [1, 3]:
                    n = min(int(.11 * rate), count - start)
                    signal[start:start + n] += rng.normal(0, .095, n) * np.exp(-np.arange(n) / rate * 35)
                note = [45, 48, 52, 55][(beat // 4 + index) % 4]
                if 32 <= beat < bars * 4 - 32:
                    n = min(int(.42 * rate), count - start)
                    t = np.arange(n) / rate
                    frequency = 440 * 2 ** ((note - 69) / 12)
                    signal[start:start + n] += .15 * (np.sin(2 * np.pi * frequency * t) + .25 * np.sin(4 * np.pi * frequency * t)) * np.sin(np.pi * np.minimum(t / .42, 1))
            t = np.arange(count) / rate
            envelope = np.minimum(t / 8, 1) * np.minimum((duration - t) / 8, 1)
            for note in [57, 60, 64]:
                signal += .032 * np.sin(2 * np.pi * 440 * 2 ** ((note - 69) / 12) * t + index * .2) * envelope
            signal = np.tanh(signal) * .65
            source = Path(temp) / f'original-{index}.wav'
            with wave.open(str(source), 'wb') as audio:
                audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(rate)
                audio.writeframes((signal * 32767).astype('<i2').tobytes())
            values = argparse.Namespace(input=source, pool=pool, media_dir=args.media_dir, id=f'lab-{index + 1:02}', title=title,
                                        artist='RadioTEDU Lab', bpm=120, target_bpm=120, key='8A', downbeat=0,
                                        intro_bars=16, outro_bars=16, authorized=True, reviewed=True, loop_safe=True, tags='electronic,house,original-test-audio')
            import_track(values)
    data = json.loads(pool.read_text(encoding='utf-8'))
    data.update(title='RadioTEDU Lab / Özgün ses denemeleri', developmentAudio=True)
    for track in data['tracks']:
        track['rights'] = {'authorized': True, 'source': 'Original procedural composition generated by this repository; no commercial samples'}
        track['analysis']['gridBasis'] = 'Known synthesis clock, A minor notes and measured render'
    write_json(pool, data)
    return {'pool': str(pool), 'tracks': len(data['tracks']), 'kind': 'original-test-audio'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    analysis = commands.add_parser('analyze')
    analysis.add_argument('input', type=Path); analysis.add_argument('--output', required=True, type=Path)
    imp = commands.add_parser('import')
    imp.add_argument('input', type=Path)
    for name in ['id', 'title', 'artist', 'key']:
        imp.add_argument('--' + name, required=True)
    imp.add_argument('--bpm', type=float, required=True); imp.add_argument('--target-bpm', type=float, required=True)
    imp.add_argument('--downbeat', type=float, required=True)
    imp.add_argument('--intro-bars', type=int, default=16); imp.add_argument('--outro-bars', type=int, default=16)
    imp.add_argument('--authorized', action='store_true'); imp.add_argument('--reviewed', action='store_true')
    imp.add_argument('--loop-safe', action='store_true', help='Confirm the reviewed outro can repeat without cutting vocals or a musical phrase.')
    imp.add_argument('--tags', default='electronic')
    original = commands.add_parser('demo')
    for command in [imp, original]:
        command.add_argument('--pool', type=Path, default=ROOT / 'local/pools/lab.json')
        command.add_argument('--media-dir', type=Path, default=ROOT / 'local/media')
    args = parser.parse_args()
    if args.command == 'analyze':
        write_json(args.output, analyze(args.input)); print(args.output)
    else:
        print(json.dumps(demo(args) if args.command == 'demo' else import_track(args), ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        raise SystemExit(str(error))
