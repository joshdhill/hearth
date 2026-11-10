"""Find out which free, keyless picture generators answer from the build machine."""
import json, os, sys, time, traceback, urllib.parse
import requests

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
log = open(f'{OUT}/probe.txt', 'w')


def say(*a):
    s = ' '.join(str(x) for x in a)
    print(s, flush=True); log.write(s + '\n'); log.flush()


CAT = 'https://raw.githubusercontent.com/joshdhill/hearth/main/art/cat/source-cat.jpg'
FIRE = 'https://raw.githubusercontent.com/joshdhill/hearth/main/art/fireside/source-fireplace.jpg'
P_SCENE = ('Photorealistic photo of a rustic red-brick fireplace shot straight on. Wide, low firebox, empty and dark, with an iron grate. '
           'A thick reclaimed-wood mantel beam sits in the upper third with two courses of brick visible above it. '
           'A deep raised brick hearth fills the foreground. Brick fills the whole frame, warm evening light, 16:9, very high detail')
P_CAT = ('Detailed painted illustration of a sleek black cat with green eyes walking to the right, full body side view, tail up, '
         'fine fur texture with subtle blue and warm brown highlights, plain cream background')
P_EDIT = 'The same black cat, same illustration style and plain cream background, now standing on all four legs and walking to the right, full body side view'
UA = {'User-Agent': 'hearth-art/1.0 (github.com/joshdhill/hearth)'}


def get(name, url, save=None, timeout=240, **kw):
    try:
        t0 = time.time()
        r = requests.get(url, timeout=timeout, headers=UA, **kw)
        ct = r.headers.get('content-type', '')
        say(name, r.status_code, ct, len(r.content), f'{time.time() - t0:.0f}s')
        if r.ok and ct.startswith('image') and save:
            open(f'{OUT}/{save}', 'wb').write(r.content)
        elif not ct.startswith('image'):
            say('   ', r.text[:600].replace('\n', ' '))
        return r
    except Exception as e:
        say(name, 'ERR', repr(e)[:300])


q = urllib.parse.quote
say('== Pollinations')
get('models (legacy)', 'https://image.pollinations.ai/models')
get('models (gen)', 'https://gen.pollinations.ai/image/models')
get('flux t2i scene', f'https://image.pollinations.ai/prompt/{q(P_SCENE)}?width=1536&height=864&model=flux&nologo=true&seed=11', 'poll-flux-scene.jpg')
time.sleep(8)
get('flux t2i cat', f'https://image.pollinations.ai/prompt/{q(P_CAT)}?width=1280&height=864&model=flux&nologo=true&seed=5', 'poll-flux-cat.jpg')
time.sleep(8)
for m in ('kontext', 'nanobanana', 'seedream', 'gptimage'):
    get(f'{m} edit cat', f'https://image.pollinations.ai/prompt/{q(P_EDIT)}?width=1280&height=864&model={m}&image={q(CAT, safe="")}&nologo=true&seed=5', f'poll-{m}-cat.jpg')
    time.sleep(8)
get('gen flux', f'https://gen.pollinations.ai/image/{q(P_CAT)}?model=flux&width=1280&height=864&seed=5', 'pollgen-flux-cat.jpg')

