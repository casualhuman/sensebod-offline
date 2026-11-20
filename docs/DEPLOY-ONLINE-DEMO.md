# Putting Sensebod Offline online (demo and test server)

Sensebod Offline is built for a Raspberry Pi with no internet. This guide is for the two **online** copies used for testing and for showing the product. They come from the same code as the Pi; nothing here changes how the Pi build or the Pi backend behave.

| | Tier 1: instant demo | Tier 2: online test server |
|---|---|---|
| What it is | The app as a plain website, with the sample lessons built in. No server. | The real backend, worker and app on one cloud machine, in one Docker image. |
| What it is for | Showing the product to anyone with a link: browsing, lessons, games, the staff screens. | Testing the real API: sign-in, uploads, publishing, exports, admin flows, many people at once. |
| What is saved | Nothing. Every reload starts again from the sample data. | Everything, on a disk (volume) attached to the machine, until you reset it. |
| Recommended host | **Cloudflare Pages**: free, no bandwidth limit, commercial use allowed. | **Fly.io**: runs this Dockerfile as it is, with a disk and HTTPS, from about US$5 a month. |
| Files | `app/build/demoPlugin.ts`, `app/demo/`, `app/vercel.json` | `deploy/online/` |

**Never put real learner data on either.** Both use demo lessons only. Tier 2 must be reset (see below) if anyone has typed real names into it.

## How the two targets stay separate

| Switch | Default (the Pi) | Online |
|---|---|---|
| `VITE_DEMO=1` (set by `npm run build:demo`) | not set: `npm run build` makes exactly the Pi build in `app/dist/` | the demo build in `app/dist-demo/` |
| `SENSEBOD_DEPLOY=online` (set by the Docker image) | not set: the backend refuses every `[dev]` switch, as before | the backend accepts two switches only: `fake_privileged` and `assume_clock` |

- The Pi build still has no service worker, is still the single Chrome 58 legacy build, and its default configuration is unchanged.
- The demo code lives in `app/demo/` and is reached only from the demo build's entry point. The eslint rule that keeps `src/` from importing the mock still applies.
- The test server uses the normal Pi build of the app (no demo flag).

---

## Tier 1: instant demo (static site)

### What it does

`npm run build:demo` builds the same app, but starts it at `app/demo/main.ts`, which:

