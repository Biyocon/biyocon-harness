#!/usr/bin/env bash
set -euo pipefail

# Ubuntu's package transaction scans the hosted image's full dpkg database and
# runs post-install hooks. CI needs only the signed-archive payload, so pin and
# verify that payload before extracting it into the ephemeral runner directory.
readonly BUBBLEWRAP_VERSION='0.9.0-1ubuntu0.3'
readonly BUBBLEWRAP_SHA256='2461f1beee9cb04c8942739fe1a2b37e7b7c2a3d518f0779dc75f9245baa3094'
readonly BUBBLEWRAP_URLS=(
  "https://security.ubuntu.com/ubuntu/pool/main/b/bubblewrap/bubblewrap_${BUBBLEWRAP_VERSION}_amd64.deb"
  "https://archive.ubuntu.com/ubuntu/pool/main/b/bubblewrap/bubblewrap_${BUBBLEWRAP_VERSION}_amd64.deb"
)

: "${RUNNER_TEMP:?prepare-ci-bubblewrap requires RUNNER_TEMP}"
: "${GITHUB_PATH:?prepare-ci-bubblewrap requires GITHUB_PATH}"

if [[ "$(uname -s)" != 'Linux' || "$(uname -m)" != 'x86_64' ]]; then
  echo 'prepare-ci-bubblewrap supports only Linux x86_64 hosted runners' >&2
  exit 1
fi

archive="${RUNNER_TEMP}/bubblewrap_${BUBBLEWRAP_VERSION}_amd64.deb"
root="${RUNNER_TEMP}/dsh-bubblewrap"

download_status=1
for url in "${BUBBLEWRAP_URLS[@]}"; do
  if curl --fail --silent --show-error --location \
    --connect-timeout 5 --max-time 15 --retry 1 --retry-delay 1 --retry-max-time 20 \
    --retry-all-errors --output "$archive" "$url"; then
    printf '%s  %s\n' "$BUBBLEWRAP_SHA256" "$archive" | sha256sum --check --status
    download_status=0
    break
  else
    download_status=$?
    echo "bubblewrap download failed from $url (curl exit $download_status)" >&2
  fi
done
if (( download_status != 0 )); then
  echo "Unable to download pinned bubblewrap $BUBBLEWRAP_VERSION from either Ubuntu mirror" >&2
  exit "$download_status"
fi
mkdir -p "$root"
dpkg-deb --extract "$archive" "$root"
printf '%s\n' "$root/usr/bin" >> "$GITHUB_PATH"

sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0 \
  || echo 'apparmor userns knob absent — the functional probe decides'
"$root/usr/bin/bwrap" --version
"$root/usr/bin/bwrap" --ro-bind / / --dev /dev --proc /proc --die-with-parent -- true
echo 'bubblewrap functional probe passed'
