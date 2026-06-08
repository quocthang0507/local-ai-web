# Start the Docker container stack
Write-Host "Starting local-ai-web services..." -ForegroundColor Cyan
docker compose up -d --build

if ($LASTEXITCODE -eq 0) {
    Write-Host "Services started successfully! Opening web app..." -ForegroundColor Green
    Start-Process "http://localhost:3000"
} else {
    Write-Host "Failed to start services. Please check if Docker is running." -ForegroundColor Red
}
