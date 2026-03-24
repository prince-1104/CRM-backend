# Star Uniform Backend

## Local Run

1. Install dependencies:
   - `pip install -r requirements.txt`
2. Start development server:
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
   - `python -m uvicorn main:app --reload`

API will be available at `http://127.0.0.1:8000`.

## Google Maps Setup

Create Google API credentials in Google Cloud Console and enable:

- Places API
- Maps JavaScript API
- Geocoding API

Set `GOOGLE_MAPS_API_KEY` in local `.env` before using admin scrape endpoints.

## Admin Maps API (base path)

All admin routes are mounted under **`/api/admin`**. Authenticate with JWT from `POST /api/admin/login` (`Authorization: Bearer <token>`).

**Maps / Places collection**

- `POST /api/admin/maps/scrape` — body: `region`, `category`, optional `radius_km` (5–50). Same behavior as `POST /api/admin/maps-collection/scrape`.
- `GET /api/admin/maps/stats`, `GET /api/admin/maps/regions`, `GET /api/admin/maps/categories`

**Maps businesses (paginated list)**

Use any of these for the same paginated `{ data, pagination }` response; query params include `region`, `category`, `page`, `limit`, `search`, `sort`, and optional `contact_status`, `rating_min`, `is_converted_to_lead`. On `GET /api/admin/maps/businesses` only, `business_type` is accepted as an alias for `category`.

- `GET /api/admin/maps-businesses`
- `GET /api/admin/maps/businesses`
- `GET /api/admin/maps/businesses/paginated`

**Updates and export**

- `PUT /api/admin/maps/businesses/{business_id}`
- `POST /api/admin/maps/export` — body uses `format` (`csv` | `excel`) and optional `region` / `category` filters

## Git (push this folder as its own repo)

From `backend/`:

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin <your-backend-repo-url>
git push -u origin main
```

`.gitignore` excludes `.env`, virtualenvs, `*.db`, and caches. Copy `.env.example` to `.env` locally — never commit secrets.
