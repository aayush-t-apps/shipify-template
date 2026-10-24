#!/usr/bin/env bash
# Shipify box setup (docs/box-setup.md): makes an Ubuntu LTS machine (24.04 on, which `box add`
# checks first) a box that runs tasks.
# `pnpm ship box add <user@host>` copies this here and runs it with sudo. Safe to run again.
#   $1  a file with RUNNER_URL, RUNNER_NAME, RUNNER_LABELS, RUNNER_SLOTS and RUNNER_TOKENS (one
#       registration token per slot), deleted once read
#   $2  the stacks' doctor checks, one per line: name<TAB>check<TAB>fix (fixes run as root)
#   $3  the slots' systemd unit, rendered by `ship box add` (the same definition as every box's),
#       with @SLOT_NAME@ and @SLOT_DIR@ for each slot's
# What it installs: git, make, gh, Node 22 (pnpm through corepack), shellcheck, fd and sqlite3, the
# updates waiting now and automatic security updates (gh's and Tailscale's too, rebooting at 04:30
# when one needs it, never restarting a slot), no sleep, what each stack needs, the user "shipify" (no sudo)
# and the box's slots as that user's services (ADR 0020): one GitHub runner each, all labelled
# shipify-box and box-<name>, each running what the queue hands it, one task at a time (ADR 0019).
# The sandbox (setup 5, ADR 0031): each slot's agent runs as a user of its own, shipify-agent-<k>,
# which can't read the runner's home (0700), what its services write (UMask=0077), or another
# slot's runs (/srv/shipify-agent-<k>); one sudo rule lets the runner run commands as them, and
# as no one else.
# The lab (setup 8, ADR 0064): containers for each slot's agent, rootless Podman as its own user,
# with a range of IDs of its own, `docker` and `docker compose`; no Docker Engine, no root daemon,
# no docker group and no socket.
# Setup 9: the agents (and their containers) reach the internet, never a private network (your
# home network, the tailnet); it waits out Ubuntu's own updates after a first boot, finishes an
# install a cut-off run left, and registers again a slot GitHub deleted; the updates waiting now
# come once the slots are registered, and --manage once the sandbox checks out.
# A check at the end proves it; `ship box add` then labels the slots `sandbox`, for run jobs.
# Running it again updates Node to the newest 22.x, and adds or removes slots to match
# RUNNER_SLOTS.
# SSH takes keys only, never passwords, once the account running this has a key; with
# SHIPIFY_HERE=1 (`box add` with no target: the PC you run it from) SSH stays as it is, and so do
# its power settings unless SHIPIFY_MANAGE=1. With SHIPIFY_MANAGE=1 in the settings file
# (`box add --manage`, over SSH or on the machine itself): it never sleeps, Tailscale, Cockpit
# reachable only through it, and a firewall that lets in only Tailscale and SSH from this
# machine's own network.
# In Docker (ADR 0056): SHIPIFY_IMAGE=1 builds the image (box/Dockerfile): the installs alone, with
# no settings file, then stops. SHIPIFY_CONTAINER=1 (`box add --container`, at `register`) skips
# the installs the image has, SSH, the OS's updates (a new image is the update) and the services
# (box/container.sh runs the slots), and does the rest: the users, the sudo rule, the runners and
# the sandbox check.
set -euo pipefail

# What this script gives a box. Bump it when a change here should reach boxes already set up:
# `ship doctor` (and so the weekly clean-up, on the status issue) names a box set up by an older
# one, and running `ship box add` again brings it up to date (ADR 0017).
SETUP_VERSION=9

[ "$(id -u)" = 0 ] || { echo "Run it with sudo."; exit 1; }
export NPM_CONFIG_UPDATE_NOTIFIER=false
IMAGE=${SHIPIFY_IMAGE:-}
ENV_FILE=${1:-}
PREP=${2:-}
UNIT_FILE=${3:-}
if [ -z "$IMAGE" ]; then
  [ -n "$ENV_FILE" ] || { echo "Usage: setup.sh <settings> [<prep>] [<unit>] (pnpm ship box add runs it)."; exit 1; }
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  rm -f "$ENV_FILE"
fi
CONTAINER=${SHIPIFY_CONTAINER:-}
command -v apt-get >/dev/null || { echo "This needs Debian or Ubuntu (apt)."; exit 1; }
case "$(uname -m)" in
  x86_64) ARCH=x64 ;;
  aarch64) ARCH=arm64 ;;
  *) echo "A box needs a 64-bit OS (x86_64 or aarch64), not $(uname -m)."; exit 1 ;;
esac
say() { printf '\n== %s\n' "$*"; }
# This run's own temporary folder, only root's, gone when it ends: nothing goes to a shared /tmp
# name that another user (an agent's) could have made first.
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
export DEBIAN_FRONTEND=noninteractive
# Right after a first boot, Ubuntu's own daily updates hold apt's lock for minutes. Every apt here
# waits for them (up to 20 minutes) instead of failing, and so does each apt in what this runs (a
# stack's fix, the runner's dependencies, Tailscale's installer): apt reads the file APT_CONFIG
# names, then its own. Every download the same way: tried again, and stopped when it stalls (curl
# reads CURL_HOME's .curlrc).
printf 'DPkg::Lock::Timeout "1200";\n' > "$WORK/apt.conf"
export APT_CONFIG="$WORK/apt.conf"
printf '%s\n' "retry = 3" "retry-delay = 5" "connect-timeout = 30" "speed-limit = 1000" "speed-time = 60" > "$WORK/.curlrc"
export CURL_HOME="$WORK"
apt_get() { apt-get "$@"; }
# apt_update: apt's lists. apt-get update doesn't wait for their lock by itself: tried again while
# another apt holds it, for up to 10 minutes.
apt_update() {
  local i
  for i in $(seq 1 20); do
    apt_get update -q && return 0
    [ "$i" = 20 ] || { echo "  apt's lists didn't update (another apt may hold them): again in 30 seconds"; sleep 30; }
  done
  return 1
}

if [ -z "$CONTAINER" ]; then
say "System packages"
# A run cut off mid-install (Ctrl-C, a lost session) leaves dpkg half done, and apt refuses until
# that's finished: finished first, so running this again always works.
if [ -n "$(dpkg --audit 2>/dev/null)" ]; then
  echo "  finishing what a run cut off left half installed (dpkg --configure -a)"
  dpkg --configure -a || true
fi
apt_update
apt_get install -y -q git make curl ca-certificates tar xz-utils build-essential jq unattended-upgrades tmux sudo procps
# The image's init: it runs the slots and passes docker stop on to them (box/container.sh).
[ -z "$IMAGE" ] || apt_get install -y -q tini
if ! command -v gh >/dev/null; then
  install -d -m 755 /etc/apt/keyrings
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
  chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list
  apt_update
  apt_get install -y -q gh
fi

# Tools an agent reaches for (setup 7). shellcheck and fd come from Ubuntu's universe, which a
# trimmed install may leave off: the box works without them, so they never fail the setup.
say "shellcheck, fd and sqlite3"
if apt_get install -y -q shellcheck fd-find sqlite3; then
  # Ubuntu names fd's program fdfind: `fd` for every user too, unless the machine has one.
  if [ -x /usr/bin/fdfind ] && ! command -v fd >/dev/null; then ln -sf /usr/bin/fdfind /usr/local/bin/fd; fi
  echo "  done"
else
  echo "  skipped: shellcheck, fd and sqlite3 didn't install (shellcheck and fd need Ubuntu's universe: sudo add-apt-repository universe, then box add again)"
