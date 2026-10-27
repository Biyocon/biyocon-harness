#!/usr/bin/env bash
# Runner-only Wine provisioning; application tests remain in wine-windows-gates.sh.
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
command=${1:?Expected plan, download, verify or install}
plan=${2:?Expected archive plan path}
archive_dir=${3:-"$HOME/wine-debs"}
apt_options=(-o Acquire::Retries=0 -o "Dir::Cache::archives=$archive_dir")
if [[ "$command" != install ]]; then
  # Keep the seed's package sources and indexes private to this job. Runner
  # mirrorlists can select azure.archive.ubuntu.com and stall on libwine.
  apt_options+=(-o "Dir::Etc::sourcelist=$plan.sources.list" -o Dir::Etc::sourceparts=- -o "Dir::State::lists=$plan.lists")
fi

case "$command" in
  plan)
    if ! grep -qx 'ID=ubuntu' /etc/os-release; then
      echo 'wine-cache: provisioning requires an Ubuntu runner' >&2
      exit 1
    fi
    codename=$(sed -n 's/^VERSION_CODENAME=//p' /etc/os-release)
    if [[ ! "$codename" =~ ^[a-z]+$ ]]; then
      echo 'wine-cache: missing Ubuntu release codename' >&2
      exit 1
    fi
    printf '%s\n' \
      "deb https://archive.ubuntu.com/ubuntu $codename main universe" \
      "deb https://archive.ubuntu.com/ubuntu $codename-updates main universe" \
      "deb https://security.ubuntu.com/ubuntu $codename-security main universe" > "$plan.sources.list"
    mkdir -p "$plan.lists/partial"
    sudo apt-get "${apt_options[@]}" update
    wine_version=$(apt-cache "${apt_options[@]}" policy wine | awk '/Candidate:/ { print $2 }')
    if [[ -z "$wine_version" || "$wine_version" == '(none)' ]]; then
      echo 'wine-cache: no Wine candidate available' >&2
      exit 1
    fi
    mkdir -p "$plan.archives"
    apt-get "${apt_options[@]}" -o "Dir::Cache::archives=$plan.archives" -o Acquire::ForceHash=SHA256 \
      --print-uris --yes --download-only --no-install-recommends \
      install "wine=$wine_version" | tee "$plan.apt.log"
    node "$script_dir/wine-apt-cache.mjs" plan "$plan.apt.log" "$wine_version" \
      "${ImageOS:?Missing runner image OS}-${ImageVersion:?Missing runner image version}" "$plan"
    ;;
  download)
    wine_version=$(node "$script_dir/wine-apt-cache.mjs" version "$plan")
    mkdir -p "$archive_dir"
    sudo apt-get "${apt_options[@]}" --yes --download-only --no-install-recommends install "wine=$wine_version"
    cp "$plan" "$archive_dir/wine-plan.json"
    ;;
  verify|install)
    node "$script_dir/wine-apt-cache.mjs" validate "$plan" "$archive_dir" "${WINE_CACHE_KEY:-}"
    archives=("$archive_dir"/*.deb)
    download_only=()
    if [[ "$command" == verify ]]; then download_only=(--download-only); fi
    # The network namespace makes the offline requirement independent of apt configuration.
    sudo unshare --net apt-get "${apt_options[@]}" --yes --no-download \
      "${download_only[@]}" --no-install-recommends install "${archives[@]}" 2>&1 | tee "$plan.$command.log"
    node "$script_dir/wine-apt-cache.mjs" offline-log "$plan.$command.log"
    ;;
  *)
    echo "wine-cache: unknown command $command" >&2
    exit 1
    ;;
esac
