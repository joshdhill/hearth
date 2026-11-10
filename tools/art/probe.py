"""Find out which free, keyless image tools can be reached from the build machine.
Writes everything it learns (and any pictures it gets) to the folder given as argv[1]."""
import json, os, sys, time, traceback, urllib.parse
import requests

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
RAW = 'https://raw.githubusercontent.com/joshdhill/hearth/main/tools/art/src/'
LOG = open(f'{OUT}/log.txt', 'w')


def log(*a):
    s = ' '.join(str(x) for x in a)
    print(s, flush=True); LOG.write(s + '\n'); LOG.flush()


def save(name, r):
    ct = r.headers.get('content-type', '')
    ext = 'jpg' if 'jpeg' in ct else 'png' if 'png' in ct else 'webp' if 'webp' in ct else 'txt'
    with open(f'{OUT}/{name}.{ext}', 'wb') as f:
        f.write(r.content[:8_000_000] if ext != 'txt' else r.content[:4000])
    log('  ->', name + '.' + ext, r.status_code, ct, len(r.content))


CAT_PROMPT = ('the same sleek black cat with green eyes, now standing on all four legs and walking to the right, '
              'full body side view, same detailed illustration style, same plain cream background')
SCENE_PROMPT = ('photorealistic photo of a rustic red brick fireplace shot straight on, wide low empty dark firebox, '
                'thick reclaimed wood mantel beam with brick wall visible above it, deep raised brick hearth in the foreground, '
                'warm evening light, highly detailed, 16:9')

# ---- 1. Pollinations -------------------------------------------------------------------------
for name, url in [
    ('poll-models', 'https://image.pollinations.ai/models'),
    ('poll-gen-models', 'https://gen.pollinations.ai/image/models'),
    ('poll-flux', 'https://image.pollinations.ai/prompt/' + urllib.parse.quote(SCENE_PROMPT) + '?width=1344&height=768&model=flux&nologo=true&seed=11'),
    ('poll-gen-flux', 'https://gen.pollinations.ai/image/' + urllib.parse.quote(SCENE_PROMPT) + '?width=1344&height=768&model=flux&seed=11'),
    ('poll-kontext', 'https://image.pollinations.ai/prompt/' + urllib.parse.quote(CAT_PROMPT) + '?model=kontext&nologo=true&seed=5&image=' + urllib.parse.quote(RAW + 'cat.jpg', safe='')),
    ('poll-gen-kontext', 'https://gen.pollinations.ai/image/' + urllib.parse.quote(CAT_PROMPT) + '?model=kontext&seed=5&image=' + urllib.parse.quote(RAW + 'cat.jpg', safe='')),
    ('poll-nanobanana', 'https://image.pollinations.ai/prompt/' + urllib.parse.quote(CAT_PROMPT) + '?model=nanobanana&nologo=true&seed=5&image=' + urllib.parse.quote(RAW + 'cat.jpg', safe='')),
]:
    try:
        log('GET', name)
        r = requests.get(url, timeout=150, headers={'User-Agent': 'hearth-build/1.0'})
        save(name, r)
    except Exception as e:
        log('  failed:', repr(e)[:300])
    time.sleep(6)

# ---- 2. AI Horde (anonymous) ---------------------------------------------------------------------
try:
    log('AI Horde: submit')
    H = {'apikey': '0000000000', 'Client-Agent': 'hearth-build:1.0:github.com/joshdhill/hearth'}
    r = requests.get('https://aihorde.net/api/v2/status/models?type=image', timeout=60)
    models = sorted(r.json(), key=lambda m: -m.get('count', 0))
    log('  models:', [(m['name'], m.get('count'), m.get('queued')) for m in models[:30]])
    r = requests.post('https://aihorde.net/api/v2/generate/async', headers=H, timeout=60, json={
        'prompt': SCENE_PROMPT, 'params': {'width': 1024, 'height': 576, 'steps': 24, 'cfg_scale': 6, 'n': 1, 'sampler_name': 'k_euler_a'},
        'models': ['AlbedoBase XL (SDXL)'], 'nsfw': False, 'r2': True})
    log('  submit:', r.status_code, r.text[:300])
    jid = r.json().get('id')
    t0 = time.time()
    while jid and time.time() - t0 < 300:
        time.sleep(10)
        c = requests.get(f'https://aihorde.net/api/v2/generate/check/{jid}', timeout=60).json()
        log('  check:', {k: c.get(k) for k in ('done', 'wait_time', 'queue_position', 'processing', 'faulted')})
        if c.get('done') or c.get('faulted'):
            break
    if jid:
        s = requests.get(f'https://aihorde.net/api/v2/generate/status/{jid}', timeout=60).json()
        for i, g in enumerate(s.get('generations', [])):
            save(f'horde-{i}', requests.get(g['img'], timeout=120))
        log('  took', round(time.time() - t0), 's')