fi

say "Node 22 (the newest 22.x) and pnpm"
base=https://nodejs.org/dist/latest-v22.x
file=$(curl -fsSL "$base/SHASUMS256.txt" | grep -oE "node-v22\.[0-9.]+-linux-${ARCH}\.tar\.xz" | head -n 1)
want=${file#node-}
want=${want%%-linux-*}
if [ "$(node --version 2>/dev/null || true)" != "$want" ]; then
  curl -fsSL -o "$WORK/$file" "$base/$file"
  (cd "$WORK" && curl -fsSL "$base/SHASUMS256.txt" | grep " $file\$" | sha256sum -c -)
  rm -rf /opt/node && mkdir -p /opt/node
  tar -xJf "$WORK/$file" -C /opt/node --strip-components 1
  rm -f "$WORK/$file"
  for b in node npm npx corepack; do ln -sf "/opt/node/bin/$b" "/usr/local/bin/$b"; done
fi
corepack enable --install-directory /usr/local/bin
node --version
fi

if [ -z "$IMAGE$CONTAINER" ]; then
say "Automatic security updates"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
# gh and Tailscale come from their own apt sources, which Ubuntu's updates leave out, and Cockpit
# (--manage) from Ubuntu's backports: only what's installed from there takes its updates. Kernel
# fixes need a restart: at 04:30, only when an update asks for one. A task running then shows
# failed; comment "continue" on it.
cat > /etc/apt/apt.conf.d/52shipify-updates <<'CONF'
Unattended-Upgrade::Origins-Pattern { "origin=gh"; "origin=Tailscale"; "origin=Ubuntu,archive=${distro_codename}-backports"; };
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
CONF
echo "  on: security updates every day, restarting at 04:30 when one needs it (the updates waiting now come once the slots are registered)"

# After an update, needrestart restarts the services whose libraries changed (Ubuntu's apt hook,
# in its automatic mode). Never a slot's: that would stop its task. A slot takes a new library at
# its next start (box add again, or the restart at 04:30 a kernel update brings).
say "Updates leave the slots running"
install -d -m 755 /etc/needrestart/conf.d
printf '%s\n' "# Written by Shipify box setup (docs/box-setup.md): an update never restarts a slot mid-task." \
  '$nrconf{override_rc}{qr(^shipify-box-)} = 0;' > /etc/needrestart/conf.d/50-shipify-box.conf
echo "  done: needrestart leaves shipify-box-* as they are"

# A box never sleeps: the same on every machine, so a laptop with its lid closed is a box like a Pi
# or a VPS, where nothing changes. The lid does nothing, and the sleep states are masked, so no
# lid, key or idle timer stops a task. logind takes the setting on a reload, which keeps every
# session. This PC keeps its own, as it keeps its SSH, unless it's set up with --manage: then it's
# a box you keep, the same as one set up over SSH.
say "Never sleeps"
LOGIND_DROPIN=/etc/systemd/logind.conf.d/50-shipify-box.conf
if [ "${SHIPIFY_HERE:-}" = 1 ] && [ "${SHIPIFY_MANAGE:-}" != 1 ]; then
  echo "  skipped: this is the PC you set it up from (no --manage), so its power settings stay as they are"
elif [ ! -d /run/systemd/system ]; then
  echo "  skipped: systemd isn't running here"
else
  printf '%s\n' "# Written by Shipify box setup (docs/box-setup.md): a box never sleeps." \
    "[Login]" "HandleLidSwitch=ignore" "HandleLidSwitchExternalPower=ignore" "HandleLidSwitchDocked=ignore" > "$WORK/logind.conf"
  if ! cmp -s "$WORK/logind.conf" "$LOGIND_DROPIN"; then
    install -D -m 644 "$WORK/logind.conf" "$LOGIND_DROPIN"
    systemctl reload systemd-logind 2>/dev/null || echo "  logind takes the lid setting at the next restart"
  fi
  if systemctl mask -q sleep.target suspend.target hibernate.target hybrid-sleep.target suspend-then-hibernate.target; then
    echo "  done: the lid does nothing, and sleep is off"
  else
    echo "  the lid does nothing, but sleep isn't off (systemctl mask failed, above); the box works as before"
  fi
fi
fi

# Swap in memory, compressed (ADR 0061): when tasks overlap and memory runs short, they slow down
# instead of being killed. Only where there's no swap of its own (WSL and a VPS with a swap file
# keep theirs), never a swap file on the disk, and never a reason for the setup to fail.
if [ -z "$IMAGE$CONTAINER" ]; then
say "Swap in memory (zram)"
ZRAM_CONF=/etc/systemd/zram-generator.conf
ZRAM_SYSCTL=/etc/sysctl.d/90-shipify-zram.conf
other=$(swapon --show=NAME --noheadings 2>/dev/null | grep -v '^/dev/zram' || true)
# Ubuntu's installer puts a swap file on the disk (a laptop's, a PC's): a box you keep gets swap in
# memory instead, as a Pi does, once the file is off (a fresh install holds next to nothing in it).
# This PC without --manage keeps its own, as it keeps its power settings.
if [ "$other" = /swap.img ] && ! { [ "${SHIPIFY_HERE:-}" = 1 ] && [ "${SHIPIFY_MANAGE:-}" != 1 ]; } &&
  swapoff /swap.img 2>/dev/null; then
  sed -i '\|^/swap\.img[[:space:]]|d' /etc/fstab
  rm -f /swap.img
  echo "  the installer's swap file on the disk (/swap.img) is off and gone"
  other=""
fi
if [ -n "$other" ]; then
  echo "  skipped: this box has swap of its own ($(echo "$other" | tr '\n' ' ' | sed 's/ $//'))"
elif [ ! -d /run/systemd/system ]; then
  echo "  skipped: systemd isn't running here"
elif ! modinfo zram >/dev/null 2>&1; then
  echo "  skipped: this kernel has no zram; tasks that overlap may be killed when memory runs short (fewer slots, or swap, fixes it)"
elif ! apt_get install -y -q systemd-zram-generator >/dev/null 2>&1; then
  echo "  skipped: systemd-zram-generator didn't install (the box works as before)"
else
  printf '%s\n' "# Written by Shipify box setup (docs/box-setup.md, ADR 0061): swap in memory, compressed." \
    "[zram0]" "zram-size = min(ram / 2, 8192)" "compression-algorithm = zstd" > "$WORK/zram.conf"
  printf '%s\n' "# Written by Shipify box setup (docs/box-setup.md, ADR 0061): settings for swap in memory." \
    "vm.swappiness = 180" "vm.page-cluster = 0" > "$ZRAM_SYSCTL"
  sysctl -q -p "$ZRAM_SYSCTL" || true
  if ! cmp -s "$WORK/zram.conf" "$ZRAM_CONF"; then
    install -m 644 "$WORK/zram.conf" "$ZRAM_CONF"
    systemctl daemon-reload
    systemctl restart systemd-zram-setup@zram0.service || true
  fi
  systemctl start systemd-zram-setup@zram0.service || true
  if swapon --show=NAME --noheadings 2>/dev/null | grep -q '^/dev/zram0'; then
    echo "  on: $(swapon --show=SIZE --noheadings /dev/zram0 | tr -d ' ') of swap in memory (zstd)"
  else
    echo "  not on yet: it starts at the next restart"
  fi
fi
fi

if [ -z "$CONTAINER" ]; then
say "What the stacks need"
if [ -n "$PREP" ] && [ -f "$PREP" ]; then
  while IFS=$'\t' read -r name check fix; do
    [ -n "$name" ] || continue
    if bash -c "$check" >/dev/null 2>&1; then
      echo "  ok: $name"
    elif [ -n "$fix" ]; then
      echo "  installing: $name"
      bash -c "$fix"
    else
      echo "  missing, and no fix known: $name"
    fi
  done < "$PREP"
  rm -f "$PREP"
fi
fi

# SSH by key only: no passwords, no root. Only when the account running this (`box add` connects
# with a key) has one, so nobody is locked out, and checked before it's used; if the check fails,
# the change goes and SSH stays as it was.
say "SSH: keys only"
SSHD_DROPIN=/etc/ssh/sshd_config.d/10-shipify.conf
SSHD=$(command -v sshd || echo /usr/sbin/sshd)
keys="/home/${SUDO_USER:-}/.ssh/authorized_keys"
if [ -n "$IMAGE$CONTAINER" ]; then
  echo "  skipped: a container has no SSH of its own"
elif [ "${SHIPIFY_HERE:-}" = 1 ]; then
  echo "  skipped: this is the PC you set it up from, so its SSH stays as it is"
elif [ -z "${SUDO_USER:-}" ] || [ ! -s "$keys" ]; then
  echo "  skipped: no SSH key for ${SUDO_USER:-this account} yet (ship box add sets one up first)"
elif [ -d /etc/ssh/sshd_config.d ] && [ -x "$SSHD" ]; then
  printf '# Written by Shipify box setup (docs/box-setup.md).\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\n' > "$SSHD_DROPIN"
  # Files here are read in order and the first value wins: 10- comes before cloud-init's 50-.
  if "$SSHD" -t 2>/dev/null; then
    systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
    echo "  done: SSH takes keys only"
  else
    rm -f "$SSHD_DROPIN"
    echo "  skipped: sshd didn't accept the change, so SSH is as it was"
  fi
fi

say "The user that runs tasks (no sudo)"
id shipify >/dev/null 2>&1 || useradd --create-home --shell /bin/bash shipify
# Setup 5: the runner's home is its own. Its runners, their jobs' folders (_work), its logins and
# caches are there, and no other user, an agent's included, can read them.
chmod 0700 /home/shipify
RUNNER_HOME=/home/shipify/runner
# Slots (ADR 0020): slot 1 is the runner named after the box, in RUNNER_HOME; slot k is
# <name>-<k>, in RUNNER_HOME/slot-<k>.
RUNNER_SLOTS=${RUNNER_SLOTS:-1}
case "$RUNNER_SLOTS" in [1-9]) ;; *) echo "RUNNER_SLOTS must be 1 to 9, not $RUNNER_SLOTS."; exit 1 ;; esac
slot_home() { if [ "$1" = 1 ]; then echo "$RUNNER_HOME"; else echo "$RUNNER_HOME/slot-$1"; fi; }
# shellcheck disable=SC2153 # RUNNER_NAME and the rest come from the settings file
slot_name() { if [ "$1" = 1 ]; then echo "$RUNNER_NAME"; else echo "$RUNNER_NAME-$1"; fi; }

