#!/usr/bin/env bash
# Runner-only Wine provisioning; application tests remain in wine-windows-gates.sh.
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
command=${1:?Expected plan, download, verify, stage or install}
plan=${2:?Expected archive plan path}
archive_dir=${3:-"$HOME/wine-debs"}
image="${ImageOS:?Missing runner image OS}-${ImageVersion:?Missing runner image version}"
privileged=()
if (( EUID != 0 )); then privileged=(sudo); fi
apt_options=(-o Acquire::Retries=0 -o "Dir::Cache::archives=$archive_dir")

case "$command" in
  plan)
    wine_version=$(apt-cache policy wine | awk '/Candidate:/ { print $2 }')
    if [[ -z "$wine_version" || "$wine_version" == '(none)' ]]; then
      echo 'wine-cache: no Wine candidate in the runner image indexes' >&2
      exit 1
    fi
    # Resolve against this image's existing indexes and installed packages.
    # An empty archive directory prevents local apt files changing the plan.
    mkdir -p "$plan.archives"
    "${privileged[@]}" unshare --net apt-get "${apt_options[@]}" \
      -o "Dir::Cache::archives=$plan.archives" -o Acquire::ForceHash=SHA256 \
      --print-uris --yes --download-only --no-install-recommends \
      install "wine=$wine_version" | tee "$plan.apt.log"
    node "$script_dir/wine-apt-cache.mjs" plan "$plan.apt.log" "$wine_version" "$image" "$plan"
    ;;
  download)
    node "$script_dir/wine-apt-cache.mjs" downloads "$plan" > "$plan.urls"
    mkdir -p "$archive_dir"
    while IFS=$'\t' read -r uri filename; do
      echo "wine-cache: downloading $filename from $uri"
      curl --fail --silent --show-error --location --output "$archive_dir/$filename" "$uri"
    done < "$plan.urls"
    cp "$plan" "$archive_dir/wine-plan.json"
    ;;
  stage)
    # Confirm cache transport into an empty destination, never over seed files.
    mv -- "$archive_dir" "$plan.produced"
    ;;
  verify|install)
    node "$script_dir/wine-apt-cache.mjs" validate "$plan" "$archive_dir" "$image" "${WINE_CACHE_KEY:-}"
    archives=("$archive_dir"/*.deb)
    download_only=()
    if [[ "$command" == verify ]]; then download_only=(--download-only); fi
    "${privileged[@]}" unshare --net apt-get "${apt_options[@]}" --yes --no-download \
      "${download_only[@]}" --no-install-recommends install "${archives[@]}" 2>&1 | tee "$plan.$command.log"
    node "$script_dir/wine-apt-cache.mjs" offline-log "$plan.$command.log"
    ;;
  *)
    echo "wine-cache: unknown command $command" >&2
    exit 1
    ;;
esac
