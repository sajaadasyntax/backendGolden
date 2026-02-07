# Troubleshooting Guide

## Mobile App Connection Issues

### Error: "JSON Parse error: Unexpected character: <"

This error means the server is returning HTML instead of JSON. Common causes:

#### 1. Backend Not Running
- **Check**: Is the backend server running on your Ubuntu server?
- **Solution**: 
  ```bash
  cd /var/www/backendGolden
  npm start
  # Or with PM2:
  pm2 start dist/index.js --name golden-backend
  ```

#### 2. Wrong API URL
- **Check**: Verify the API URL in `mobile/app.json` matches your server
- **Current**: `https://api.alzahaby.cloud`
- **Test**: Open `https://api.alzahaby.cloud/health` in a browser
  - Should return: `{"status":"ok","timestamp":"..."}`
  - If you get HTML/404, the URL is wrong or server isn't accessible

#### 3. Reverse Proxy/nginx Configuration
If using nginx as reverse proxy, ensure it's configured correctly:

```nginx
server {
    listen 443 ssl;
    server_name api.alzahaby.cloud;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

#### 4. CORS Issues
- Check backend CORS configuration in `src/index.ts`
- Ensure `https://api.alzahaby.cloud` is in allowed origins

#### 5. SSL Certificate Issues
- Verify SSL certificate is valid
- Check certificate expiration
- Ensure certificate matches the domain

### Testing Steps

1. **Test Health Endpoint**:
   ```bash
   curl https://api.alzahaby.cloud/health
   ```
   Should return JSON, not HTML

2. **Test tRPC Endpoint**:
   ```bash
   curl -X POST https://api.alzahaby.cloud/trpc/auth.login \
     -H "Content-Type: application/json" \
     -d '{"json":{"email":"test@test.com","password":"test"}}'
   ```

3. **Check Backend Logs**:
   ```bash
   # If using PM2:
   pm2 logs golden-backend
   
   # Or check systemd:
   sudo journalctl -u golden-backend -f
   ```

4. **Verify Environment Variables**:
   - Check `.env` file exists
   - Verify `DATABASE_URL` is correct
   - Verify `NODE_ENV=production`
   - Verify `API_URL` and `FRONTEND_URL` are set

### Common Solutions

#### Solution 1: Rebuild Mobile App
After changing `app.json`, you need to rebuild:
```bash
cd mobile
npx expo start --clear
# Then rebuild the app
```

#### Solution 2: Check Server Accessibility
```bash
# From your local machine, test if server is accessible:
curl -I https://api.alzahaby.cloud/health

# Should return HTTP 200, not 404 or 502
```

#### Solution 3: Check Firewall
```bash
# On Ubuntu server, ensure port 4000 is open (if not using reverse proxy):
sudo ufw allow 4000/tcp
```

#### Solution 4: Verify Database Connection
```bash
# Test database connection:
psql -h localhost -U golden -d goldendatabase
# Enter password when prompted
```

### Debug Mode

To see more detailed errors, temporarily enable debug logging in the mobile app by uncommenting console.log statements in `mobile/lib/api.ts`.
