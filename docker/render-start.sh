#!/bin/sh
# Starts the API (on $PORT, which the host sets) and then the Telegram bot in the same container.
# If either one stops, the container exits so the host restarts both.
# Heap caps keep the pair inside a 512 MB instance (Render Free); raise API_HEAP_MB on bigger plans.
PORT="${PORT:-4000}"
export PORT
# The bot talks to the API inside the container unless told otherwise.
export API_INTERNAL_URL="${API_INTERNAL_URL:-http://127.0.0.1:$PORT/api}"

cd /app/apps/api && node --max-old-space-size="${API_HEAP_MB:-256}" dist/main.js &
API_PID=$!

# Wait for the API to answer before starting the bot (up to 60 s).
i=0
until wget -qO- "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 || [ $i -ge 60 ]; do
  i=$((i + 1))
  sleep 1
done

BOT_PID=""
if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ "$RUN_BOT" != "false" ]; then
  cd /app/apps/bot && node --max-old-space-size="${BOT_HEAP_MB:-96}" dist/main.js &
  BOT_PID=$!
fi

trap 'kill $API_PID $BOT_PID 2>/dev/null; exit 0' TERM INT

while kill -0 "$API_PID" 2>/dev/null && { [ -z "$BOT_PID" ] || kill -0 "$BOT_PID" 2>/dev/null; }; do
  sleep 5
done
echo "API or bot stopped; exiting so the host restarts the service." >&2
kill $API_PID $BOT_PID 2>/dev/null
exit 1
