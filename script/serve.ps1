$lanIp = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
  $_.InterfaceAlias -notmatch "Loopback|Bluetooth|vEthernet|WSL|Default Switch" -and
  $_.PrefixOrigin -ne "WellKnown" -and
  $_.IPAddress -match "^\d+\.\d+\.\d+\.\d+$"
} | Select-Object -First 1 -ExpandProperty IPAddress

if (-not $lanIp) {
  Write-Error "Impossibile trovare IP LAN. Verifica la connessione di rete."
  exit 1
}

Write-Output "IP LAN rilevato: $lanIp"
Write-Output "Avvio container nikcli-serve..."
Write-Output ""

$env:HOST_IP = $lanIp
docker compose -f docker-compose.serve.yml up -d

Write-Output ""
Write-Output "==================== ACCESSO ===================="
Write-Output " Web App:      https://nikcli.store/app/connect"
Write-Output " Server (LAN): http://${lanIp}:4096"
Write-Output " Password:     nikcli / dev123"
Write-Output "=================================================="
Write-Output ""
Write-Output "Collega il telefono alla stessa WiFi e inserisci:"
Write-Output "  Server: http://${lanIp}:4096"
Write-Output "  Utente: nikcli"
Write-Output "  Password: dev123"
