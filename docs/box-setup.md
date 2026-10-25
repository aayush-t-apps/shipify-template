# Setting up a box: a Pi, a laptop, a VPS or this PC

A box is a Linux machine that runs Shipify's jobs: task runs, due runs, clean-ups and alerts. Its
slots are GitHub runners for the shipify repo only, labelled `shipify-box` and `box-<name>`. It
runs what the queue hands it and keeps no secret: each job gets fresh tokens. CI and deploys never
run on a box, so your apps don't depend on one. With every box off, runs wait in the queue.

**One way for every machine** (ADR 0047): `pnpm ship box add` sets up a Pi, a laptop, a spare PC
or a VPS over SSH, or this PC with no target, with the same script. Every box gets the same OS, the
same setup and the same rules; `box add` reads its cores and memory and picks its slots. On each,
the agent runs as a user of its own (the sandbox), and its slots get the label `sandbox` once that
checks out, so every box takes task runs ([The agent's own user](#the-agents-own-user)).

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
3. **It asks your copy:** by default the one private `shipify` repo you manage (yours, or an
   organization's), else `<you>/shipify`. It checks that you manage it, that it's private, and that
   it's a Shipify copy.
4. **It runs your copy's own `box add` on the machine:**
   - the plan first;
   - the box's name (the hostname by default) and its slots;
   - your yes, and sudo once;
   - 10 to 15 minutes.
5. **It always cleans up, even on an error or Ctrl-C:** the login, the clone and the tools it
   fetched go. It prints the link to revoke the approval: needed on a machine that isn't yours.

**Its options,** after `bash -s --` when piped:
- `--manage` makes it a box you keep: it never sleeps, and gets Tailscale, Cockpit and a firewall
  ([below](#what-it-leaves-out-and---manage)).
- `--replace` takes the place of a machine that had the same box name (this one, reinstalled).
- `--fresh` starts over on this machine, in one go: Shipify off it first (as `--remove --purge`),
  then the box set up again, with the same name and slots. Use it when running the command again
  doesn't fix something ([below](#starting-over)).
- `--remove` takes the box away; `--remove --purge` takes Shipify off the machine too
  ([below](#taking-shipify-off-a-machine)).
- `--token` takes a fine-grained token instead of the code: your copy only, Administration and
  Variables write, Contents read, a day long.
- `--copy`, `--name` and `--slots` answer its questions ahead.

**Run it again** for anything: to update the box's setup, to finish one that stopped, or to fix
what `ship doctor` names. It carries on from what's done, and mends what an older setup left
(setup 10: the agents' folders that kept containers from starting). Run it while no task runs:
`box add` refuses while a slot is busy.

**It never says done when something isn't:** the setup ends with a line that says what's left
("Done, except containers: …"), and `box add` ends with the same, and the fix.

**To read it or pin it first:** each release lists `here.sh`'s SHA-256 in its notes.
```sh
curl -fsSLo here.sh https://github.com/<owner>/shipify-template/releases/download/v<version>/here.sh
sha256sum here.sh   # compare with the release notes
bash here.sh
```

**What it needs:** the template public (otherwise `latest/download` isn't reachable without a
login), and your copy private: a box never serves a public repo. `box add` and `ship doctor`
refuse one. From a PC, `pnpm ship box add` below does the same.

### What it leaves out, and `--manage`

**Without `--manage`,** it sets the machine up as [this PC](#this-pc) is: its power and SSH
settings stay as they are (a laptop still sleeps when its lid closes), and there's no Tailscale,
Cockpit or firewall. That fits a machine you also use for other things.

**With `--manage`,** for a machine you keep as a box (a laptop, a spare PC), it's set up as one
from a PC over SSH is, with one difference:
```sh
curl -fsSL https://github.com/<owner>/shipify-template/releases/latest/download/here.sh | bash -s -- --manage
```
- **The same:** it never sleeps (the lid does nothing, and sleep is off), and it gets Tailscale,
  Cockpit and the firewall ([Managing it from a browser](#managing-it-from-a-browser)). Sign in to
  Tailscale at the link it prints.
- **The difference:** its SSH settings stay as they are, because you set it up at the machine,
  not over SSH. The firewall lets SSH in only from your own network and Tailscale. For keys only,
  add your key (`ssh-copy-id`), then run `pnpm ship box add <it> --manage --yes` from a PC once.
- **Not on WSL** (Windows runs that machine), nor in Docker.

The whole way for a laptop or a PC, with no other machine: [No PC?](#no-pc-the-machine-sets-itself-up)
below.

## With Docker

Any machine that runs Docker: a Linux server, a NAS, a Raspberry Pi, a VPS, or a Mac or Windows PC
with Docker Desktop. Each release publishes the box as an image, `ghcr.io/<owner>/shipify-box`,
for x64 and arm64. It's built from `setup.sh`, so a container is the same box as a Pi.

```sh
# with compose.yml (from the template):
docker compose run --rm box register   # once: approve the code on your phone, name it
docker compose up -d                   # then: it runs, and starts again after every reboot

# or with docker alone:
docker run -it --rm -v shipify-box:/home/shipify ghcr.io/<owner>/shipify-box register
docker run -d --name shipify-box --restart unless-stopped --stop-timeout 300 \
  -v shipify-box:/home/shipify ghcr.io/<owner>/shipify-box
```

- **`register`** runs `here.sh` in the container, then your copy's own `box add --container`:
  - it registers the slots and checks the sandbox;
  - it fits the slots to the container's memory limit (`--memory`), or takes `--slots`;
  - its swap is the host's: a container gets no zram of its own (ADR 0061), so give the host swap,
    or keep the slots to what `--memory` fits;
  - it keeps no login.
- **The volume** keeps only the runners' registration. Everything else is the image's.
- **A new release:** `docker compose pull && docker compose up -d`. The registration stays.
- **To stop it:** `docker compose down`, or `docker stop -t 300 shipify-box`. Each runner gets 5
  minutes to cancel its job, as on a box.
- **To remove it:** `docker compose run --rm box remove`, then `docker volume rm` its volume.
- **Never `--privileged`, never the Docker socket:** either would give a task the host. So a box
  in Docker gives its agents no containers ([the lab](#containers-the-lab)): a container can't make
  containers without them.
- **On Docker Desktop (Mac, Windows):** it works when Docker's own kernel allows the sandbox. If
  it doesn't, `register` says so and the box takes no tasks.
- **One volume, one container:** a second container on the same volume refuses to start.

## Which box

| | This PC | A machine of your own (a Pi, a laptop, a spare PC) | A VPS |
|---|---|---|---|
| Always on | while the PC and WSL run | yes: a box never sleeps | yes |
| Cost | none | the hardware, once | monthly |
| Set up with | `box add` | `box add <user@host>` over SSH, or `here.sh --manage` on it | `box add <user@host>` over SSH |
| sudo | once, during setup (and `box start`, `stop`) | once, during setup | once, during setup |
| Task runs (the agent) | yes | yes | yes |

**Slots: several tasks at once.** A runner takes one job at a time, so a box runs one runner per
slot. One rule for every box: **a slot per core, no more than its memory fits.** A busy slot needs
about 1.6 GB of memory (its checks, browser tests included, about 1.0 GB for a minute or two; its
agent 0.4; its runner 0.2), so the box keeps 1 GB for the system and fits a slot per 2 GB of the
rest. Past its cores, checks that overlap only slow each other down (on homepi's 4 cores, a fourth
or fifth at once gets no more done per minute, ADR 0061).

| The box | Slots |
|---|---|
| a 4 GB VPS | 1 (memory) |
| a Pi 4 or 5, 8 GB, 4 cores | 3 (memory) |
| a laptop, 32 GB, 4 cores (8 threads) | 8 (threads: `nproc` counts them) |
| 64 GB, 16 cores | 9, the most a box has |

`--slots N` picks another count, 1 to 9, and a box keeps what it has when `box add` runs again.
Past what it suggests, `box add` warns. Your Claude plan's limits are shared: N tasks at once use
them N times as fast, and a slot with no task uses none.
A box with no swap of its own (Ubuntu's Pi image and most VPS images come without) gets **swap in
memory (zram)**: half its memory, compressed, so tasks that overlap and run short slow down
instead of having a test killed. A box that has swap (WSL, a VPS with a swap file) keeps its own.

**How slots share a box.** Nothing is set aside for a slot: Linux shares the box between them, as it
shares a laptop between its apps.
- **The cores:** Linux gives each program short turns on a core and switches many times a second.
  A slot whose agent waits for its model, or whose tests wait on the disk, takes no turns. When
  more programs want turns than there are cores, each runs slower, and nothing breaks; far past
  the cores, a test with a time limit can run out of time (6 at once on homepi's 4).
- **The memory:** a program gets memory when it asks, and gives it back when it ends. An idle slot
  holds about 0.2 GB, so a task alone can use the rest. Memory nothing uses holds the disk's cache,
  given back at once when a program asks.
- **When memory runs short:** with swap, Linux moves what's idle out of the way and things slow
  down; with none, it kills a program, and a test fails. zram is swap kept in memory, compressed
  to about a third, so it's fast and never wears out a USB stick or SD card.
- **Each slot's count:** each slot is a systemd service, and systemd gives each service a group of
  its own (a cgroup) that counts its memory. `box health` reads it: the most each slot has used,
  and any task killed for memory. No slot has a limit of its own: a task alone gets the whole box,
  and a limit comes only if a slot is ever killed for memory (ADR 0061).
- **Measure a box:** `box/load-test.sh`, below.

**One OS for every box: Ubuntu Server 24.04 LTS (64-bit),** or a newer LTS. `box add`
refuses any other, Raspberry Pi OS and Debian included ([About the OS](#about-the-os)), so every
box is set up and tested the same way.

**More boxes share the work:** any free slot on any box takes the next run. A task runs one at a
time, and carries on from any box: its branch and status live on GitHub.

## Once, before the first box

The bot and the agent's login: [setup.md](setup.md), about 10 minutes on the PC. None of it goes on
a box: it lives in shipify's secrets.

## A machine of your own: a Pi, a laptop or a spare PC

**What you need:** a 64-bit machine (x64 or arm64) with 4 GB of memory or more, an SSD (SD cards
and USB sticks wear out) and Ethernet or Wi-Fi. A Pi 4 or 5 also needs the official power supply
and a case with a fan; a laptop works with its lid closed, on an open shelf where air reaches it.
Five steps, about 30 minutes; reinstalling is the same five.

### No PC? The machine sets itself up

A laptop or a spare PC, with only your phone beside it:
1. **Write the OS and start it:** steps 1 and 2 below (on a laptop, keep it plugged in, and on
   Ethernet if you can).
2. **At its keyboard,** signed in as the user you made:
   ```sh
   curl -fsSL https://github.com/<owner>/shipify-template/releases/latest/download/here.sh | bash -s -- --manage --copy <owner>/shipify
   ```
   Approve the code on your phone, check the plan, say `yes`, and give your password once. About
   15 minutes. Last, it prints a Tailscale link: open it on your phone and sign in with the
   account its Tailscale app uses (within 15 minutes).
3. **In Tailscale's admin page:** the machine → **Disable key expiry**. If Cockpit's address
   doesn't open, turn on HTTPS certificates there (DNS), then run the same command again.
4. **Check it:** step 5 below, from your phone: `/ping` in your chat, then a real task.

Anything goes wrong, or `ship doctor` later says its setup is older: the same command again. It
never needs a PC. (From another machine you can reach, such as another box over Tailscale, steps
3 to 5 work as from a PC: as your own user there, `gh auth login`, clone your copy, `make setup`;
afterwards `gh auth logout` and delete the clone.)

### 1. Write the OS, on the PC

**A Pi:**
1. In **Raspberry Pi Imager**, pick: Device **Raspberry Pi 4** (or 5); OS **Other general-purpose
   OS → Ubuntu → Ubuntu Server 24.04.x LTS (64-bit)** (check the version: older ones sit next to
   it); Storage: the SSD.
2. At OS customisation, **Edit settings**:
   - a hostname: it becomes the box's name (for example `mybox`);
   - a username and password (setup asks for the password once);
   - your Wi-Fi, unless it's on Ethernet;
   - **Services**: enable SSH (password login is fine: step 3 adds your key).

**A laptop or a PC:** write the [Ubuntu Server 24.04.x LTS](https://ubuntu.com/download/server)
installer to a USB stick (for example with Raspberry Pi Imager's **Use custom**), and start the machine from
it. In the installer:
- **Storage:** the internal SSD, and untick **Set up this disk as an LVM group**, so the system gets
  the whole disk. Leave any second disk (an HDD) out.
- **Profile:** the server's name is the box's name (for example `mybox`); a username and password.
- **SSH:** tick **Install OpenSSH server**.
- **Featured snaps:** none.

### 2. Start it

- **A Pi:** plug the SSD into a blue USB 3 port and power on (about two minutes). If it doesn't
  boot, the bootloader is too old: write **Misc utility images → Bootloader → USB Boot** to an SD
  card, boot from it until the green light blinks steadily, then remove the card.
- **A laptop or a PC:** let the installer finish, remove the stick, and restart. Nothing else on
  the machine needs setting: the setup keeps every box awake, and swaps the installer's swap file
  (`/swap.img`, on the disk) for swap in memory (zram), as a Pi has.

### 3. Connect from the PC, once

Find the machine's address in your router (reserve it there), then:

```sh
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_box -N ""        # once per PC: a key just for boxes
ssh-keygen -R <address>                                     # only when reinstalling
ssh-copy-id -i ~/.ssh/id_ed25519_box.pub <user>@<address>   # asks for the machine's password once
```

Give it a short name in `~/.ssh/config`, then check `ssh mybox true` asks for nothing:

```
Host mybox
  HostName <address>
  User <user>
  IdentityFile ~/.ssh/id_ed25519_box
  IdentitiesOnly yes
```

### 4. Make it a box, from the PC

```sh
pnpm ship box add mybox --manage        # shows what it will do, and its slots
pnpm ship box add mybox --manage --yes  # asks for the machine's password once
```

`--manage` adds Tailscale and Cockpit ([Managing it from a browser](#managing-it-from-a-browser)).
Make a free [Tailscale](https://tailscale.com) account first (sign in with GitHub), and install
its phone app with the same login.

- **What it installs:** git (2.26 or newer: `ship doctor` checks), make, gh, Node 22, shellcheck,
  fd and sqlite3 (shellcheck and fd come from Ubuntu's universe, on by default: without it the
  setup goes on and says how to add them), what each stack needs; automatic security updates
  (restarting at 04:30 when one needs it, and never restarting a slot mid-task); no sleep (the lid
  does nothing, and sleep is off: on a Pi or a VPS this changes nothing); SSH by key only; the
  user `shipify` (no sudo, its home 0700) running one runner per slot as system services (`shipify-box-<name>`, then
  `shipify-box-<name>-<k>`, with `UMask=0077`); the machine's tools in `/opt/shipify`; the sandbox
  ([below](#the-agents-own-user)), the agents' network wall included; containers for the agents,
  the lab ([below](#containers-the-lab)); then the updates waiting now; with `--manage`, last,
  Tailscale, Cockpit and a firewall.
- **Right after a first boot,** Ubuntu's own updates hold apt for a while: the setup waits for them
  (up to 20 minutes) and says so. A run cut off mid-install is finished first when you run it
  again.
- **Then it checks the sandbox.** Only when every wall holds does it add the label `sandbox` to the
  slots, so task runs can go to them. It says `containers: … nothing was left` when the lab works.
  It's done only when every slot has the label and one is online; otherwise it says which.
- **Time:** 10 to 15 minutes. Running it again updates the box in place (not while a task runs).
- **With `--manage`:** sign in to Tailscale at the link it prints, within 15 minutes, and if asked,
  turn on HTTPS certificates in Tailscale's admin page (DNS). If you miss it, the box works anyway:
  run the same command again.
- **Reinstalling:** the name looks taken, so add `--replace` (`here.sh` takes it too), and delete
  the old machine in Tailscale.

### 5. Check it

1. `pnpm ship box list` shows it online, with no "no sandbox"; `pnpm ship box health mybox`
   says how it's doing.
2. Open an issue on shipify (or write to the bot): "how's mybox doing?". The reply's run details
   name the box and slot that answered.
3. Then a real one, like `acme-site: bigger margins on cards`.

## A VPS

Any VPS with Ubuntu Server 24.04 LTS, x64 or arm64, is set up the same way. It costs money every
month.

1. **Create it** with Ubuntu 24.04 LTS, your SSH key and a user who can use sudo; a core and 2 GB
   of memory per slot, plus 1 GB (4 GB for 1 slot, 8 GB and 3 cores for 3).
2. **Firewall:** in the provider's firewall, allow only SSH in. The box only connects out.
3. **Make it a box:** `pnpm ship box add <user>@<ip> --manage`, then again with `--yes`. It's
   named after the hostname; `--name <name>` picks another.
4. **Check:** as for a machine of your own, step 5.

To remove it: `pnpm ship box remove <name> --yes`, then delete the VPS.

## This PC

```sh
pnpm ship box add        # the plan
pnpm ship box add --yes  # does it: asks for sudo once
```

- **The same box as a Pi's:** the same script, run here with sudo, so the same user `shipify`, the
  same agent users and sandbox, the same system services, and the same `sandbox` label once its
  check passes. It takes task runs like any box.
- **What stays as it is:** this PC's SSH settings, its power settings and its network. With
  `--manage`, it's a box you keep instead: it never sleeps, and gets Tailscale, Cockpit and a
  firewall; its SSH settings still stay ([one command](#what-it-leaves-out-and---manage)). Not on
  WSL.
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
  | `/opt/shipify/tool` | the runner's tool cache: the watch's Node, and each agent at the version `executors.json` pins (`claude-code/<version>` about 233 MB, `pi/<version>` about 166 MB, `opencode/<version>` about 177 MB), installed the first time a run picks it ([agents.md](agents.md#on-a-box)) |
  | `/opt/shipify/tool/shipify-app/<commit>` | read-only copies of Shipify, one per commit: the CLI built as one file that every step and the agent start, its playbook, skills and checks; no packages (the three newest, and any a run is on; runs that start together on a new commit each build their own, and the first moves it in) |

  What goes in them is installed with `umask 022`, so agents can read it. A task's run and its agent
  both use the system's Node and pnpm (`/usr/local/bin`, from `box add`; ADR 0057). A test browser is each slot's
  agent's own, in its slot's cache, downloaded once per slot (ADR 0041).
- **Each run, a fresh folder,** `/srv/shipify-agent-<k>/run-<id>/`: its own clone of the latest
  code, home and work, gone before the next run ([security.md](security.md#the-agents-sandbox)).
  Only its `out/` has the runner's group (`shipify`): the rest is the agent's alone, its group too,
  so a container can chown a folder there (a database's image does at its start).
- **Kept per slot:** `/srv/shipify-agent-<k>/cache` and `data` (the agent's `~/.cache` and
  `~/.local/share`), so tools download once per slot, not once per run: pnpm, the
  project's packages, a test browser, its containers' images (`data/containers`). The weekly
  clean-up trims what hasn't been read in 30 days, and leaves the images to Podman's prune.
  Both are the agent's own, its group too, with no setgid (setup 10): with the slot folder's
  group (`shipify`, which has no ID in the agent's user namespace), Podman's store couldn't mount.
  A run's start that makes one again (it went missing) clears the setgid it takes from the slot
  folder.
- **The check, at setup and every week:** the runner starts each agent without a password, and no
  agent can read the runner's home, its jobs' folder (`_work`), a runner process's environment or
  another slot's runs, nor write to a root container socket, nor, on WSL, open a Windows drive or
  start a Windows program ([This PC](#this-pc)). At setup, also: no agent reaches a private
  network (below). `box add` adds the `sandbox` label only after it passes. `ship doctor` (so each
  weekly clean-up) checks it again, plus the home's 0700, the jobs' umask 0077, and that
  `shipify-agents-net.service` loaded the network rule (below).
- **Its network: the internet, never a private network** (setup 9). An agent and its containers
  reach what the work needs (GitHub, npm, the agent's API), and no private address: not your home
  network (the router, a camera, a NAS, homepi), not the tailnet, nor a cloud's metadata address
  (`10/8`, `172.16/12`, `192.168/16`, `100.64/10`, `169.254/16`, `fc00::/7`, `fe80::/10`). DNS stays
  open, since a resolver on your network may answer it. It's a table of its own in nftables
  (`/etc/shipify/agents-net.nft`), for each agent's user and the IDs of its range, loaded at every
  start by `shipify-agents-net.service`, before the network is up. Your own rules, ufw's and
  Tailscale's stay as they are. The setup's check proves it: a listener on the box's own private
  address, which root reaches and no agent does. The rest of the internet stays open: a list of
  allowed hosts is for later ([roadmap.md](roadmap.md)).
- **Nor the box's own SSH and Cockpit** (setup 10): ports 22 and 9090 on `127.0.0.1` and `::1`
  are closed to the agents, in the same table. Each asks for your password, which an agent could
  keep guessing. A port a container publishes on `127.0.0.1` stays the agent's to reach. Another
  service of yours on the box's `127.0.0.1` stays open to them: put it behind a password, or on a
  port the agents can't reach.

## Containers: the lab

Every box gives its agents containers (box setup 8, ADR 0064): a task can run `docker run …` or
`docker compose up` for tests that need a database, to try a repo with its own services, or to test
a theory. Nothing to set: `box add` installs it, the same on a Pi, a laptop, a spare PC or a VPS.

- **Rootless only:** Podman, as each slot's own agent user, in a user namespace the agent owns,
  with a range of 65,536 IDs of its own (`/etc/subuid`, `/etc/subgid`). `docker` is Podman
  (podman-docker), and `docker compose` is podman-compose. No Docker Engine, no root daemon, no
  `docker` group and no socket: setup turns off the root API socket Ubuntu's package starts.
- **Gone with the turn:** a container is a child of the agent's command, so the box's kill at each
  turn's end stops it. Its record, volumes and networks go when the slot's next run starts, which
  empties Podman's state in `/srv/shipify-agent-<k>/runtime` (as a restart would) and prunes them.
- **Images are kept per slot, for a week,** in `/srv/shipify-agent-<k>/data/containers`, so a
  second run is fast. The weekly clean-up removes them, when no other slot is busy. Each slot pulls
  its own copy: a store two agents share would break the wall between slots.
- **Docker's habits:** a short name (`postgres`) is Docker Hub's
  (`/etc/containers/registries.conf.d/50-shipify.conf`). Docker Hub lets an address pull 100 times
  in 6 hours without a login.
- **The agents' settings,** `/etc/containers/shipify-agents.conf`, which the runner names in each
  agent command: there's no systemd user session, so the cgroupfs group manager, and logs and
  events to files (`docker logs` works). Healthchecks don't run, and podman-compose 1.0.6 doesn't
  wait for a healthy service, so an agent waits in its own command. A container stays in its
  slot's group, so its memory counts as the slot's.
- **Ubuntu's normal updates:** Podman's fix for stopping containers is only in `<codename>-updates`.
  A box whose sources lack it (homepi's image did) gets it in
  `/etc/apt/sources.list.d/shipify-updates.sources`. Automatic updates stay security-only.
- **A machine with a Docker of its own** keeps it: setup installs no `docker` command there, and
  removes no package. Agents use `podman`, which takes the same commands.
- **Your own Podman** on the box works as before, as your user, with your own range and settings.
- **The box works without them, but never quietly:** when the packages can't install (no Ubuntu
  universe) or a container doesn't start, the step says why (Podman's own `Error:` line), and the
  setup ends with "Done, except containers" and exit 3. The slots still get their `sandbox` label
  and take tasks; `box add` says what's left and the fix
  ([troubleshooting.md](troubleshooting.md#boxes)). A box in Docker skips it.
- **The check, at setup:** on every slot, the agent's range works and its store opens (`podman
  info`, as its runs do); on slot 1, the whole way, as a run does, in a folder laid out as a run's:
  a container gives the folder it mounts to a user of its own, as a database's image does, and
  runs as it; the box's kill stops it and leaves no process of the agent or its range (a wall: no
  label until it holds), a run start's prune leaves no container, and `podman unshare` removes what
  the container wrote. Each step gives Podman the names the box gives its own Podman commands
  (`HOME` the slot's folder: Podman stops at once without a `HOME` that is there). A pull that fails
  (no network, Docker Hub's limit) is said, and the setup ends as done.
- **And every week:** `ship doctor` (so the weekly clean-up, and "how is this box doing?") opens
  each slot's store as its agent, and names a slot whose containers don't start.

## Adding a box or a slot

```sh
pnpm ship box add <user@host> --manage --yes            # a new box: a slot per core, as memory fits
pnpm ship box add <user@host> --slots 3 --manage --yes  # more (or fewer) slots on a box
```

- **More slots:** each new slot gets its runner and its agent user. Fewer removes the extra ones,
  with their agents' users and runs.
- **When to change the count:** a new box starts with what its cores and memory fit. Pick fewer when
  `box health` says a slot had a task killed for memory, or when your plan's limits run out too
  fast. Pick more on a box with memory and cores to spare: the warning says when it's past them.
- **Measure it:** `box/load-test.sh` runs N copies of an app's `make verify` at once on the box
  (as your own login there, no root) and prints each one's time and memory, the box's lowest free
  memory and any kill (`bash box/load-test.sh <app folder> 1 3 4 5`).
- **More boxes or more slots:** your Claude plan, not the hardware, is usually the limit: N tasks
  at once use its 5-hour limit N times as fast. Start with what `box add` picks; if runs hit the
  limit, the same command with `--slots 4` (or fewer). Add a box when tasks wait in the queue, not
  before.
- **Names:** each box's is its own. `box add` refuses a name another machine has, unless you add
  `--replace`.
- **Moving to another machine,** in one go:
  1. Set the new one up (steps 1 to 5, or [No PC?](#no-pc-the-machine-sets-itself-up)).
  2. On the old one, `sudo systemctl stop shipify-box-<old name> shipify-box-<old name>-2 …`, so
     the next task goes to the new one. Run one, and check its run details name the new box.
  3. [Take Shipify off the old one](#taking-shipify-off-a-machine) (`here.sh --remove --purge` on
     it), or write it a fresh OS. Nothing is lost: a box holds nothing that isn't on GitHub.

## How every box stays running

Each slot is a systemd service running the runner's `bin/runsvc.sh`: a system service run as
`shipify`, the same on every machine. It starts at boot, comes back 10 seconds after anything but
you stops it (`Restart=always`), and a stop asks the runner to cancel its job first
(`KillMode=mixed`). It runs with `UMask=0077`. The runner updates itself. A slot GitHub deleted
(after `box remove`, or 14 days off) registers again when the box is set up again.

Every box you keep (set up over SSH, or with `--manage`) never sleeps: a logind setting makes the
lid do nothing, and the sleep states are masked. An automatic update never restarts a slot (a
needrestart rule for `shipify-box-*`): a slot takes a new library at its next start. This PC without
`--manage` keeps its own power settings; a container's host keeps its own.

## Fast and current

| Piece | Stays current |
|---|---|
| shipify's code | a run fetches its commit only when the box has no copy of it (ADR 0057); the watch's jobs check out their own |
| Node 22 | `box add` again (or a new image) updates the system's, which a task's run and its agent use; the weekly clean-up takes the newest 22.x for the watch's jobs, and keeps the two newest |
| pnpm, the agents | pinned (`packageManager`; each agent's `install` in `executors.json`); they change only in a PR. The weekly clean-up removes an agent's other versions |
| packages | one pnpm store per box, pruned weekly |
| the box itself | `box/setup.sh`: a change bumps `SETUP_VERSION`, and `ship doctor` names a box set up by an older one |

**Time limits:** the agent works up to 200 minutes in one session (ADR 0059), its fix round 20,
`make verify` 25, a check one; the run's job stops after 460 minutes. A run cut off anyway is
marked Stopped by the watch, and your `continue` carries it on from where it got to. A box that
restarts or loses power mid-run loses that run's work since its start: the agent's commits leave
the box when the run ends.

## Commands

| Command | Does |
|---|---|
| `pnpm ship box list` | every box: online, busy, its slots, "no sandbox", its Cockpit link (from anywhere) |
| `pnpm ship box add [<user@host>] --yes` | makes a box: a Pi or VPS over SSH, or this PC with no target; again, it brings a box up to date |
| `pnpm ship box status` | this machine's box (this PC's, or a Pi's when you run it there): each slot's service, GitHub's view and the task it runs |
| `pnpm ship box health [<user@host>]` | disk, memory and swap, temperature, how a Pi last started (power-on or a restart), a pending restart, updates, services, each slot's memory: here or over SSH |
| `pnpm ship box stop` · `start` · `restart` | this machine's box: off until started, even after a restart; on; both, with sudo. Stop asks first while a task runs |
| `pnpm ship box logs -f` · `peek -f` | this machine's slots' log, live; what the agent is doing now |
| `pnpm ship box remove <name> [--purge] --yes` | unregisters its slots from GitHub, and stops its services when it's this machine's (with sudo); a Pi's, it says what to run there. `--purge`, on the machine itself: Shipify off it too (`box/remove.sh`) |
| `pnpm ship doctor` | on a box: its setup version and the sandbox check, among the rest |

## Looking after it

- **Usually, nothing:**
  - the box restarts itself, and Ubuntu installs security updates (restarting at 04:30 if needed);
  - **the weekly clean-up:** the due run starts it on each box once its last is a week old. It
    removes closed and deleted tasks' folders, the agents' run folders older than 8 hours (as each
    agent, who owns them), runs `ship doctor` (the sandbox check included), checks the door
    answers, and takes the newest Node 22.x. When no other slot is busy, it keeps the box's shared
    tools to each agent's pinned version and the two newest Node versions, prunes the package
    store and npm's cache, and removes each slot's containers' images. Its result goes on the
    status task, naming what it removed; a problem comes as a comment there, which notifies you on
    GitHub;
  - each due run writes the box's health to the status task (disk, memory and swap, temperature,
    throttling, how a Pi last started, a pending restart, updates, services, and the most each slot has used since it
    started); a slot that had a task killed for memory comes as a comment there;
  - the watch says when a box is offline for 4 minutes or more, and again when it's back.
- **See what the agent is doing,** over SSH or Cockpit's terminal:
  `sudo node /home/shipify/runner/_work/shipify/shipify/box/peek.mjs --follow` (the agents'
  sessions are readable only by them and root). It reads Claude Code's sessions; for pi, the run's
  Actions log shows each step as it goes.
- **Stop, start or restart it:** Cockpit → Services, or `sudo systemctl stop|start|restart
  shipify-box-<name> shipify-box-<name>-2 …`; logs: `journalctl -u 'shipify-box-<name>*' -f`.
- **A task cut off mid-run** (a restart, a power cut): the watch marks it Stopped and tells you
  once; reply `continue` and any box carries it on.
- **Update its setup** (when doctor says it's older), while no task runs: on the box, its
  `here.sh` command again; from a PC, `pnpm ship box add <user@host> --manage --yes`.
- **Start over,** when running it again doesn't fix something: [Starting over](#starting-over).
- **Remove it:** [Taking Shipify off a machine](#taking-shipify-off-a-machine), or write a fresh
  OS.
- **Lost or stolen:** [security.md](security.md#if-something-leaks-or-a-box-is-lost).

## Starting over

A box is disposable: it keeps no task and no secret, so taking Shipify off it and setting it up
again loses nothing that isn't on GitHub. Tasks that come meanwhile wait in the queue. On the box,
while no task runs on it, one command (setup 10):

```sh
curl -fsSL https://github.com/<owner>/shipify-template/releases/latest/download/here.sh | bash -s -- --fresh --manage --name <name>
```

- **What it does:** both plans first (the purge's, then the setup's), one yes, then Shipify off
  the machine (its slots on GitHub, services, users, folders and rules, as `--remove --purge`),
  then the box set up again, with the same name and as many slots as it had (`--slots` to change
  it).
- **What stays:** the machine's own (security updates, SSH, zram, Tailscale, Cockpit, the
  firewall), and anything else of yours on it. The slots' caches and images download again.
- **It refuses** while a slot runs a task, and on a machine that is another box.
- **If it stops,** the same command carries on: a purge that stopped is finished first.
- **Still wrong after it?** Write the OS fresh (Ubuntu Server 24.04 LTS), then the same command
  without `--fresh`, with `--replace`.

## Taking Shipify off a machine

For a machine that stays in use: a Pi that keeps other work, a laptop you take back. Writing a fresh
OS does the same; nothing is lost either way, since a box holds nothing that isn't on GitHub.

1. **On the machine,** while no task runs on it, one command (setup 9):
   ```sh
   curl -fsSL https://github.com/<owner>/shipify-template/releases/latest/download/here.sh | bash -s -- --remove --purge
   ```
   (or, in a clone of your copy there, `pnpm ship box remove <name> --purge --yes`). GitHub forgets
   its slots, then `box/remove.sh` takes off, with sudo: its services, its users with their ID
   ranges, folders and processes (the containers' images too), the sudo rule, the update rule for
   the slots, the agents' network rules and `/opt/shipify`. Last, it checks nothing of the box is
   left, and says what is. It's safe to run again.
2. **A machine you can't reach any more:** from a PC, `pnpm ship box remove <name> --yes` (the
   box's name, not the SSH alias): GitHub forgets its slots. Write it a fresh OS when you have it
   back.
3. **The tools only Shipify used,** when nothing else on the machine needs them: Node and pnpm,
   gh, and the lab's Podman and its settings. shellcheck, fd and sqlite3 can stay.
   ```sh
   sudo rm -rf /opt/node
   sudo rm -f /usr/local/bin/{node,npm,npx,corepack,pnpm,pnpx,yarn,yarnpkg}
   sudo apt purge -y gh && sudo apt autoremove -y
   sudo rm -f /etc/apt/sources.list.d/github-cli.list /etc/apt/keyrings/githubcli-archive-keyring.gpg
   sudo apt purge -y podman podman-docker podman-compose uidmap slirp4netns catatonit netavark aardvark-dns && sudo apt autoremove -y
   sudo rm -f /etc/containers/shipify-agents.conf /etc/containers/registries.conf.d/50-shipify.conf /etc/containers/nodocker
   ```
4. **What stays, as the machine's own:** security updates (with the restart at 04:30), Ubuntu's
   normal updates where setup added them (`/etc/apt/sources.list.d/shipify-updates.sources`), SSH
   by key only, zram, and with `--manage` Tailscale, Cockpit and the firewall. A laptop you take
   back sleeps again with `sudo rm /etc/systemd/logind.conf.d/50-shipify-box.conf` and `sudo
   systemctl unmask sleep.target suspend.target hibernate.target hybrid-sleep.target
   suspend-then-hibernate.target`, then a restart.

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
- **"Bad Origin" in Cockpit:** run the same command again (`here.sh --manage`, or `box add
  --manage`). It restarts Cockpit only when its settings change, so it works from Cockpit's own
  terminal too.
- **No NetworkManager:** Cockpit comes without what it recommends, so its Networking and Storage
  pages are missing: NetworkManager would take a laptop's Wi-Fi from Ubuntu Server's own settings.
  Its updates page is there.

## Using it anywhere

- **Any network works:** the box only connects out (GitHub, the agent's API, npm). More Wi-Fi
  networks go under `access-points:` in `/etc/netplan/50-cloud-init.yaml` (then `sudo netplan
  apply`).
- **SSH from anywhere:** with `--manage`, `ssh <user>@<hostname>` over Tailscale. An alias like
  `mybox` points at the home address, and the firewall lets plain SSH in only from the network
  the box was set up on.

## About the OS

- **Ubuntu Server LTS only,** on every box: one OS, one setup, tested the same way.
  `box add` checks it first (24.04 or a newer LTS) and refuses any other.
- **Not Raspberry Pi OS:** `make verify` starts Cloudflare's local runtime, which needs a
  kernel with 48-bit addresses; Raspberry Pi OS's has 39
  ([workerd #5013](https://github.com/cloudflare/workerd/issues/5013)), and Docker can't change
  that (a container uses the host's kernel). `ship doctor` checks it too.
- **A newer LTS:** write it fresh and run the five steps again (a box holds nothing that isn't on
  GitHub). 24.04 has updates to 2029, 2034 with [Ubuntu Pro](https://ubuntu.com/pro) (free for
  five personal machines).

## When something's off

"Run it again" below means the box's own setup command: on the box, its `here.sh` command; from a
PC, `pnpm ship box add <user@host> --manage --yes`. Either works, while no task runs.

| You see | Do |
|---|---|
| a task gets no 👀 for minutes | no box is online: `/ping` in your chat (or `pnpm ship box list`), then turn one on. GitHub's queue starts the task when one is back |
| tasks wait with a box online | no online slot has the `sandbox` label (`box list` says "no sandbox"): run its setup again, while no task runs |
| the setup says none of its slots is online | `sudo systemctl status shipify-box-<name>` on it says why; then run it again |
| the setup waits at "Waiting for cache lock" | Ubuntu's own updates, after a first boot: it waits up to 20 minutes, then goes on. Stopped anyway (Ctrl-C, a lost session)? Run it again: it finishes the cut-off install first |
| the sandbox check says the agents can reach your network | their rules didn't load: `sudo systemctl status shipify-agents-net` says why; then run it again |
| `ship doctor` (or the clean-up) says the sandbox isn't right | it names the wall that's open. Run `box add` again: it sets the sandbox up and checks it |
| the sandbox check says an agent's commands can read its memory, or its login isn't on a pipe | both are Ubuntu's own settings, which `box add` leaves as they are: put `kernel.yama.ptrace_scope = 1` in `/etc/sysctl.d/10-ptrace.conf` and run `sudo sysctl --system`; `/bin/sh` must be dash (`ls -l /bin/sh`). Then `box add` again |
| `box add` stops at "Checking the sandbox" | the line above names the wall. The box keeps working, without the `sandbox` label. Run it again; if it fails the same way, look at `/etc/sudoers.d/shipify-agents` and `ls -ld /home/shipify /srv/shipify-agent-*`. On WSL, "the agents can reach Windows": make the fix it prints in `/etc/wsl.conf` first ([This PC](#this-pc)) |
| `box add` says the machine runs another OS | write Ubuntu Server 24.04 LTS (64-bit) on it, then run it again |
| `box add` can't connect | it says why and prints the fix: `ssh-keygen -R <address>` after a reinstall, `ssh-copy-id` for a missing key; for a key with a passphrase, `eval "$(ssh-agent)" && ssh-add` first |
| this PC's box goes offline when you close WSL | the `.wslconfig` idle timeouts ([This PC](#this-pc)) |
| `ship doctor` says the kernel is 39-bit | write Ubuntu Server 24.04 LTS instead |
| offline after a power cut | wait a minute; then Cockpit, or `ssh` in and `sudo systemctl status shipify-box-<name>` |
| a box's clean-up waits in the queue | its slots lack the `box-<name>` label: run `box add` again |
| a box vanished from `box list` | GitHub removes a runner that's been off 14 days: run its setup again, which registers its slots again |