# The machine's tools, outside the runner's home so an agent can use them, and change none: the
# runners' tool cache (Node, the agent's CLI). The runner's own, read by everyone; what goes in it
# is installed with umask 022 (task.yml), since the runner's services write everything else with
# UMask=0077. A test browser is each slot's agent's own, in its cache (ADR 0041).
TOOL_DIR=/opt/shipify/tool
say "The machine's tools: $TOOL_DIR"
install -d -m 0755 /opt/shipify
install -d -o shipify -g shipify -m 0755 "$TOOL_DIR"
chown shipify:shipify "$TOOL_DIR"
chmod 0755 "$TOOL_DIR"

# The agents' own users (setup 5, ADR 0031): slot k's agent runs as shipify-agent-<k>, a system
# user with no password and no login shell. Its runs go in /srv/shipify-agent-<k>, its own, with
# group shipify and setgid (2710): the runner can pass through to a run's out/ folder, which it
# reads, and no other user can enter. No cron or at jobs: nothing an agent starts outlives its run.
# A new one gets a range of IDs of its own from shadow (setup 8): its containers' users.
AGENT_ROOT=/srv
agent_user() { echo "shipify-agent-$1"; }
say "The agents' users: one per slot, each walled off from the runner and the other slots"
install -d -m 0755 "$AGENT_ROOT"
for k in $(seq 1 "$RUNNER_SLOTS"); do
  u=$(agent_user "$k")
  id "$u" >/dev/null 2>&1 ||
    useradd --system --user-group --no-create-home --add-subids-for-system --home-dir "$AGENT_ROOT/$u" --shell /usr/sbin/nologin "$u"
  # Never in the runner's group: out/ folders are the runner's to read, through that group.
  gpasswd -d "$u" shipify >/dev/null 2>&1 || true
  install -d -o "$u" -g shipify -m 2710 "$AGENT_ROOT/$u"
  chown "$u:shipify" "$AGENT_ROOT/$u"
  chmod 2710 "$AGENT_ROOT/$u"
  for deny in /etc/cron.deny /etc/at.deny; do
    grep -qx "$u" "$deny" 2>/dev/null || echo "$u" >> "$deny"
  done
  echo "  $u: $AGENT_ROOT/$u"
done
# Agents above RUNNER_SLOTS go with their slots: their processes, user and runs.
for dir in "$AGENT_ROOT"/shipify-agent-*; do
  [ -d "$dir" ] || continue
  k=${dir##*/shipify-agent-}
  case "$k" in '' | *[!0-9]*) continue ;; esac
  [ "$k" -gt "$RUNNER_SLOTS" ] || continue
  u=$(agent_user "$k")
  echo "  $u goes, with its slot"
  pkill -KILL -u "$u" 2>/dev/null || true
  # Its ID ranges first (every one it has), then the user.
  usermod --del-subuids 0-4294967294 --del-subgids 0-4294967294 "$u" 2>/dev/null || true
  userdel "$u" 2>/dev/null || true
  rm -rf "$dir"
  for deny in /etc/cron.deny /etc/at.deny; do
    [ ! -f "$deny" ] || sed -i "/^$u\$/d" "$deny"
  done
done

