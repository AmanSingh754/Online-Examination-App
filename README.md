# Automated Examination Portal

This repository contains a full-stack examination platform with separate flows for:

- Regular students (Bulk uploaded by Admin)
- Walk-in students (Self-registration with Admin approval)
- Administrators

The system is built with a Node.js/Express backend (`Backend`) and a modern React + Vite frontend (`frontend-react`).

## Features

- **Admin Dashboard**: Manage students, approve registrations, and monitor exam events.
- **Walk-in Registration**: Students can register themselves; accounts remain `PENDING` until approved by an admin.
- **Bulk Upload**: Admin can upload regular students using XLSX templates.
- **Dynamic Question Banking**: Support for Aptitude, Technical (Stream-based), and Coding questions.
- **Proctoring**: Basic full-screen enforcement and violation tracking.
- **AI Integration**: Support for automated summary generation and grading (OpenAI/Azure OpenAI).
- **Result Export**: Detailed result reports available in Excel format.

## Tech Stack

- **Backend**: Node.js, Express, PostgreSQL
- **Frontend**: React 18, Vite, Vanilla CSS
- **Authentication**: Session-based (`express-session`)
- **Library Dependencies**: `xlsx` for reports, `pg` for database, `dotenv` for configuration.

## Project Structure

```text
Backend/          Express server, routes, database models, and LLM services.
frontend-react/   The active React application (Vite-based).
Frontend/         Legacy static HTML/JS frontend (for reference).
run-portal.ps1    PowerShell helper script for build and execution.
Dockerfile        Containerization support.
```

## Prerequisites

- Node.js (v18+)
- npm or yarn
- PostgreSQL instance (Running and accessible)

## Configuration

The backend requires a `.env` file in the `Backend/` directory. See `Backend/.env.example` (if available) or ensure the following variables are set:

- `SESSION_SECRET`: A strong unique key for session encryption.
- `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE`: PostgreSQL connection details.
- `PORT`: Port for the backend server (defaults to 5000).

## Installation

1. **Install Frontend Dependencies**:
   ```bash
   cd frontend-react
   npm install
   ```

2. **Install Backend Dependencies**:
   ```bash
   cd ../Backend
   npm install
   ```

## Running the Application

### Option 1: Automated Script (Windows/PowerShell)
```powershell
.\run-portal.ps1
```

### Option 2: Manual Start
1. **Build the Frontend**:
   ```bash
   cd frontend-react
   npm run build
   ```
2. **Start the Backend**:
   ```bash
   cd ../Backend
   node server.js
   ```

## Usage

Once the server is running, access the portal at:
`http://localhost:5000`

The backend automatically serves the production build of the React app from `frontend-react/dist`.

## Useful Scripts

- **Backend Smoke Tests**: `npm run smoke:regular` or `npm run smoke:walkin` (inside `Backend/`).
- **Frontend Development**: `npm run dev` (inside `frontend-react/`) to run with HMR on port 3000.

## Notes

- **Registration Flow**: New walk-in students must be approved in the Admin Dashboard before they can log in.
- **Static Content**: The `Frontend/` folder is legacy and is not used by the main application server.
- **Security**: Always rotate `SESSION_SECRET` and database credentials before production deployment.

## Author
Aman Kumar Singh
🔗 GitHub: [AmanSingh754](https://github.com/AmanSingh754)
