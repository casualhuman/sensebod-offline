#!/bin/sh
# Reviewer B: start / stop the two test servers with the COMMITTED configs, unchanged.
#   sh containers.sh up <repo root> <work dir>     work dir holds www/ (releases/r1 + current symlink) and media/
#   sh containers.sh down
# nginx  : image built from Dockerfile.nginx-bookworm (Debian 12 nginx-light 1.22.1), port 48080
# caddy  : official caddy:2 image with app/deploy/Caddyfile mounted, port 48081
# Both configs proxy the API to 127.0.0.1:8000. A socat process in the same network namespace
# forwards that port to the mock API of "vite preview" on the host (port 44173): test harness only.
# 48083 is a second nginx with NOTHING on port 8000 (backend down); 48084 the same for Caddy.
set -e
case "$1" in
up)
  REPO="$2"; WORK="$3"
  docker run -d --name sensebod-review-b-nginx -p 127.0.0.1:48080:80 -e API_FORWARD=host.docker.internal:44173 \
    -v "$WORK/www:/var/www/sensebod:ro" -v "$WORK/media:/var/lib/sensebod/media:ro" sensebod-review-b-nginx
  docker run -d --name sensebod-review-b-nginx-noapi -p 127.0.0.1:48083:80 \
    -v "$WORK/www:/var/www/sensebod:ro" -v "$WORK/media:/var/lib/sensebod/media:ro" sensebod-review-b-nginx
  docker run -d --name sensebod-review-b-caddy -p 127.0.0.1:48081:80 -v "$REPO/app/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" \
    -v "$WORK/www:/var/www/sensebod:ro" -v "$WORK/media:/var/lib/sensebod/media:ro" caddy:2
  docker run -d --name sensebod-review-b-caddy-fwd --network container:sensebod-review-b-caddy sensebod-review-b-nginx \
    socat TCP-LISTEN:8000,bind=127.0.0.1,fork,reuseaddr TCP:host.docker.internal:44173
  docker run -d --name sensebod-review-b-caddy-noapi -p 127.0.0.1:48084:80 -v "$REPO/app/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" \
    -v "$WORK/www:/var/www/sensebod:ro" -v "$WORK/media:/var/lib/sensebod/media:ro" caddy:2
  sleep 2
  docker exec sensebod-review-b-nginx nginx -t
  docker exec sensebod-review-b-nginx nginx -v
  docker exec sensebod-review-b-caddy caddy version
  docker exec sensebod-review-b-caddy caddy validate --config /etc/caddy/Caddyfile 2>&1 | tail -2
  ;;
down)
  for c in sensebod-review-b-nginx sensebod-review-b-nginx-noapi sensebod-review-b-caddy-fwd sensebod-review-b-caddy sensebod-review-b-caddy-noapi sensebod-review-b-c58; do
    docker rm -f "$c" 2>/dev/null || true
  done
  ;;
esac
