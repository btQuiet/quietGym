# Self-hosting quietGym without Docker

quietGym consists of a static React build, a small Node API and the `media/` directory. Caddy is
the only public service. The API listens on loopback and stores the single owner's data under
`/var/lib/quietgym`.

## Requirements

- Node.js 24.7.0 or newer and npm.
- Caddy with ports 80 and 443 reachable.
- A DNS hostname pointing to the server.

## Local development

Install dependencies once:

```powershell
cd api
npm ci
npm run password:set
```

The password command creates `data/db.json` outside the `api` directory. It asks for a password
twice without echoing it and requires at least 15 characters.

Run the three development processes in separate terminals from the repository root:

```powershell
cd api
npm start
```

```powershell
py -m http.server 8888 --bind 127.0.0.1 --directory media
```

```powershell
cd frontend
npm ci
npm run dev
```

Open the URL printed by Vite. Vite sends `/api` to port 3000 and `/img` and `/gif` to port 8888.

## Production layout

Recommended paths:

```text
/opt/quietgym                 application source and API dependencies
/var/www/quietgym-current     compiled frontend
/var/www/quietgym-media       exercise images and animations
/var/lib/quietgym             owner hash and runtime data
/etc/quietgym/quietgym.env    private runtime configuration
```

Create the service account and protected directories according to the procedure documented for
the server. Build and test the frontend on a trusted development machine with `npm ci`,
`npm test` and `npm run build`; the VPS does not need the frontend development toolchain. Install
the resulting contents of `frontend/dist/` in `/var/www/quietgym-current`, and copy `media/img/`
and `media/gif/` into the corresponding directories under `/var/www/quietgym-media`.

Install the API dependencies:

```bash
cd /opt/quietgym/api
npm ci --omit=dev
```

Create the owner before starting the API. The plaintext password is read only from the terminal;
it must not be added to the environment file or command line:

```bash
cd /opt/quietgym/api
sudo -u quietgym env DATA_DIR=/var/lib/quietgym npm run password:set
```

Running the command again changes the password and invalidates all existing sessions without
removing workout data.

## Environment

Copy `.env.example` to `/etc/quietgym/quietgym.env` and set at least the real HTTPS origin:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=2300
DATA_DIR=/var/lib/quietgym
ORIGIN=https://gym.qs-ecosystem.com
SESSION_DAYS=90
AUTH_RATE_LIMIT_MAX=5
AUTH_RATE_LIMIT_WINDOW_SECONDS=900
VAPID_SUBJECT=mailto:admin@example.com
```

The systemd service should run as `quietgym`, read that environment file and execute
`/usr/bin/node /opt/quietgym/api/server.js`. Do not open port 2300 in the firewall.

## Caddy

The media directory is outside Vite's build and must be served explicitly:

```caddyfile
gym.qs-ecosystem.com {
    encode zstd gzip

    handle /api/* {
        reverse_proxy 127.0.0.1:2300
    }

    @media path /img/* /gif/*
    handle @media {
        root * /var/www/quietgym-media
        header Cache-Control "public, max-age=2592000, immutable"
        file_server
    }

    handle {
        root * /var/www/quietgym-current
        try_files {path} /index.html
        file_server
    }
}
```

Format, validate and then reload Caddy:

```bash
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## Verification

```bash
curl http://127.0.0.1:2300/api/health
curl -I https://gym.qs-ecosystem.com/
curl -I https://gym.qs-ecosystem.com/img/3297-GaSzzuh.jpg
curl -I https://gym.qs-ecosystem.com/gif/3297-GaSzzuh.gif
```

The health endpoint should return `{"ok":true}`. The image and GIF should return `200` with
`image/jpeg` and `image/gif` respectively. Login is only supported through the public HTTPS
origin in production.

No automatic backup procedure is configured for this installation.