# The lab (setup 8, ADR 0064): containers for each slot's agent. Rootless Podman as the agent's own
# user, in a user namespace it owns, with a range of 65,536 IDs of its own; a `docker` command and
# `docker compose`. No Docker Engine, no root daemon, no docker group and no socket: a container is
# a child of the agent's command, so the box's kill at each turn's end stops it. Never a reason for
# the setup to fail: without it the box works as before, and box add again tries again.
CONTAINERS_CONF=/etc/containers/shipify-agents.conf
# next_ids <files…>: the first ID past every range in them, and at least Ubuntu's SUB_UID_MIN.
next_ids() { awk -F: 'BEGIN { n = 100000 } $2 + $3 > n { n = $2 + $3 } END { print n }' "$@"; }
# ubuntu_suite <suite>: "<address> <part>" for each of Ubuntu's own sources for it (apt's view, so
# either sources format), never another source that names the same suite.
ubuntu_suite() {
  apt-cache policy 2>/dev/null | awk -v want="$1" '
    $2 ~ /:\/\// && index($3, want "/") == 1 { uri = $2; part = substr($3, length(want) + 2); next }
    / release / && /o=Ubuntu,/ && index($0, ",a=" want ",") && uri != "" && !seen[uri " " part]++ { print uri, part }
    { uri = "" }'
}
lab() {
  set -e
  say "Containers for the agents (rootless Podman, with docker and docker compose)"
  local codename uri parts pkgs first u k
  # Ubuntu's normal updates, where the box's sources leave them out (a Pi's image can): Podman's
  # fix for stopping containers is only there (LP #2040483). Automatic updates stay security-only.
  codename=$(. /etc/os-release && echo "${VERSION_CODENAME:-}")
  if [ -n "$codename" ] && [ -z "$(ubuntu_suite "$codename-updates")" ]; then
    uri=$(ubuntu_suite "$codename" | awk 'NR == 1 { print $1 }')
    parts=$(ubuntu_suite "$codename" | awk -v u="$uri" '$1 == u { print $2 }' | paste -sd' ' -)
    if [ -n "$uri" ]; then
      {
        echo "# Written by Shipify box setup (docs/box-setup.md, ADR 0064): Ubuntu's normal updates, which this box's sources left out."
        printf 'Types: deb\nURIs: %s\nSuites: %s-updates\nComponents: %s\n' "$uri" "$codename" "$parts"
        [ ! -f /usr/share/keyrings/ubuntu-archive-keyring.gpg ] || echo "Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg"
      } > /etc/apt/sources.list.d/shipify-updates.sources
      apt_update
      echo "  added Ubuntu's normal updates ($codename-updates), which Podman's fixes come from"
    fi
  fi
  # The exact list, nothing it recommends (podman-docker's is the old docker-compose), and never a
  # package removed. The docker command only where the machine has no docker of its own.
  pkgs="podman podman-compose uidmap slirp4netns catatonit netavark aardvark-dns"
  if dpkg -s podman-docker >/dev/null 2>&1 || ! command -v docker >/dev/null; then pkgs="$pkgs podman-docker"; else
    echo "  this machine has a docker of its own, so it stays: agents use podman, which takes the same commands"
  fi
  # shellcheck disable=SC2086 # the list, word by word
  apt_get install -y -q --no-install-recommends --no-remove $pkgs
  # Each agent's range: one from shadow when it was made (above), else the next free one, so no
  # range overlaps another, nor any user's or group's own ID.
  touch /etc/subuid /etc/subgid
  for k in $(seq 1 "$RUNNER_SLOTS"); do
    u=$(agent_user "$k")
    first=$(next_ids /etc/subuid /etc/subgid)
    grep -q "^$u:" /etc/subuid || usermod --add-subuids "$first-$((first + 65535))" "$u"
    grep -q "^$u:" /etc/subgid || usermod --add-subgids "$first-$((first + 65535))" "$u"
  done
  # Settings for the agents' users alone, which the runner names in each of their commands
  # (CONTAINERS_CONF_OVERRIDE): your own Podman keeps its defaults.
  install -d -m 755 /etc/containers/registries.conf.d
  printf '%s\n' "# Written by Shipify box setup (docs/box-setup.md, ADR 0064): Podman's settings for the agents' users alone." \
    "# They have no systemd user session: the cgroupfs group manager, and logs and events to files (docker logs works)." \
    "[containers]" 'log_driver = "k8s-file"' "" "[engine]" 'cgroup_manager = "cgroupfs"' 'events_logger = "file"' \
    'compose_providers = ["podman-compose"]' "compose_warning_logs = false" > "$CONTAINERS_CONF"
  chmod 644 "$CONTAINERS_CONF"
  # Docker's habits, for everyone here: a short name (postgres) is Docker Hub's, and no notice.
  printf '%s\n' "# Written by Shipify box setup (docs/box-setup.md, ADR 0064): a short image name is Docker Hub's, as with Docker." \
    'unqualified-search-registries = ["docker.io"]' > /etc/containers/registries.conf.d/50-shipify.conf
  touch /etc/containers/nodocker
  # Nothing for root: Ubuntu's package starts a root API socket (podman-docker links /run/docker.sock
  # to it), which nothing here needs.
  systemctl disable --now -q podman.socket podman.service podman-auto-update.timer 2>/dev/null || true
  echo "  done: $(podman --version), docker and docker compose for each slot's agent; no root socket"
}
if [ -n "$IMAGE$CONTAINER" ]; then
  say "Containers for the agents"
  echo "  skipped: a box in Docker makes no containers (that would need privileges, ADR 0056)"
else
  # Not `(lab) || …`: bash ignores set -e inside a function run that way.
  set +e
  (lab)
  labbed=$?
  set -e
  [ "$labbed" = 0 ] || echo "  skipped: the containers didn't install (above); the box works without them, and box add again tries again"
fi

# One sudo rule: the runner (shipify) may run commands as its slots' agents, without a password,
# and as no one else; an agent can't become the runner. sudo starts from no terminal (the runner
# has none), so no pseudo-terminal either. The rule goes in only once visudo accepts it, and comes
# out again if the whole configuration then fails visudo's check, so sudo always keeps working.
say "One sudo rule: the runner starts its slots' agents, and no one else"
SUDOERS=/etc/sudoers.d/shipify-agents
agents=$(for k in $(seq 1 "$RUNNER_SLOTS"); do agent_user "$k"; done | paste -sd, -)
rule="shipify ALL=($agents) NOPASSWD: ALL"
head="# Written by Shipify box setup (docs/box-setup.md): the runner starts the agents of its slots."
printf '%s\nDefaults:shipify !use_pty\n%s\n' "$head" "$rule" > "$WORK/shipify-agents"
if ! visudo -cqf "$WORK/shipify-agents" >/dev/null 2>&1; then
  # A sudo without the use_pty setting (sudo-rs, an old sudo): the rule alone.
  printf '%s\n%s\n' "$head" "$rule" > "$WORK/shipify-agents"
  visudo -cqf "$WORK/shipify-agents" >/dev/null 2>&1 || { echo "visudo refused the rule, so nothing changed."; exit 1; }
fi
install -m 0440 -o root -g root "$WORK/shipify-agents" "$SUDOERS"
if ! visudo -cq >/dev/null 2>&1; then
  rm -f "$SUDOERS"
  echo "sudo's configuration didn't pass visudo's check with the rule, so the rule is out again."
  exit 1
fi
echo "  $rule"

