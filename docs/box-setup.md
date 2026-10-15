# Setting up a box: a Raspberry Pi, a VPS or this PC

A box is a Linux machine that runs Shipify's jobs: task runs, due runs, clean-ups and alerts. Its
slots are GitHub runners for the shipify repo only, labelled `shipify-box` and `box-<name>`. It
runs what the queue hands it and keeps no secret: each job gets fresh tokens. CI and deploys never
run on a box, so your apps don't depend on one. With every box off, runs wait in the queue.

**One way for every machine** (ADR 0047): `pnpm ship box add` sets up a Pi or a VPS over SSH, or
this PC with no target, with the same script. On each, the agent runs as a user of its own (the
sandbox), and its slots get the label `sandbox` once that checks out, so every box takes task runs
([The agent's own user](#the-agents-own-user)).

## Anywhere, with one command

On any Ubuntu 24.04 LTS machine (a cloud VM, a spare PC, a friend's laptop), as a user who can
sudo, with nothing on it yet:

```sh
curl -fsSL https://github.com/<owner>/shipify-template/releases/latest/download/here.sh | bash
```

1. **It looks first, and changes nothing yet:**
   - the OS: Ubuntu 24.04 LTS or newer, x64 or arm64;
   - the user: not root, and sudo works;
   - 4 GB of memory and 10 GB free;
   - GitHub reachable.
2. **It shows a code.** On your phone, open github.com/login/device, enter it, and approve
   "GitHub CLI". Approve only a code you started just now.
3. **It asks your copy** (`<you>/shipify` by default). It checks that you manage it, that it's
   private, and that it's a Shipify copy.
4. **It runs your copy's own `box add` on the machine:**
   - the plan first;
   - the box's name (the hostname by default) and its slots;
   - your yes, and sudo once;
   - 10 to 15 minutes.
5. **It always cleans up, even on an error or Ctrl-C:** the login, the clone and the tools it
   fetched go. It prints the link to revoke the approval: needed on a machine that isn't yours.

**Its options,** after `bash -s --` when piped:
- `--remove` takes the box away.
- `--token` takes a fine-grained token instead of the code: your copy only, Administration and
  Variables write, Contents read, a day long.
- `--copy`, `--name` and `--slots` answer its questions ahead.

**To read it or pin it first:** each release lists `here.sh`'s SHA-256 in its notes.
```sh
curl -fsSLo here.sh https://github.com/<owner>/shipify-template/releases/download/v<version>/here.sh
sha256sum here.sh   # compare with the release notes
bash here.sh
```

**What it needs:** the template public (otherwise `latest/download` isn't reachable without a
login), and your copy private: a box never serves a public repo. `box add` and `ship doctor`
refuse one. From a PC, `pnpm ship box add` below does the same.

## Which box

| | This PC | A Raspberry Pi 4 | A VPS |
|---|---|---|---|
| Always on | while the PC and WSL run | yes | yes |
| Cost | none | the hardware, once | monthly |
| Set up with | `box add` | `box add <user@host>` over SSH | `box add <user@host>` over SSH |
| sudo | once, during setup (and `box start`, `stop`) | once, during setup | once, during setup |
| Task runs (the agent) | yes | yes | yes |

**Slots: several tasks at once.** A runner takes one job at a time, so a box runs one runner per
slot. A task peaks at about 1.7 GB of memory (the agent, then `make verify`'s browser tests), and
only for the minute its tests run, so a new Pi or VPS keeps 1 GB for the system and gets a slot
per 2 GB of the rest: 4 GB gives 1, 6 GB 2, 8 GB (a Pi 4 or 5) 3, 12 GB and up 4. `--slots N`
(1 to 4) picks another count, and a box keeps what it has when `box add` runs again. A box usually
has no swap (Ubuntu's Pi image and most VPS images come without), so one that runs short has a
test killed, not slowed: fewer slots fix it. Your Claude plan's limits are shared: N tasks at once
use them N times as fast.

**One OS for every Pi and VPS: Ubuntu Server 24.04 LTS (64-bit),** or a newer LTS. `box add`
refuses any other, Raspberry Pi OS and Debian included ([About the OS](#about-the-os)), so every
box is set up and tested the same way.

**More boxes share the work:** any free slot on any box takes the next run. A task runs one at a
time, and carries on from any box: its branch and status live on GitHub.

## Once, before the first box

The bot and the agent's login: [setup.md](setup.md), about 10 minutes on the PC. None of it goes on
a box: it lives in shipify's secrets.

## A Raspberry Pi 4 (8 GB)

**What you need:** the Pi 4 (8 GB; 4 GB works, slower), a USB 3 SSD (SD cards wear out), the
official 15 W power supply, a case with a fan, and Ethernet or Wi-Fi. Five steps, about 30
minutes; reinstalling is the same five.

### 1. Write the OS, on the PC

1. In **Raspberry Pi Imager**, pick: Device **Raspberry Pi 4**; OS **Other general-purpose OS →
   Ubuntu → Ubuntu Server 24.04.x LTS (64-bit)** (check the version: older ones sit next to it);
   Storage: the SSD.
2. At OS customisation, **Edit settings**:
   - a hostname: it becomes the box's name (for example `mybox`);
   - a username and password (setup asks for the password once);
   - your Wi-Fi, unless it's on Ethernet;
   - **Services**: enable SSH (password login is fine: step 3 adds your key).

### 2. Boot from the SSD

Plug the SSD into a blue USB 3 port and power on (about two minutes). If it doesn't boot, the
bootloader is too old: write **Misc utility images → Bootloader → USB Boot** to an SD card, boot
from it until the green light blinks steadily, then remove the card.

### 3. Connect from the PC, once

Find the Pi's address in your router (reserve it there), then:

```sh
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_pi -N ""        # once per PC: a key just for the Pi
ssh-keygen -R <address>                                    # only when reinstalling
ssh-copy-id -i ~/.ssh/id_ed25519_pi.pub <user>@<address>   # asks for the Pi's password once
```

Give it a short name in `~/.ssh/config`, then check `ssh mybox true` asks for nothing:

```
Host mybox
  HostName <address>
  User <user>
  IdentityFile ~/.ssh/id_ed25519_pi
  IdentitiesOnly yes
```

### 4. Make it a box, from the PC

```sh
pnpm ship box add mybox --manage        # shows what it will do
pnpm ship box add mybox --manage --yes  # asks for the Pi's password once
```

`--manage` adds Tailscale and Cockpit ([Managing it from a browser](#managing-it-from-a-browser)).
Make a free [Tailscale](https://tailscale.com) account first (sign in with GitHub), and install
its phone app with the same login.

- **What it installs:** git (2.26 or newer: `ship doctor` checks), make, gh, Node 22, what each stack needs; automatic security updates
  (restarting at 04:30 when one needs it); SSH by key only; the user `shipify` (no sudo, its home
  0700) running one runner per slot as system services (`shipify-box-<name>`, then
  `shipify-box-<name>-<k>`, with `UMask=0077`); the machine's tools in `/opt/shipify`; the sandbox
  ([below](#the-agents-own-user)); with `--manage`, Tailscale, Cockpit and a firewall.
- **Then it checks the sandbox.** Only when every wall holds does it add the label `sandbox` to the
  slots, so task runs can go to them.
- **Time:** 10 to 15 minutes. Running it again updates the box in place (not while a task runs).
- **With `--manage`:** sign in to Tailscale at the link it prints, and if asked, turn on HTTPS
  certificates in Tailscale's admin page (DNS).
- **Reinstalling:** the name looks taken, so add `--replace` (and delete the old machine in
  Tailscale).

### 5. Check it

1. `pnpm ship box list` shows it online, with no "no sandbox"; `pnpm ship box health mybox`
   says how it's doing.
2. Open an issue on shipify (or write to the bot): "how's mybox doing?". The reply's run details
   name the box and slot that answered.
3. Then a real one, like `acme-site: bigger margins on cards`.

## A VPS

Any VPS with Ubuntu Server 24.04 LTS, x64 or arm64, works like a Pi. It costs money every month.

1. **Create it** with Ubuntu 24.04 LTS, your SSH key and a user who can use sudo; 4 GB of memory
   for 1 slot, 8 GB for 3.
2. **Firewall:** in the provider's firewall, allow only SSH in. The box only connects out.
3. **Make it a box:** `pnpm ship box add <user>@<ip> --manage`, then again with `--yes`. It's
   named after the hostname; `--name <name>` picks another.
4. **Check:** as for the Pi, step 5.

To remove it: `pnpm ship box remove <name> --yes`, then delete the VPS.

## This PC

```sh
pnpm ship box add        # the plan
pnpm ship box add --yes  # does it: asks for sudo once
```

- **The same box as a Pi's:** the same script, run here with sudo, so the same user `shipify`, the
  same agent users and sandbox, the same system services, and the same `sandbox` label once its
  check passes. It takes task runs like any box.
- **What stays as it is:** this PC's SSH settings and its network. `--manage` (Tailscale, Cockpit,
  a firewall) is for a machine you reach over SSH, so it's refused here.
- **Ubuntu 24.04 LTS or newer,** natively or in WSL. The runner and the agents are their own
  users, who can't read your Linux home.
- **On WSL, Windows is walled off too.** By default WSL lets every Linux user open your Windows
  drives (`/mnt/c` and the rest) and start Windows programs, which run as you in Windows. So the
  sandbox check also makes sure no agent can do either, and until then `box add` stops and prints
  the fix, which is yours to make: put this in `/etc/wsl.conf`,

  ```ini
  [interop]
  enabled=false
  appendWindowsPath=false
  [automount]
  options="metadata,umask=077"
  ```

  (`umask=077` keeps the drives yours alone; `enabled=false` under `[automount]` instead takes them
  out of WSL), then run `wsl --shutdown` in Windows, open Ubuntu again and run `box add` again.
  **The trade-off:** no Windows programs from WSL any more (`explorer.exe`, a link opening in your
  browser by itself: Shipify prints the link instead). If you want them, make a Pi or a spare Linux
  machine the box instead.
- **Turning it off and on:** `pnpm ship box stop` (off until you start it, even after a restart)
  and `pnpm ship box start`, each with sudo.
- **On WSL:** it needs systemd, which `box add` checks first (`[boot] systemd=true` in
  `/etc/wsl.conf`, then `wsl --shutdown`). Windows stops WSL 15 seconds after its last window
  closes. To keep it running, put this in `%UserProfile%\.wslconfig`, then run `wsl --shutdown`
  once:

  ```ini
  [general]
  instanceIdleTimeout=-1
  [wsl2]
  vmIdleTimeout=-1
  ```

  To start it at sign-in too, add a Task Scheduler task "At log on" running
  `wsl.exe -d Ubuntu --exec true`.
- **Not Ubuntu LTS:** `box add` refuses it, as for a Pi or VPS ([About the OS](#about-the-os)).

## The agent's own user

On a Pi or VPS, the runner and the agent are different Linux users, so nothing the agent does
reaches the runner's keys or changes what the runner runs next.

| | The runner (`shipify`) | Slot k's agent (`shipify-agent-<k>`) |
|---|---|---|
| Its folders | `/home/shipify` (0700): the runners, jobs' folders, logins, caches | `/srv/shipify-agent-<k>` (2710): its runs; the runner may only pass through to a run's `out/` |
| What it writes | for itself alone (`UMask=0077`) | in its run's folder |
| Its keys | the job's tokens, in processes the agent can't read | only what a run hands it on stdin: a read-only token and the tools' look keys, and its login, which goes on a pipe (fd 3), never in its environment |
| sudo | one rule: run commands as its slots' agents | none |
| Tools | `/opt/shipify`, its own | the same, to read and run, never to change |

- **One sudo rule,** `/etc/sudoers.d/shipify-agents`:

  ```
  Defaults:shipify !use_pty
  shipify ALL=(shipify-agent-1,shipify-agent-2) NOPASSWD: ALL
  ```

  It goes in only once `visudo` accepts it, and comes out again if sudo's whole configuration then
  fails the check, so sudo always keeps working. Nobody types sudo after `box add`.
- **The agents' users:** system users with no password and no login shell, never in the runner's
  group, refused cron and at.
- **The machine's tools,** outside the runner's home so agents can use them and change none:

  | Folder | Holds |
  |---|---|
  | `/opt/shipify/tool` | the runner's tool cache: Node, and each agent at the version `executors.json` pins (`claude-code/<version>` about 233 MB, `pi/<version>` about 166 MB, `opencode/<version>` about 177 MB), installed the first time a run picks it ([agents.md](agents.md#on-a-box)) |
  | `/opt/shipify/tool/shipify-app/<commit>` | read-only copies of Shipify, one per commit: the CLI built as one file that every step and the agent start, its playbook, skills and checks; no packages (the three newest, and any a run is on; runs that start together on a new commit each build their own, and the first moves it in) |

  What goes in them is installed with `umask 022`, so agents can read it. The agent's commands use
  the system's Node and pnpm (`/usr/local/bin`, from `box add`). A test browser is each slot's
  agent's own, in its slot's cache, downloaded once per slot (ADR 0041).
- **Each run, a fresh folder,** `/srv/shipify-agent-<k>/run-<id>/`: its own clone of the latest
  code, home and work, gone before the next run ([security.md](security.md#the-agents-sandbox)).
- **Kept per slot:** `/srv/shipify-agent-<k>/cache` and `data` (the agent's `~/.cache` and
  `~/.local/share`), so tools download once per slot, not once per run: pnpm, the
  project's packages, a test browser. The weekly clean-up trims what hasn't been read in 30 days.
- **The check, at setup and every week:** the runner starts each agent without a password, and no
  agent can read the runner's home, its jobs' folder (`_work`), a runner process's environment or
  another slot's runs, nor, on WSL, open a Windows drive or start a Windows program
  ([This PC](#this-pc)). `box add` adds the `sandbox` label only after it passes. `ship doctor`
  (so each weekly clean-up) checks it again, plus the home's 0700 and the jobs' umask 0077.
- **Its network is open,** as the work needs (npm, the agent's API, GitHub). A firewall for the
  agents' users is for later.

## Adding a box or a slot

```sh
pnpm ship box add <user@host> --manage --yes            # a new box, a slot per 2 GB of memory
pnpm ship box add <user@host> --slots 3 --manage --yes  # more (or fewer) slots on a box
```

- **More slots:** each new slot gets its runner and its agent user. Fewer removes the extra ones,
  with their agents' users and runs.
- **When to change the count:** a new box starts with what its memory fits. Pick fewer when a
  test gets killed for memory, or when your plan's limits run out too fast.
- **More boxes or more slots:** your Claude plan, not the hardware, is usually the limit: for one
  person, 2 to 4 slots in all. Add a box when tasks wait in the queue, not before.
- **Names:** each box's is its own. `box add` refuses a name another machine has, unless you add
  `--replace`.
- **Another Linux PC or laptop** on your network, with Ubuntu 24.04 LTS, is set up like a VPS (it
  needs `sudo apt install openssh-server`). A laptop that sleeps is better as extra capacity than as the only box.

## How every box stays running

Each slot is a systemd service running the runner's `bin/runsvc.sh`: a system service run as
`shipify` on a Pi or VPS, your user's service (with linger, no sudo) on this PC. It starts at boot,
comes back 10 seconds after anything but you stops it (`Restart=always`), and a stop asks the runner
to cancel its job first (`KillMode=mixed`). On a Pi or VPS it runs with `UMask=0077`. The runner
updates itself.

## Fast and current

| Piece | Stays current |
|---|---|
| shipify's code | each job checks out its own commit |
| Node 22 | the weekly clean-up takes the newest 22.x for jobs, and keeps the two newest; `box add` again updates the system's, which the agent uses |
| pnpm, the agents | pinned (`packageManager`; each agent's `install` in `executors.json`); they change only in a PR. The weekly clean-up removes an agent's other versions |
| packages | one pnpm store per box, pruned weekly |
| the box itself | `box/setup.sh`: a change bumps `SETUP_VERSION`, and `ship doctor` names a box set up by an older one |

**Time limits:** the agent stops after 50 minutes, `make verify` after 25, a check after one; the
run's job after 4 hours. A run cut off anyway is marked Stopped by the watch, and your `continue`
carries it on from where it got to.

## Commands

| Command | Does |
|---|---|
| `pnpm ship box list` | every box: online, busy, its slots, "no sandbox", its Cockpit link (from anywhere) |
| `pnpm ship box add [<user@host>] --yes` | makes a box: a Pi or VPS over SSH, or this PC with no target; again, it brings a box up to date |
| `pnpm ship box status` | this machine's box (this PC's, or a Pi's when you run it there): each slot's service, GitHub's view and the task it runs |
| `pnpm ship box health [<user@host>]` | disk, memory, temperature, a pending restart, updates, services: here or over SSH |
| `pnpm ship box stop` · `start` · `restart` | this machine's box: off until started, even after a restart; on; both, with sudo. Stop asks first while a task runs |
| `pnpm ship box logs -f` · `peek -f` | this machine's slots' log, live; what the agent is doing now |
| `pnpm ship box remove <name> --yes` | unregisters its slots from GitHub, and stops its services when it's this machine's (with sudo); a Pi's, it says what to run there |
| `pnpm ship doctor` | on a box: its setup version and the sandbox check, among the rest |

## Looking after it

- **Usually, nothing:**
  - the box restarts itself, and Ubuntu installs security updates (restarting at 04:30 if needed);
  - **the weekly clean-up:** the due run starts it on each box once its last is a week old. It
    removes closed and deleted tasks' folders, the agents' run folders older than 6 hours (as each
    agent, who owns them), runs `ship doctor` (the sandbox check included), checks the door
    answers, and takes the newest Node 22.x. When no other slot is busy, it keeps the box's shared
    tools to each agent's pinned version and the two newest Node versions, and prunes the package
    store and npm's cache. Its result goes on the status task, naming what it removed; a problem
    comes as a comment there, which notifies you on GitHub;
  - each due run writes the box's health to the status task (disk, temperature, throttling, a
    pending restart, updates, services);
  - the watch says when a box is offline for 4 minutes or more, and again when it's back.
- **See what the agent is doing,** over SSH or Cockpit's terminal:
  `sudo node /home/shipify/runner/_work/shipify/shipify/box/peek.mjs --follow` (the agents'
  sessions are readable only by them and root). It reads Claude Code's sessions; for pi, the run's
  Actions log shows each step as it goes.
- **Stop, start or restart it:** Cockpit → Services, or `sudo systemctl stop|start|restart
  shipify-box-<name> shipify-box-<name>-2 …`; logs: `journalctl -u 'shipify-box-<name>*' -f`.
- **A task cut off mid-run** (a restart, a power cut): the watch marks it Stopped and tells you
  once; reply `continue` and any box carries it on.
- **Update its setup** (when doctor says it's older): `pnpm ship box add <user@host> --manage
  --yes`, while no task runs.
- **Remove it:** `pnpm ship box remove mybox --yes` (the box's name, not the SSH alias), then on
  the Pi `sudo systemctl disable --now shipify-box-mybox …`, or write a fresh OS.
- **Lost or stolen:** [security.md](security.md#if-something-leaks-or-a-box-is-lost).

## Managing it from a browser

With `--manage`, the box runs **Cockpit**: a terminal, its services, live logs, updates, restart,
CPU and disk.

- **Where:** `https://<hostname>.<your-tailnet>.ts.net` (`pnpm ship box list` shows it), from any
  device on your Tailscale. Sign in as your own user, not `shipify`.
- **Who can reach it:** only your devices: Cockpit listens on 127.0.0.1, shared over HTTPS by
  `tailscale serve`. The firewall lets in only Tailscale and SSH from the box's own network
  (`sudo ufw disable` undoes it).
- **A terminal without Cockpit:** Tailscale's admin page → Machines → the box → **SSH to machine**.
- **Keep it on your tailnet:** Tailscale's admin page → Machines → the box → **Disable key expiry**
  (otherwise it drops off after 180 days).
- **"Bad Origin" in Cockpit:** run `box add --manage` again.

## Using it anywhere

- **Any network works:** the box only connects out (GitHub, the agent's API, npm). More Wi-Fi
  networks go under `access-points:` in `/etc/netplan/50-cloud-init.yaml` (then `sudo netplan
  apply`).
- **SSH from anywhere:** with `--manage`, `ssh <user>@<hostname>` over Tailscale. An alias like
  `mybox` points at the home address, and the firewall lets plain SSH in only from the network
  the box was set up on.

## About the OS

- **Ubuntu Server LTS only,** on a Pi and a VPS alike: one OS, one setup, tested the same way.
  `box add` checks it first (24.04 or a newer LTS) and refuses any other.
- **Not Raspberry Pi OS:** `make verify` starts Cloudflare's local runtime, which needs a
  kernel with 48-bit addresses; Raspberry Pi OS's has 39
  ([workerd #5013](https://github.com/cloudflare/workerd/issues/5013)), and Docker can't change
  that (a container uses the host's kernel). `ship doctor` checks it too.
- **A newer LTS:** write it fresh and run the five steps again (a box holds nothing that isn't on
  GitHub). 24.04 has updates to 2029, 2034 with [Ubuntu Pro](https://ubuntu.com/pro) (free for
  five personal machines).

## When something's off

| You see | Do |
|---|---|
| a task gets no 👀 for minutes | no box is online: `pnpm ship box list`, then turn one on. GitHub's queue starts the task when one is back |
| tasks wait with a box online | no online slot has the `sandbox` label (`box list` says "no sandbox"): run `box add` again on that box, while no task runs |
| `ship doctor` (or the clean-up) says the sandbox isn't right | it names the wall that's open. Run `box add` again: it sets the sandbox up and checks it |
| the sandbox check says an agent's commands can read its memory, or its login isn't on a pipe | both are Ubuntu's own settings, which `box add` leaves as they are: put `kernel.yama.ptrace_scope = 1` in `/etc/sysctl.d/10-ptrace.conf` and run `sudo sysctl --system`; `/bin/sh` must be dash (`ls -l /bin/sh`). Then `box add` again |
| `box add` stops at "Checking the sandbox" | the line above names the wall. The box keeps working, without the `sandbox` label. Run it again; if it fails the same way, look at `/etc/sudoers.d/shipify-agents` and `ls -ld /home/shipify /srv/shipify-agent-*`. On WSL, "the agents can reach Windows": make the fix it prints in `/etc/wsl.conf` first ([This PC](#this-pc)) |
| `box add` says the machine runs another OS | write Ubuntu Server 24.04 LTS (64-bit) on it, then run it again |
| `box add` can't connect | it says why and prints the fix: `ssh-keygen -R <address>` after a reinstall, `ssh-copy-id` for a missing key; for a key with a passphrase, `eval "$(ssh-agent)" && ssh-add` first |
| this PC's box goes offline when you close WSL | the `.wslconfig` idle timeouts ([This PC](#this-pc)) |
| `ship doctor` says the kernel is 39-bit | write Ubuntu Server 24.04 LTS instead |
| offline after a power cut | wait a minute; then Cockpit, or `ssh` in and `sudo systemctl status shipify-box-<name>` |
| a box's clean-up waits in the queue | its slots lack the `box-<name>` label: run `box add` again |
| a box vanished from `box list` | GitHub removes a runner that's been off 14 days: `box add` again |
