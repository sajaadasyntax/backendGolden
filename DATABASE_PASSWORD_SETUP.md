# Database Password Setup Guide

Based on your command history, you created a PostgreSQL user `golden` but didn't set a password. Here's how to set it:

## Option 1: Set Password for Existing User (Recommended)

```bash
# Connect as postgres superuser
sudo -i -u postgres
psql

# Set password for golden user
ALTER USER golden WITH PASSWORD 'your_secure_password_here';

# Exit psql
\q
exit
```

## Option 2: Create User with Password

If you want to recreate the user with a password:

```bash
sudo -i -u postgres
psql

# Drop existing user (if needed)
DROP USER IF EXISTS golden;

# Create user with password
CREATE USER golden WITH PASSWORD 'your_secure_password_here';

# Grant privileges
GRANT ALL PRIVILEGES ON DATABASE golden TO golden;

# Exit
\q
exit
```

## Option 3: Use Peer Authentication (Local Only)

If you're connecting from the same machine, you can use peer authentication by editing `/etc/postgresql/16/main/pg_hba.conf`:

```
# Change this line:
local   all             all                                     peer

# To:
local   all             all                                     md5
```

Then restart PostgreSQL:
```bash
sudo systemctl restart postgresql
```

## Update Your DATABASE_URL

After setting the password, update your `.env` file:

```env
DATABASE_URL=postgresql://golden:your_secure_password_here@localhost:5432/golden
```

## Test Connection

```bash
psql -h localhost -U golden -d golden
# Enter the password when prompted
```

## Security Note

- Use a strong password (at least 12 characters, mix of letters, numbers, symbols)
- Never commit passwords to version control
- Consider using environment variables or a secrets manager in production