# The newest runner, downloaded once and checked against GitHub's checksum.
TARBALL=""
fetch_runner() {
  [ -n "$TARBALL" ] && return
  # An image's build gives its GitHub token (box/Dockerfile): GitHub's machines share addresses,
  # and a call with none is refused once they've made 60 in the hour. A box's own needs none.
  local auth=()
  [ -r /run/secrets/gh ] && auth=(-H "Authorization: Bearer $(cat /run/secrets/gh)")
  release=$(curl -fsSL "${auth[@]}" https://api.github.com/repos/actions/runner/releases/latest)
  version=$(printf '%s' "$release" | jq -r .tag_name | sed 's/^v//')
  file="actions-runner-linux-${ARCH}-${version}.tar.gz"
  sum=$(printf '%s' "$release" | jq -r --arg f "$file" '.assets[] | select(.name == $f) | .digest' | sed 's/^sha256://')
  if [ -z "$sum" ] || [ "$sum" = null ]; then echo "No checksum for $file."; exit 1; fi
  curl -fsSL -o "$WORK/$file" "https://github.com/actions/runner/releases/download/v${version}/${file}"
  echo "$sum  $WORK/$file" | sha256sum -c -
  TARBALL="$WORK/$file"
}

# The image (ADR 0056) stops here: the runner's libraries in, its program not (registering
# downloads it, as on any box, so the image stays small). The rest is each box's own.
if [ -n "$IMAGE" ]; then
  say "The runner's libraries"
  fetch_runner
  mkdir "$WORK/runner"
  tar -xzf "$TARBALL" -C "$WORK/runner"
  "$WORK/runner/bin/installdependencies.sh" >"$WORK/runner-deps.log" 2>&1 || { tail -n 30 "$WORK/runner-deps.log"; exit 1; }
  rm -rf "$TARBALL" "$WORK/runner"
  apt-get clean
  rm -rf /var/lib/apt/lists/* /root/.npm /root/.cache
  say "The image is ready: register it with docker run … register (docs/box-setup.md)"
  exit 0
fi

# register <folder> <name> <labels> <token>: unpack the runner there and register it, once.
DEPS_DONE=""
register() {
  local home=$1 name=$2 labels=$3 token=$4
  if [ -f "$home/.runner" ]; then
    echo "  $name: already registered"
    return
  fi
  fetch_runner
  install -d -o shipify -g shipify "$home"
  # The tarball is in root's own folder: root opens it, and the runner's user unpacks it.
  # shellcheck disable=SC2024 # the redirect is root's on purpose
  sudo -u shipify tar -xzf - -C "$home" < "$TARBALL"
  # It tries each distribution's package names in turn, so apt prints "Unable to locate" for the
  # ones this system doesn't use: keep that in a log, shown only if it fails.
  if [ -z "$DEPS_DONE" ]; then
    if ! "$home/bin/installdependencies.sh" >"$WORK/runner-deps.log" 2>&1; then
      tail -n 30 "$WORK/runner-deps.log"
      echo "The runner's dependencies didn't install (above)."
      exit 1
    fi
    DEPS_DONE=1
  fi
  [ -n "$token" ] || { echo "No registration token for $name."; exit 1; }
  # The registration token goes through the environment, not the command line.
  (cd "$home" && ACTIONS_RUNNER_INPUT_TOKEN="$token" sudo -u shipify --preserve-env=ACTIONS_RUNNER_INPUT_TOKEN \
    ./config.sh --unattended --url "$RUNNER_URL" --name "$name" --labels "$labels" --work _work --replace)
}

# The slots whose service restarts, each " <folder> ": its .env changed, or it registered again.
RESTART=" "

# registered <k>: GitHub has slot k's runner. RUNNER_REGISTERED lists them (box add reads GitHub);
# without it, a slot registered here counts as GitHub's too.
registered() {
  [ -z "${RUNNER_REGISTERED+set}" ] && return 0
  case " $RUNNER_REGISTERED " in *" $1 "*) return 0 ;; esac
  return 1
}

# slot_env <folder>: what the slot's runner hands its jobs (it reads its folder's .env when it
# starts): the box, the box's folder (the weekly clean-up covers every slot) and the machine's one
# tool cache. The rest of the file is the runner's own.
slot_env() {
  local home=$1 tmp="$WORK/slot.env"
  {
    grep -vE '^$|^(SHIPIFY_BOX|SHIPIFY_BOX_DIR|RUNNER_TOOL_CACHE)=' "$home/.env" 2>/dev/null || true
    echo "SHIPIFY_BOX=$RUNNER_NAME"
    echo "SHIPIFY_BOX_DIR=$RUNNER_HOME"
    echo "RUNNER_TOOL_CACHE=$TOOL_DIR"
  } > "$tmp"
  if ! cmp -s "$tmp" "$home/.env"; then
    install -m 600 -o shipify -g shipify "$tmp" "$home/.env"
    RESTART="$RESTART$home "
  fi
  rm -f "$tmp"
}

say "The GitHub runners: $RUNNER_SLOTS slot(s), one task at a time each"
read -r -a TOKENS <<< "${RUNNER_TOKENS:-}"
for k in $(seq 1 "$RUNNER_SLOTS"); do
  home=$(slot_home "$k")
  # A slot GitHub deleted (box remove, or 14 days off) still has its registration here, which its
  # runner can't use: it goes, and the slot registers again.
  if [ -f "$home/.runner" ] && ! registered "$k"; then
    echo "  $(slot_name "$k"): GitHub no longer has it, so it registers again"
    # Its runner stopped first, so none reads the registration while it's made again.
    [ -n "$CONTAINER" ] || systemctl stop "shipify-box-$(slot_name "$k").service" 2>/dev/null || true
    rm -f "$home/.runner" "$home/.credentials" "$home/.credentials_rsaparams"
    RESTART="$RESTART$home "
  fi
  register "$home" "$(slot_name "$k")" "$RUNNER_LABELS" "${TOKENS[$((k - 1))]:-}"
  slot_env "$home"
done
[ -z "$TARBALL" ] || rm -f "$TARBALL"
unset RUNNER_TOKENS TOKENS

# Slots above RUNNER_SLOTS go: their services and folders (`ship box add` then removes their
# registrations on GitHub).
for home in "$RUNNER_HOME"/slot-*; do
  [ -d "$home" ] || continue
  k=${home##*/slot-}
  case "$k" in '' | *[!0-9]*) continue ;; esac
  [ "$k" -gt "$RUNNER_SLOTS" ] || continue
  unit="shipify-box-$(slot_name "$k").service"
  say "The slot $(slot_name "$k") goes"
  if [ -z "$CONTAINER" ]; then
    systemctl disable --now -q "$unit" 2>/dev/null || true
    rm -f "/etc/systemd/system/$unit"
    systemctl daemon-reload
  fi
  rm -rf "$home"
done

# install_unit <file> <unit> [restart]: install a service and start it; a changed one (or one
# in RESTART: restart=1) restarts.
install_unit() {
  local file=$1 unit=$2 changed=1
  cmp -s "$file" "/etc/systemd/system/$unit" && [ "${3:-}" != 1 ] && changed=0
  install -m 644 "$file" "/etc/systemd/system/$unit"
  rm -f "$file"
  systemctl daemon-reload
  systemctl enable -q "$unit"
  if [ "$changed" = 1 ] && systemctl is-active -q "$unit"; then systemctl restart "$unit"; else systemctl start "$unit"; fi
  systemctl --no-pager status "$unit" | head -n 5 || true
}

if [ -n "$CONTAINER" ]; then
  say "The slots: the container runs them (box/container.sh), restarting each that stops"
  rm -f "$UNIT_FILE"
else
say "The slots as services (they start on boot, and restart on failure)"
[ -f "$UNIT_FILE" ] || { echo "No service file: run this through pnpm ship box add."; exit 1; }
# Setup 5: what the runners write is theirs alone (UMask=0077), so no agent can read it.
grep -qx 'UMask=0077' "$UNIT_FILE" || { echo "The service file has no UMask=0077: run this through pnpm ship box add."; exit 1; }
for k in $(seq 1 "$RUNNER_SLOTS"); do
  home=$(slot_home "$k")
  name=$(slot_name "$k")
  sed -e "s|@SLOT_NAME@|$name|g" -e "s|@SLOT_DIR@|$home|g" "$UNIT_FILE" > "$WORK/shipify-box-$name.service"
  restart=""
  case "$RESTART" in *" $home "*) restart=1 ;; esac
  install_unit "$WORK/shipify-box-$name.service" "shipify-box-$name.service" "$restart"
done
rm -f "$UNIT_FILE"
fi

# updating_now <log>: the newest step of the updates under way in their dpkg log, or nothing. Never
# a reason to stop: a fresh install's log has no such line yet, or isn't there.
updating_now() {
  grep -E '^(Unpacking|Setting up|update-initramfs)' "$1" 2>/dev/null | tail -n 1 | cut -c1-70 || true
}

