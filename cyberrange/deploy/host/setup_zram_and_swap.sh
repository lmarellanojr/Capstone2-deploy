#!/usr/bin/env bash
# deploy/host/setup_zram_and_swap.sh -- OCI HOST script (not guacamole). Run once
# per host. Order matters: disk-swap isolation runs BEFORE zram is enabled --
# see design spec "Swap isolation" for why swapoff -a after zram is active
# would disable zram too.
set -euo pipefail

echo "=== pre-check: existing swap ==="
swapon --show || true

# Remove any disk-backed swap (some cloud images provision one by default).
# Targeted swapoff on whatever's actually listed -- never a blanket `swapoff -a`.
while read -r line; do
  dev="$(echo "$line" | awk '{print $1}')"
  [[ "$dev" == "NAME" || -z "$dev" ]] && continue
  echo "Disabling disk-backed swap: $dev"
  sudo swapoff "$dev"
done < <(swapon --show --noheadings 2>/dev/null || true)

sudo sed -i.bak '/\sswap\s/d' /etc/fstab 2>/dev/null || true

echo "=== installing systemd-zram-generator ==="
sudo apt-get update
sudo apt-get install -y systemd-zram-generator

sudo tee /etc/systemd/zram-generator.conf > /dev/null <<'EOF'
[zram0]
zram-size = 3072
compression-algorithm = lz4
EOF

sudo sysctl -w vm.swappiness=80
echo 'vm.swappiness=80' | sudo tee /etc/sysctl.d/99-zram-swappiness.conf > /dev/null

sudo systemctl daemon-reload
sudo systemctl start systemd-zram-setup@zram0.service

echo "=== post-check: zram-only ==="
zramctl
swapon --show
echo "Expect: exactly one entry, TYPE=zram or /dev/zram0 -- if any non-zram device"
echo "still appears, the disk-swap removal above did not fully take effect."

# === Storage-backend-conditional memory controls (design Round 6) =============
# PRIMARY PATH IS BTRFS. On btrfs, container file cache is charged to the
# container's own cgroup (cgroup v2 page-cache accounting), so it is already
# inside the ceilings this design sets and needs no extra bound here.
#
# ZFS is a supported ALTERNATE. On that path the ARC cap is MANDATORY, because
# ARC is host-kernel memory outside every cgroup ceiling (guacamole 2G, wazuh 3G,
# pod 4G) and uncapped can host-OOM Wazuh/Keycloak while every container is
# still inside its own limit.
if lxc storage list --format csv 2>/dev/null | grep -q ',zfs,'; then
  echo "=== ZFS pool detected (ALTERNATE path) -- ARC cap is mandatory here ==="
  # PROVISIONAL 512 MiB: at 1 GiB the budget is 10.5 + 1.0 = 11.5 vs ~11.7 usable
  # (~0.2 GiB free -- a rounding error, not a margin).
  echo "options zfs zfs_arc_max=536870912" | sudo tee /etc/modprobe.d/zfs.conf
  # modprobe.d only applies at next module load; apply now so this session is
  # actually protected and the value is verifiable.
  if [[ -w /sys/module/zfs/parameters/zfs_arc_max ]]; then
    echo 536870912 | sudo tee /sys/module/zfs/parameters/zfs_arc_max > /dev/null
  fi
  echo "--- verify ---"
  cat /sys/module/zfs/parameters/zfs_arc_max   # expect 536870912
  awk '/^size/ {print "current ARC size (bytes):", $3}' /proc/spl/kstat/zfs/arcstats

elif lxc storage list --format csv 2>/dev/null | grep -q ',btrfs,'; then
  echo "=== btrfs pool detected (PRIMARY path) -- no ARC concept, none needed ==="
  # btrfs still has an out-of-cgroup metadata slab (~0.1-0.3 GiB). It is NOT
  # bounded by a tunable -- it is monitored. Baseline it here for Task 9.
  awk '/^(SUnreclaim|SReclaimable)/ {print}' /proc/meminfo
  echo "--- pool usage (watch for ENOSPC-from-metadata even with raw space free) ---"
  sudo btrfs filesystem usage /var/snap/lxd/common/lxd/storage-pools/lxd-pool 2>/dev/null \
    || echo "(adjust path if the pool name differs; snap LXD lives under /var/snap/lxd/common/lxd)"
else
  echo "=== LXD pool is neither zfs nor btrfs (dir?) -- no storage memory control applied ==="
fi
