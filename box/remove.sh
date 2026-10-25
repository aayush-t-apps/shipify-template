#!/usr/bin/env bash
# Take Shipify off this machine (docs/box-setup.md, "Taking Shipify off a machine"): what
# box/setup.sh made for the box, and nothing of the machine's own. `pnpm ship box remove <name>
# --purge` runs it with sudo (here.sh --remove --purge too), once GitHub has forgotten the slots.
# Goes: the slots' services; the users shipify and shipify-agent-<k>, with their ID ranges, folders
# and processes (the containers' images too); the sudo rule; the update rule for the slots; the
# agents' network rules; the containers' settings for the agents; /opt/shipify.
# Stays, as the machine's own: security updates (with the restart at 04:30), Ubuntu's normal updates
# where setup added them, SSH by key only, zram, never sleeping, and with --manage Tailscale, Cockpit
# and the firewall; and the tools it installed (Node, gh, Podman), which the docs say how to remove.
# Safe to run again: what's gone already is skipped.
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Run it with sudo."; exit 1; }
say() { printf '\n== %s\n' "$*"; }

say "The slots' services"
for f in /etc/systemd/system/shipify-box-*.service; do
  [ -e "$f" ] || continue
  unit=${f##*/}
  systemctl disable --now -q "$unit" 2>/dev/null || true
  rm -f "$f"
  echo "  ${unit%.service}: gone"
done
systemctl daemon-reload

say "The agents' network rules"
systemctl disable --now -q shipify-agents-net.service 2>/dev/null || true
rm -f /etc/systemd/system/shipify-agents-net.service /etc/shipify/agents-net.nft
rmdir /etc/shipify 2>/dev/null || true
nft delete table inet shipify_agents 2>/dev/null || true
systemctl daemon-reload
echo "  gone"

say "The runner's and the agents' users, with their ID ranges, folders and processes"
for u in $(getent passwd | cut -d: -f1 | grep -E '^shipify(-agent-[0-9]+)?$' || true); do
  # As the user first: that reaches its containers too, which run as IDs of its range.
  sudo -u "$u" kill -KILL -1 2>/dev/null || true
  pkill -KILL -u "$u" 2>/dev/null || true
  usermod --del-subuids 0-4294967294 --del-subgids 0-4294967294 "$u" 2>/dev/null || true
  if userdel "$u"; then echo "  $u: gone"; else echo "  ✗ $u stays (above)"; fi
done
rm -rf /home/shipify /srv/shipify-agent-* /opt/shipify /var/log/shipify-box-updates.log
for deny in /etc/cron.deny /etc/at.deny; do
  [ ! -f "$deny" ] || sed -i '/^shipify-agent-[0-9]*$/d' "$deny"
done

say "Its rules"
rm -f /etc/sudoers.d/shipify-agents /etc/needrestart/conf.d/50-shipify-box.conf \
  /etc/containers/shipify-agents.conf /etc/containers/registries.conf.d/50-shipify.conf /etc/containers/nodocker
echo "  the sudo rule, the update rule for the slots and the agents' container settings: gone"

say "Checking nothing of the box is left"
left=$(
  {
    systemctl list-unit-files 'shipify-box*' 'shipify-agents-net*' --no-legend 2>/dev/null
    getent passwd | grep '^shipify'
    grep -H '^shipify' /etc/subuid /etc/subgid
    ls -d /home/shipify /srv/shipify-agent-* /opt/shipify /etc/sudoers.d/shipify-agents
  } 2>/dev/null || true
)
if [ -n "$left" ]; then
  printf '  ✗ still here:\n%s\n' "$(printf '%s\n' "$left" | sed 's/^/    /')"
  echo "It's safe to run this again."
  exit 1
fi
echo "  nothing: Shipify is off this machine"