# A fresh install starts current: the updates waiting now, by the same rules as every day. After the
# slots registered, so a long first update (a new kernel, slow Wi-Fi) never outlasts the
# registration tokens' hour; the slots get the sandbox label only once this setup ends.
if [ -z "$CONTAINER" ]; then
say "The updates waiting now"
echo "  installing them (a few minutes on a fresh install; a new kernel takes longest)"
unattended-upgrade >/var/log/shipify-box-updates.log 2>&1 &
updating=$!
while kill -0 "$updating" 2>/dev/null; do
  sleep 20
  if kill -0 "$updating" 2>/dev/null; then
    now=$(updating_now /var/log/unattended-upgrades/unattended-upgrades-dpkg.log)
    echo "  still working: ${now:-starting}"
  fi
done
if wait "$updating"; then
  echo "  done"
else
  echo "  some didn't install now (see /var/log/shipify-box-updates.log); the daily run tries again"
fi
[ ! -f /var/run/reboot-required ] || echo "  they need a restart: it happens at 04:30 by itself, or run: sudo reboot"
fi

# put_file <file> <path>: the file in place, when it differs from what's there. Says whether it did.
put_file() {
  cmp -s "$1" "$2" && return 1
  install -D -m 644 "$1" "$2"
}

# Tailscale, then Cockpit on 127.0.0.1 only, shared with your own devices by `tailscale serve`.
# The box already works and its sandbox checked out at this point; a problem here stops only this
# part.
manage() {
  set -e
  local cockpit=""
  say "Tailscale (only your own devices can reach this machine)"
  command -v tailscale >/dev/null || curl -fsSL https://tailscale.com/install.sh | sh
  say "Cockpit (a web page for the terminal, services, logs and updates)"
  # Where it listens, in place before it's installed: it never listens on the network, even for a
  # moment.
  printf '[Socket]\nListenStream=\nListenStream=127.0.0.1:9090\n' > "$WORK/listen.conf"
  put_file "$WORK/listen.conf" /etc/systemd/system/cockpit.socket.d/listen.conf && cockpit=changed
  # shellcheck disable=SC1091
  . /etc/os-release
  # Its updates page, without what it recommends: NetworkManager would take a laptop's Wi-Fi from
  # Ubuntu Server's own network settings.
  apt_get install -y -q --no-install-recommends -t "${VERSION_CODENAME}-backports" cockpit cockpit-packagekit ||
    apt_get install -y -q --no-install-recommends cockpit cockpit-packagekit
  if ! tailscale status >/dev/null 2>&1; then
    echo "  Sign in at the link below, with the account your phone's Tailscale app uses (within 15 minutes):"
    tailscale up --ssh --timeout 15m
  else
    tailscale set --ssh
  fi
  address=$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')
  printf '[WebService]\nOrigins = https://%s\n' "$address" > "$WORK/cockpit.conf"
  put_file "$WORK/cockpit.conf" /etc/cockpit/cockpit.conf && cockpit=changed
  # Restarted only when its settings changed: a restart ends every Cockpit session, this setup's
  # too when it runs in Cockpit's terminal.
  if [ -n "$cockpit" ]; then
    systemctl daemon-reload
    systemctl restart cockpit.socket
  fi
  echo "  If it asks, turn on HTTPS certificates in Tailscale's admin page (DNS), then come back."
  tailscale serve --bg https+insecure://localhost:9090
  echo "  Cockpit: https://$address (sign in as your own user on this machine)"
  firewall
}

# The firewall (with --manage): nothing comes in but Tailscale and SSH from this machine's own
# network, kept as a way in if Tailscale is ever down. Going out is open, as the runners need.
# Only once Tailscale is up, and the allows go in before it turns on, so the session running this
# stays. Rules are only added, never reset: your own rules stay. To undo: sudo ufw disable.
firewall() {
  say "Firewall: Tailscale, and SSH from this machine's own network"
  if ! ip -4 addr show tailscale0 2>/dev/null | grep -q inet; then
    echo "  skipped: Tailscale isn't up yet, so nothing changes (run the same command again, with --manage)"
    return 0
  fi
  command -v ufw >/dev/null || apt_get install -y -q ufw
  # The allows first, then the defaults, then on: no moment shuts out a new SSH connection.
  ufw allow in on tailscale0 comment "Tailscale: Cockpit, SSH" >/dev/null
  ufw allow 41641/udp comment "Tailscale direct connections" >/dev/null
  local nets
  nets=$(ip -4 route show scope link | awk '$3 != "tailscale0" && $1 ~ /\// {print $1}' | sort -u)
  for net in $nets; do
    ufw allow from "$net" to any port 22 proto tcp comment "SSH from this network" >/dev/null
    echo "  SSH allowed from $net"
  done
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw --force enable >/dev/null
  echo "  on: in through Tailscale$([ -n "$nets" ] && echo ", and SSH from this network"); out as before"
}

# The agents' network (setup 9): out to the internet, as the work needs (GitHub, npm, the agent's
# API), never to a private network: your home network (its router, cameras, other machines), the
# tailnet, nor a cloud's metadata address. A table of its own in nftables, for each agent's user
# and the IDs of its range (its containers' users), loaded at every start by a service of its own,
# before the network is up. DNS stays open, as a resolver on your network may answer it. Your own
# rules, ufw's and Tailscale's stay as they are.
AGENTS_NET=/etc/shipify/agents-net.nft
AGENTS_NET_UNIT=shipify-agents-net.service
# agent_ids: each agent's user ID and the range of IDs its containers use, as nft reads them.
agent_ids() {
  local k u ids=""
  for k in $(seq 1 "$RUNNER_SLOTS"); do
    u=$(agent_user "$k")
    ids="$ids${ids:+, }$(id -u "$u")"
    ids="$ids$(awk -F: -v n="$u" '$1 == n && $3 > 0 { printf ", %d-%d", $2, $2 + $3 - 1 }' /etc/subuid 2>/dev/null)"
  done
  echo "$ids"
}
# agents_net <ids>: the table, for these users. Made again whole each time (an empty one first, so
# the delete always finds one), in one go.
agents_net() {
  cat <<NFT
# Written by Shipify box setup (docs/box-setup.md): the agents reach no private network.
table inet shipify_agents
delete table inet shipify_agents
table inet shipify_agents {
  chain out {
    type filter hook output priority filter; policy accept;
    meta skuid != { $1 } accept
    meta l4proto { tcp, udp } th dport 53 accept
    ip daddr { 10.0.0.0/8, 100.64.0.0/10, 169.254.0.0/16, 172.16.0.0/12, 192.168.0.0/16 } reject with icmpx admin-prohibited
    ip6 daddr { fc00::/7, fe80::/10 } reject with icmpx admin-prohibited
  }
}
NFT
}
if [ -n "$CONTAINER" ]; then
  say "The agents' network"
  echo "  skipped: a box in Docker reaches what its host lets it"
