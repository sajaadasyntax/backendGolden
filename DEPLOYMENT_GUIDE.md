# Backend Deployment Guide

## Prerequisites
- Node.js (v18 or higher recommended)
- npm or yarn
- PostgreSQL database
- Environment variables configured

## Deployment Steps

### 1. Install Dependencies
```bash
npm install
```

### 2. Generate Prisma Client
```bash
npm run db:generate
```

### 3. Run Database Migrations
```bash
npm run db:migrate
```

### 4. Build the Project
```bash
npm run build
```

### 5. Start the Server
```bash
npm start
```

## Production Setup

### Using PM2 (Recommended)
```bash
# Install PM2 globally
npm install -g pm2

# Start the application
pm2 start dist/index.js --name golden-backend

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

### Using systemd
Create `/etc/systemd/system/golden-backend.service`:
```ini
[Unit]
Description=Golden Backend API
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/backendGolden
Environment=NODE_ENV=production
EnvironmentFile=/var/www/backendGolden/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable golden-backend
sudo systemctl start golden-backend
sudo systemctl status golden-backend
```

## Environment Variables

Create a `.env` file in the project root:
```env
# Database
DATABASE_URL=postgresql://golden:your_password@localhost:5432/golden

# Server
PORT=4000
NODE_ENV=production

# API Configuration
API_URL=https://api.alzahaby.cloud
FRONTEND_URL=https://your-frontend-domain.com

# JWT Secret (generate a strong random string)
JWT_SECRET=your-secret-key-here
JWT_EXPIRES_IN=7d
```

## Troubleshooting

### TypeScript not found
```bash
npm install
```

### Prisma Client not generated
```bash
npm run db:generate
```

### Database connection issues
- Check PostgreSQL is running: `sudo systemctl status postgresql`
- Verify DATABASE_URL in .env
- Test connection: `psql -h localhost -U golden -d golden`

### Port already in use
- Change PORT in .env
- Or kill the process: `lsof -ti:4000 | xargs kill -9`
