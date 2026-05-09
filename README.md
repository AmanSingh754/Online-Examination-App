# Automated Examination Portal

This repository contains a full-stack examination platform with separate flows for:

- regular students
- walk-in students
- admins
- BDE users

The current app uses a Node.js/Express backend in `Backend` and a React + Vite frontend in `frontend-react`. A legacy static frontend also exists in `Frontend`, but the active UI work is in the React app.

## Features

- admin and BDE dashboards
- regular and walk-in student registration
- bulk regular student upload through XLSX
- regular and walk-in exam flows
- coding, MCQ, and descriptive question handling
- walk-in result review and report export
- Agentic AI stream support
- post-exam feedback collection

## Tech Stack

- Backend: Node.js, Express, PostgreSQL
- Frontend: React, Vite
- Auth/session: `express-session`
- LLM integrations: OpenAI / Azure OpenAI support in backend services
- File export/import: `xlsx`

## Project Structure

```text
Backend/          Express server, routes, DB layer, LLM helpers
frontend-react/   Active React frontend
Frontend/         Legacy static frontend
run-portal.ps1    Simple build-and-run script
Dockerfile
docker-compose.yml
```

## Prerequisites

- Node.js installed
- npm installed
- PostgreSQL reachable with the values configured in `Backend/.env`

## Environment

The backend reads configuration from `Backend/.env`.

Minimum required backend settings:

- `SESSION_SECRET`
- `PG_HOST`
- `PG_PORT`
- `PG_USER`
- `PG_PASSWORD`
- `PG_DATABASE`

Optional AI-related settings are also present in the backend for summary and grading flows.

## Install

From the project root:

```powershell
cd "c:\Users\Aman\OneDrive - iDataLytics LLC\Desktop\EXAM PORTAL - Copy"
```

Install frontend dependencies:

```powershell
cd frontend-react
npm install
cd ..
```

Install backend dependencies:

```powershell
cd Backend
npm install
cd ..
```

## Run

### Option 1: Use the helper script

This builds the React frontend and starts the backend server:

```powershell
.\run-portal.ps1
```

### Option 2: Run manually

Build the frontend:

```powershell
cd frontend-react
npm run build
cd ..
```

Start the backend:

```powershell
node Backend/server.js
```

## Local URL

Once the backend is running, open:

```text
http://localhost:5000
```

The backend serves the built React app from `frontend-react/dist`.

## Useful Scripts

Backend smoke scripts:

```powershell
cd Backend
npm run smoke:regular
npm run smoke:walkin
```

Frontend production build:

```powershell
cd frontend-react
npm run build
```

## Notes

- Student result visibility is currently disabled in the student-facing flow. After submission, students are redirected back to the dashboard instead of seeing marks.
- The repo currently contains environment secrets in `Backend/.env`. If this repository is shared publicly, those values should be rotated.
- `Frontend/` is kept for older static pages, but active changes should go into `frontend-react/`.

## GitHub

If this project is pushed to a separate repository branch, verify that you are viewing the correct branch on GitHub. For example, if code is pushed to `main-import`, the default `main` page may still show only the older placeholder content until you switch branches or merge it.
