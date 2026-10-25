#!/usr/bin/env bash
# Make this machine a Shipify box, from one command (ADR 0055, docs/box-setup.md):
#
#   curl -fsSL https://github.com/<owner>/shipify-template/releases/latest/download/here.sh | bash
#
# It runs on the machine itself, as a user who can sudo, and asks before it changes anything:
#   1. looks first: Ubuntu 24.04 LTS or newer (x64 or arm64), not root, sudo, memory, disk, GitHub
#   2. your approval: a code from GitHub you enter on your phone (github.com/login/device), or a
#      token you paste (--token). The login lives in a folder this script deletes when it ends
#   3. your copy (asked; by default the private Shipify copy you manage, else `<you>/shipify`): you
#      manage its runners, and it's private
#   4. your copy's own `ship box add` on this machine, from a clone in that folder, with Node 22 and
#      pnpm put there too: the plan first, then your yes. sudo asks for your password once
#   5. always, even on an error or Ctrl-C: the folder deleted, with the login, the clone and the
#      tools in it, and the link to revoke the approval on GitHub
# After it the box holds no key: each job brings its own (ADR 0031).
# --manage, for a machine you keep as a box (a laptop, a spare PC): it never sleeps, and gets
# Tailscale, Cockpit and a firewall, as `box add --manage` over SSH. Its SSH settings stay.
# --replace takes the place of a machine that had the same box name (this one, reinstalled).
# --fresh starts over on this machine: Shipify off it first (box remove --purge), then set up again,
# with the same slots, in one go.
# --remove takes the box away; with --purge, Shipify off this machine too (box/remove.sh).
#
#   bash here.sh [--manage] [--replace | --fresh] [--remove [--purge]] [--token] [--copy <owner/repo>] [--name <name>] [--slots <n>]
#   curl … | bash -s -- --manage      (options after `bash -s --` when piped)
# In the box's Docker image (ADR 0056), `docker run -it … register` runs it with --container: as the
# container's root, with the image's own gh and Node, and `box add --container`.
#
# The whole file is read before anything runs (main is called on its last line), so a download cut
# short runs nothing. Every answer is read from the terminal, so it works when piped.
set -euo pipefail

WORK=""
APPROVED=""
WAITING=""

say() { printf '\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
die() {
  printf '\n\033[31mStopped:\033[0m %s\n' "$1" >&2
  shift
  for line in "$@"; do printf '  %s\n' "$line" >&2; done
  exit 1
}

# An answer from the terminal (stdin is this script when piped): $1 the question, $2 the default.
ask() {
  local answer
  printf '%s%s: ' "$1" "${2:+ [$2]}" >/dev/tty
  IFS= read -r answer </dev/tty || answer=""
  printf '%s' "${answer:-${2:-}}"
}

# A yes from the terminal, in any case ("Yes", as a phone's keyboard writes it): $1 the question.
# Anything else is no.
yes_to() {
  case "$(ask "$1? yes or no" no | tr '[:upper:]' '[:lower:]')" in
    y | yes) return 0 ;;
    *) return 1 ;;
  esac
}

# A secret from the terminal, never shown.
ask_secret() {
  local answer
  printf '%s: ' "$1" >/dev/tty
  IFS= read -r -s answer </dev/tty || answer=""
  printf '\n' >/dev/tty
  printf '%s' "$answer"
}

cleanup() {
  local code=$?
  if [ -n "$WAITING" ]; then
    kill "$WAITING" 2>/dev/null || true
    wait "$WAITING" 2>/dev/null || true
  fi
  if [ -n "$WORK" ] && [ -d "$WORK" ]; then
    # Forget the login here first, then everything this script put down.
    GH_CONFIG_DIR="$WORK/gh" "$WORK/bin/gh" auth logout --hostname github.com >/dev/null 2>&1 || true
    rm -rf "$WORK"
  fi
  if [ -n "$APPROVED" ]; then
    printf '\nThe login is gone from this machine. On one that isn'"'"'t yours, also revoke the approval:\n'
    printf '  %s\n' "$APPROVED"
  fi
  exit "$code"
}

