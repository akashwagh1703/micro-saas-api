# CI/CD — Auto deploy to DigitalOcean on git push

Push to `master` (or `main`) → GitHub Actions SSHs into your droplet → runs `scripts/deploy-digitalocean.sh`.

You have **three separate GitHub repos** — each has its own workflow:

| Repo | Workflow file | Server path |
|------|---------------|-------------|
| `micro-saas-api` | `.github/workflows/deploy-digitalocean.yml` | `/var/www/autowave/micro-saas-api` |
| `micro-saas-portal` | `.github/workflows/deploy-digitalocean.yml` | `/var/www/autowave/micro-saas-portal` |
| `micro-saas-website` | `.github/workflows/deploy-digitalocean.yml` | `/var/www/autowave/micro-saas-website` |

---

## Architecture

```text
git push (master)
    │
    ▼
GitHub Actions (build test on GitHub runner)
    │
    ▼ SSH (private key in GitHub Secrets)
DigitalOcean droplet (whatsapp-bot-pod)
    │
    ├── git pull + npm ci + build
    ├── API: prisma migrate deploy + pm2 restart autowave-api
    └── Portal/Website: vite build → nginx serves dist/
```

---

## One-time server setup (DigitalOcean)

SSH into your droplet as root (or a deploy user):

```bash
# 1. Install Node 20, git, pm2, nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt update && sudo apt install -y git nginx
sudo npm install -g pm2

# 2. App directory
sudo mkdir -p /var/www/autowave
sudo chown -R $USER:$USER /var/www/autowave
cd /var/www/autowave

# 3. Clone repos (use your GitHub URLs)
git clone git@github.com:akashwagh1703/micro-saas-api.git
git clone git@github.com:akashwagh1703/micro-saas-portal.git
# optional:
# git clone git@github.com:akashwagh1703/micro-saas-website.git

# 4. API env (NEVER commit .env)
cp micro-saas-api/.env.example micro-saas-api/.env
nano micro-saas-api/.env   # fill DATABASE_URL, APP_URL, MinIO, WhatsApp, etc.

# 5. First manual API deploy
cd micro-saas-api
npm ci
npx prisma migrate deploy
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # follow the printed command so PM2 survives reboot

# 6. Portal first build
cd ../micro-saas-portal
echo 'VITE_API_URL=https://api.autowave.playltp.in/api' > .env.production
npm ci
npm run build
```

Make deploy scripts executable:

```bash
chmod +x /var/www/autowave/micro-saas-api/scripts/deploy-digitalocean.sh
chmod +x /var/www/autowave/micro-saas-portal/scripts/deploy-digitalocean.sh
```

---

## Nginx example

Point each domain at the Vite `dist` folder and proxy API to port 3000:

```nginx
# /etc/nginx/sites-available/autowave-api
server {
    listen 443 ssl http2;
    server_name api.autowave.playltp.in;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# /etc/nginx/sites-available/autowave-portal
server {
    listen 443 ssl http2;
    server_name portal.autowave.playltp.in;
    root /var/www/autowave/micro-saas-portal/dist;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

```bash
sudo ln -sf /etc/nginx/sites-available/autowave-api /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/autowave-portal /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## GitHub Actions secrets

In each repo: **Settings → Secrets and variables → Actions → New repository secret**

| Secret | Example | Required in |
|--------|---------|-------------|
| `DO_HOST` | `168.144.121.155` or droplet hostname | all 3 repos |
| `DO_USER` | `root` or `deploy` | all 3 repos |
| `DO_SSH_KEY` | private key (full PEM) | all 3 repos |
| `DO_SSH_PORT` | `22` | optional |
| `VITE_API_URL` | `https://api.autowave.playltp.in/api` | portal only |

---

## SSH key for GitHub Actions (on your laptop)

```bash
ssh-keygen -t ed25519 -C "github-actions-autowave" -f ~/.ssh/autowave_github_actions -N ""
```

1. **Public key** → add to server:

```bash
# On DigitalOcean droplet:
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "PASTE_PUBLIC_KEY_HERE" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

2. **Private key** → GitHub secret `DO_SSH_KEY`:

```bash
cat ~/.ssh/autowave_github_actions
```

Copy the entire block including `-----BEGIN` / `-----END`.

---

## Enable auto deploy

1. Commit and push the workflow files to each repo:

```bash
cd micro-saas-api
git add .github scripts/deploy-digitalocean.sh ecosystem.config.cjs docs/DIGITALOCEAN_CICD.md
git commit -m "Add DigitalOcean CI/CD deploy pipeline"
git push origin master
```

Repeat for `micro-saas-portal` and `micro-saas-website`.

2. Add GitHub secrets (above).

3. Watch **Actions** tab — green = deployed.

4. Manual re-deploy: **Actions → Deploy … → Run workflow**.

---

## What each deploy script does

### API (`scripts/deploy-digitalocean.sh`)

- `git fetch` + `reset --hard origin/master`
- `npm ci`
- `npx prisma migrate deploy`
- `npm run build`
- `pm2 restart autowave-api`
- curls `http://127.0.0.1:3000/up`

### Portal (`scripts/deploy-digitalocean.sh`)

- git pull
- `VITE_API_URL=... npm run build`
- `nginx reload` if nginx installed

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Permission denied (publickey)` | Check `DO_SSH_KEY` secret and `authorized_keys` on server |
| `git pull` / reset fails | Ensure repo cloned on server; deploy user owns `/var/www/autowave` |
| `npm ci` fails | Node version on server should be 20+ (`node -v`) |
| PM2 app missing | Run once: `pm2 start ecosystem.config.cjs && pm2 save` |
| Portal shows old UI | Hard refresh browser; confirm nginx `root` points to `dist/` |
| Migrate fails | Check `DATABASE_URL` / `DIRECT_URL` in server `.env` |
| Workflow never runs | Push must be to `master` or `main`; secrets must exist in **that** repo |

---

## Security notes

- Never commit `.env` — only on the server.
- Use a dedicated `deploy` Linux user with sudo only for `nginx reload` if you want to harden further.
- Restrict GitHub Actions deploy key to read-only on repos if using deploy keys for git clone on server.
