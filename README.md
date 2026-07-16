## College Portal

Full-stack college portal with:
- JWT auth (student/admin roles)
- Notice board
- Marks management
- File upload/download
- Student profile view

## Project Structure

- `server/` - Express + MongoDB API, serves frontend static files
- `client/` - HTML/CSS/JS pages

## Prerequisites

- Node.js 18+
- MongoDB running locally on `mongodb://127.0.0.1:27017`

## Run

1. Install dependencies (if needed):
   - `cd server`
   - `npm install`
2. Start server:
   - `npm start`
3. Open:
   - `http://localhost:5000`

## Login Credentials

The server creates a master admin automatically when MongoDB is connected:

- Username: `masteradmin`
- Password: `MasterAdmin@123`

You can override these before starting the server with:

- `MASTER_ADMIN_USERNAME`
- `MASTER_ADMIN_PASSWORD`
- `MASTER_ADMIN_NAME`

If an old database already has a different password for `masteradmin`, reset/create the account with:

- `cd server`
- `npm run reset:master-admin`

Student accounts can be created from `register.html`. Use usernames like `21bca56051`, `22bsccs55005`, or `23mscit56012`.
Faculty/admin accounts can be created after logging in as the master admin.

## Default Behavior

- Register as `student`, or create faculty/admin users from the master admin dashboard
- Login redirects by role:
  - admin/master admin -> `admin-dashboard.html`
  - student -> `student-dashboard.html`

## API Base

- `/api/auth`
- `/api/notice`
- `/api/marks`
- `/api/files`
