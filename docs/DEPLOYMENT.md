# Deploying Steel Tide

Steel Tide is one Node process. It serves the page, the game's JavaScript and a
WebSocket at `/ws`. There is no database, no build step and no asset files: all
artwork is generated in the browser. A deployment therefore needs three things:

1. the Node process, listening on a private port;
2. a reverse proxy in front of it that terminates TLS and forwards WebSocket
   upgrades;
3. a public DNS name pointing at the proxy.

> **Status:** the project is *deployment-ready* and tested locally in
> production mode, including through a proxy that adds latency, jitter and
> disconnects. It has **not** been deployed to a public host or verified from
> an external network — that needs a server and a domain (see
> [What is still needed](#what-is-still-needed)).

## Requirements

- Node.js 20.12 or newer (22 LTS recommended)
- A Linux or Windows Server host with one public port for HTTPS (443) and, for redirects, HTTP (80)
- A domain name, and a TLS certificate (Caddy and Let's Encrypt issue one free)

## Environment variables

All configuration is read from the environment. Copy `.env.example` to `.env`.
None of these is a secret; the browser only ever receives `PUBLIC_URL`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` turns on caching, compression at full strength, strict origin checks and JSON logs. |
| `HOST` | `0.0.0.0` | Interface to bind. Use `127.0.0.1` behind a proxy on the same machine so the app port is not reachable from outside. |
| `PORT` | `3000` | Port to bind. |
| `PUBLIC_URL` | *(empty)* | The address players use, e.g. `https://play.example.com`. Drives invite links, the WebSocket origin check and HSTS. |
| `ALLOWED_ORIGINS` | *(empty)* | Extra origins allowed to open the game socket, comma separated. `PUBLIC_URL` is always allowed. |
| `TRUST_PROXY` | `0` | Set to `1` behind a reverse proxy so `X-Forwarded-For` / `X-Forwarded-Host` are honoured. Leave `0` if the process is exposed directly. |
| `MAX_CLIENTS` | `1000` | Total simultaneous connections. |
| `MAX_ROOMS` | `200` | Total rooms. |
| `MAX_CONN_PER_IP` | `20` | Connections per client address. Raise it if many players share one NAT. |
| `RECONNECT_GRACE_MS` | `60000` | How long a match waits for a dropped player. |
| `NAME_MAX` | `16` | Longest display name, in characters (any script). |
| `JOIN_ATTEMPTS` / `JOIN_WINDOW_SECONDS` | `8` / `30` | Room-code attempts allowed per connection within the window; further tries get the `slow` error. |
| `READY_WARN_SECONDS` | `45` | Real time a player may stay not-ready while others wait before being flagged idle (warned; the host is offered a kick). Nobody is kicked automatically. |
| `LOAD_TIMEOUT_SECONDS` | `20` | Real time a starting match waits for clients to finish loading. After that it starts and slow clients load into the running match. |
| `START_COUNTDOWN_SECONDS` | `5` | Real-time "get ready" countdown after loading. The simulation stands still and takes no orders while it runs; `0` turns it off. Lessons never count down. |
| `ROOM_NAME_MAX` | `24` | Longest room title, in characters. |
| `KEY_ATTEMPTS` / `KEY_WINDOW_SECONDS` | `10` / `60` | Wrong keys a private room accepts from everybody together within the window; after that every try gets the `slow` error until the window has passed. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |

Binding to `0.0.0.0` does not by itself make the game public: the host's
firewall, the cloud security group and DNS all have to allow and route traffic
to the proxy.

## Local development

```bash
npm install
npm start
```

Development mode reads files from disk on every request, never caches, allows
connections from the page's own host (localhost or a LAN address) and prints
the LAN addresses to share.

## Production: Linux server with systemd and a proxy

```bash
sudo useradd --system --home /opt/steel-tide steeltide
sudo mkdir -p /opt/steel-tide && sudo cp -r . /opt/steel-tide
cd /opt/steel-tide
sudo cp .env.example .env        # then edit PUBLIC_URL
sudo chown -R steeltide: /opt/steel-tide
sudo -u steeltide npm ci --omit=dev
sudo cp deploy/steel-tide.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now steel-tide
curl -s http://127.0.0.1:3000/healthz
```

Then put a proxy in front. Either works:

- **Caddy** (simplest, automatic certificates): edit the hostname in
  `deploy/Caddyfile`, then `caddy run --config deploy/Caddyfile`.
- **nginx**: edit the hostname and certificate paths in `deploy/nginx.conf`,
  install it as a site and reload nginx.

### What the proxy must do

- Terminate TLS and redirect HTTP to HTTPS. The page then opens `wss://` on its
  own origin automatically; there are no hard-coded addresses in the client.
- Forward the WebSocket upgrade for `/ws`: HTTP/1.1 to the upstream with the
  `Upgrade` and `Connection` headers passed through. Without them the game
  loads but shows "Reconnecting".
- Pass `Host`, `X-Forwarded-Host`, `X-Forwarded-Proto` and `X-Forwarded-For`.
- Allow idle sockets for at least 60 s (the server pings every 15 s).
- Not re-compress or rewrite cache headers: the app already sends brotli/gzip,
  `immutable` versioned assets and a Content-Security-Policy.
- Keep `/healthz` private (both sample configs do).

## Production: Windows Server

Tested target: Windows Server 2019 or 2022 with Windows PowerShell 5.1. The
scripts are in `deploy\windows\`. They have been written for this layout but
**not yet run on a Windows machine** — treat the first run as a test.

| File | Purpose |
| --- | --- |
| `install.ps1` | Copies the app, runs `npm ci`, writes `.env`, registers the background task, checks `/healthz`. |
| `run.ps1` | The task's wrapper: runs Node, writes the log, restarts it if it exits. |
| `uninstall.ps1` | Stops and removes the task and the firewall rule. |
| `setup-iis.ps1` | Configures IIS as the HTTPS / WebSocket reverse proxy. |
| `web.config` | The IIS site's rules (health check hidden, HTTP→HTTPS, proxy to the app). |

### 1. Install the app

1. Install **Node.js 22 LTS** for all users (the Windows installer from
   nodejs.org) and open a new elevated PowerShell window.
2. Copy the project folder to the server (or `git clone` it).
3. From the project folder:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\install.ps1 -PublicUrl https://play.example.com -OpenFirewall
```

Options: `-InstallDir` (default `C:\SteelTide`), `-Port` (default `3000`),
`-TaskName` (default `SteelTide`). `-OpenFirewall` allows inbound TCP 80 and
443 for the proxy; the app port is never opened because the app binds to
`127.0.0.1`.

The app runs as a **scheduled task**, not a classic service: Node is not a
service executable, and this avoids installing a third-party wrapper. The task
starts at boot, runs as the low-privilege `LOCAL SERVICE` account (read access
to the app, write access only to `logs\`) and is restarted if it stops.

Running the script again updates an existing install and keeps its `.env`.

### 2. Put a proxy in front

**Option A — IIS.** Install *URL Rewrite 2.1* and *Application Request Routing
3.0* from Microsoft's IIS downloads, put a certificate for your host in the
machine's Personal store, then:

```powershell
.\deploy\windows\setup-iis.ps1 -HostName play.example.com -CertThumbprint <thumbprint>
```

The script adds the IIS role with the **WebSocket Protocol** feature, enables
ARR's proxy, allow-lists the forwarded headers and creates the site. Without
`-CertThumbprint` it creates the HTTP site only; run it again once you have a
certificate. To list thumbprints:
`Get-ChildItem Cert:\LocalMachine\My | Format-List Subject, Thumbprint, NotAfter`.

**Option B — Caddy.** Simpler if you do not already run IIS, because Caddy
obtains and renews the certificate itself. Download `caddy.exe` for Windows,
set your host name in `deploy\Caddyfile`, and register it as a service
(Caddy's documentation describes this `sc.exe` form):

```powershell
sc.exe create caddy start= auto binPath= "C:\caddy\caddy.exe run --config C:\SteelTide\deploy\Caddyfile"
sc.exe start caddy
```

Use one proxy or the other, not both: they would compete for ports 80 and 443.

### 3. Day-to-day on Windows

```powershell
Get-ScheduledTask SteelTide | Get-ScheduledTaskInfo          # last run, last result
Invoke-RestMethod http://127.0.0.1:3000/healthz              # status and counters
Get-Content C:\SteelTide\logs\steel-tide-*.log -Tail 50 -Wait   # follow the log
Stop-ScheduledTask SteelTide; Start-ScheduledTask SteelTide  # restart
```

- **Update:** copy the new project folder to the server and run `install.ps1`
  again with the same arguments.
- **Settings:** edit `C:\SteelTide\.env`, then restart the task.
- **Remove:** `.\deploy\windows\uninstall.ps1` (add `-RemoveFiles` to delete
  the folder).
- **Logs:** one file per start in `logs\`, pruned after 14 days. A
  `wrapper_restart` line means Node exited and was started again.
- **Stopping is abrupt:** Windows has no `SIGTERM`, so stopping the task ends
  Node at once. Players see "Reconnecting" and are returned to the menu, as
  after any restart.

### Windows troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `install.ps1` cannot be loaded | Script execution is restricted. Run it through `powershell -ExecutionPolicy Bypass -File …` as shown. |
| Task shows *Running* but `/healthz` does not answer | Look at the newest file in `logs\`. `EADDRINUSE` means the port is taken: reinstall with another `-Port`. |
| IIS returns 502.3 | The app is not running, or the port in `C:\inetpub\steel-tide\web.config` does not match `PORT` in `.env`. |
| IIS returns 500.50 mentioning `HTTP_X_FORWARDED_HOST` | The server variables are not allow-listed. Run `setup-iis.ps1` again. |
| Page loads over IIS but stays on "Reconnecting" | The WebSocket Protocol feature is missing (`Install-WindowsFeature Web-WebSockets`), or the origin is refused: check `PUBLIC_URL` in `.env` against the address in the browser. |
| Every player is refused with `per_ip` in the log | `TRUST_PROXY` is not `1`, so all players appear to come from the proxy. |

## Production: container

```bash
docker build -t steel-tide .
docker run -d --name steel-tide --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -e PUBLIC_URL=https://play.example.com -e TRUST_PROXY=1 \
  steel-tide
```

Publish the port on `127.0.0.1` and proxy to it as above, or let your platform's
load balancer terminate TLS. On a managed platform, check that it supports
WebSockets and set its health check to `GET /healthz`.

**One instance only.** Rooms live in the memory of a single process. Running
several instances behind a load balancer would split players across rooms
unless every connection for a room reaches the same instance.

## Public endpoints

| Path | Purpose |
| --- | --- |
| `GET /`, `/armory.html` | The pages. Always revalidated (`no-cache` + `ETag`). |
| `GET /v/<build>/...` | Scripts and styles. `<build>` is a hash of all files, so they are cached for a year and a new deploy changes every URL at once. |
| `GET /ws` (upgrade) | The game socket. |
| `GET /healthz` | Liveness and counters. Keep it private at the proxy. |

Everything else returns 404; only `GET` and `HEAD` are accepted.

## Operations

- **Health:** `curl -s http://127.0.0.1:3000/healthz` returns
  `{"status":"ok","build":…,"uptime":…,"clients":…,"rooms":…,"matches":…}`.
- **Logs:** one JSON line per event on stdout (`journalctl -u steel-tide -f`):
  `listening`, `room_create`, `room_destroy`, `match_start`, `match_end`,
  `session_resume`, `ws_reject` (with the reason: `origin`, `per_ip`,
  `capacity`, `path`), `rate_limit_kick`, `handler_failed`. Player names,
  addresses, tokens and message contents are never logged.
- **Updating:** copy the new files, `npm ci --omit=dev`,
  `sudo systemctl restart steel-tide`. Open pages notice the new build and ask
  the player to reload.

## Recovery

| Symptom | Cause and fix |
| --- | --- |
| Page loads, indicator stays on "Reconnecting" | The proxy is not forwarding the upgrade, or the origin is refused. Check the proxy's `/ws` block, then look for `ws_reject` in the log: `origin` means `PUBLIC_URL` / `ALLOWED_ORIGINS` does not match the address in the browser. |
| `ws_reject` with `per_ip` | Many players behind one address. Raise `MAX_CONN_PER_IP`. If *every* player hits it, `TRUST_PROXY` is off and they all look like the proxy. |
| Mixed-content errors | The page is on https but something forces `ws://`. The client derives the scheme from the page, so this means TLS is terminated somewhere that rewrites the page to http. |
| Process crashed or was restarted | systemd restarts it within seconds. Matches in progress are lost (state is in memory); players are returned to the menu with a notice and can host again. |
| A player drops mid-match | An AI holds their seat. If they return within `RECONNECT_GRACE_MS` they get it back automatically. |
| "Out of sync" notice | The client's checksum did not match the server three times in a row; it reconnects and reloads the match from the server. If it recurs for everyone, restart the process and report the build id. |

## How the networking behaves

- The server is authoritative. Clients send intentions (`send`, `up`, `skill`);
  ownership, roads, counts, targets, cooldowns and superweapon eligibility are
  all validated in the simulation at the moment the command is accepted.
- Every command carries an id. A retried or duplicated message is acknowledged
  but never executed twice, so reconnects and repeated packets cannot grant a
  free order or cast.
- The simulation runs at 20 steps per second. State goes out at most 10 times
  per second and contains only the cities and armies that changed; a full
  keyframe follows every 50 updates.
- Armies are sent as "position and speed at server time T" and extrapolated by
  the client, so a marching army costs nothing on the wire until its speed,
  strength or state changes (plus one position correction every 2 seconds).
- Every update has a sequence number and a checksum of all cities and armies.
  A gap or mismatch triggers a keyframe; repeated mismatches force a clean
  reconnect. A corrupted match is never left running silently.
- Send orders are predicted locally (the garrison drops at once) and replaced
  by the server's result, which arrives just before its acknowledgement.
- Players who join or reconnect mid-match receive the full state, including
  crates, pending strikes, hazard zones and skill timers.
- The page pings every 4 s to measure latency (shown bottom-left), reconnects
  with exponential backoff up to 8 times, then offers a manual retry.
- Limits: 2 KB per message, 20 messages per second per connection (burst 40),
  `MAX_CONN_PER_IP`, `MAX_CLIENTS`, `MAX_ROOMS`.

## Verifying a deployment

Automated, on any machine with the repository:

```bash
npm test
```

`test/net.test.mjs` starts a production-mode server and drives real WebSocket
clients through a proxy that adds latency, jitter, stalls and a hard
disconnect. It checks caching, compression, origin rules, clean state sync,
desync recovery, session recovery, 12 simultaneous matches and flood limits,
and prints measured latency and bandwidth.

Against the public address, from a network other than the server's (for
example a phone on mobile data):

```bash
curl -sI https://play.example.com/ | grep -iE 'HTTP/|content-security|strict-transport|cache-control'
curl -s -o /dev/null -w '%{http_code}\n' https://play.example.com/healthz     # expect 404 (kept private)
curl -s -o /dev/null -w '%{http_code}\n' -H 'Origin: https://evil.example' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' https://play.example.com/ws   # expect 403
```

Then in a browser:

1. Open the site; the indicator bottom-left should show a latency in ms.
2. DevTools → Console: no mixed-content, CSP or cross-origin errors.
   DevTools → Network: `/ws` shows status 101 over `wss://`; scripts are served
   from `/v/<build>/` with `content-encoding: br`.
3. Host a room, open the invite link on a second device on a different network,
   start a match and play.
4. Switch the language on both devices.
5. Turn the second device's network off for ten seconds mid-match and back on:
   the indicator should count reconnect attempts and the match should resume.

## What is still needed

To go from deployment-ready to publicly deployed and verified:

- a host (VPS, container platform or similar) with SSH or deploy access;
- a domain or subdomain and the ability to point its DNS at that host;
- a go-ahead to publish it.