usage() {
  sed -n '2,30p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//' || true
  printf 'bash here.sh [--manage] [--replace | --fresh] [--remove [--purge]] [--token] [--copy <owner/repo>] [--name <name>] [--slots <n>]\n'
}

# ---------------------------------------------------------------- 1. looks first

preflight() {
  say "Looking at this machine (nothing changes yet)"
  # Read as text, never run: KEY=value or KEY="value".
  local os=${SHIPIFY_OS_RELEASE:-/etc/os-release}
  field() { sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}\$/\1/p" "$os" 2>/dev/null | head -n 1; }
  local id version pretty
  id=$(field ID)
  version=$(field VERSION_ID)
  pretty=$(field PRETTY_NAME)
  local major=${version%%.*}
  if [ "$id" != ubuntu ] || [ -z "$major" ] || [ "$major" -lt 24 ] || [ $((major % 2)) -ne 0 ] ||
    [ "${version#*.}" != 04 ]; then
    die "this is ${pretty:-an unknown OS}: a box needs Ubuntu Server 24.04 LTS or a newer LTS." \
      "Make the machine again with Ubuntu 24.04 LTS (64-bit), then run this again."
  fi
  case "$(uname -m)" in
    x86_64) ARCH=x64 ;;
    aarch64) ARCH=arm64 ;;
    *) die "this machine is $(uname -m): a box needs x64 or arm64 (64-bit)." ;;
  esac
  local where="Run it in an SSH session or a cloud console, not a start-up script."
  [ "$CONTAINER" = 1 ] && where="Run it with a terminal: docker run -it … register (or docker compose run --rm box register)."
  { : </dev/tty; } 2>/dev/null || die "it needs a terminal: you approve it on your phone and answer its questions." "$where"
  if [ "$(id -u)" -eq 0 ] && [ "$CONTAINER" != 1 ]; then
    die "you're root: run it as a user who can sudo, as on every box." \
      "Log in as the machine's default user (often ubuntu), or make one:" \
      "adduser you && usermod -aG sudo you, then log in as them and run this again."
  fi
  command -v sudo >/dev/null || die "sudo isn't here: a box is set up with it once."
  local kb
  kb=$(awk '/^MemTotal:/{print $2}' /proc/meminfo)
  if [ "$kb" -lt 3500000 ]; then
    die "it has $((kb / 1024)) MB of memory: a box needs 4 GB for one slot (a busy slot needs about 1.6 GB, the system 1)." \
      "Pick a machine with 4 GB or more."
  fi
  local free
  free=$(df -Pk "$HOME" | awk 'NR==2{print $4}')
  if [ "$free" -lt 10000000 ]; then
    die "it has $((free / 1048576)) GB free: a box needs 10 GB at least (25 GB is comfortable)." \
      "Make the disk bigger, or free some space."
  fi
  curl -fsS --max-time 15 -o /dev/null https://api.github.com ||
    die "it can't reach GitHub (api.github.com)." \
      "A box only connects out: check the machine's network, and HTTPS_PROXY if it uses a proxy."
  note "$pretty, $ARCH, $((kb / 1048576)) GB of memory, $((free / 1048576)) GB free: fine"
  if [ "$(id -u)" -ne 0 ]; then
    say "sudo, once (a box is set up with it)"
    sudo -v || die "sudo refused: run it as a user who can sudo."
  fi
}

# ---------------------------------------------------------------- tools, in the folder

