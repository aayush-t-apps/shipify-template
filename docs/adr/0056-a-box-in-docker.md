---
status: accepted (merged #408) and built, simpler in two places: the image holds the runner's libraries but not its program (registering downloads it, as on any box: 1.5 GB instead of 2.5 GB), and the runner updates itself as on every box, so nothing copies it from a new image; the weekly clean-up's Node goes to the runners' tool cache, unchanged in a container
date: 2026-10-15
amends: 0055 (a box from one command: a container too), 0047 (each release also publishes the box's image)
---

# 0056: A box in Docker

## The plan in short

**What:**
- Each release also publishes one image, `ghcr.io/<owner>/shipify-box`, for x64 and arm64. It
  holds the same machine a box is (ADR 0031), set up once, at that release.
- Any machine that runs Docker becomes a box with two commands. That covers a Linux server, a
  NAS, a Raspberry Pi, a VPS, and a Mac or Windows PC with Docker Desktop when its kernel allows
  the sandbox.
  - **Once, to register it:** you approve a GitHub code on your phone, as with `here.sh`.
  - **Then, to run it:** it starts by itself after every reboot and asks nothing.

**Why:** the owner, 2026-10-15: "docker is worth doing … general support vm on ubuntu but docker
can make it flexible for anything to make it work on any platform and run cleanly with lowest
overhead and efficiency simplest setup", "keep the same env".

## What was found (checked 2026-10-15, `main` at `a0973d5`)

| Fact | How it was checked |
|---|---|
| A box is one script, `box/setup.sh`. Its installs (system packages, Node 22, what each stack needs, the user `shipify`, the agents' users and the one sudo rule, the runner) are separate from what needs a machine of its own (SSH, automatic updates, systemd services) and from registering (tokens, then the sandbox check) | its sections |
| No container mode exists yet: a comment in `box.ts` says a container would run the slot's `runsvc.sh` as its main process | `cli/commands/box.ts` |
| The sandbox stands on Linux users, one sudo rule, `/bin/sh` being dash, and the kernel's `ptrace_scope` 1. Inside a container the first three are the image's, and the last is the host kernel's | `setup.sh`'s check, `docs/box-setup.md` |
| `here.sh` already does the approval, your copy's checks and the clean-up, and runs your copy's own `box add` | ADR 0055, `box/here.sh` |
| GitHub's container registry is free for public images, and a public repo's Actions (x64 and arm64 machines) are free | GitHub's docs |

## Decisions

### 1. One image, built from `setup.sh`

- **`box/Dockerfile`** starts from `ubuntu:24.04` and runs `setup.sh` with `SHIPIFY_IMAGE=1`.
  That installs everything it installs on a Pi, and skips SSH, automatic updates, registering
  and services. One script, so a container is the same box as a Pi.
- **Small and lean:**
  - no OS init and no systemd: a tiny init (`tini`) runs the slots;
  - the browsers' system libraries, but not the browsers, which a project's tests fetch to the
    tool cache;
  - its size is measured in the build and said in the docs.
- **Built by the template's release** (`ci.yml`, next to `here.sh`): one job per architecture, on
  GitHub's own x64 and arm64 machines, then one tag for both. Tags are `:<version>` and
  `:latest`.
- **Only where it's public:** a private copy's CI never builds it, so it spends none of your
  minutes.
- **It holds no key and no one's data,** like the template.

### 2. Register once, then run

```sh
# Once: register this machine as a box (your phone approves; your copy's own `box add` runs)
docker run -it --rm -v shipify-box:/home/shipify ghcr.io/<owner>/shipify-box register

# Then: run it, now and after every reboot
docker run -d --name shipify-box --restart unless-stopped -v shipify-box:/home/shipify \
  ghcr.io/<owner>/shipify-box
```

- **`register`** runs `here.sh` in the container with `--container`.
  - It asks the approval, your copy, the name and the slots, as `here.sh` does.
  - Your copy's `box add --container` registers the slots and runs the sandbox check, with no
    services.
  - It logs out and keeps no login. The volume keeps only the runners' registration, as a box's
    `/home/shipify` does.
- **The default command runs the slots:**
  - each slot's `runsvc.sh`, as the user `shipify`, restarted if it stops;
  - on `docker stop`, each runner is asked to cancel its job and stop, as systemd asks it on a box.
  - Unregistered, it says to run `register` first and exits once, so `--restart` doesn't loop.
- **`compose.yml`** in the template does the same: `docker compose run --rm box register` once,
  then `docker compose up -d`.
- **`remove`** (`docker run -it --rm -v shipify-box:/home/shipify … remove`) unregisters the
  slots. Then `docker volume rm shipify-box`.

### 3. Updates: the image, never the box in place

- A new release is a new image: `docker pull`, then start it again on the same volume, or
  `docker compose pull && docker compose up -d`. The registration stays.
- **The runner's program comes from the image.** At start, a slot whose runner program is older
  than the image's takes the image's, and keeps its registration.
- **The weekly clean-up** still clears old runs and runs doctor. In a container it leaves Node as
  it is, since the image is how it updates, and says so.
- `ship doctor` (and so the weekly clean-up) names a box behind the newest image, as it names one
  set up by an older `setup.sh`.

### 4. The walls stay where they are

- **Never `--privileged`, never the Docker socket:** either would give a task the host. Nothing
  in the commands or `compose.yml` adds a capability.
- **The sandbox, inside:** each slot's agent is its own user, as on a Pi. The check at `register`
  proves it. If the host's kernel doesn't allow it (some Docker Desktop setups), it says so plainly.
  The slots get no `sandbox` label and take no tasks, since running them unwalled isn't offered.
- **The host's memory:** a container sees the host's, so `register` reads its own limit
  (`--memory`, from its cgroup) to fit the slots, or takes `--slots`.

## Edge cases

| Case | What happens |
|---|---|
| `register` with no terminal | stops: it needs your approval |
| Run before `register` | says "register first", with the command, and exits once |
| Two containers on one volume | the second stops: a lock in the volume |
| The volume deleted | the box is gone. `register` again; the old name is taken, so it asks to replace it |
| A host restart | `--restart unless-stopped` starts it again; a job it cut short is Stopped, as on any box (`continue`) |
| Docker Desktop on a Mac or PC | runs if its kernel allows the sandbox; if not, `register` says so and the slots take no tasks |
| Podman | likely works the same, but isn't promised or tested |
| A 32-bit host | no image: x64 and arm64 only, as every box |
| An old image | doctor names the newer one; `docker pull` and start it again |

## What this touches

- **New:**
  - `box/Dockerfile`, `box/container.sh` (the slots, `register` and `remove`);
  - `compose.yml`;
  - `setup.sh`'s `SHIPIFY_IMAGE=1`;
  - `box add --container` and `here.sh --container`;
  - the release's image job;
  - tests: the Dockerfile and `compose.yml` hold to section 4, `container.sh`'s signals and exits,
    and the image is built and checked once in CI (doctor inside it).
- **Docs:** `docs/box-setup.md` ("With Docker"), `docs/security.md`, `docs/troubleshooting.md`,
  `docs/releases.md` (the image), `README.md`, `AGENTS.md`, `CHANGELOG.md`.

## What you do

1. Merge this ADR.
2. Merge the build PR. It ships as Shipify 0.1.7, with the MIT licence.
3. Release (`pnpm ship template --yes`). The template's CI publishes the image.
4. Once, after the first image: if GitHub made the package private, set it public (the template
   → Packages → `shipify-box` → Package settings → Visibility).
5. The live test, on any machine with Docker: `register` and approve on your phone, then run it.
   Check:
   - `/ping` shows the box;
   - a task runs on it;
   - `docker stop` lets its job end cleanly;
   - `remove` takes it away.
