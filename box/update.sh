#!/usr/bin/env bash
# The box's own setup update (setup 14, docs/box-setup.md): main's newer box/setup.sh, applied by
# the box itself, with nothing for you to run. box/setup.sh installs this as
# /usr/local/sbin/shipify-box-update, root's own, and one sudo line lets the runner (shipify) start
# it. The due run and the weekly clean-up start it when this box's setup is older than main's and no
# other slot runs a job (cli/lib/box-update.ts).
#
#   sudo -n shipify-box-update    a read token for the box's repo on stdin (the job's own). Root
#                                 downloads box/setup.sh and box/update.sh from the repo's default
#                                 branch itself; when that setup is newer than this box's, it applies
#                                 it in a service of its own (--apply), then says how it went.
#   shipify-box-update --apply    that service: the slots with no job stopped, the setup run with the
#                                 box's own settings (SHIPIFY_REFRESH=1), the slots started again.
#
# Root never runs a file the runner or an agent can write: only what it downloaded itself, from the
# repo the box was set up for, into a folder only root opens. The token serves that one download,
# and is never kept or put on a command line. So a job can ask "update now", never say what runs.
# An update registers no slot (that takes your approval) and never waits for a sign-in. One that
# fails is tried again a day later, not at every due run.
# Exit: 0 updated, 10 current already, 75 not now (another slot runs a job, an update is under way,
# or the last one failed less than a day ago), 1 not updated (said above).
set -euo pipefail
umask 022
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin LANG=C.UTF-8

CONF=/etc/shipify/box.env
DIR=/var/lib/shipify/update
TRIED=/var/lib/shipify/update-failed
LOG=/var/log/shipify-box-update.log
RECORD=/home/shipify/.shipify-setup
UNIT=shipify-setup-update

[ "$(id -u)" = 0 ] || { echo "Run it with sudo."; exit 1; }

# version_of <file>: the setup version it gives a box (its SETUP_VERSION), or nothing.
version_of() { sed -n 's/^SETUP_VERSION=\([0-9][0-9]*\)$/\1/p' "$1" | head -n 1; }
# recorded: the setup this box has (box/setup.sh records it once its sandbox checks out), else 0.
recorded() {
  local v
  v=$(head -n 1 "$RECORD" 2>/dev/null || true)
  case "$v" in '' | *[!0-9]*) echo 0 ;; *) echo "$v" ;; esac
}
# setting <name>: one of the box's settings, as setup wrote them.
setting() { sed -n "s/^$1=//p" "$CONF" | head -n 1; }
# busy: the slots' services that run a job now (a runner's Worker in their group), one per line.
busy() {
  local p
  for p in $(pgrep -u shipify -f 'bin/Runner\.Worker' || true); do
    sed -n 's|^0::.*/\(shipify-box-[^/]*\.service\)$|\1|p' "/proc/$p/cgroup" 2>/dev/null || true
  done | sort -u
}