tools() {
  if [ "$CONTAINER" = 1 ]; then
    # The image has them (box/setup.sh), at its release's versions.
    note "the image's gh $(gh --version | head -n 1 | cut -d' ' -f3), Node $(node --version)"
    return
  fi
  say "gh, Node 22 and pnpm, in a folder deleted at the end"
  mkdir -p "$WORK/bin" "$WORK/node"
  # gh: GitHub's release, its checksum checked.
  local ghv tgz
  ghv=$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p' | head -n 1)
  [ -n "$ghv" ] || die "couldn't find gh's newest release on GitHub."
  local gharch=amd64
  [ "$ARCH" = arm64 ] && gharch=arm64
  tgz="gh_${ghv}_linux_${gharch}.tar.gz"
  (cd "$WORK" && curl -fsSLO "https://github.com/cli/cli/releases/download/v${ghv}/${tgz}" &&
    curl -fsSL "https://github.com/cli/cli/releases/download/v${ghv}/gh_${ghv}_checksums.txt" |
    grep " ${tgz}\$" | sha256sum -c - >/dev/null) || die "gh's download didn't match its checksum."
  tar -xzf "$WORK/$tgz" -C "$WORK" && mv "$WORK/gh_${ghv}_linux_${gharch}/bin/gh" "$WORK/bin/gh"
  # Node 22: nodejs.org's newest 22.x, its checksum checked (as box/setup.sh takes it).
  local base=https://nodejs.org/dist/latest-v22.x file
  file=$(curl -fsSL "$base/SHASUMS256.txt" | grep -oE "node-v22\.[0-9.]+-linux-${ARCH}\.tar\.xz" | head -n 1)
  [ -n "$file" ] || die "couldn't find Node 22 for $ARCH on nodejs.org."
  (cd "$WORK" && curl -fsSLO "$base/$file" &&
    curl -fsSL "$base/SHASUMS256.txt" | grep " ${file}\$" | sha256sum -c - >/dev/null) ||
    die "Node's download didn't match its checksum."
  tar -xJf "$WORK/$file" -C "$WORK/node" --strip-components 1
  export PATH="$WORK/bin:$WORK/node/bin:$PATH"
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0 COREPACK_HOME="$WORK/corepack"
  corepack enable --install-directory "$WORK/bin"
  command -v git >/dev/null ||
    { sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git >/dev/null; } ||
    die "couldn't install git."
  note "gh $ghv, $(node --version)"
}

# ---------------------------------------------------------------- 2. your approval

login() {
  export GH_CONFIG_DIR="$WORK/gh" GH_NO_UPDATE_NOTIFIER=1
  if [ "$TOKEN" = 1 ]; then
    say "Your token (fine-grained: your copy only; Administration and Variables write, Contents read)"
    local t
    t=$(ask_secret "Paste it (not shown)")
    [ -n "$t" ] || die "no token given."
    printf '%s' "$t" | gh auth login --hostname github.com --with-token ||
      die "GitHub refused that token." "Make one at github.com/settings/personal-access-tokens, then run this again."
    APPROVED="github.com/settings/personal-access-tokens (delete the token)"
  else
    say "Your approval, on your phone"
    note "a code shows below: open github.com/login/device, enter it and approve \"GitHub CLI\"."
    note "Only approve a code you started just now."
    # No terminal on its stdin: it asks nothing more, and leaves git's own settings as they are.
    # Plain output: it never waits on the terminal for its colours (a web console may not answer).
    # Waited on from here, so Ctrl-C or a dropped session cleans up at once (it stops gh too).
    TERM=dumb NO_COLOR=1 gh auth login --hostname github.com --git-protocol https --web </dev/null &
    WAITING=$!
    wait "$WAITING" ||
      die "GitHub didn't approve it (declined, or the code expired after 15 minutes)." "Run this again."
    WAITING=""
    APPROVED="github.com/settings/applications → Authorized OAuth Apps → GitHub CLI → Revoke"
  fi
  LOGIN=$(gh api user --jq .login) || die "couldn't read who you are on GitHub."
  note "signed in as $LOGIN"
}

# ---------------------------------------------------------------- 3. your copy

