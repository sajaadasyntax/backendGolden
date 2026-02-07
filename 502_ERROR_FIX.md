# Fixing 502 Bad Gateway Error

## What 502 Means
HTTP 502 means your reverse proxy (nginx) is running but **cannot connect to the backend server**. The backend is either:
- Not running
- Crashed
- Not listening on the correct port
- Blocked by firewall

## Step-by-Step Fix

### 1. Check if Backend is Running

```bash
# Check if Node.js process is running
ps aux | grep node

# Or if using PM2:
pm2 list

# Check if port 4000 is in use
sudo netstat -tlnp | grep 4000
# Or
sudo ss -tlnp | grep 4000
```

### 2. Start/Restart the Backend

```bash
cd /var/www/backendGolden

# If using PM2:
pm2 restart golden-backend
# Or start it:
pm2 start dist/index.js --name golden-backend

# If not using PM2, start manually:
NODE_ENV=production node dist/index.js

# Or with npm:
npm start
```

### 3. Check Backend Logs

```bash
# PM2 logs:
pm2 logs golden-backend

# Or if running manually, check the console output
# Look for errors like:
# - Database connection errors
# - Port already in use
# - Missing environment variables
```

### 4. Verify Environment Variables

```bash
cd /var/www/backendGolden

# Check if .env exists
ls -la .env

# Verify DATABASE_URL is set correctly
cat .env | grep DATABASE_URL

# Should be:
# DATABASE_URL=postgresql://golden:g123@localhost:5432/goldendatabase
```

### 5. Test Backend Directly (Bypass nginx)

```bash
# On the server, test if backend responds:
curl http://localhost:4000/health

# Should return: {"status":"ok","timestamp":"..."}
```

If this works, the backend is running but nginx can't reach it.

### 6. Check nginx Configuration

```bash
# Check nginx error logs
sudo tail -f /var/log/nginx/error.log

# Check nginx configuration
sudo nano /etc/nginx/sites-available/api.alzahaby.cloud
# Or
sudo nano /etc/nginx/conf.d/api.alzahaby.cloud.conf
```

Ensure the proxy_pass points to the correct backend:
```nginx
location / {
    proxy_pass http://localhost:4000;  # ← Should match your backend port
    # ... rest of config
}
```

### 7. Test Database Connection

```bash
# Test if database is accessible
psql -h localhost -U golden -d goldendatabase
# Enter password: g123

# If this fails, fix database connection first
```

### 8. Common Issues and Solutions

#### Issue: Backend crashes on startup
**Solution**: Check logs for errors:
```bash
pm2 logs golden-backend --lines 50
```

Common causes:
- Database connection failed
- Missing environment variables
- Port already in use

#### Issue: Port 4000 already in use
**Solution**: 
```bash
# Find what's using port 4000
sudo lsof -i :4000
# Kill the process or change PORT in .env
```

#### Issue: Database connection error
**Solution**: 
```bash
# Verify database is running
sudo systemctl status postgresql

# Test connection
psql -h localhost -U golden -d goldendatabase
```

#### Issue: Missing Prisma Client
**Solution**:
```bash
cd /var/www/backendGolden
npm run db:generate
```

### 9. Complete Restart Sequence

```bash
# 1. Stop everything
pm2 stop golden-backend
# Or kill the process

# 2. Verify port is free
sudo netstat -tlnp | grep 4000

# 3. Generate Prisma client
cd /var/www/backendGolden
npm run db:generate

# 4. Start backend
pm2 start dist/index.js --name golden-backend
# Or
NODE_ENV=production node dist/index.js

# 5. Check it's running
pm2 logs golden-backend
# Should see: "🚀 Server running on http://localhost:4000"

# 6. Test locally
curl http://localhost:4000/health

# 7. Reload nginx
sudo nginx -t  # Test config
sudo systemctl reload nginx

# 8. Test from outside
curl https://api.alzahaby.cloud/health
```

### 10. Verify Everything Works

```bash
# Test health endpoint
curl https://api.alzahaby.cloud/health

# Test tRPC endpoint
curl -X POST https://api.alzahaby.cloud/trpc/auth.login \
  -H "Content-Type: application/json" \
  -d '{"json":{"email":"test@test.com","password":"test"}}'
```

Both should return JSON, not HTML or 502 errors.
