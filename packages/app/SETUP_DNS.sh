#!/bin/bash
# Setup DNS for app.nikcli.store

# Instructions:
# 1. Go to https://dash.cloudflare.com
# 2. Click "DNS" 
# 3. Click "Add record"
# 4. Select type: CNAME
# 5. Name: app
# 6. Target: nikcli-app.pages.dev
# 7. TTL: Auto
# 8. Click "Save"

# Alternative: Add via API
# Get API token from: https://dash.cloudflare.com/profile/api-tokens
# Then run:
# 
# curl -X POST "https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/dns_records" \
#   -H "Authorization: Bearer <API_TOKEN>" \
#   -H "Content-Type: application/json" \
#   -d '{
#     "type": "CNAME",
#     "name": "app",
#     "content": "nikcli-app.pages.dev",
#     "ttl": 1,
#     "proxied": false
#   }'
