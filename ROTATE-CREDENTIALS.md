# Rotating the dashboard's credentials

Three values are secret and are readable by anything that can read the files
below: `server.key` (the HTTPS private key), `pin` and `media_pin`. They were
generated once and have never been rotated, so anything that ever read them
still has them.

**This is not automated, on purpose.** Changing the PIN is the only way back
into the dashboard, and changing the key breaks the running listener until the
service is restarted. Both belong to a person who can choose the new values.

## Before you start

You need the current PIN, or a shell on the host. If you have forgotten the
PIN, the `pin` field in `config.json` is the only way back in — see
[Forgotten PIN](#forgotten-pin) below.

## 1. The PINs

`config.json`, in the repository root:

```json
{
  "pin": "1234",
  "media_pin": "5678"
}
```

- `pin` unlocks the full dashboard.
- `media_pin` unlocks the read-only Media Streamer view. The two must differ;
  if `media_pin` equals `pin` the restricted mode is not restricted at all.
- An **empty** `pin` means no PIN is required. That is a deliberate choice for
  a single-user machine, and the server logs a warning at startup saying so.
  It is not a safe default on a shared network.

The file is re-read on `SIGHUP`, so no restart is needed:

```sh
kill -HUP "$(pidof tab-dashboard)"
```

The server logs `config: reloaded from ...` if it worked. A wrong PIN is not
distinguishable from a right one at the log level, by design.

## 2. The HTTPS key

`server.key` and `server.crt` sit in the repository root. Regenerate both:

```sh
cd /path/to/tab-dashboard
mv server.key server.key.old
mv server.crt server.crt.old
openssl req -x509 -newkey rsa:4096 -nodes \\
  -keyout server.key -out server.crt -days 365 \\
  -subj "/CN=$(hostname -f)"
chmod 600 server.key
```

`chmod 600` matters: the key is the one secret here that is not additionally
protected by a PIN check on every request.

Any client that pinned the old certificate will need to re-trust it. iOS in
particular remembers the old one per host, so the home-screen web app has to be
removed and re-added after this.

## 3. Restart, and confirm

```sh
systemctl --user restart tab-dashboard
systemctl --user status tab-dashboard
```

Then check the service comes up and the new PIN is the one in effect:

```sh
curl -s -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:8080/static/   # 200
curl -sk https://127.0.0.1:8443/static/ >/dev/null && echo "https ok"
```

Unlock the dashboard with the new PIN, and unlock the Media Streamer with
`media_pin` and confirm it does **not** offer the broadcast or per-device
stream controls — that is the check that the two PINs are actually doing
different jobs.

Once confirmed, remove the `.old` files.

## Forgotten PIN

There is no back door, deliberately. With a shell on the host:

```sh
cd /path/to/tab-dashboard
# Edit config.json and set "pin" to something you choose.
kill -HUP "$(pidof tab-dashboard)"
```

An empty `pin` disables the check entirely, which is the quickest way back in
on a machine you have shell access to — and a good reason to set it to
something rather than leave it empty.
