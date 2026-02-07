# Verify Backend Deployment

## ✅ Backend is Running!

Your backend is now running on `http://localhost:4000`. Now verify it's accessible through nginx.

## Step 1: Test Backend Locally (On Server)

```bash
# Test health endpoint
curl http://localhost:4000/health

# Should return:
# {"status":"ok","timestamp":"2024-..."}

# Test tRPC endpoint
curl -X POST http://localhost:4000/trpc/auth.login \
  -H "Content-Type: application/json" \
  -d '{"json":{"email":"test@test.com","password":"test"}}'

# Should return JSON (even if login fails, it should be JSON, not HTML)
```

## Step 2: Test Through nginx (Public URL)

```bash
# Test health endpoint through HTTPS
curl https://api.alzahaby.cloud/health

# Should return:
# {"status":"ok","timestamp":"2024-..."}

# If you get 502, nginx can't reach the backend
# If you get 404, nginx routing is wrong
# If you get HTML, nginx is serving wrong content
```

## Step 3: Check nginx Configuration

If Step 2 fails, check nginx config:

```bash
# View nginx config
sudo nano /etc/nginx/sites-available/api.alzahaby.cloud
# Or
sudo nano /etc/nginx/conf.d/api.alzahaby.cloud.conf

# Should have:
# location / {
#     proxy_pass http://localhost:4000;
#     ...
# }

# Test nginx config
sudo nginx -t

# Reload nginx if config changed
sudo systemctl reload nginx
```

## Step 4: Check nginx Error Logs

```bash
# Watch nginx errors in real-time
sudo tail -f /var/log/nginx/error.log

# Try accessing the API from mobile app
# Watch for any errors in the log
```

## Step 5: Test from Mobile App

Now that backend is running:

1. **Restart the mobile app** (if it's still running)
2. **Try to login** - should work now!
3. **Check console logs** for any errors

## Step 6: Keep Backend Running (PM2)

To ensure backend stays running after server restart:

```bash
# If not already using PM2:
cd /var/www/backendGolden
pm2 start dist/index.js --name golden-backend
pm2 save
pm2 startup  # Setup PM2 to start on boot

# Check status
pm2 status
pm2 logs golden-backend
```

## Common Issues After Backend Starts

### Issue: Still getting 502
**Solution**: 
- Check nginx is running: `sudo systemctl status nginx`
- Check nginx can reach backend: `curl http://localhost:4000/health` (from server)
- Restart nginx: `sudo systemctl restart nginx`

### Issue: Getting 404
**Solution**: 
- Check nginx `proxy_pass` points to `http://localhost:4000`
- Check nginx location block matches `/` or `/trpc`

### Issue: CORS errors in mobile app
**Solution**: 
- Verify `https://api.alzahaby.cloud` is in CORS allowed origins
- Check backend logs for CORS errors

### Issue: Database connection errors
**Solution**: 
- Verify `.env` has correct `DATABASE_URL`
- Test database: `psql -h localhost -U golden -d goldendatabase`
- Check backend logs for database errors

## Success Indicators

✅ `curl http://localhost:4000/health` returns JSON  
✅ `curl https://api.alzahaby.cloud/health` returns JSON  
✅ Mobile app can connect and login  
✅ No 502 errors  
✅ Backend logs show successful requests  

## Next Steps

Once everything is working:

1. **Setup PM2** to keep backend running
2. **Setup monitoring** (optional)
3. **Setup SSL certificate renewal** (if using Let's Encrypt)
4. **Setup log rotation** for PM2 logs