if [ "${1:-}" = --apply ]; then
  [ $# = 1 ] || { echo "--apply takes nothing more."; exit 2; }
  if [ ! -f "$DIR/setup.sh" ] || [ ! -f "$DIR/box.env" ]; then echo "Nothing to apply."; exit 1; fi
  echo 1 > "$DIR/exit"
  # The setup's sandbox check stops every agent's processes, so no other slot may run a job, and
  # the ones with none stop until it ends: no task starts on them meanwhile.
  running=$(busy)
  if [ "$(printf '%s\n' "$running" | grep -c .)" -gt 1 ]; then
    echo "Not now: another slot runs a job."
    echo 75 > "$DIR/exit"
    exit 0
  fi
  stopped=""
  # shellcheck disable=SC2317,SC2329 # the trap runs it (shellcheck 0.9 says SC2317, 0.11 SC2329)
  start_again() {
    local unit
    for unit in $stopped; do
      systemctl start "$unit" || echo "  ✗ $unit didn't start again: sudo systemctl start $unit"
    done
  }
  trap start_again EXIT
  for unit in $(systemctl list-units --type=service --state=active --plain --no-legend 'shipify-box-*.service' | awk '{print $1}'); do
    printf '%s\n' "$running" | grep -qx "$unit" && continue
    systemctl stop "$unit" && stopped="$stopped $unit"
  done
  set +e
  bash "$DIR/setup.sh" "$DIR/box.env" "" "" "$DIR/update.sh"
  echo "$?" > "$DIR/exit"
  exit 0
fi

[ $# = 0 ] || { echo "It takes no arguments: a read token for the box's repo on stdin."; exit 2; }
[ -f "$CONF" ] || { echo "This box has no settings for its own updates (setup 13 or older): on the box, its here.sh command once more."; exit 1; }
exec 9>/run/shipify-box-update.lock
if ! flock -n 9 || systemctl is-active -q "$UNIT.service"; then
  echo "Not now: an update is under way."
  exit 75
fi
IFS= read -r -t 10 token || true
case "$token" in '' | *[!A-Za-z0-9_]*) echo "No read token on stdin."; exit 1 ;; esac

url=$(setting RUNNER_URL)
repo=${url#https://github.com/}
if [ "$url" = "$repo" ] || ! [[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo "This box's settings name no GitHub repo ($url): on the box, its here.sh command again."
  exit 1
fi
# A refresh registers nothing: a slot with no registration here takes you.
slots=$(setting RUNNER_SLOTS)
case "$slots" in [1-9]) ;; *) echo "This box's settings have no slots ($slots): on the box, its here.sh command again."; exit 1 ;; esac
for k in $(seq 1 "$slots"); do
  f=/home/shipify/runner/.runner
  [ "$k" = 1 ] || f="/home/shipify/runner/slot-$k/.runner"
  [ -f "$f" ] || { echo "Slot $k has no registration here, and an update registers none (that takes your approval): on the box, its here.sh command again."; exit 1; }
done

rm -rf "$DIR"
install -d -m 0700 "$DIR"
(umask 077 && printf 'Authorization: Bearer %s\n' "$token" > "$DIR/auth")
unset token
# fetch <file>: box/<file> on the repo's default branch, from GitHub itself.
fetch() {
  curl -fsS --proto '=https' --retry 3 --connect-timeout 30 --max-time 120 -H @"$DIR/auth" \
    -H 'Accept: application/vnd.github.raw+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
    -o "$DIR/$1" "https://api.github.com/repos/$repo/contents/box/$1"
}
got=1
if ! fetch setup.sh || ! fetch update.sh; then got=""; fi
rm -f "$DIR/auth"
[ -n "$got" ] || { echo "Couldn't download main's box setup from $repo (above); the next due run tries again."; exit 1; }
want=$(version_of "$DIR/setup.sh")
have=$(recorded)
[ -n "$want" ] || { echo "main's box/setup.sh has no SETUP_VERSION."; exit 1; }
if [ "$want" -le "$have" ]; then
  echo "Current: this box has setup $have, and main's is $want."
  exit 10
fi
# The same setup failed less than a day ago: tried again once a day, not at every due run.
failed="" at=0
[ ! -f "$TRIED" ] || read -r failed at < "$TRIED" || true
if [ "$failed" = "$want" ] && [ $(($(date +%s) - at)) -lt 86400 ]; then
  echo "Not now: setup $want failed here less than a day ago ($LOG); it's tried again a day after."
  exit 75
fi

# The box's own settings, as box add gave them: no registration tokens.
{
  cat "$CONF"
  echo "SHIPIFY_REFRESH=1"
} > "$DIR/box.env"
chmod 600 "$DIR/box.env"
# Its log: the runner reads it (through its group), no agent does.
install -m 0640 -o root -g shipify /dev/null "$LOG"
echo "Setup $have → $want: main's, applied in the service $UNIT (its log: $LOG)"
systemctl reset-failed "$UNIT.service" 2>/dev/null || true
systemd-run --quiet --wait --collect --unit "$UNIT" -p StandardOutput="append:$LOG" \
  -p StandardError="append:$LOG" /usr/local/sbin/shipify-box-update --apply || true
cat "$LOG"
code=$(cat "$DIR/exit" 2>/dev/null || echo 1)
[ "$code" != 75 ] || exit 75
if [ "$(recorded)" -ge "$want" ]; then
  rm -f "$TRIED"
  echo "Done: this box has setup $want (the setup's exit $code)."
  exit 0
fi
echo "$want $(date +%s)" > "$TRIED"
echo "Not updated: the setup stopped (exit $code, above), so this box keeps setup $have. It's tried again in a day; on the box, its here.sh command does it now."
exit 1
