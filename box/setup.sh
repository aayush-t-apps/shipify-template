#!/usr/bin/env bash
# Shipify box setup (docs/box-setup.md): makes an Ubuntu LTS machine (24.04 on, which `box add`
# checks first) a box that runs tasks.
# `pnpm ship box add <user@host>` copies this here and runs it with sudo. Safe to run again.
#   $1  a file with RUNNER_URL, RUNNER_NAME, RUNNER_LABELS, RUNNER_SLOTS and RUNNER_TOKENS (one
#       registration token per slot), deleted once read
#   $2  the stacks' doctor checks, one per line: name<TAB>check<TAB>fix (fixes run as root)
#   $3  the slots' systemd unit, rendered by `ship box add` (the same definition as every box's),
#       with @SLOT_NAME@ and @SLOT_DIR@ for each slot's
# What it installs: git, make, gh, Node 22 (pnpm through corepack), the updates waiting now and
# automatic security updates (gh's and Tailscale's too, rebooting at 04:30 when one needs it), what each stack needs, the user "shipify" (no sudo)
# and the box's slots as that user's services (ADR 0020): one GitHub runner each, all labelled
# shipify-box and box-<name>, each running what the queue hands it, one task at a time (ADR 0019).
# The sandbox (setup 5, ADR 0031): each slot's agent runs as a user of its own, shipify-agent-<k>,
# which can't read the runner's home (0700), what its services write (UMask=0077), or another
# slot's runs (/srv/shipify-agent-<k>); one sudo rule lets the runner run commands as them, and
# as no one else.
# A check at the end proves it; `ship box add` then labels the slots `sandbox`, for run jobs.
# Running it again updates Node to the newest 22.x, and adds or removes slots to match
# RUNNER_SLOTS.
# SSH takes keys only, never passwords, once the account running this has a key; with
# SHIPIFY_HERE=1 (`box add` with no target: the PC you run it from) SSH stays as it is. With
# SHIPIFY_MANAGE=1 in the settings file (`box add --manage`): Tailscale, Cockpit reachable only
# through it, and a firewall that lets in only Tailscale and SSH from this machine's own network.
set -euo pipefail

# What this script gives a box. Bump it when a change here should reach boxes already set up:
# `ship doctor` (and so the weekly clean-up, on the status issue) names a box set up by an older
# one, and running `ship box add` again brings it up to date (ADR 0017).
SETUP_VERSION=5

[ "$(id -u)" = 0 ] || { echo "Run it with sudo."; exit 1; }
export NPM_CONFIG_UPDATE_NOTIFIER=false
ENV_FILE=${1:?the runner settings file}
PREP=${2:-}
UNIT_FILE=${3:-}
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
rm -f "$ENV_FILE"
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
# While the daily updates hold apt's lock, wait for them (up to 5 minutes) instead of failing.
apt_get() { apt-get -o DPkg::Lock::Timeout=300 "$@"; }

say "System packages"
apt_get update -q
apt_get install -y -q git make curl ca-certificates tar xz-utils build-essential jq unattended-upgrades tmux sudo procps
if ! command -v gh >/dev/null; then
  install -d -m 755 /etc/apt/keyrings
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
  chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list
  apt_get update -q
  apt_get install -y -q gh
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

say "Automatic security updates"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
# gh and Tailscale come from their own apt sources, which Ubuntu's updates leave out. Kernel
# fixes need a restart: at 04:30, only when an update asks for one. A task running then shows
# failed; comment "continue" on it.
cat > /etc/apt/apt.conf.d/52shipify-updates <<'CONF'
Unattended-Upgrade::Origins-Pattern { "origin=gh"; "origin=Tailscale"; };
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
CONF
# A fresh install starts current: the updates waiting now, by the same rules as every day.
echo "  installing the updates waiting now (a few minutes on a fresh install; a new kernel takes longest)"
unattended-upgrade >/var/log/shipify-box-updates.log 2>&1 &
updating=$!
while kill -0 "$updating" 2>/dev/null; do
  sleep 20
  if kill -0 "$updating" 2>/dev/null; then
    now=$(grep -E '^(Unpacking|Setting up|update-initramfs)' /var/log/unattended-upgrades/unattended-upgrades-dpkg.log 2>/dev/null | tail -n 1 | cut -c1-70)
    echo "  still working: ${now:-starting}"
  fi
done
if wait "$updating"; then
  echo "  done"
else
  echo "  some didn't install now (see /var/log/shipify-box-updates.log); the daily run tries again"
fi
[ ! -f /var/run/reboot-required ] || echo "  they need a restart: it happens at 04:30 by itself, or run: sudo reboot"

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

# SSH by key only: no passwords, no root. Only when the account running this (`box add` connects
# with a key) has one, so nobody is locked out, and checked before it's used; if the check fails,
# the change goes and SSH stays as it was.
say "SSH: keys only"
SSHD_DROPIN=/etc/ssh/sshd_config.d/10-shipify.conf
SSHD=$(command -v sshd || echo /usr/sbin/sshd)
keys="/home/${SUDO_USER:-}/.ssh/authorized_keys"
if [ "${SHIPIFY_HERE:-}" = 1 ]; then
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
AGENT_ROOT=/srv
agent_user() { echo "shipify-agent-$1"; }
say "The agents' users: one per slot, each walled off from the runner and the other slots"
install -d -m 0755 "$AGENT_ROOT"
for k in $(seq 1 "$RUNNER_SLOTS"); do
  u=$(agent_user "$k")
  id "$u" >/dev/null 2>&1 ||
    useradd --system --user-group --no-create-home --home-dir "$AGENT_ROOT/$u" --shell /usr/sbin/nologin "$u"
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
  userdel "$u" 2>/dev/null || true
  rm -rf "$dir"
  for deny in /etc/cron.deny /etc/at.deny; do
    [ ! -f "$deny" ] || sed -i "/^$u\$/d" "$deny"
  done