copy() {
  # The default: the one private repo named shipify you manage (yours, or an organization's), else
  # <you>/shipify.
  local mine
  mine=$(gh api "user/repos?per_page=100" --paginate \
    --jq '.[] | select(.name == "shipify" and .private and .permissions.admin) | .full_name' 2>/dev/null || true)
  [ "$(printf '%s\n' "$mine" | grep -c /)" = 1 ] || mine="$LOGIN/shipify"
  [ -n "$COPY" ] || COPY=$(ask "Your Shipify copy" "$mine")
  [[ "$COPY" =~ ^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$ ]] || die "\"$COPY\" isn't owner/name."
  local facts admin priv
  facts=$(gh api "repos/$COPY" --jq '"\(.permissions.admin) \(.private)"' 2>/dev/null) ||
    die "$LOGIN can't see $COPY." "Check its name, or approve as the account that owns it."
  read -r admin priv <<<"$facts"
  [ "$admin" = true ] || die "$LOGIN can't manage $COPY's runners (it needs admin on it)."
  [ "$priv" = true ] || die "$COPY is public: a box serves only a private copy (ADR 0055)." \
    "Make it private on GitHub (Settings → General → Danger Zone), then run this again."
  local owner
  owner=$(gh variable get SHIPIFY_OWNER -R "$COPY" 2>/dev/null || true)
  [ "$owner" = "$LOGIN" ] || die "$COPY isn't a Shipify copy of $LOGIN's (its SHIPIFY_OWNER is ${owner:-unset})." \
    "Run pnpm ship setup on it first (docs/getting-started.md)."
  say "Your copy: $COPY"
  # gh lends git its login for this clone alone: nothing is written to your git settings.
  git -c credential.helper= -c "credential.helper=!$WORK/bin/gh auth git-credential" \
    clone -q --depth 1 "https://github.com/$COPY.git" "$WORK/shipify" || die "couldn't clone $COPY."
  (cd "$WORK/shipify" && pnpm install --frozen-lockfile --prod --silent) ||
    die "couldn't install $COPY's packages."
}

# ---------------------------------------------------------------- 4. its own box add

ship() { (cd "$WORK/shipify" && pnpm --silent ship "$@"); }

add() {
  # A container's hostname is a random id: it asks with a plainer name.
  local default
  default=$(hostname -s)
  [ "$CONTAINER" = 1 ] && default=docker
  [ -n "$NAME" ] || NAME=$(ask "This box's name" "$default")
  [[ "$NAME" =~ ^[a-z0-9][a-z0-9-]{0,30}$ ]] || die "\"$NAME\" isn't a box name: small letters, digits and -."
  local args=(box add --name "$NAME")
  [ -n "$SLOTS" ] && args+=(--slots "$SLOTS")
  [ "$MANAGE" = 1 ] && args+=(--manage)
  [ "$CONTAINER" = 1 ] && args+=(--container)
  [ "$REPLACE" = 1 ] && args+=(--replace)
  if [ "$FRESH" = 1 ]; then
    # The same slots as before, unless --slots says: the box's services here, slot 1 and -2 to -9.
    local had
    had=$(systemctl list-unit-files --no-legend "shipify-box-$NAME*" 2>/dev/null |
      grep -cE "^shipify-box-$NAME(-[2-9])?\.service" || true)
    [ -n "$SLOTS" ] || [ "$had" = 0 ] || args+=(--slots "$had")
    say "Starting over: first, Shipify off this machine"
    ship box remove "$NAME" --purge || die "nothing changed: box remove can't go ahead (above), and names the fix."
  fi
  say "The plan"
  # A plan that can't go ahead (a name another machine has) says why: nothing is asked then.
  ship "${args[@]}" || die "nothing changed: box add can't go ahead (above), and names the fix."
  if [ "$FRESH" = 1 ]; then
    yes_to "Take Shipify off this machine, then make it the box $NAME again" || die "nothing changed: you said no."
    ship box remove "$NAME" --purge --yes </dev/tty ||
      die "box remove stopped (above). Running this again carries on."
  else
    yes_to "Make this machine the box $NAME" || die "nothing changed: you said no."
  fi
  ship "${args[@]}" --yes </dev/tty || die "box add didn't finish (above): it says what's left, and the fix. Running this again carries on."
  if [ "$CONTAINER" = 1 ]; then
    say "Registered: $NAME. Start it, and it runs after every reboot:"
    note "docker compose up -d   (or: docker run -d --name shipify-box --restart unless-stopped -v shipify-box:/home/shipify <image>)"
    return
  fi
  say "Live: $NAME takes the next task. /ping in your chat shows it."
  note "To take it away: the same command with \`| bash -s -- --remove\` (or from your PC: pnpm ship box remove $NAME --yes)"
}