else
  say "The agents' network: the internet, never a private network"
  command -v nft >/dev/null || apt_get install -y -q nftables
  agents_net "$(agent_ids)" > "$WORK/agents-net.nft"
  put_file "$WORK/agents-net.nft" "$AGENTS_NET" || true
  # As Debian's own nftables service loads its file, but this table alone, and nothing flushed.
  printf '%s\n' "# Written by Shipify box setup (docs/box-setup.md): the agents reach no private network." \
    "[Unit]" "Description=Shipify: the agents reach no private network" "Wants=network-pre.target" \
    "Before=network-pre.target shutdown.target" "Conflicts=shutdown.target" "DefaultDependencies=no" "" \
    "[Service]" "Type=oneshot" "RemainAfterExit=yes" "StandardInput=null" "ExecStart=$(command -v nft) -f $AGENTS_NET" \
    "ExecReload=$(command -v nft) -f $AGENTS_NET" "" "[Install]" "WantedBy=sysinit.target" > "$WORK/$AGENTS_NET_UNIT"
  if put_file "$WORK/$AGENTS_NET_UNIT" "/etc/systemd/system/$AGENTS_NET_UNIT"; then systemctl daemon-reload; fi
  systemctl enable -q "$AGENTS_NET_UNIT"
  if systemctl restart "$AGENTS_NET_UNIT"; then
    echo "  on: no agent, nor its containers, reaches your network, the tailnet or a metadata address"
  else
    echo "  ✗ the agents' network rules didn't load (above: sudo systemctl status $AGENTS_NET_UNIT)"
  fi
fi
# The sandbox, proved: the runner starts each agent without a password, and no agent can read the
# runner's home, its jobs' folder, a runner process's environment or another slot's runs, nor its
# own memory from a command, nor, on WSL, reach Windows. Until this passes, the box records no new
# setup and `ship box add` gives its slots no sandbox label.
# The lab's check (setup 8, ADR 0064), as a run does it (cli/lib/sandbox.ts).
CHECK_IMAGE=docker.io/library/busybox:1.37
# left_of <user>: how many processes of the user, or of an ID in its range, run (one process list).
left_of() {
  local uid range
  uid=$(id -u "$1")
  range=$(awk -F: -v n="$1" '$1 == n { print $2, $3; exit }' /etc/subuid 2>/dev/null || true)
  ps -A -o uid= | awk -v u="$uid" -v r="$range" 'BEGIN { split(r, a, " ") }
    $1 == u || (a[2] > 0 && $1 >= a[1] && $1 < a[1] + a[2]) { n++ } END { print n + 0 }'
}
# kill_agent <user>: every process of it killed as it, as the box does after each turn; fails when
# one is still there.
kill_agent() {
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    sudo -u "$1" kill -KILL -1 2>/dev/null || true
    [ "$(left_of "$1")" != 0 ] || return 0
    sleep 0.3
  done
  return 1
}
# agent_sh <user> <script>: a script as the agent, in its folder.
agent_sh() { sudo -u "$1" sh -c "cd -- \"\$1\" && $2" agent "$AGENT_ROOT/$1"; }
# podman_as <user> <args…>: Podman as the agent, with a run's names, from its folder; its home and
# temporary files in run-setup-check, which goes as a run does.
podman_as() {
  local u=$1 s="$AGENT_ROOT/$1"
  shift
  sudo -u "$u" env -i PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 HOME="$s/run-setup-check/home" \
    TMPDIR="$s/run-setup-check/tmp" XDG_DATA_HOME="$s/data" XDG_RUNTIME_DIR="$s/runtime" \
    CONTAINERS_CONF_OVERRIDE="$CONTAINERS_CONF" sh -c 'cd -- "$1" && shift && exec podman "$@"' podman "$s" "$@"
}
# lab_check <user>: the whole way on one slot. A container that writes into the run's folder as a
# user of its own (an ID of the agent's range); the box's kill reaches it, and leaves nothing; a run
# start's reset and prune leave no container; that folder goes as cleanRuns removes a run. Only a
# process that survives the kill is a wall; the rest is said. Sets lab_ok="" when something's off.
lab_check() {
  local u=$1 s="$AGENT_ROOT/$1" c pid first said
  c="$s/run-setup-check"
  if ! podman_as "$u" pull -q "$CHECK_IMAGE" >"$WORK/lab.log" 2>&1; then
    echo "  containers: not run, the image didn't pull ($(tail -n 1 "$WORK/lab.log")); the next box add tries again"
    lab_ok=""
    return 0
  fi
  if ! podman_as "$u" run -d --replace --name shipify-check --user 1000:1000 -v "$c/work:/w" "$CHECK_IMAGE" \
    sh -c 'mkdir /w/c && touch /w/c/f && chmod 700 /w/c && exec sleep 600' >"$WORK/lab.log" 2>&1; then
    echo "  ✗ containers: one doesn't start as $u ($(tail -n 1 "$WORK/lab.log")): docs/troubleshooting.md"
    lab_ok=""
    return 0
  fi
  pid=$(podman_as "$u" inspect -f '{{.State.Pid}}' shipify-check 2>/dev/null || echo 0)
  for _ in $(seq 1 30); do [ ! -e "$c/work/c/f" ] || break; sleep 0.3; done
  first=$(awk -F: -v n="$u" '$1 == n { print $2; exit }' /etc/subuid)
  if [ "$(stat -c %u "/proc/$pid" 2>/dev/null)" != "$((first + 999))" ] || [ ! -e "$c/work/c/f" ]; then
    echo "  ✗ containers: the check's container didn't run as an ID of $u's range"
    lab_ok=""
  fi
  # Podman's group manager is cgroupfs with no delegation: a container stays in its agent's group,
  # in a run the slot's (its memory counts there).
  said=$(sudo -u "$u" cat /proc/self/cgroup)
  if [ "$(cat "/proc/$pid/cgroup" 2>/dev/null)" != "$said" ]; then
    echo "  containers: the check's container left its agent's group ($(cat "/proc/$pid/cgroup" 2>/dev/null)); its memory may not count in the slot's"
    lab_ok=""
  fi
  if ! kill_agent "$u"; then
    echo "  ✗ a container of $u's outlived the box's kill"
    walls=""
  fi
  # A run start: runtime/ emptied, then every container, pod, volume and network removed.
  agent_sh "$u" 'chmod -R u+rwX runtime 2>/dev/null; rm -rf runtime && mkdir -m 700 runtime'
  podman_as "$u" system prune --force --volumes >/dev/null 2>&1 || true
  if [ -n "$(podman_as "$u" ps -a -q 2>/dev/null)" ]; then
    echo "  ✗ containers: a run start's prune left a container of $u's"
    lab_ok=""
  fi
  # cleanRuns: plain rm can't remove what the container wrote as its own user; podman unshare can.
  agent_sh "$u" 'chmod -R u+rwX run-setup-check 2>/dev/null; rm -rf run-setup-check 2>/dev/null; true'
  [ ! -e "$c" ] || podman_as "$u" unshare rm -rf "$c" >/dev/null 2>&1 || true
  if [ -e "$c" ]; then
    echo "  ✗ containers: a folder a container wrote as its own user didn't go through podman unshare"
    lab_ok=""
  fi
}

say "Checking the sandbox"
walls=ok
# wall <user> <path>: the user can't read it (a folder's list, or a file's first byte).
wall() {
  # shellcheck disable=SC2016 # $1 is the inner shell's argument
  if sudo -u "$1" sh -c 'if [ -d "$1" ]; then ls -A -- "$1"; else head -c 1 -- "$1"; fi' wall "$2" >/dev/null 2>&1; then
    echo "  ✗ $1 can read $2"
    walls=""
  fi
}
listener=$(pgrep -u shipify -f Runner.Listener | head -n 1 || true)
for k in $(seq 1 "$RUNNER_SLOTS"); do
  u=$(agent_user "$k")
  if ! sudo -u shipify sudo -n -u "$u" true; then
    echo "  ✗ the runner can't start $u without a password"
    walls=""
  fi
  wall "$u" /home/shipify
  wall "$u" "$RUNNER_HOME/_work"
  [ -z "$listener" ] || wall "$u" "/proc/$listener/environ"
  for j in $(seq 1 "$RUNNER_SLOTS"); do
    [ "$j" = "$k" ] || wall "$u" "$AGENT_ROOT/$(agent_user "$j")"
  done
  # A root container socket (Docker's or Podman's), or the docker group, would give an agent the box.
  for sock in /run/docker.sock /run/podman/podman.sock; do
    if sudo -u "$u" test -w "$sock"; then
      echo "  ✗ $u can write $sock, a root container socket"
      walls=""
    fi
  done
