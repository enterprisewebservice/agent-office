# Live DaemonSet script as found on 6 Nov 2026 (hand-patched earlier; Argo ignored
# /spec/template/spec/containers/0/args until that night). Per-GPU 250 W overrides by
# UUID: the spare RTX 4090 and the three RTX 3090 Ti. Kept so the caps can come back.
# To restore: put this back into daemonset.yaml's args (or re-add the ignoreDifferences
# and patch the live DaemonSet), and set POWER_CAP_WATTS to SAVED_POWER_CAP_WATTS.
set -eu
echo "[gpu-power-cap] node=$NODE_NAME starting"
# Persistence mode = the cap persists across power-state
# transitions. Without this, suspend+resume can reset
# the cap to default. -pm 1 = enable.
nvidia-smi -pm 1 || echo "[gpu-power-cap] WARN nvidia-smi -pm 1 failed"
# Authorized per-GPU overrides: spare RTX4090=250W and all three RTX3090Ti=250W.
# All other GPU limits retain the ConfigMap default.
apply_caps() {
  gpu_uuids=$(nvidia-smi --query-gpu=uuid --format=csv,noheader) || return $?
  for gpu_uuid in $gpu_uuids; do
    gpu_target="$WATTS"
    case "$gpu_uuid" in
      GPU-aff29727-c8ae-cb0b-3adb-d7ed3ee64e80) gpu_target=250 ;;
      GPU-eca399cc-addd-732b-6b1e-1e4fbdc3bfe9) gpu_target=250 ;;
      GPU-9875bf0a-a989-fece-ff00-a2569a7c75a1) gpu_target=250 ;;
      GPU-1f30f620-4fa4-5864-5c95-77ebc0f3e991) gpu_target=250 ;;
    esac
    nvidia-smi -i "$gpu_uuid" -pl "$gpu_target" || return $?
  done
}
while true; do
  # Reload values from ConfigMap mount on each iteration
  # so a `kubectl edit cm` change is picked up without
  # restarting the DS.
  WATTS=$(cat /etc/gpu-power-cap/POWER_CAP_WATTS)
  INTERVAL=$(cat /etc/gpu-power-cap/REAPPLY_INTERVAL_SECONDS)
  # Apply to every GPU on this node. Quiet the noisy
  # success output; keep error output.
  if out=$(apply_caps 2>&1); then
    echo "[gpu-power-cap] node=$NODE_NAME default-cap=${WATTS}W applied (spare4090=250W; three3090Tis=250W)"
  else
    echo "[gpu-power-cap] node=$NODE_NAME ERROR setting cap=${WATTS}W: $out"
  fi
  sleep "$INTERVAL"
done
