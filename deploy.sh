#!/usr/bin/env bash
# deploy.sh — Deploy next-salesinvoice to production server
# Usage: ./deploy.sh
# Requires: sshpass, rsync installed locally
#
# After first deploy, ensure .env is configured on the server:
#   ssh bosscatdog@192.168.2.109 "cp ~/next-salesinvoice/.env.example ~/next-salesinvoice/.env && nano ~/next-salesinvoice/.env"

set -euo pipefail

SERVER_USER="bosscatdog"
SERVER_HOST="192.168.2.109"
SERVER_PASS="boss123456"
DEPLOY_DIR="/home/bosscatdog/next-salesinvoice"
FRONTEND_PORT=3040
LOG_FILE="~/cloudflared-next-salesinvoice.log"

SSH_CMD="sshpass -p '${SERVER_PASS}' ssh -o StrictHostKeyChecking=no ${SERVER_USER}@${SERVER_HOST}"
RSYNC_CMD="sshpass -p '${SERVER_PASS}' rsync -avz --progress"

echo "===> [1/4] Syncing project files to server..."
${RSYNC_CMD} \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='frontend/dist' \
  --exclude='backend/.gocache' \
  --exclude='backend/.gopath' \
  --exclude='.env' \
  ./ "${SERVER_USER}@${SERVER_HOST}:${DEPLOY_DIR}/"

echo ""
echo "===> [2/4] Ensuring .env exists on server..."
eval "${SSH_CMD}" "bash -s" <<'REMOTE'
DEPLOY_DIR="/home/bosscatdog/next-salesinvoice"
if [ ! -f "${DEPLOY_DIR}/.env" ]; then
  cp "${DEPLOY_DIR}/.env.example" "${DEPLOY_DIR}/.env"
  echo "  .env created from .env.example — PLEASE EDIT IT before use!"
  echo "  Run: nano ${DEPLOY_DIR}/.env"
  exit 1
else
  echo "  .env already exists — skipping copy"
fi
REMOTE

echo ""
echo "===> [3/4] Building Docker images and starting containers..."
eval "${SSH_CMD}" "bash -s" <<'REMOTE'
DEPLOY_DIR="/home/bosscatdog/next-salesinvoice"
cd "${DEPLOY_DIR}"
docker compose down --remove-orphans 2>/dev/null || true
docker compose up -d --build
echo "  Containers started:"
docker compose ps
REMOTE

echo ""
echo "===> [4/4] Starting Cloudflare Quick Tunnel on port 3040..."
eval "${SSH_CMD}" "bash -s" <<REMOTE
# Kill any previous tunnel for this project
pkill -f "cloudflared.*3040" 2>/dev/null || true
sleep 1

# Start new quick tunnel in background, log URL to file
nohup cloudflared tunnel --url http://127.0.0.1:${FRONTEND_PORT} --no-autoupdate > ${LOG_FILE} 2>&1 &
TUNNEL_PID=\$!
echo "  cloudflared PID: \${TUNNEL_PID}"

# Wait a moment then extract the tunnel URL from the log
sleep 5
TUNNEL_URL=\$(grep -oP 'https://[a-z0-9\-]+\.trycloudflare\.com' ${LOG_FILE} 2>/dev/null | head -1 || true)

if [ -n "\${TUNNEL_URL}" ]; then
  echo ""
  echo "  =============================================="
  echo "  Cloudflare Quick Tunnel URL:"
  echo "  \${TUNNEL_URL}"
  echo "  =============================================="
else
  echo "  Tunnel started — check log for URL:"
  echo "  ssh ${SERVER_USER}@${SERVER_HOST} 'grep trycloudflare ${LOG_FILE}'"
fi
REMOTE

echo ""
echo "Deploy complete."
echo ""
echo "Useful commands:"
echo "  View logs:      sshpass -p '${SERVER_PASS}' ssh ${SERVER_USER}@${SERVER_HOST} 'cd ${DEPLOY_DIR} && docker compose logs -f'"
echo "  Tunnel URL:     sshpass -p '${SERVER_PASS}' ssh ${SERVER_USER}@${SERVER_HOST} 'grep trycloudflare ${LOG_FILE}'"
echo "  Backend direct: http://${SERVER_HOST}:8085"
echo "  Frontend direct: http://${SERVER_HOST}:${FRONTEND_PORT}"
