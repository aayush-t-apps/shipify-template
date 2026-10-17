#!/usr/bin/env bash
# What N tasks at once cost a box (ADR 0061): N copies of an app's `make verify`, each in a user
# service of its own (so each has its own memory count), as a box's slots run them. For each round
# it prints the time, each copy's peak and result, the box's lowest free memory and any OOM kill.
# A guard stops a round when free memory falls under GUARD_MB (700), so live tasks stay safe.
# Run it on the box as your own login (no root), when no task runs, with an app's checkout whose
# `make verify` passes there (its packages and browsers installed):
#   bash box/load-test.sh <app folder> [<copies at once>…]     (default: 1 3 4 5)
# Its copies go in ~/shipify-load-test and are removed at the end; each copy's log stays there.
set -euo pipefail
APP=$(cd "${1:?usage: load-test.sh <app folder> [<copies at once>…]}" && pwd)
shift
if [ $# -gt 0 ]; then ROUNDS=("$@"); else ROUNDS=(1 3 4 5); fi
GUARD_MB=${GUARD_MB:-700}
HERE=$HOME/shipify-load-test
systemctl --user show-environment >/dev/null 2>&1 || {
  echo "This needs your own systemd session: log in over SSH as yourself (not with sudo)."
  exit 1
}
CG=/sys/fs/cgroup$(systemctl --user show -p ControlGroup --value)
rm -rf "$HERE"
mkdir -p "$HERE"
trap 'systemctl --user stop "shipify-load-*" 2>/dev/null || true; rm -rf "$HERE"/c*' EXIT
most=0
for n in "${ROUNDS[@]}"; do [ "$n" -gt "$most" ] && most=$n; done
echo "Copying $APP $most times into $HERE…"
for k in $(seq 1 "$most"); do cp -a "$APP" "$HERE/c$k"; done
# The copies written to the disk first, so the first round doesn't wait on a slow one (a USB stick).
sync
avail() { awk '/^MemAvailable:/ {print int($2 / 1024)}' /proc/meminfo; }
kills() { awk '$1 == "oom_kill" {print $2}' /proc/vmstat; }
swap=$(swapon --show=NAME,SIZE --noheadings 2>/dev/null | tr -s ' \n' ' ' || true)
echo "$(nproc) cores, $(awk '/^MemTotal:/ {printf "%.1f", $2 / 1048576}' /proc/meminfo) GB, swap: ${swap:-none}"
for n in "${ROUNDS[@]}"; do
  oom=$(kills)
  low=$(avail)
  start=$(date +%s)
  for k in $(seq 1 "$n"); do
    systemd-run --user --quiet --collect --wait -p MemoryAccounting=yes --unit "shipify-load-$n-$k" \
      -E PATH="$PATH" -E HOME="$HOME" ${PLAYWRIGHT_BROWSERS_PATH:+-E PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_BROWSERS_PATH"} \
      --working-directory "$HERE/c$k" sh -c 'make verify >"../log-$0.txt" 2>&1; echo $? >"../exit-$0.txt"' "$n-$k" &
  done
  stopped=""
  declare -A peak=()
  while [ "$(jobs -rp | wc -l)" -gt 0 ]; do
    a=$(avail)
    [ "$a" -lt "$low" ] && low=$a
    for k in $(seq 1 "$n"); do
      p=$(cat "$CG/app.slice/shipify-load-$n-$k.service/memory.peak" 2>/dev/null || echo 0)
      [ "$p" -gt "${peak[$k]:-0}" ] && peak[$k]=$p
    done
    if [ "$a" -lt "$GUARD_MB" ] && [ -z "$stopped" ]; then
      stopped=" (stopped: free memory fell to $a MB)"
      systemctl --user stop "shipify-load-$n-*" || true
    fi
    sleep 1
  done
  wait || true
  echo "$n at once: $(($(date +%s) - start)) s, lowest free memory ${low} MB, OOM kills $(($(kills) - oom))$stopped"
  for k in $(seq 1 "$n"); do
    code=$(cat "$HERE/exit-$n-$k.txt" 2>/dev/null || echo "?")
    echo "  copy $k: peak $((${peak[$k]:-0} / 1048576)) MB, make verify $([ "$code" = 0 ] && echo passed || echo "failed ($code): $HERE/log-$n-$k.txt")"
  done
  unset peak
done