except Exception as e:
    log('  horde failed:', repr(e)[:300])

# ---- 3. Hugging Face Spaces (anonymous) ------------------------------------------------------------
for q in ['kontext', 'qwen image edit', 'image edit', 'image to video', 'wan2.2', 'first last frame', 'flux', 'outpaint', 'lama', 'upscale', 'background removal']:
    try:
        r = requests.get('https://huggingface.co/api/spaces', params={'search': q, 'sort': 'likes', 'direction': -1, 'limit': 12, 'full': 'true'}, timeout=60)
        rows = [(s['id'], s.get('likes'), (s.get('runtime') or {}).get('stage'), ((s.get('runtime') or {}).get('hardware') or {}).get('current')) for s in r.json()]
        log('HF spaces for', repr(q), ':', rows)
    except Exception as e:
        log('HF search failed', q, repr(e)[:200])

try:
    from gradio_client import Client, handle_file
    import shutil

    def try_space(space, api_name, kwargs, tag, timeout=280):
        try:
            log('SPACE', space)
            c = Client(space, verbose=False)
            info = c.view_api(return_format='dict')
            eps = info.get('named_endpoints', {})
            log('  endpoints:', {k: [p.get('parameter_name') for p in v.get('parameters', [])] for k, v in eps.items()})
            ep = api_name if api_name in eps else (list(eps)[0] if eps else None)
            if not ep:
                return
            names = [p.get('parameter_name') for p in eps[ep].get('parameters', [])]
            kw = {k: v for k, v in kwargs.items() if k in names}
            log('  calling', ep, 'with', list(kw))
            job = c.submit(api_name=ep, **kw)
            res = job.result(timeout=timeout)
            log('  result:', str(res)[:500])
            flat = res if isinstance(res, (list, tuple)) else [res]
            for i, x in enumerate(flat):
                p = x.get('path') or x.get('video') if isinstance(x, dict) else x
                if isinstance(p, dict):
                    p = p.get('path')
                if isinstance(p, str) and os.path.exists(p):
                    shutil.copy(p, f'{OUT}/{tag}-{i}{os.path.splitext(p)[1]}')
                    log('  saved', f'{tag}-{i}{os.path.splitext(p)[1]}', os.path.getsize(p))
        except Exception as e:
            log('  failed:', repr(e)[:500])

    cat = handle_file(RAW + 'cat.jpg')
    try_space('black-forest-labs/FLUX.1-Kontext-Dev', '/infer', dict(input_image=cat, prompt=CAT_PROMPT, seed=3, randomize_seed=False, guidance_scale=2.5, steps=28), 'hf-kontext')
    try_space('black-forest-labs/FLUX.1-schnell', '/infer', dict(prompt=SCENE_PROMPT, seed=3, randomize_seed=False, width=1344, height=768, num_inference_steps=4), 'hf-schnell')
    try_space('Qwen/Qwen-Image-Edit', '/infer', dict(image=cat, prompt=CAT_PROMPT, seed=3, randomize_seed=False, true_guidance_scale=4.0, num_inference_steps=30, rewrite_prompt=False), 'hf-qwen')
    try_space('zerogpu-aoti/wan2-2-fp8da-aoti-faster', '/generate_video', dict(input_image=cat, prompt='the black cat stands up and walks to the right out of frame, plain cream background, static camera', steps=6, duration_seconds=3.5, seed=3, randomize_seed=False), 'hf-wan')
except Exception as e:
    log('gradio_client unavailable:', repr(e)[:300])
    log(traceback.format_exc()[-600:])
log('done')
