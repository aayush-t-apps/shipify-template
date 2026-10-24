---
status: accepted (merged #560; the owner's `go` on #555) and built
date: 2026-10-24
amends: 0031 (the sandbox: an agent runs containers as itself, with a range of IDs of its own, and a root container socket is a wall), 0043 (agents run what they need: containers too), 0061 (the weekly trim leaves the containers' store to Podman)
---

# 0064: The lab: containers on every box, rootless, gone with the run

## The plan in short

**Every box gets containers for its agents: Podman, rootless, as each slot's own agent user, with a
`docker` command and `docker compose`.** `box add` installs it the same way on a Pi, a laptop, a
spare PC or a VPS (box setup 8). It adds no repo, service, daemon or key, and nothing for you to
set.

1. **What an agent can do in a task:** `docker run …` and `docker compose up`: a test that needs a
   database, a repo tried with its own services, a theory tested with real services.
2. **Rootless only.** An agent's containers run in a user namespace that the agent owns, with a
   range of user IDs of its own. There is no Docker Engine, no root daemon, no `docker` group and
   no socket.
3. **Gone with the run.** A container stops when the agent's turn ends: the box's kill already
   reaches it. Its record, its volumes and its networks go when the slot's next run starts.
4. **Images are kept per slot, for a week.** The second run is fast. The weekly clean-up removes
   them.
5. **One limit is set aside, on purpose:** an agent can be root inside a user namespace of its own,
   which puts more of the kernel in its reach. It can already do that today, through a known way
   past Ubuntu's limit (checked on homepi). The kernel's security updates defend it (Security,
   below).
6. **Proved on each box:** the setup's check runs a container as an agent, kills it the way the box
   does, and finds nothing left. A new wall line: no agent reaches a root container socket.
7. **Proved before the laptop:** after the build merges, `box add` runs again on homepi (it is safe
   to run again), and one task runs a compose file there. Then the laptop.

Not in it, on purpose: anything an agent starts that outlives its turn, a firewall for containers
(a container reaches what its agent reaches), a separate lab repo or service, and a tool that
reaches homelab. Each is a later step, only if you ask.

## Context

- The owner, on task #555 (24 Oct): the laptop as an experimental workdesk where agents can run
  heavy things; then "the lab is tools on the same box, Docker and such, set up initially; homelab
  stays separate" (07:37); "it has to be set up before we move to the laptop" (07:21); every box
  the same, with no laptop config (06:43).
- Today no agent can run a container: a box has no container tool. A task whose tests need a
  database can't run them on a box; it leaves them to CI.
- ADR 0056 refused the Docker socket and `--privileged` for a box in Docker: either gives a task
  the host. The `docker` group is the same as the socket.
- The sandbox (ADR 0031, box setup 5): each slot's agent is its own user. The runner starts every
  command through `sudo -n -u shipify-agent-<k>` from an empty environment, so there is no login
  session, no `XDG_RUNTIME_DIR` and no systemd user manager. After each think, the box kills every
  process of that user (`kill -KILL -1`, `killAll` in `cli/lib/sandbox.ts`). HOME is a fresh
  folder per run; the slot's `cache/` and `data/` are kept across runs.

## Assumptions, checked

| Assumption | How it was checked |
|---|---|
| Ubuntu 24.04 limits user namespaces | homepi (24.04.5, kernel 6.8.0-1065-raspi): `kernel.apparmor_restrict_unprivileged_userns` is 1 |
| A plain `unshare` gets no root in a user namespace | as `shipify-agent-1` on homepi: `unshare --user` works, but runs in AppArmor's `unprivileged_userns` profile with no capabilities (`CapEff` 0); `unshare --user --map-root-user` fails (writing `uid_map`: operation not permitted) |
| But an agent can already be root in one today | Qualys found three ways past this limit in 24.04 ([Qualys, 27 Mar 2025](https://blog.qualys.com/vulnerabilities-threat-research/2025/03/27/qualys-tru-discovers-three-bypasses-of-ubuntu-unprivileged-user-namespace-restrictions)); Canonical answered with AppArmor changes in normal releases, not a security fix. On homepi (apparmor 4.0.1-0ubuntu0.24.04.7), as `shipify-agent-1`: `busybox unshare -Ur` is now refused, but `aa-exec -p trinity -- unshare -Ur` gives `uid=0` and every capability (`CapEff` 000001ffffffffff) in a namespace of its own. `aa-exec` and 92 profiles that allow namespaces ship with Ubuntu |
| Podman's own profile lifts the limit, for Podman only | `/etc/apparmor.d/podman` is already on homepi (Ubuntu's `apparmor` package): `profile podman /usr/bin/podman flags=(unconfined) { userns, }`. `crun`, `runc`, `slirp4netns`, `buildah` and `rootlesskit` have the same kind |
| The packages are in Ubuntu 24.04 | `apt-cache policy` on homepi: podman and podman-docker 4.9.3, podman-compose 1.0.6, uidmap, slirp4netns 1.2.1, catatonit 0.1.7, netavark and aardvark-dns 1.4.0, crun 1.14.1, conmon 2.1.10 |
| podman's recommended packages are more than needed | `apt-cache show`: podman recommends buildah, dbus-user-session, passt, slirp4netns, uidmap and catatonit; podman-docker recommends docker-compose (the old Python 1.29). So setup installs an exact list with `--no-install-recommends` |
| Ubuntu's podman turns on a root socket | the packages' own files (`apt-get download`, unpacked, not installed): podman's `postinst` enables and starts `podman.socket`, `podman.service`, `podman-auto-update.timer`, `podman-restart.service` and `podman-clean-transient.service`; `podman.socket` listens on `%t/podman/podman.sock`, `SocketMode=0660`; podman-docker's tmpfiles line links `%t/docker.sock` to it; its `/usr/bin/docker` is `exec /usr/bin/podman "$@"`, quiet when `/etc/containers/nodocker` exists |
| A short image name fails on Ubuntu | Ubuntu's `registries.conf` has no unqualified-search registries, so `podman pull postgres` fails with "short-name did not resolve" ([desigeek.com](https://blog.desigeek.com/post/2022/03/podman-error-on-ubuntu-short-name-did-not-resolve-to-an-alias-and-no-unqualified-search-registries/), [containers-registries.conf(5)](https://manpages.ubuntu.com/manpages/noble/man5/containers-registries.conf.5.html)). With `docker.io` as the only one, a short name has one meaning, so nothing asks |
| netavark 1.4.0 in 24.04 has a known DNS issue | CVE-2025-8283, low (3.7): a container whose name matches a name under the box's DNS search domains may reach that host instead; no fix listed for 24.04 ([osv.dev](https://osv.dev/vulnerability/UBUNTU-CVE-2025-8283)) |
| The agents have no ID range | `/etc/subuid` and `/etc/subgid` on homepi: only `homepi` (100000) and `shipify` (165536) |
| Containers count in the slot's memory | the agent's processes are in the slot's service group (`/proc/self/cgroup`: `/system.slice/shipify-box-homepi.service`), which has no delegation. Podman falls back to cgroupfs (above); that containers then stay in the slot's group, and that a container's own `--memory` limit is refused there, are not confirmed: the setup's check reads the container's group |
| A published port is 1024 or more | `net.ipv4.ip_unprivileged_port_start` is 1024 on homepi |
| Docker Hub without a login | 100 pulls in 6 hours per IPv4 address ([docs.docker.com/docker-hub/usage](https://docs.docker.com/docker-hub/usage/)) |
| Podman stops containers only with Ubuntu's normal updates | LP #2040483: AppArmor 4.0 kept crun from sending signals, so stopping a container failed; fixed in podman 4.9.3+ds1-1ubuntu0.2 and containers-common 0.57.4+ds1-2ubuntu0.1, released to `noble-updates` ([Launchpad](https://bugs.launchpad.net/ubuntu/+source/libpod/+bug/2040483)). homepi's apt sources have only `noble` and `noble-security` (`/etc/apt/sources.list.d/ubuntu.sources`), so its newest podman is 4.9.3+ds1-1ubuntu0.1 (`apt-cache madison`), without the fix. A fresh Ubuntu Server install has `noble-updates` |
| The box's kill reaches a container's processes | not found in a source; by the kernel's rule, a signal is allowed when the sender holds CAP_KILL in the target's user namespace, which the namespace's owner does. After a kill, a lost `tmp_dir` makes Podman reset every container that isn't exited to "configured" ([runtime.go L560-646](https://github.com/containers/podman/blob/v4.9.3/libpod/runtime.go#L560-L646)). The setup's check proves the kill on each box |
| Podman with no login session | podman 4.9.3 source: with no `XDG_RUNTIME_DIR` it uses `$TMPDIR/podman-run-<uid>` and exports that as `XDG_RUNTIME_DIR`; its store's run folder is `$XDG_RUNTIME_DIR/containers` and its `tmp_dir` `$XDG_RUNTIME_DIR/libpod/tmp` ([utils_supported.go](https://github.com/containers/podman/blob/v4.9.3/pkg/util/utils_supported.go), [default.go](https://github.com/containers/common/blob/v0.57.4/pkg/config/default.go)). With the systemd group manager it prints four lines and falls back to cgroupfs; logs and events go to journald, which a system user may not read back; healthchecks never run, since their timers need a systemd user manager ([healthcheck_linux.go](https://github.com/containers/podman/blob/v4.9.3/libpod/healthcheck_linux.go)). Its troubleshooting guide: rootless with cgroup v2 "expects a valid login session … In most cases, podman will figure out a solution on its own" ([troubleshooting.md](https://github.com/containers/podman/blob/v4.9.3/troubleshooting.md)): it usually works, but isn't promised. The setup's check proves it on each box |
| Podman keeps the paths of its first use | podman 4.9.3 source: `mergeDBConfig` replaces the store's run folder, its root, `tmp_dir` and the volumes' path with the ones its database recorded, unless a command-line flag set them; only a debug line says so ([runtime.go L1010-1059](https://github.com/containers/podman/blob/v4.9.3/libpod/runtime.go#L1010-L1059)). A user's log shows it: "Overriding run root … from database" ([podman list](https://lists.podman.io/archives/list/podman@lists.podman.io/message/VL45HEU3FWDAY5B2DWWPOBONFJBNJPKL)). The database is `<store>/db.sql` (SQLite, from 4.8). So with a run's own `TMPDIR`, every later run would reuse the first run's folders |
| Where a rootless store goes | containers-storage.conf(5), from Ubuntu's `containers-storage` 1.51.0 package: a rootless user's store is `$XDG_DATA_HOME/containers/storage` when `XDG_DATA_HOME` is set; `transient_store` "should remain disabled in most configurations" (it needs garbage collection at boot) |
| Podman's per-boot folder and its temp files | containers.conf(5), from Ubuntu's containers-common 0.57.4: `tmp_dir` "must be a tmpfs (wiped after reboot)"; `image_copy_tmp_dir` is overridden by `TMPDIR` (so a pull's temp files go in the run's `tmp/`); a new store's database is SQLite |
| Settings for the agents' users alone | containers.conf(5), 0.57.4: the files read are `/usr/share/containers`, `/etc/containers` (and its `.d`) and the user's own `$HOME/.config/containers`; there is no per-user folder under `/etc` in this version. `CONTAINERS_CONF_OVERRIDE` names a file "loaded last". So the runner names one, root's, for the agents' commands alone. Defaults there: `cgroup_manager="systemd"`, `events_logger="journald"`, `compose_warning_logs=true` |
| The network program | containers.conf(5), 0.57.4: `default_rootless_network_cmd="slirp4netns"` (pasta is the default only from Podman 5); slirp4netns's `allow_host_loopback` is false by default, so a container doesn't reach the box's `127.0.0.1` |
| Files under a container's IDs | podman-unshare(1), 4.9.3: it starts a command in a user namespace where the user is root and its `/etc/subuid` range is mapped, and is "useful … for manually clearing storage and other data related to images and containers". That plain `rm` fails on a folder of a container's own user (0700, under an ID of the agent's range) follows from file permissions: the agent isn't its owner and has no override in the box's own namespace. The setup's check proves the clean-up |
| A published port listens on every address | podman-run(1), 4.9.3 (in the package): "If host IP is set to 0.0.0.0 or not set at all, the port is bound on all IPs on the host". With `--manage`, the box's firewall lets in only Tailscale; without it, the home network reaches it, as it reaches any program an agent starts today |
| `docker compose` | the 4.9.3 binary has `podman compose`, which runs the first provider it finds, `docker-compose` before `podman-compose` (its strings; containers.conf(5): `compose_providers`, `compose_warning_logs`). podman-docker's `docker` runs `podman` with the same words, so `docker compose` is `podman compose`. The agents' settings name `podman-compose` alone, so a `docker-compose` installed later changes nothing. podman-compose 1.0.6 ([its source](https://raw.githubusercontent.com/containers/podman-compose/v1.0.6/podman_compose.py), [releases](https://github.com/containers/podman-compose/releases)): `build` and `up --build` work; a `depends_on` condition is dropped, so nothing waits for `service_healthy` (from 1.3.0/1.4.0); no profiles (from 1.1.0) |
| ID ranges | homepi's `/etc/login.defs`: `SUB_UID_MIN` 100000, `SUB_UID_COUNT` 65536 (and the same for groups), and system users get none by default. Its shadow 4.13 has `useradd --add-subids-for-system` (a new agent gets a free range from shadow itself) and `usermod --add-subuids/--add-subgids FIRST-LAST` (an agent that already exists) |
| Pruning | podman-system-prune(1), 4.9.3: it removes every unused container, pod and network; `--volumes` adds volumes; `--all` adds every image that no container uses; `--external` removes store files Podman no longer knows of, which an unclean stop can leave (it can't go with `--all`) |

## Options

- **A: rootless Podman as each agent, on every box (chosen).** No daemon: a container is a child of
  the agent's command, in the slot's group, killed with the agent. Ubuntu packages it and gives it
  an AppArmor profile. (+ the walls between users stay; nothing runs as root; one setup for every
  box / − an agent can be root in its own user namespace; podman-compose covers less of Compose
  than Docker's)
- **B: Docker Engine, with the `docker` group or its socket for the agents.** (− either is root on
  the box: any task could read the runner's keys. Refused, as in ADR 0056)
- **C: rootless Docker, a daemon per agent user.** (− a daemon that must outlive each command, a
  systemd user manager or linger per agent, and Docker's own apt source for its rootless parts;
  more parts for the same wall as A)
- **D: a virtual machine per run (Firecracker, a QEMU micro-VM, Kata).** (+ the strongest wall /
  − needs KVM, which a VPS seldom has and a box in Docker never; heavy on a Pi; much more to build.
  A later step, if a run ever needs a wall stronger than A's)
- **E: gVisor as Podman's runtime, on top of A.** (+ a container's own calls reach less of the
  kernel / − Podman itself still needs the namespace; slower, less compatible. A later step on A)
- **F: no containers on boxes; services only in CI.** (today; − no lab)
- **G: containers only on boxes that ask for them (a label).** (− the owner wants every box the same)
- **H: A, with a systemd user manager per agent (linger).** (+ healthchecks, journald and resource
  limits would work / − a process of the agent's that outlives every run, which the sandbox
  forbids, and the box's kill would stop it each turn)

For compose:
- **podman-compose (chosen):** from Ubuntu, no daemon, `docker compose` calls it through
  `podman compose`. (− not all of the Compose spec)
- **docker-compose v2 over Podman's API socket:** fuller Compose, but a socket service per agent
  turn. The fallback, if real compose files need it often.

For where a slot's containers live:
- **Per slot, paths that never change (chosen):** images cached across runs; containers, volumes and
  networks per run.
- **Per run:** the simplest clean-up, but every run pulls every image again (slow on a Pi, and
  Docker Hub's limit).
- **One store for all slots:** one copy of each image, but a store that two agents share breaks the
  wall between slots. A shared read-only store, filled by the runner, is a later step if the disk
  needs it.

## Decision

Chosen **A**, with podman-compose and a store per slot, because it is the only option that adds
containers without a daemon, a root process or a new key, keeps every wall between users, and is
the same on every box.

### 1. What box setup 8 adds

In a step of its own that never fails the setup, like the tools step (setup 7):
- **Ubuntu's normal updates first:** when the box's apt sources lack `<codename>-updates` (homepi
  does), setup adds it in a file of its own (`/etc/apt/sources.list.d/shipify-updates.sources`,
  the same address and parts as the box's Ubuntu source). Podman's fix for stopping containers is
  only there. Automatic updates stay security-only, as today.
- **Packages,** `--no-install-recommends`: `podman`, `podman-docker` (the `docker` command),
  `podman-compose`, `uidmap` (the ID ranges), `slirp4netns` (Podman 4.9's network for rootless
  containers), `catatonit` (the pause process), `netavark` and `aardvark-dns` (the names between a
  compose file's services).
- **An ID range for each agent:** 65,536 user and group IDs. A new agent gets one from shadow itself
  (`useradd --add-subids-for-system`); an agent that already exists gets the next free one
  (`usermod --add-subuids … --add-subgids …`, after the highest range in use). No range overlaps
  another or any real user or group. When a slot goes, setup removes its agent's range
  (`usermod --del-subuids … --del-subgids …`), then its user.
- **Settings for the agents' users alone,** in `/etc/containers/shipify-agents.conf` (root's, read by
  all), so your own Podman keeps its defaults: the group manager `cgroupfs`, and logs and events to
  files (`log_driver="k8s-file"`, `events_logger="file"`), since there is no systemd user manager
  and `docker logs` must work; `podman-compose` as the only compose provider, and no message each
  time compose runs. The runner names that file in each agent command
  (`CONTAINERS_CONF_OVERRIDE`, section 2).
- **Docker's habits:** a short image name (`postgres`) means Docker Hub's, as with Docker
  (`/etc/containers/registries.conf.d/50-shipify.conf`), and `/etc/containers/nodocker`, which
  quiets podman-docker's notice.
- **Nothing for root:** Ubuntu's package turns on and starts the system's `podman.socket`, a root
  API socket (`/run/podman/podman.sock`, 0660, group root), and podman-docker links
  `/run/docker.sock` to it. No agent can reach it, but nothing needs it: setup turns off and stops
  `podman.socket`, `podman.service` and `podman-auto-update.timer`, so no root Podman runs. There
  is no `docker` group.
- **A box in Docker (ADR 0056) skips the step,** and says so: a container can't make containers
  without privileges.

### 2. Where a slot's containers live

Podman records its paths at its first use and reuses them silently (checked above), so they must be
the same at every run. But a run's HOME is new each time, and today's `XDG_DATA_HOME` is a link
inside it. So the runner gives each agent command three names:
- `XDG_DATA_HOME=/srv/shipify-agent-<k>/data`: the slot's kept folder, by its real path. It is the
  same folder as today's `~/.local/share` link, so other tools see no change. Podman's store is in
  `data/containers/storage`: images, and each container's own layer.
- `XDG_RUNTIME_DIR=/srv/shipify-agent-<k>/runtime` (0700, the agent's): Podman's state while it
  runs, which it wants wiped at each restart. The next run start empties it, so to Podman each run
  starts as after a restart.
- `CONTAINERS_CONF_OVERRIDE=/etc/containers/shipify-agents.conf`: the agents' settings (section 1).

A pull's temp files go in the run's own `tmp/` (`TMPDIR`), so they go with the run.

The weekly trim of `data/` (files unread for 30 days) skips `data/containers`: deleting files
inside a store would break its images. Podman prunes it instead (section 4).

### 3. Gone with the run

- **The turn's end:** `killAll` (`kill -KILL -1` as the agent) reaches the container processes: the
  agent owns their user namespace, so it may signal them (the kernel's rule; the setup's check
  proves it). Its "nothing left" check then looks at the agent's ID range too, not only its user,
  with the same one read of the process list.
- **The next run's start** (`prepareRun`), only when `runtime/` isn't empty: empty it (through
  `podman unshare` when plain `rm` can't), then, as the agent, `podman system prune --force
  --volumes`. It removes every container, pod, volume and network of the last run, and keeps the
  images. One Podman call, and none at all on a slot whose last run used no container.
- **A run folder with files under a container's IDs** (a bind mount): plain `rm` can't remove
  them. `cleanRuns` then removes what is left through `podman unshare rm -rf`, where the agent is
  root over its own range.
- **Nothing else outlives a turn.** To keep something running for days, run it yourself on the box
  (your own user's Podman); a `lab` repo for that is a later step.

### 4. The weekly clean-up

For each slot whose store exists, as its agent: `podman system prune --all --force --volumes`, then
`podman system prune --external --force`. The first removes every image, since no container
outlives a run; the second removes what an unclean stop (a power cut) left in the store. So a slot's
store holds at most a week of images. The first run after it pulls again.

### 5. The sandbox check

- **At setup, each slot:** its agent's range works (`podman unshare cat /proc/self/uid_map`).
- **At setup, one slot, the whole way, with a run's names:** pull a small image, run it, start one
  detached (as a user of the image's own, so a process runs under the agent's range), read its
  group (the slot's), kill the agent's processes as the box does, and find no process of the agent
  or its range left; then empty `runtime/` and prune, as a run start does, and nothing is left; and
  a folder that container wrote under its own user goes through `cleanRuns`.
- **A new wall, at setup and in `ship doctor`:** no agent can write to a root container socket
  (`/run/docker.sock`, `/run/podman/podman.sock`).
- The wall lines decide the `sandbox` label, as every wall does. The rest (a pull, a run) only
  reports: a box whose check can't pull still works, and says why.

### 6. What agents are told

One line in the playbook (`playbooks/task.md`, How to work): containers work on a box (`docker run`,
`docker compose`), they stop when the turn ends, publish ports on `127.0.0.1`, a short name is
Docker Hub's, name compose services plainly (`db`, `app`), healthchecks don't run (wait in your
own command until a service answers), and for a bind mount, files a container's own user writes
may not be yours (use a named volume, or `--userns=keep-id`).

## Security: the one limit set aside

- **What changes:** an agent that runs Podman is root inside a user namespace of its own. There it
  can mount file systems, make network namespaces and set firewall rules in them. That reaches more
  of the kernel's code. A kernel bug there could give an agent the box: several local root bugs of
  recent years needed exactly this.
- **But it isn't a new reach:** an agent can already do this today, through `aa-exec` and one of
  Ubuntu's own profiles (checked on homepi, above). Ubuntu's limit slows an attacker; it was never a
  wall Shipify counted on (security.md lists none). Podman makes the same reach the normal way, with
  a range of IDs per agent and a check on every box.
- **What stays:** every other wall. The agent's files and folders are its user's and its range's.
  It can't read the runner's home, its jobs, its environment or another slot's runs, and it can't
  read its own memory from a command. No socket and no group gives it root. A container gets no key
  that the agent doesn't pass it, and the agent holds only read-only keys.
- **What defends it:** the kernel's security updates, which every box installs each day, with a
  restart at 04:30 when one needs it (box setup).
- **Stronger, later, if needed:** gVisor as the runtime (E), or a VM per run (D).
- **The owner's merge of this ADR accepts this trade.**

## Edge cases

| Case | What happens |
|---|---|
| A container still runs when the turn ends | it is killed with the agent's processes; its record goes at the slot's next run |
| A run in a stay (ADR 0057) | each turn ends with the kill, so containers don't carry over between turns: start what a turn needs in that turn |
| The box loses power during a run | `runtime/` is stale; the next run start empties it and prunes, as after any kill |
| A container writes into the run folder under its own IDs | `cleanRuns` removes them through `podman unshare`; a file the runner should take back goes into `out/` as the agent's (`cp`) |
| Docker Hub's limit (100 pulls in 6 hours per address) | a slot pulls an image once a week; past the limit, the pull fails with Docker Hub's words, and the reply says so. A login or a mirror is a later step |
| A container uses too much memory | as a heavy test does today: zram slows things down, the kernel's out-of-memory killer stops the biggest process, and `ship doctor` shows the slot's peak and the kill (ADR 0061) |
| Images fill the disk | the weekly clean-up removes each slot's images; before then, `ship doctor`'s 5 GB floor names it |
| A box without Ubuntu's normal updates (`noble-updates`) | setup adds them, so Podman can stop containers (LP #2040483); a box that has them is left as it is |
| The packages don't install (no universe) | the step says so; the box works without containers; an agent's `docker` is "not found", and it says so |
| A wall line fails (a process survives the kill; an agent reaches a root socket) | no `sandbox` label until it is fixed, as for any wall |
| A pull or a run fails at setup (no network) | reported; the box keeps its label; the next `box add` checks again |
| A box in Docker (ADR 0056) | skipped: no containers there |
| WSL (this PC) | the same setup; not tried there. The check says whether it works |
| A compose file that waits for a healthy service (`depends_on: condition: service_healthy`) | podman-compose 1.0.6 drops the condition, and healthchecks don't run without a systemd user manager, so it starts the next service at once. The playbook line says: wait in your own command (retry until the port answers) |
| A container with its own memory limit (`--memory`) | may be refused with no delegated group (not confirmed); run it without one: the slot's memory covers it |
| Podman's notice "Failed to add pause process to systemd sandbox cgroup" | expected on a box with no user session (from Podman's source); harmless. The agents' settings quiet the rest |
| Two slots need the same image | each pulls its own copy: a store per slot keeps the wall between slots |
| Your own Podman on the box | works as before, as your user, with your own range and settings |
| A compose file that podman-compose doesn't run | the agent says which part failed; the fallback design is docker-compose v2 over Podman's socket |
| A slot removed | its user, its range and its folder (its store too) go, as in setup 5 |
| A compose service named like a machine on the box's search domains (Tailscale's, for one) | netavark 1.4's DNS issue (CVE-2025-8283) may send it to that machine; the playbook line says to name services plainly (`db`, `app`) |
| A `docker` command a project's scripts call with Docker-only options | most map to Podman's; the agent says which one didn't |

## Setup

Nothing new to set up: `box add` again (it is safe to run again), from an up-to-date shipify folder
on your PC.

```sh
git checkout main && git pull
pnpm ship box add <the box's SSH address> --manage --yes
```

It says "Containers: done" and then "Checking the sandbox … done". A new box (the laptop) gets it on
its first `box add`, with no extra step.

## Docs and clean-up

The build updates, in the same PR:
- `box/setup.sh` (setup 8), `cli/lib/sandbox.ts` (the three names, the run-start prune, `cleanRuns`'
  fallback, `killAll`'s range, the weekly prune and the trim's skip), `cli/commands/doctor.ts` (the
  socket wall), `cli/commands/watch.ts` if the weekly clean-up needs it, and their tests.
- `docs/box-setup.md`: the agent's own user (containers, its range, its store), "Taking Shipify off
  a machine" (the Podman packages, the agents' ranges, `/etc/containers/shipify-agents.conf` and
  the registries file; Ubuntu's normal updates stay), and what a box installs.
- `docs/security.md`: the sandbox (the limit set aside, the socket wall), "What a box keeps
  between runs" (a week of images per slot), and "Left for later".
- `docs/agents.md` (on a box: containers), `playbooks/task.md` (the one line), `docs/glossary.md`
  (the lab), `docs/troubleshooting.md` (a container that won't start: `podman info` as the agent),
  `docs/roadmap.md` (the later steps below), `AGENTS.md` (the box row names containers),
  `CHANGELOG.md`, and this ADR's row in `docs/adr/README.md`.
- Nothing is removed. `lab-plan.md` (the task's file) is replaced by this ADR.

Later steps, for the roadmap, each only if you ask: a `lab` repo for experiments that keep running;
the agents' firewall, which then covers containers too; a shared read-only image store; a registry
login or a mirror; gVisor or a VM per run; a tool that reaches homelab.

## Consequences

- **Easier:** tests that need a database or a service run on the box, before the PR, not only in
  CI. An agent can try a repo with its services, or a theory, and leave nothing behind.
- **Harder:** the kernel's namespace code is now an agent's normal path, not only a way past a
  limit, so its updates matter more; one more store per slot to keep small; and one Podman call at
  the start of a run after one that used containers.

## Confirmation

- `box add`'s check, on every box, and `ship doctor`'s socket wall in each weekly clean-up.
- Tests: setup 8 installs the exact list with `--no-install-recommends`, never Docker Engine, the
  `docker` group or a socket; every agent command gets the three names; `killAll` checks the range;
  `cleanRuns` falls back to `podman unshare`; the run-start prune runs only when `runtime/` has
  something; the weekly trim skips `data/containers`.

## Build

1. The owner merges this ADR, then says `go` on task #555.
2. One PR: box setup 8, the sandbox's changes, their tests and the docs above.
3. After its merge, before the laptop: `box add` on homepi again, then a task that runs a compose
   file with two services (a database and a client that reaches it by name). Then the laptop.

## As built (2026-10-24)

One PR, as decided, with these details found while building:

- **The run start empties `runtime/` twice when it prunes.** The prune itself writes Podman's
  state into `runtime/` and starts its pause process, so every later run would prune again. So the
  run start (`fresh` in `cli/lib/sandbox.ts`) empties `runtime/` when it holds anything, prunes
  only when Podman's own state was there (`runtime/libpod`: a tool's socket there costs no Podman
  call), then stops the pause process (`kill -KILL -1` as the agent) and empties `runtime/` again.
  The runner then checks, as before any run, that nothing of the agent's or its range's is left.
  A run that used no container leaves `runtime/` empty: no Podman call at the next start.
- **`podman unshare` for `runtime/` too:** what plain rm can't remove there goes the same way as in
  a run folder, and the pause process that starts is stopped.
- **The weekly prune runs only while no other slot is busy,** with the tools' tidy, so it never
  removes what a run in flight uses. It empties `runtime/` first, as a run start does.
- **Never a package removed:** the install has `--no-remove`, and a machine with a `docker` of its
  own (Docker Engine) gets no podman-docker, which would conflict with it. Agents use `podman`
  there.
- **The ranges:** a new agent's from shadow (`useradd --add-subids-for-system`); one that exists
  gets the next free range past every range in `/etc/subuid` and `/etc/subgid`, so its user and
  group IDs are the same numbers. A slot that goes drops its ranges (`usermod --del-subuids
  0-4294967294 …`), then its user.
- **The group check at setup** compares the container's group with its agent's own: setup runs
  outside the slot's service, so "the slot's group" holds in a run when the container stays in its
  agent's group. Like the pull and the range, it only reports.
- **The socket wall** is one probe per slot in `ship doctor`, and `test -w` per slot at setup: the
  `docker` group counts, as it opens Docker's socket.
- **Not proved on a box yet:** this box has no Podman and no sudo. Unit tests cover the shell's
  words and run the reset and the removal for real as one user; the first `box add` on homepi is
  the proof (step 3).
