#!/bin/bash
# Start a local web server for The Haunted Map application
PORT=8000
echo "🎃 Starting The Haunted Map Web Application on http://localhost:$PORT ..."
echo "Press Ctrl+C to stop the server."

# Open browser automatically if on macOS
if command -v open >/dev/null 2>&1; then
  (sleep 1 && open "http://localhost:$PORT") &
fi

python3 -m http.server $PORT
