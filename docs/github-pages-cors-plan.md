# GitHub Pages CORS Implementation Plan

## Goal

Allow the PRISM Life Cycle Assessment frontend hosted on GitHub Pages to call the LCA REST API at:

```text
https://lca-mcp.mathplosion.com
```

The frontend repository is `calvinw/product-graph-editor`, so its production browser origin is:

```text
https://calvinw.github.io
```

The repository path is not part of a CORS origin.

## Current problem

The API currently accepts normal REST calls, but a browser preflight request to `POST /api/lca/run` returns `405 Method Not Allowed`. Because the request uses `Content-Type: application/json`, browsers perform an `OPTIONS` preflight before sending the calculation request. GitHub Pages calculations will remain blocked until the API responds to that preflight with the correct CORS headers.

## Required server change

Find the Python module that creates the existing FastAPI application (`app = FastAPI(...)`). Add FastAPI's `CORSMiddleware` to that same application. Do not create a second FastAPI instance.

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://calvinw.github.io",
        "http://localhost:5173",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)
```

Place the middleware configuration near the creation of `app`, before the server begins handling requests.

### Security constraints

- Do not use `allow_origins=["*"]`.
- Do not enable credentials; this REST API currently requires no authentication.
- Keep the existing REST and MCP routes unchanged.
- Permit the production GitHub Pages origin and local Vite development origin only.

## Automated tests

Add or update server tests to verify:

1. An `OPTIONS /api/lca/run` request from `https://calvinw.github.io` succeeds.
2. Its response includes `Access-Control-Allow-Origin: https://calvinw.github.io`.
3. `POST` and the `content-type` request header are allowed by the preflight response.
4. A request from an unlisted origin does not receive an `Access-Control-Allow-Origin` header.
5. Existing health, tools, LCA REST, and MCP tests still pass.

Example preflight request for a FastAPI test client:

```python
response = client.options(
    "/api/lca/run",
    headers={
        "Origin": "https://calvinw.github.io",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    },
)

assert response.status_code == 200
assert response.headers["access-control-allow-origin"] == "https://calvinw.github.io"
assert "POST" in response.headers["access-control-allow-methods"]
assert "content-type" in response.headers["access-control-allow-headers"].lower()
```

## Deployment

Deploy the changed API to the DigitalOcean droplet using the repository's existing deployment process. This may be a Docker Compose rebuild or a systemd service restart; inspect the repository and deployment configuration rather than assuming which one is used.

Typical examples are:

```bash
docker compose up -d --build
```

or:

```bash
sudo systemctl restart <service-name>
```

## Production verification

After deployment, run:

```bash
curl -i -X OPTIONS \
  -H "Origin: https://calvinw.github.io" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type" \
  https://lca-mcp.mathplosion.com/api/lca/run
```

Acceptance criteria:

- The response is HTTP `200` (not `405`).
- `access-control-allow-origin` is exactly `https://calvinw.github.io`.
- `access-control-allow-methods` permits `POST`.
- `access-control-allow-headers` permits `content-type`.

Then verify the standard startup sequence still works:

```bash
curl -sS https://lca-mcp.mathplosion.com/api/health
curl -sS https://lca-mcp.mathplosion.com/api/tools
```

Finally, open the deployed GitHub Pages site, select **LCA Results**, choose **Calculate**, and confirm that the current YAML graph produces the rendered Markdown results report without a browser CORS error.

## Frontend compatibility

The frontend already defaults to calling `https://lca-mcp.mathplosion.com` in production. Once the API enables CORS, no production proxy and no additional frontend configuration should be required. Local development continues to use the Vite `/lca-api` proxy.