done

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
  release=$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest)
  version=$(printf '%s' "$release" | jq -r .tag_name | sed 's/^v//')
  file="actions-runner-linux-${ARCH}-${version}.tar.gz"
  sum=$(printf '%s' "$release" | jq -r --arg f "$file" '.assets[] | select(.name == $f) | .digest' | sed 's/^sha256://')
  if [ -z "$sum" ] || [ "$sum" = null ]; then echo "No checksum for $file."; exit 1; fi
  curl -fsSL -o "$WORK/$file" "https://github.com/actions/runner/releases/download/v${version}/${file}"
  echo "$sum  $WORK/$file" | sha256sum -c -
  TARBALL="$WORK/$file"
}

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

# slot_env <folder>: what the slot's runner hands its jobs (it reads its folder's .env when it
# starts): the box, the box's folder (the weekly clean-up covers every slot) and the machine's one
# tool cache. The rest of the file is the runner's own.
ENV_CHANGED=" "
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
    ENV_CHANGED="$ENV_CHANGED$home "
  fi
  rm -f "$tmp"
}

say "The GitHub runners: $RUNNER_SLOTS slot(s), one task at a time each"
read -r -a TOKENS <<< "${RUNNER_TOKENS:-}"
for k in $(seq 1 "$RUNNER_SLOTS"); do
  register "$(slot_home "$k")" "$(slot_name "$k")" "$RUNNER_LABELS" "${TOKENS[$((k - 1))]:-}"
  slot_env "$(slot_home "$k")"
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
  systemctl disable --now -q "$unit" 2>/dev/null || true
  rm -f "/etc/systemd/system/$unit"
  systemctl daemon-reload
  rm -rf "$home"
done

# install_unit <file> <unit> [restart]: install a service and start it; a changed one (or one
# whose slot's .env changed: restart=1) restarts.
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

say "The slots as services (they start on boot, and restart on failure)"
[ -f "$UNIT_FILE" ] || { echo "No service file: run this through pnpm ship box add."; exit 1; }
# Setup 5: what the runners write is theirs alone (UMask=0077), so no agent can read it.
grep -qx 'UMask=0077' "$UNIT_FILE" || { echo "The service file has no UMask=0077: run this through pnpm ship box add."; exit 1; }
for k in $(seq 1 "$RUNNER_SLOTS"); do
  home=$(slot_home "$k")
  name=$(slot_name "$k")
  sed -e "s|@SLOT_NAME@|$name|g" -e "s|@SLOT_DIR@|$home|g" "$UNIT_FILE" > "$WORK/shipify-box-$name.service"
  restart=""
  case "$ENV_CHANGED" in *" $home "*) restart=1 ;; esac
  install_unit "$WORK/shipify-box-$name.service" "shipify-box-$name.service" "$restart"
done
rm -f "$UNIT_FILE"

# Tailscale, then Cockpit on 127.0.0.1 only, shared with your own devices by `tailscale serve`.
# The box already works at this point; a problem here stops only this part.
manage() {
  set -e
  say "Tailscale (only your own devices can reach this machine)"
  command -v tailscale >/dev/null || curl -fsSL https://tailscale.com/install.sh | sh
  say "Cockpit (a web page for the terminal, services, logs and updates)"
  # shellcheck disable=SC1091
  . /etc/os-release
  apt_get install -y -q -t "${VERSION_CODENAME}-backports" cockpit || apt_get install -y -q cockpit
  mkdir -p /etc/systemd/system/cockpit.socket.d
  printf '[Socket]\nListenStream=\nListenStream=127.0.0.1:9090\n' > /etc/systemd/system/cockpit.socket.d/listen.conf
  if ! tailscale status >/dev/null 2>&1; then
    echo "  Sign in at the link below, with the account your phone's Tailscale app uses:"
    tailscale up --ssh
  else
    tailscale set --ssh
  fi
  address=$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')
  printf '[WebService]\nOrigins = https://%s\n' "$address" > /etc/cockpit/cockpit.conf
  systemctl daemon-reload
  systemctl restart cockpit.socket
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
    echo "  skipped: Tailscale isn't up yet, so nothing changes (run box add --manage again)"
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
if [ "${SHIPIFY_MANAGE:-}" = 1 ]; then
  # Not `(manage) || …`: bash ignores set -e inside a function run that way.
  set +e
  (manage)
  managed=$?
  set -e
  [ "$managed" = 0 ] || echo "  The management part stopped (see above). The box works; run box add --manage again."
fi
# The sandbox, proved: the runner starts each agent without a password, and no agent can read the
# runner's home, its jobs' folder, a runner process's environment or another slot's runs. Until
# this passes, the box records no new setup and `ship box add` gives its slots no sandbox label.
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
done
[ -n "$walls" ] || { echo "The sandbox isn't right (above); it's safe to run this again."; exit 1; }
echo "  done: $RUNNER_SLOTS agent(s), each walled off"

# Which setup this box has, for ship doctor.
echo "$SETUP_VERSION" > /home/shipify/.shipify-setup
chown shipify:shipify /home/shipify/.shipify-setup
say "Done: ask \"how is this box doing?\" (a task, or the bot) to check it"