1. answers every `/api/...` call inside the browser with the mock API that development and tests already use (`app/mock/handler.ts`), so no server is needed;
2. shows no demo strip (removed at the owner's request, 20 Nov 2026). Test sign-ins: staff **admin / sensebod**; learner **Aminata Kamara / 1234** (every sample learner uses 1234). These are the mock's fixed demo values, not real accounts.

The build also writes, into `app/dist-demo/`:

- `media/`: the sample clips from `app/mock/media` (about 100 KB in all: a 20-second test-pattern video, two short tones, captions, one Try-it animation). Every video and audio lesson in the demo plays one of these. The real lesson videos are not in the demo (they are far too large and not ours to publish openly); the players work, the content is a placeholder.
- `_redirects` (single-page fallback for Cloudflare Pages and Netlify), `_headers` (the Pi's security headers plus "do not index"), `robots.txt` ("disallow all").
- `index.html` gets `<meta name="robots" content="noindex">` and the Pi's Content-Security-Policy as a `<meta>` tag.

Size: about 20 MB (mostly the games and illustrations, with their `.gz` twins). Fine for every free static host.

### Try it on your computer

```sh
cd app
npm ci
npm run build:demo
npm run preview:demo          # http://localhost:4173 (no mock server runs: this is how a static host behaves)
```

### Put it online: Cloudflare Pages (recommended)

1. Push the repository to GitHub (you do this; nothing has been pushed).
2. Sign in at dash.cloudflare.com → Workers & Pages → Create → Pages → Connect to Git → pick `sensebod-offline`.
3. Build settings:
   - Framework preset: **None**
   - Root directory: **`app`**
   - Build command: **`npm run build:demo`**
   - Build output directory: **`dist-demo`**
   - Environment variable: `NODE_VERSION` = `22`
4. Save and deploy. The site appears at `https://<project>.pages.dev`. Every push to `main` rebuilds it.

Without Git: `cd app && npm run build:demo && npx wrangler pages deploy dist-demo --project-name sensebod-demo` (needs a Cloudflare login).

### Other hosts

- **Vercel**: import the repository, set Root Directory to `app`. `app/vercel.json` already sets the build command, output folder, the single-page fallback and the headers. Note: Vercel's free (Hobby) plan is for non-commercial use only.
- **Netlify**: base directory `app`, build command `npm run build:demo`, publish directory `app/dist-demo`. The `_redirects` and `_headers` files are picked up automatically.
- **GitHub Pages**: works only at the root of a domain (the app expects to live at `/`, not `/sensebod-offline/`) and has no single-page fallback; copy `index.html` to `404.html` after building. Prefer one of the hosts above.

### Cost

Free on all four hosts at demo traffic.

---

## Tier 2: online test server (Docker)

### What is in the image

One image (`deploy/online/Dockerfile`), built from the repository root, contains:

- the app, built exactly as for the Pi (`npm run build`);
- the backend (`bin/sensebod-offline-api`, `-worker`, `-maint`, `-boot-recover`, `-admin`) on Node 24, the Node line the Pi pins;
- nginx 1.22 (Debian 12, the base of Raspberry Pi OS 12) with the Pi's site configuration, adapted for the internet (`deploy/online/nginx.conf.template`);
- ffmpeg, poppler-utils, age and ssh-keygen, which the worker calls for uploads, PDFs, encrypted backups and signed packages;
- `deploy/online/supervise.mjs`, which plays the part systemd plays on the Pi.

On every start the supervisor writes the backend configuration from environment variables, creates the bag with the demo lessons **on the first start only**, runs boot recovery (as the Pi does once per boot), creates the staff account if it does not exist, and then runs nginx, the API and the worker (restarting any that stop) plus maintenance one minute after start and every 15 minutes. The API, the worker and the tools run as the unprivileged `node` user.

Data lives in `/data` (a Docker volume, or a Fly volume): `/data/sensebod-offline` holds the databases, media, exports and snapshots, as `/var/lib/sensebod-offline` does on the Pi.

### Settings

Set these as environment variables or secrets (template: `deploy/online/online.env.example`; your copy `deploy/online/online.env` is git-ignored). **No password is in the repository.**

| Name | Needed | What |
|---|---|---|
| `SENSEBOD_PUBLIC_HOST` | yes | The address people open, e.g. `sensebod-test.fly.dev`. The API refuses other host names. |
| `SENSEBOD_ADMIN_USERNAME`, `SENSEBOD_ADMIN_PASSWORD` | to sign in as staff | Created on start if that username does not exist. 10 characters or more. `SENSEBOD_ADMIN_PASSWORD_FILE` also works. Changing the password later: sign in and change it in the app, or reset the demo. |
| `SENSEBOD_BASIC_AUTH_USER`, `SENSEBOD_BASIC_AUTH_PASSWORD` | optional | One password in front of the whole site (the browser asks for it). Leave empty for an open test server. |
| `SENSEBOD_COOKIE_SECURE` | optional | `1` (default): the staff cookie is sent over HTTPS only. |
| `SENSEBOD_BACKUP_RECIPIENTS` | optional | An age public key (`age1…`), so the encrypted backup export can be tested. Without it, backup export says the bag has no backup key yet, as a new Pi does. |
| `SENSEBOD_BAG_NAME` | optional | Default "Online test server". |

### Try it on your computer

Needs Docker Desktop.

```sh
cp deploy/online/online.env.example deploy/online/online.env
# edit online.env: set SENSEBOD_ADMIN_PASSWORD, and SENSEBOD_COOKIE_SECURE=1 is fine for http://localhost
docker compose -f deploy/online/compose.yaml up -d --build
open http://localhost:8080
curl http://localhost:8080/healthz
```

Reset to the demo lessons (deletes every upload, learner, export and account, then recreates the staff account from the settings):

```sh
docker compose -f deploy/online/compose.yaml exec sensebod node deploy/supervise.mjs reset-demo
```

Stop: `docker compose -f deploy/online/compose.yaml down` (add `-v` to delete the data too).

### Put it online: Fly.io (recommended)

Install `flyctl` and sign in (`fly auth login`). From the repository root:

```sh
# 1. edit deploy/online/fly.toml: choose an app name, and set SENSEBOD_PUBLIC_HOST to <app>.fly.dev
fly apps create <app-name>
fly volumes create sensebod_data --size 3 --region lhr --config deploy/online/fly.toml
fly secrets set SENSEBOD_ADMIN_PASSWORD='choose-a-long-one' --config deploy/online/fly.toml
# optional site password:
fly secrets set SENSEBOD_BASIC_AUTH_USER=team SENSEBOD_BASIC_AUTH_PASSWORD='another-long-one' --config deploy/online/fly.toml
fly deploy . --config deploy/online/fly.toml --dockerfile deploy/online/Dockerfile
```

Open `https://<app-name>.fly.dev`. Fly provides HTTPS. Reset: `fly ssh console --config deploy/online/fly.toml -C "node /srv/sensebod-offline/deploy/supervise.mjs reset-demo"`. Logs: `fly logs`.

Keep **one machine**: SQLite lives on the one volume. `fly.toml` already stops the machine when nobody uses it and starts it on the next visit (the first page then takes a few seconds).

### Other hosts

- **A plain VPS** (Hetzner, DigitalOcean, any Linux box with Docker): copy the repository, fill in `online.env` with your domain in `SENSEBOD_PUBLIC_HOST`, point the domain's DNS at the server, then `docker compose -f deploy/online/compose.yaml --profile https up -d --build`. Caddy gets the HTTPS certificate. Cheapest (about €4–6 a month) but you look after the server.
- **Render**: "New Web Service" from the repo, Docker, Dockerfile path `deploy/online/Dockerfile`, Docker context `.`, add a persistent disk mounted at `/data` (needs a paid instance), port 8080, health check path `/healthz`.
- **Railway**: deploy from the repo with `RAILWAY_DOCKERFILE_PATH=deploy/online/Dockerfile`, add a volume at `/data`, set the variables above.

### Cost (check current prices; they change)

- Fly.io: a shared 1-CPU, 1 GB machine plus a 3 GB volume is roughly US$5–7 a month when on all the time, less when it stops while idle. There is no free tier for new accounts.
- Render: a disk needs a paid instance, from about US$7 a month plus disk.
- Railway: from US$5 a month.
- VPS: about €4–6 a month, plus your time.

---

## What is different online, and how it is handled

Nothing below was removed from the code; online the parts that need Pi hardware are stubbed safely.

| On the Pi | Online test server | Instant demo |
|---|---|---|
| Plain HTTP on the bag's Wi-Fi: no secure context | HTTPS from the host: a secure context. The camera / microphone / clipboard features that are blocked on the Pi **work online**, so a screen can look fine online and still be blocked on the Pi. Test those on the Pi or over plain HTTP. No service worker is added either way. | Same as the test server (HTTPS). |
| Staff cookie without the Secure flag | nginx adds `Secure` (`SENSEBOD_COOKIE_SECURE=1`). | No real cookie; the mock keeps a session in memory. |
| Name `easystem.local` / hotspot address, host allow-list | The allow-list is `SENSEBOD_PUBLIC_HOST` plus localhost. There is no hotspot and no `.local` name. | n/a |
| USB stick: backups, content packs, restore, override presence | No USB devices. The root helper is stubbed (`fake_privileged`): eject and format report success without doing anything, and no stick is ever detected, so USB screens show "no stick". Downloaded exports (zip, CSV) work. | The mock's answers only. |
| Override codes (EasySTEM's offline challenge-response) | Work the same if EasySTEM's office tool is used against this server's bag id; the USB "presence" route never fires (no stick). | Not available. |
| No battery clock (RTC); clock set by hand; clock trust levels | The machine's clock is kept by NTP, so the clock is treated as `synced` (`assume_clock`). Setting the clock from the admin screen is accepted but does not change the server's clock. | The browser's clock. |
| Retention (learners kept 61 days, unexported data held 60 more) | Runs as on the Pi, with a true clock. Keep it: it also clears test data over time. | Nothing is stored. |
| Power-off button, update packages | Stubbed: they report success and do nothing. Restart the machine with the host's tools instead. | n/a |
| Boot recovery once per boot | Runs at every container start. On Docker on one host, a container restart reuses the host's boot id, so recovery treats it like a service restart, not a reboot (as `systemctl restart` on the Pi). On Fly, every restart is a new machine boot. | n/a |
| Many phones on one Wi-Fi, per-connection rate limit for media | Same nginx limits. The client address is taken from the host's proxy (private addresses only are trusted). | n/a |

## Risks

- **Real data online.** Both tiers are for demo data only. Anyone who can reach tier 2 can create learner names. Use the site password (`SENSEBOD_BASIC_AUTH_*`) for anything beyond a quick test, and reset after testing with people.
- **Search engines.** Both tiers send `X-Robots-Tag: noindex` and a "disallow all" `robots.txt`; tier 1 also has a `noindex` meta tag. That keeps honest crawlers out, not people: a link that is shared can be opened. Use the site password if that matters.
- **Staff password.** Tier 2's staff account is real. Use a long password set as a secret, never in a file in the repository. Tier 1's `admin / sensebod` is the mock's and opens nothing real.
- **Online is not the Pi.** HTTPS, a fast CPU, a true clock and no USB hide problems the bag will have (secure-context features, slow conversions, clock jumps, USB paths). Passing online is not passing on the Pi; the Pi and Android 8 checks in `docs/ARCHITECTURE.md` §13 still apply.
- **Cost surprises.** Fly bills by usage; keep one machine and the auto-stop setting. Delete the app and volume when testing is over (`fly apps destroy <app-name>`).
- **Third-party content.** The games keep their own licences (see `README.md`); some of their pictures and sounds carry no licence statement. Check that before publishing the demo widely.
