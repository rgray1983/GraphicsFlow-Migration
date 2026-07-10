# GraphicsFlow V3

GraphicsFlow V3 is a TypeScript, React, and Tailwind rebuild of the working Graphics Manager 2.0 application.

The `PHP version/` directory is the read-only behavioral reference for the rebuild. New application code lives in `graphicsflow-v3/`.

## First milestone

The foundation includes:

- React + TypeScript + Vite frontend
- Tailwind CSS design tokens
- React Router application shell
- Fastify TypeScript API
- Shared Zod schemas and TypeScript types
- Environment-based storage configuration
- Health-check endpoint

## Development

```bash
cd graphicsflow-v3
npm install
cp .env.example .env
npm run dev
```

Frontend: `http://localhost:5173`

API: `http://localhost:3001/api/health`

See `graphicsflow-v3/README.md` for project details.
