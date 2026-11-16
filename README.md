# appt-mgmt-communication-api

Communication bounded context for Salud Activa. The API provides authenticated direct messaging
and persists conversation history in MongoDB.

## Run locally

Requires Node.js 22+ and MongoDB. Configure the same `JWT_SECRET` used by the authentication
service; communication tokens must contain a string `userId` claim.

```powershell
Copy-Item .env.example .env
npm ci
npm start
```

The service listens on `http://localhost:3004`. For a containerized local stack, set
`JWT_SECRET` in the shell or `.env`, then run:

```powershell
docker compose up --build
```

## API

All `/api/messages` endpoints require `Authorization: Bearer <JWT>`.

| Method and route | Description |
|---|---|
| `GET /api/messages?withUser=<userId>` | Read the direct conversation. Supports `limit` (1-100) and the opaque `before` cursor returned by the previous page. |
| `POST /api/messages` | Send `{ "toUserId": "<userId>", "content": "..." }`. |
| `PATCH /api/messages/{id}/read` | Mark a message addressed to the caller as read. |
| `GET /health/live` | Liveness probe. |
| `GET /health/ready` | Readiness probe; returns 503 when MongoDB is unavailable. |

Messages are scoped to the two participants in the JWT and request. The sender identity is always
derived from the signed token, and only the recipient can mark a message as read. Content is trimmed
and limited to 2,000 characters.

See [OpenAPI contract](docs/openapi.yaml).

## Tests

```powershell
npm test
```

## Branching

Changes enter through child branches and pull requests:

```
hu-xxx-dev -> PR develop -> PR qa -> PR main
```

Do not commit directly to permanent environment branches. Promotion follows the team repository
policy; `main` requires approval from `ariel5253`. Governance details are in
[`library-docs`](https://github.com/code-corhuila/library-docs).