remove() {
  local default
  default=$(hostname -s)
  [ "$CONTAINER" = 1 ] && default=docker
  [ -n "$NAME" ] || NAME=$(ask "The box to remove" "$default")
  local args=(box remove "$NAME")
  if [ "$PURGE" = 1 ]; then
    args+=(--purge)
    yes_to "Remove the box $NAME (its slots on GitHub, its services here), and take Shipify off this machine (its users, folders and rules)" ||
      die "nothing changed: you said no."
  else
    yes_to "Remove the box $NAME (its slots on GitHub, its services here)" || die "nothing changed: you said no."
  fi
  ship "${args[@]}" --yes </dev/tty || die "box remove stopped (above). Running this again carries on."
  if [ "$PURGE" = 1 ]; then
    say "$NAME is removed, and Shipify is off this machine."
  else
    say "$NAME is removed. To take Shipify off this machine too: the same command with --remove --purge."
  fi
}

main() {
  REMOVE=0 PURGE=0 REPLACE=0 FRESH=0 TOKEN=0 CONTAINER=0 MANAGE=0 COPY="" NAME="" SLOTS="" ARCH="" LOGIN=""
  # value <option> <its value…>: the value given, or a stop that names the option.
  value() {
    if [ $# -lt 2 ] || [ -z "$2" ] || [ "${2#--}" != "$2" ]; then die "$1 needs a value: $1 <value>."; fi
    printf '%s' "$2"
  }
  while [ $# -gt 0 ]; do
    case "$1" in
      --remove) REMOVE=1 ;;
      --purge) PURGE=1 ;;
      --replace) REPLACE=1 ;;
      --fresh) FRESH=1 ;;
      --manage) MANAGE=1 ;;
      --token) TOKEN=1 ;;
      --container) CONTAINER=1 ;;
      # Each on its own line: a failed value stops it here, as `set -e` does nothing in a `&&` list.
      --copy)
        COPY=$(value "$@")
        shift
        ;;
      --name)
        NAME=$(value "$@")
        shift
        ;;
      --slots)
        SLOTS=$(value "$@")
        shift
        [[ "$SLOTS" =~ ^[1-9]$ ]] || die "--slots is a whole number from 1 to 9."
        ;;
      -h | --help) usage && exit 0 ;;
      *) die "unknown option $1" "$(usage)" ;;
    esac
    shift
  done
  # Refused before the login and the clone, as box add would refuse them.
  if [ "$MANAGE" = 1 ] && [ "$REMOVE" = 1 ]; then die "--manage is for adding a box, not removing one."; fi
  if [ "$MANAGE" = 1 ] && [ "$CONTAINER" = 1 ]; then die "--manage isn't for a box in Docker: its host keeps the machine."; fi
  if [ "$PURGE" = 1 ] && [ "$REMOVE" != 1 ]; then die "--purge goes with --remove: it takes Shipify off this machine as the box goes."; fi
  if [ "$PURGE" = 1 ] && [ "$CONTAINER" = 1 ]; then die "--purge isn't for a box in Docker: remove its volume instead (docker volume rm)."; fi
  if [ "$REPLACE" = 1 ] && [ "$REMOVE" = 1 ]; then die "--replace is for adding a box, not removing one."; fi
  if [ "$FRESH" = 1 ] && [ "$REMOVE" = 1 ]; then die "--fresh sets the box up again: for taking it away, --remove --purge alone."; fi
  if [ "$FRESH" = 1 ] && [ "$REPLACE" = 1 ]; then die "--fresh starts over on this machine's own box; --replace takes another machine's place: pick one."; fi
  if [ "$FRESH" = 1 ] && [ "$CONTAINER" = 1 ]; then die "--fresh isn't for a box in Docker: remove its volume, then register again."; fi
  preflight
  WORK=$(mktemp -d)
  chmod 700 "$WORK"
  trap cleanup EXIT
  # Ctrl-C, a stop, or the SSH session dropping: each still cleans up.
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'exit 129' HUP
  # What the tools write for themselves (Node's cache, npm's) goes in the folder too.
  mkdir -p "$WORK/tmp"
  export TMPDIR="$WORK/tmp"
  # Every download tried again, and stopped when it stalls (curl reads CURL_HOME's .curlrc).
  printf '%s\n' "retry = 3" "retry-delay = 5" "connect-timeout = 30" "speed-limit = 1000" "speed-time = 60" > "$WORK/.curlrc"
  export CURL_HOME="$WORK"
  tools
  login
  copy
  if [ "$REMOVE" = 1 ]; then remove; else add; fi
}

main "$@"