done
# The lab, where Podman is: each agent's range works, and slot 1 the whole way (lab_check). Each
# slot is left as a run start leaves it: nothing of its agent's running, runtime/ empty.
if [ -z "$CONTAINER" ] && command -v podman >/dev/null; then
  lab_ok=ok
  for k in $(seq 1 "$RUNNER_SLOTS"); do
    u=$(agent_user "$k")
    agent_sh "$u" 'mkdir -p -m 700 data runtime run-setup-check/home run-setup-check/tmp run-setup-check/work && chmod 777 run-setup-check/work'
    if ! podman_as "$u" unshare cat /proc/self/uid_map 2>"$WORK/lab.log" | awk 'NR > 1 && $3 >= 65536 { ok = 1 } END { exit !ok }'; then
      echo "  ✗ containers: $u's range of IDs doesn't work ($(tail -n 1 "$WORK/lab.log")): run box add again"
      lab_ok=""
    elif [ "$k" = 1 ]; then
      lab_check "$u"
    fi
    kill_agent "$u" || { echo "  ✗ $u: a process outlived the box's kill"; walls=""; }
    agent_sh "$u" 'chmod -R u+rwX runtime run-setup-check 2>/dev/null; rm -rf runtime run-setup-check; mkdir -m 700 runtime' 2>/dev/null || true
    rm -rf "$AGENT_ROOT/$u/run-setup-check"
  done
  [ -z "$lab_ok" ] || echo "  containers: each agent's range works; a container ran, the box's kill stopped it, and nothing was left"
fi
# No command an agent runs can read the agent's memory, where its login is (on a pipe, never in its
# environment): the kernel lets a process read only its own children's (Ubuntu's own setting).
if [ "$(cat /proc/sys/kernel/yama/ptrace_scope 2>/dev/null || echo 0)" -lt 1 ]; then
  echo "  ✗ an agent's commands can read its memory: put kernel.yama.ptrace_scope = 1 in /etc/sysctl.d/10-ptrace.conf, then sudo sysctl --system"
  walls=""
fi
# The agents' network (setup 9): its rules loaded, and a listener on this machine's own private
# address, which root reaches and no agent does (as any private address is).
# private_ip: this machine's first private IPv4 address, if it has one (a VPS may have none).
private_ip() {
  ip -4 -o addr show scope global 2>/dev/null | awk '{ split($4, a, "/"); print a[1] }' |
    grep -E '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.)' |
    head -n 1 || true
}
# reaches <user> <address> <port>: a TCP connection there within 5 seconds, as the user ("": root).
reaches() {
  local as=()
  [ -z "$1" ] || as=(sudo -u "$1")
  # shellcheck disable=SC2016 # $1 and $2 are the inner shell's
  "${as[@]}" timeout 5 bash -c 'exec 3<>"/dev/tcp/$1/$2"' reach "$2" "$3" 2>/dev/null
}
if [ -z "$CONTAINER" ]; then
  if ! nft list table inet shipify_agents >/dev/null 2>&1; then
    echo "  ✗ the agents can reach your network and the tailnet: their rules aren't loaded (sudo systemctl status $AGENTS_NET_UNIT)"
    walls=""
  elif ip=$(private_ip) && [ -n "$ip" ]; then
    node -e 'const s = require("net").createServer((c) => c.end()); s.listen(0, process.argv[1], () => console.log(s.address().port))' \
      "$ip" >"$WORK/net.port" 2>/dev/null &
    probe=$!
    for _ in $(seq 1 30); do [ ! -s "$WORK/net.port" ] || break; sleep 0.2; done
    port=$(cat "$WORK/net.port" 2>/dev/null || true)
    if [ -n "$port" ] && reaches "" "$ip" "$port"; then
      for k in $(seq 1 "$RUNNER_SLOTS"); do
        u=$(agent_user "$k")
        if reaches "$u" "$ip" "$port"; then
          echo "  ✗ $u can reach $ip, a private network's address"
          walls=""
        fi
      done
    else
      echo "  the agents' network: its rules are loaded; not tried (nothing could listen on $ip)"
    fi
    kill "$probe" 2>/dev/null || true
    wait "$probe" 2>/dev/null || true
  fi
fi
# On WSL (this PC, in Windows), two more walls, which are Windows' settings, so yours to set: no
# agent can open a Windows drive, and Windows programs don't run from Linux (interop), since one
# runs as you in Windows, outside every Linux wall. Nothing here changes them (no OS tuning).
windows=""
if [ -e /proc/sys/fs/binfmt_misc/WSLInterop ] || grep -qi microsoft /proc/version 2>/dev/null; then
  for f in /proc/sys/fs/binfmt_misc/WSLInterop*; do
    if [ "$(head -n 1 "$f" 2>/dev/null)" = enabled ]; then
      echo "  ✗ Windows programs can run from WSL (interop), as you in Windows"
      windows=open
      break
    fi
  done
  # Windows' drives (C:\ and the rest), wherever they're mounted.
  drives=$(awk '$1 ~ /^[A-Za-z]:(\\134)?$/ {print $2}' /proc/mounts)
  for k in $(seq 1 "$RUNNER_SLOTS"); do
    u=$(agent_user "$k")
    for d in $drives; do
      # shellcheck disable=SC2016 # $1 is the inner shell's argument
      if sudo -u "$u" sh -c 'cd -- "$1" || ls -A -- "$1"' wall "$d" >/dev/null 2>&1; then
        echo "  ✗ $u can open $d, a Windows drive"
        windows=open
      fi
    done
  done
fi
if [ -n "$windows" ]; then
  walls=""
  echo "On WSL, the agents can reach Windows (above). To close it, put this in /etc/wsl.conf:"
  printf '    [interop]\n    enabled=false\n    appendWindowsPath=false\n    [automount]\n    options="metadata,umask=077"\n'
  echo "  (or, under [automount], enabled=false: no Windows drives in WSL at all), then run"
  echo "  wsl --shutdown in Windows, open Ubuntu again, and run box add again."
  echo "  It means no Windows programs from WSL (a link opening in your browser, explorer.exe):"
  echo "  if you need them, make a Pi or a spare Linux machine the box instead (docs/box-setup.md)."
fi
[ -n "$walls" ] || { echo "The sandbox isn't right (above); it's safe to run this again."; exit 1; }
echo "  done: $RUNNER_SLOTS agent(s), each walled off"

# Which setup this box has, for ship doctor.
echo "$SETUP_VERSION" > /home/shipify/.shipify-setup
chown shipify:shipify /home/shipify/.shipify-setup

# --manage last, once the sandbox checked out: Tailscale's sign-in waits for you (15 minutes at
# most), and when this part stops, the box still works and gets its sandbox label.
if [ "${SHIPIFY_MANAGE:-}" = 1 ]; then
  # Not `(manage) || …`: bash ignores set -e inside a function run that way.
  set +e
  (manage)
  managed=$?
  set -e
  [ "$managed" = 0 ] || echo "  The management part stopped (see above). The box works; run the same command again, with --manage."
fi
say "Done: ask \"how is this box doing?\" (a task, or the bot) to check it"
