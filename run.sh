#!/bin/bash

echo "Starting local-ai-web services..."
docker compose up -d --build

if [ $? -eq 0 ]; then
    echo "Services started successfully! Opening web app..."
    if command -v xdg-open > /dev/null; then
        xdg-open "http://localhost:3000"
    elif command -v open > /dev/null; then
        open "http://localhost:3000"
    else
        echo "Please open http://localhost:3000 in your browser."
    fi
else
    echo "Failed to start services. Please check if Docker is running."
fi