say('== AI Horde')
try:
    r = requests.get('https://aihorde.net/api/v2/status/models?type=image', headers=UA, timeout=60)
    ms = sorted(r.json(), key=lambda m: -m.get('count', 0))
    say('models:', [(m['name'], m['count'], m.get('queued')) for m in ms[:40]])
    H = {'apikey': '0000000000', 'Client-Agent': 'hearth-art:1.0:github.com/joshdhill/hearth'}
    jobs = {}
    for label, model, steps, cfg, prompt, w, h in [
        ('horde-sdxl-scene', 'AlbedoBase XL (SDXL)', 28, 6, P_SCENE, 1216, 704),
        ('horde-flux-cat', 'Flux.1-Schnell fp8 (Compact)', 4, 1, P_CAT, 1024, 704),
    ]:
        body = {'prompt': prompt, 'params': {'sampler_name': 'k_euler', 'cfg_scale': cfg, 'steps': steps, 'width': w, 'height': h, 'n': 1},
                'models': [model], 'nsfw': False, 'censor_nsfw': True, 'r2': True, 'shared': False}
        r = requests.post('https://aihorde.net/api/v2/generate/async', json=body, headers=H, timeout=60)
        say(label, 'submit', r.status_code, r.text[:300])
        if r.ok:
            jobs[label] = r.json()['id']
    t0 = time.time()
    while jobs and time.time() - t0 < 420:
        time.sleep(15)
        for label, jid in list(jobs.items()):
            c = requests.get(f'https://aihorde.net/api/v2/generate/check/{jid}', headers=UA, timeout=60).json()
            if c.get('done') or c.get('faulted') or not c.get('is_possible', True):
                st = requests.get(f'https://aihorde.net/api/v2/generate/status/{jid}', headers=UA, timeout=60).json()
                say(label, 'finished after', round(time.time() - t0), 's', {k: st.get(k) for k in ('done', 'faulted', 'is_possible', 'kudos')})
                for g in st.get('generations', []):
                    img = requests.get(g['img'], timeout=120).content
                    open(f'{OUT}/{label}.webp', 'wb').write(img)
                    say('   saved', len(img), g.get('model'), g.get('worker_name'))
                del jobs[label]
            else:
                say(label, 'waiting', c.get('wait_time'), 'queue', c.get('queue_position'))
    for label in jobs:
        say(label, 'TIMED OUT')
except Exception:
    say('horde ERR', traceback.format_exc()[-600:])

say('== Hugging Face spaces')
for term in ('kontext', 'image edit', 'qwen image edit', 'image to video', 'wan 2.2', 'flux', 'upscale'):
    try:
        r = requests.get('https://huggingface.co/api/spaces', params={'search': term, 'sort': 'likes', 'direction': -1, 'limit': 25, 'full': 'true'}, headers=UA, timeout=60)
        say(term, '->', [(s['id'], s.get('likes'), (s.get('runtime') or {}).get('stage'), ((s.get('runtime') or {}).get('hardware') or {}).get('current')) for s in r.json()])
    except Exception as e:
        say(term, 'ERR', repr(e)[:200])
try:
    from gradio_client import Client, handle_file
    SPACES = ['black-forest-labs/FLUX.1-schnell', 'black-forest-labs/FLUX.1-Kontext-Dev', 'black-forest-labs/FLUX.2-dev', 'Qwen/Qwen-Image-Edit',
              'Qwen/Qwen-Image-Edit-2509', 'multimodalart/Qwen-Image-Edit-Fast', 'zerogpu-aoti/wan2-2-fp8da-aoti-faster',
              'multimodalart/wan-2-2-first-last-frame', 'Wan-AI/Wan-2.2-5B', 'Lightricks/ltx-video-distilled']
    clients = {}
    for sp in SPACES:
        try:
            c = Client(sp, verbose=False)
            api = c.view_api(return_format='dict')
            say(sp, 'API:', json.dumps({k: [(p.get('parameter_name'), p.get('type', {}).get('type'), p.get('parameter_default')) for p in v.get('parameters', [])]
                                       for k, v in api.get('named_endpoints', {}).items()})[:1500])
            clients[sp] = c
        except Exception as e:
            say(sp, 'ERR', repr(e)[:300])

    def call(label, sp, save, **kw):
        if sp not in clients:
            return
        try:
            t0 = time.time()
            job = clients[sp].submit(**kw)
            res = job.result(timeout=420)
            say(label, 'OK', f'{time.time() - t0:.0f}s', str(res)[:400])
            f = res[0] if isinstance(res, (list, tuple)) else res
            if isinstance(f, dict):
                f = f.get('video') or f.get('path') or f.get('url')
            if isinstance(f, str) and os.path.exists(f):
                ext = os.path.splitext(f)[1] or '.bin'
                open(f'{OUT}/{save}{ext}', 'wb').write(open(f, 'rb').read())
        except Exception as e:
            say(label, 'ERR', repr(e)[:500])

    call('hf schnell cat', 'black-forest-labs/FLUX.1-schnell', 'hf-schnell-cat', prompt=P_CAT, seed=5, randomize_seed=False, width=1280, height=864, num_inference_steps=4, api_name='/infer')
    call('hf kontext cat', 'black-forest-labs/FLUX.1-Kontext-Dev', 'hf-kontext-cat', input_image=handle_file(CAT), prompt=P_EDIT, seed=5, randomize_seed=False, guidance_scale=2.5, steps=28, api_name='/infer')
except Exception:
    say('gradio ERR', traceback.format_exc()[-800:])
say('done')
