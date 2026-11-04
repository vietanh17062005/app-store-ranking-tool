# Run from the project directory in PowerShell.
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created .env from .env.example. Edit DB_* and API_TOKEN before continuing."
    exit 1
}

docker compose up -d --build
