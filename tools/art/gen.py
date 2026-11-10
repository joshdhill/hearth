"""Run one generation task on a free Hugging Face Space (from the build machine).

usage: gen.py <tasks.json> <index> <outdir>
A task is {"name", "space", "api", "args": {...}}; an arg written {"file": "path"} is uploaded.
A task {"name", "view": ["space", ...]} just records what those Spaces accept.
Videos also get a contact sheet (sheet.jpg) so they can be checked at a glance."""
import json, os, shutil, subprocess, sys, time

tasks = json.load(open(sys.argv[1]))
i = int(sys.argv[2])
if i >= len(tasks):
    print('no task', i); sys.exit(0)
task = tasks[i]
OUT = os.path.join(sys.argv[3], task['name'])
os.makedirs(OUT, exist_ok=True)
log = open(os.path.join(OUT, 'log.txt'), 'w')


def say(*a):
    s = ' '.join(str(x) for x in a)
    print(s, flush=True); log.write(s + '\n'); log.flush()


from gradio_client import Client, handle_file

if 'view' in task:
    for sp in task['view']:
        try:
            c = Client(sp, verbose=False)
            info = c.view_api(return_format='dict')
            for ep, v in info.get('named_endpoints', {}).items():
                say(sp, ep)
                for p in v.get('parameters', []):
                    say('   ', p.get('parameter_name'), '|', p.get('label'), '|', (p.get('python_type') or {}).get('type'), '| default:', str(p.get('parameter_default'))[:160])
                say('    returns:', [(r.get('label'), (r.get('python_type') or {}).get('type')) for r in v.get('returns', [])])
        except Exception as e:
            say(sp, 'FAILED', repr(e)[:300])
    sys.exit(0)


def conv(v):
    if isinstance(v, dict) and 'file' in v:
        return handle_file(v['file'])
    if isinstance(v, dict):
        return {k: conv(x) for k, x in v.items()}
    if isinstance(v, list):
        return [conv(x) for x in v]
    return v


def files_in(x, found):
    if isinstance(x, str) and os.path.exists(x) and os.path.isfile(x):
        found.append(x)
    elif isinstance(x, dict):
        for v in x.values():
            files_in(v, found)
    elif isinstance(x, (list, tuple)):
        for v in x:
            files_in(v, found)


ok = False
for attempt in range(int(task.get('tries', 2))):
    try:
        say('SPACE', task['space'], task.get('api'), 'attempt', attempt + 1)
        c = Client(task['space'], verbose=False)
        t0 = time.time()
        job = c.submit(api_name=task.get('api'), **{k: conv(v) for k, v in task['args'].items()})
        res = job.result(timeout=int(task.get('timeout', 420)))
        say('  took', round(time.time() - t0), 's; result:', str(res)[:400])
        found = []
        files_in(res, found)
        for n, p in enumerate(found):
            ext = os.path.splitext(p)[1].lower() or '.bin'
            dst = os.path.join(OUT, f'out{n if n else ""}{ext}')
            shutil.copy(p, dst)
            say('  saved', dst, os.path.getsize(dst))
            if ext in ('.mp4', '.webm', '.mov'):
                pr = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,nb_frames', '-of', 'csv=p=0', dst], capture_output=True, text=True).stdout.strip()
                say('  video:', pr)
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', dst, '-vf', 'fps=5,scale=416:-2,tile=6x5', '-frames:v', '1', '-q:v', '4', os.path.join(OUT, f'sheet{n if n else ""}.jpg')])
            elif ext in ('.webp', '.png', '.jpg', '.jpeg'):
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', dst, os.path.join(OUT, f'out{n if n else ""}.png')])
        ok = bool(found)
        if ok:
            break
    except Exception as e:
        say('  failed:', repr(e)[:600])
        time.sleep(20)
say('OK' if ok else 'NO OUTPUT')
