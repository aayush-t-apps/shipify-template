#!/usr/bin/env bash
# The box in Docker (ADR 0056, docs/box-setup.md): the image's entry point, under tini.
#   register   once: your phone approves, and your copy's own `box add --container` registers this
#              container's slots and checks the sandbox (box/here.sh --container). Needs -it
#   remove     takes the box away: its slots unregistered, then their registration in the volume
#   run        the default: each registered slot's runner, as the user shipify, as a box's service
#              runs it (umask 077), restarted when it stops; docker stop asks each to cancel its
#              job and stop, as systemd does (use docker stop -t 300, as a box's 5 minutes)
# The volume on /home/shipify keeps the registration; the image keeps everything else.
set -euo pipefail

RUNNER_HOME=/home/shipify/runner
HERE=/opt/shipify/here.sh

slots() {
  local d
  for d in "$RUNNER_HOME" "$RUNNER_HOME"/slot-*; do
    [ -f "$d/.runner" ] && echo "$d"
  done
  return 0
}

run() {
  # One container per volume: a second would start the same runners twice.
  exec 9>/home/shipify/.box.lock
  flock -n 9 || { echo "Another container runs this box (its volume is in use): stop it first."; exit 1; }
  mapfile -t homes < <(slots)
  if [ "${#homes[@]}" -eq 0 ]; then
    echo "This box isn't registered yet. Register it once, then start it again:"
    echo "  docker compose run --rm box register"
    echo "  (or: docker run -it --rm -v shipify-box:/home/shipify <image> register)"
    # Waits instead of exiting, so --restart unless-stopped doesn't start it over and over.
    exec sleep infinity
  fi
  local stopping="" pids=()
  stop() {
    stopping=1
    echo "Stopping: each runner cancels its job and stops."
    for p in "${pids[@]}"; do kill -TERM "$p" 2>/dev/null || true; done
  }
  trap stop TERM INT
  for home in "${homes[@]}"; do
    (
      # Handled, never ignored: an ignored signal stays ignored in the runner it starts, which could
      # then never hear docker stop.
      trap 'exit 0' TERM
      while :; do
        # The slot's runner, as the user shipify, exactly as a box's service starts it.
        (cd "$home" && umask 077 && exec setpriv --reuid=shipify --regid=shipify --init-groups \
          env HOME=/home/shipify USER=shipify ./bin/runsvc.sh) &
        child=$!
        trap 'kill -TERM "$child" 2>/dev/null; wait "$child"; exit 0' TERM
        wait "$child" || true
        trap 'exit 0' TERM
        echo "$(basename "$home") stopped; starting it again in 10 seconds."
        sleep 10 &
        wait "$!" || true
      done
    ) &
    pids+=("$!")
    echo "Started $(basename "$home")."
  done
  # Until docker stop: then each slot's loop stops its runner, and this waits for them all.
  while [ -z "$stopping" ]; do wait -n || true; done
  wait || true
  echo "Stopped."
}

case "${1:-run}" in
  register)
    shift
    exec bash "$HERE" --container "$@"
    ;;
  remove)
    shift
    bash "$HERE" --container --remove "$@"
    rm -rf "$RUNNER_HOME"
    echo "Its registration is gone from the volume too. Delete the volume if you like: docker volume rm shipify-box"
    ;;
  run) run ;;
  -h | --help | help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//' ;;
  *)
    echo "Use: register | remove | run (docs/box-setup.md)"
    exit 1
    ;;
esac
