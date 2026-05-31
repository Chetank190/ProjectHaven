# Haven Matrix — Data Sources Reference

> All datasets used in Haven Matrix, their open-source origins, update procedures, and licensing.
> Last verified: 2026-05-30.

---

## Table of Contents

1. [Shelter System Flow](#1-shelter-system-flow--shelterscsv)
2. [Food Banks & Meal Programs](#2-food-banks--meal-programs--food_bankscsv)
3. [Rehab & Crisis Services](#3-rehab--crisis-services--rehab_servicescsv)
4. [Hygiene Stations](#4-hygiene-stations--hygiene_stationscsv)
5. [Grassroots Services](#5-grassroots-services--grassroots_servicescsv)
6. [OSM Amenities](#6-openstreetmap-amenities--osm_amenitiesjson)
7. [TTC GTFS Stops](#7-ttc-gtfs-stops--stopstxt)
8. [Youth Spaces](#8-youth-spaces--youth_spacescsv)
9. [Toronto Public Libraries](#9-toronto-public-libraries--librariescsv)
10. [Respite / Warming / Cooling Centres](#10-respite--warming--cooling-centres--respite_sitescsv)
11. [Environment Canada Weather Feed](#11-environment-canada-weather-feed--live-api)
12. [Runtime Telemetry](#12-runtime-telemetry--daily_telemetrycsv)

---

## 1. Shelter System Flow — `shelters.csv`

| Field | Value |
|-------|-------|
| **File** | `data/shelters.csv` |
| **Rows** | 290 |
| **Format** | CSV |
| **Update** | Daily (live CKAN hydration on startup) |
| **License** | [Open Government License – Toronto](https://open.toronto.ca/open-data-license/) |

### Source

**Toronto Open Data Portal (CKAN)**
- Dataset page: https://open.toronto.ca/dataset/daily-shelter-overnight-service-occupancy-capacity/
- Live API endpoint (used in `backend/config.py`):
  ```
  https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search
    ?resource_id=42714176-4f05-44e6-b157-2b57f29b856a&limit=500
  ```

### Columns

| Column | Description |
|--------|-------------|
| `ORGANIZATION_NAME` | Shelter operator name |
| `SHELTER_ADDRESS` | Street address |
| `SECTOR` | Men / Women / Mixed Adult / Youth / Family |
| `SERVICE_USER_COUNT` | Current occupancy (refreshed daily) |
| `CAPACITY_ACTUAL_BED` | Total bed capacity |
| `UNOCCUPIED_BEDS` | Available beds = Capacity − Occupancy |
| `LAT` / `LON` | Geocoordinates (pre-processed; CKAN feed lacks coords) |
| `requires_id` | Whether photo ID is required at intake |
| `harm_reduction` | Whether harm-reduction model applies |
| `accepts_walk_in` | Walk-in access without referral |
| `phone` | Contact number (211 default) |
| `hours` | Operating hours |
| `intake_preparation` | What to bring / steps before arrival |
| `bypass_pathway` | Script for caseworker if site is full |

### How Refresh Works

On startup, `data_ingestion._fetch_shelters_ckan()` attempts a live CKAN pull (10 s timeout). If CKAN data lacks `LAT`/`LON`, the local `shelters.csv` (which has pre-geocoded coordinates and eligibility flags) is used instead. Background re-hydration runs every 60 s with a 500 ms fail-safe.

### How to Update Manually

```bash
curl "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search\
?resource_id=42714176-4f05-44e6-b157-2b57f29b856a&limit=500" | python3 -c "
import json, sys, csv
d = json.load(sys.stdin)
rows = d['result']['records']
writer = csv.DictWriter(sys.stdout, fieldnames=rows[0].keys())
writer.writeheader(); writer.writerows(rows)
" > data/shelters_fresh.csv
```

---

## 2. Food Banks & Meal Programs — `food_banks.csv`

| Field | Value |
|-------|-------|
| **File** | `data/food_banks.csv` |
| **Rows** | 20 |
| **Format** | CSV |
| **Update** | Manual — verify quarterly |
| **License** | Derived from public org information |

### Sources

Hand-curated from:

| Organization | Source URL |
|---|---|
| Daily Bread Food Bank network | https://www.dailybread.ca/need-food/food-bank-finder/ |
| Scott Mission | https://www.scottmission.com |
| Yonge Street Mission | https://www.ysm.ca |
| The Meeting Place | https://tmptoronto.com |
| 519 Community Centre | https://the519.org |
| Toronto Drop-In Network (TDIN) | https://www.torontodropin.ca |
| 211 Ontario service directory | https://211ontario.ca |
| Meal Exchange | https://mealexchange.com |
| Not Far From The Tree | https://notfarfromthetree.org |

### Key Columns

`organization_name`, `address`, `lat`, `lon`, `hours`, `phone`, `requires_id`, `harm_reduction`, `bypass_pathway`, `intake_preparation`

### How to Update

1. Check each org's website for hours changes, closures, and new locations.
2. Cross-reference with 211 Ontario: https://211ontario.ca (search "food bank Toronto").
3. Geocode new addresses with the [Toronto Geocoder](https://www.toronto.ca/city-government/data-research-maps/open-data/open-data-catalogue/maps-geospatial-data/) or Google Maps API.

---

## 3. Rehab & Crisis Services — `rehab_services.csv`

| Field | Value |
|-------|-------|
| **File** | `data/rehab_services.csv` |
| **Rows** | 25 |
| **Format** | CSV |
| **Update** | Manual — verify quarterly |
| **License** | Derived from public health service information |

### Sources

| Organization / Dataset | Source |
|---|---|
| CAMH (Centre for Addiction and Mental Health) | https://www.camh.ca |
| St. Joseph's Health Centre Crisis | https://www.stjoe.on.ca |
| Turning Point — withdrawal management | https://www.turningpointcs.ca |
| ConnexOntario treatment locator | https://www.connexontario.ca (call 1-866-531-2600 or API) |
| Sojourn House | https://www.sojournhouse.org |
| 211 Ontario — mental health & addictions | https://211ontario.ca |
| Ontario MOHLTC Facility Registry | https://www.health.gov.on.ca/en/pro/programs/ohip/ohip_registry/ |

### ConnexOntario API (Recommended for Bulk Update)

ConnexOntario maintains the most complete Ontario addiction/mental-health service directory and offers a free API:

```bash
# Search for withdrawal management beds in Toronto
curl "https://api.connexontario.ca/v1/providers?service_type=withdrawal_management&region=Toronto" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Register for a key at https://www.connexontario.ca/en-ca/resources/data-api.

### Key Columns

`organization_name`, `address`, `lat`, `lon`, `service_type`, `bed_count`, `phone`, `service_description`, `accepts_walk_in`, `requires_id`, `harm_reduction`, `bypass_pathway`, `intake_preparation`

---

## 4. Hygiene Stations — `hygiene_stations.csv`

| Field | Value |
|-------|-------|
| **File** | `data/hygiene_stations.csv` |
| **Rows** | 817 |
| **Format** | CSV |
| **Update** | Hybrid — manual core + open data bulk |
| **License** | Open Government License – Toronto (for city datasets) |

### Sources

The 817 rows come from three layers merged in Session 10 (EDA expansion):

| Layer | Rows | Source |
|-------|------|--------|
| Hand-curated shower/laundry sites | ~15 | Direct org outreach |
| Toronto drinking fountains | ~798 | Toronto Open Data |
| Toronto public washrooms | ~4 | Toronto Open Data |

### Toronto Open Data — Drinking Fountains

- Dataset: **Drinking Fountains**
- URL: https://open.toronto.ca/dataset/drinking-fountains/
- Direct CKAN API:
  ```
  https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search
    ?resource_id=<drinking-fountains-resource-id>&limit=5000
  ```
- Fields: `ID`, `NAME`, `ADDRESS_FULL`, `LATITUDE`, `LONGITUDE`, `ACCESSIBLE_FOUNTAIN_IND`, `SEASONAL_IND`

### Toronto Open Data — Public Washrooms

- Dataset: **Public Washrooms**
- URL: https://open.toronto.ca/dataset/public-washrooms/
- Fields: `ID`, `NAME`, `ADDRESS_FULL`, `LATITUDE`, `LONGITUDE`, `ACCESSIBLE_IND`, `SEASONAL_IND`

### How to Update

```bash
# Refresh drinking fountains
curl "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search\
?resource_id=d1495840-3fe0-4d06-9e36-e31e1e36d6d6&limit=5000" \
  | python3 scripts/merge_hygiene.py >> data/hygiene_stations.csv
```

---

## 5. Grassroots Services — `grassroots_services.csv`

| Field | Value |
|-------|-------|
| **File** | `data/grassroots_services.csv` |
| **Rows** | 20 |
| **Format** | CSV |
| **Update** | Manual — verify quarterly |
| **License** | Derived from public org information |

### Sources

| Organization | Type | Source |
|---|---|---|
| 519 Community Centre | Meal program, LGBTQ+ welcoming | https://the519.org |
| Meal Exchange (UTSC) | Campus community lunch | https://mealexchange.com |
| Not Far From The Tree | Produce distribution | https://notfarfromthetree.org |
| Toronto Drop-In Network (TDIN) | Referral network / directory | https://www.torontodropin.ca |
| Fred Victor Centre | Meals + services | https://www.fredvictor.org |
| Evangel Hall Mission | Meals | https://www.evangelhall.ca |
| Dixon Hall | Multi-service | https://www.dixonhall.org |
| Christie Ossington Neighbourhood Centre | Community meals | https://connc.ca |
| University Settlement | Services | https://www.universitysettlement.com |
| Parkdale Activity Recreation Centre (PARC) | Drop-in meals | https://www.parc.on.ca |

### Bulk Discovery

Use the [TDIN Member Directory](https://www.torontodropin.ca/member-directory) to find additional meal/drop-in programs not listed here. 211 Ontario also supports category-filtered searches.

---

## 6. OpenStreetMap Amenities — `osm_amenities.json`

| Field | Value |
|-------|-------|
| **File** | `data/osm_amenities.json` |
| **Records** | 55 elements |
| **Format** | JSON (Overpass API format) |
| **Update** | Re-export as needed (OSM data refreshes continuously) |
| **License** | [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/) |

### Source

**OpenStreetMap** via the **Overpass API**
- Overpass Turbo UI: https://overpass-turbo.eu
- API endpoint: `https://overpass-api.de/api/interpreter`

### Query Used

The current `osm_amenities.json` was exported using this Overpass QL query (Toronto bounding box):

```overpass
[out:json][timeout:60];
(
  node["amenity"~"toilets|drinking_water|shelter|social_facility"]
    (43.5800,-79.6400,43.8600,-79.1200);
  way["amenity"~"toilets|drinking_water|shelter|social_facility"]
    (43.5800,-79.6400,43.8600,-79.1200);
);
out center;
```

### How to Refresh

```bash
# Re-fetch from Overpass API
curl -s "https://overpass-api.de/api/interpreter" \
  --data '[out:json][timeout:60];
(
  node["amenity"~"toilets|drinking_water|shelter|social_facility"]
    (43.5800,-79.6400,43.8600,-79.1200);
);
out center;' > data/osm_amenities.json
```

### Schema (per element)

```json
{
  "type": "node",
  "id": 1001,
  "lat": 43.653303,
  "lon": -79.383599,
  "tags": {
    "amenity": "toilets",
    "name": "Nathan Phillips Square Washroom",
    "access": "yes",
    "fee": "no",
    "wheelchair": "no"
  }
}
```

The ingestion layer (`data_ingestion._load_osm()`) flattens this into a DataFrame with: `osm_id`, `name`, `amenity`, `lat`, `lon`.

---

## 7. TTC GTFS Stops — `stops.txt`

| Field | Value |
|-------|-------|
| **File** | `data/stops.txt` |
| **Rows** | 9,368 |
| **Format** | GTFS standard (CSV) |
| **Update** | Periodic — TTC publishes new GTFS bundles |
| **License** | [Open Government License – Toronto](https://open.toronto.ca/open-data-license/) |

### Source

**Toronto Transit Commission (TTC) — GTFS Feed** via Toronto Open Data
- Dataset page: https://open.toronto.ca/dataset/ttc-routes-and-schedules/
- CKAN resource: search for "TTC Routes and Schedules" on https://open.toronto.ca

### GTFS Standard

The `stops.txt` file is part of the [General Transit Feed Specification](https://gtfs.org/schedule/reference/#stopstxt). Fields used by Haven Matrix:

| Column | Description |
|--------|-------------|
| `stop_id` | Unique TTC stop identifier |
| `stop_name` | Human-readable stop name |
| `stop_lat` | Latitude (renamed to `lat` on load) |
| `stop_lon` | Longitude (renamed to `lon` on load) |

The solver uses these stops to compute a **transit proximity score**: resources within 200 m of a TTC stop get a 10% score bonus (configurable via `TRANSIT_RADIUS_M` and `WEIGHT_TRANSIT` in `config.py`).

### How to Update

1. Download the latest GTFS bundle from the dataset page above.
2. Unzip and replace `data/stops.txt` with the new file.
3. No schema changes expected — GTFS `stops.txt` format is stable.

---

## 8. Youth Spaces — `youth_spaces.csv`

| Field | Value |
|-------|-------|
| **File** | `data/youth_spaces.csv` |
| **Rows** | 20 |
| **Format** | CSV |
| **Update** | Manual — verify annually |
| **License** | Derived from public org information |

### Sources

| Organization | Source |
|---|---|
| Regent Park Community Centre | https://www.toronto.ca/data/parks/prd/facilities/complex/27/index.html |
| 519 Community Centre | https://the519.org |
| Scadding Court Community Centre | https://www.scaddingcourt.org |
| Dufferin Grove Park Community House | https://www.toronto.ca/parks |
| Eva's Initiatives (Parkdale) | https://evas.ca |
| Covenant House Toronto | https://www.covenanthousetoronto.ca |
| Sprott House | https://www.sprottfoundation.org |
| Native Child and Family Services | https://www.nativechild.org |
| Youth Without Shelter | https://www.yws.on.ca |

### Toronto Open Data — Community Recreation

City-operated community centres can be found at:
- https://open.toronto.ca/dataset/parks-facilities/
- https://www.toronto.ca/data/parks/prd/

Youth-specific programming details require verifying directly with each centre.

### Key Columns

`organization_name`, `address`, `lat`, `lon`, `age_min`, `age_max`, `hours`, `phone`, `has_computers`, `has_kitchen`, `requires_id`, `harm_reduction`, `bypass_pathway`, `intake_preparation`, `occupancy_ratio`

---

## 9. Toronto Public Libraries — `libraries.csv`

| Field | Value |
|-------|-------|
| **File** | `data/libraries.csv` |
| **Rows** | 20 |
| **Format** | CSV |
| **Update** | Manual — annual or on branch changes |
| **License** | [Open Government License – Toronto](https://open.toronto.ca/open-data-license/) |

### Source

**Toronto Public Library (TPL)** via Toronto Open Data
- Dataset page: https://open.toronto.ca/dataset/library-branch-general-information/
- Full branch list with hours and coordinates is available as open data

### CKAN API

```bash
curl "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search\
?resource_id=<tpl-branch-resource-id>&limit=300" | python3 -c "
import json, csv, sys
d = json.load(sys.stdin)
rows = d['result']['records']
csv.DictWriter(sys.stdout, fieldnames=rows[0].keys()).writerows(rows)
" > data/libraries_fresh.csv
```

### Key Columns

`organization_name`, `address`, `lat`, `lon`, `hours`, `phone`, `has_wifi`, `has_computers`, `has_settlement_worker`, `requires_id`, `harm_reduction`, `bypass_pathway`, `intake_preparation`, `occupancy_ratio`

Libraries serve as a **library / respite pillar** — they provide computers, internet, settlement workers, and daytime safe indoor space without requiring ID or referral.

---

## 10. Respite / Warming / Cooling Centres — `respite_sites.csv`

| Field | Value |
|-------|-------|
| **File** | `data/respite_sites.csv` |
| **Rows** | 1,599 |
| **Format** | CSV |
| **Update** | Hybrid — manual core + open data seasonal bulk |
| **License** | Open Government License – Toronto (city data layers) |

### Sources — Three Merged Layers

| Layer | Rows | Source |
|-------|------|--------|
| City warming centres (core) | ~15 | Toronto Open Data |
| Places of worship (cold/heat refuge) | ~1,407 | EDA expansion (Session 10) |
| City cooling centres | ~177 | Toronto Open Data |

### Toronto Open Data — Warming Centres

- Dataset: **Warming Centres**
- URL: https://open.toronto.ca/dataset/warming-centres/
- Activated by City of Toronto extreme cold protocol (−15 °C or colder with wind chill)
- CKAN API:
  ```
  https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search
    ?resource_id=<warming-centres-resource-id>&limit=200
  ```

### Toronto Open Data — Cooling Centres

- Dataset: **Cooling Centres**
- URL: https://open.toronto.ca/dataset/cooling-centres/
- Activated during heat alerts (Humidex ≥ 40 °C or sustained high heat)
- CKAN API:
  ```
  https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search
    ?resource_id=<cooling-centres-resource-id>&limit=500
  ```

### Places of Worship Layer

The 1,407 places of worship were added as low-barrier refuge sites during extreme weather (many offer drop-in space to anyone). Source options:

- **OpenStreetMap**: Query `"amenity"="place_of_worship"` within Toronto bounding box via Overpass API
- **Statistics Canada**: Places of Religious Worship dataset (https://www150.statcan.gc.ca)
- **Charity Directorate**: CRA registered charities with "religious" purpose in Toronto postal codes (https://apps.cra-arc.gc.ca/ebci/hacc/srch/pub/srchRslt)

### Key Columns

`organization_name`, `address`, `lat`, `lon`, `hours`, `phone`, `pet_friendly`, `wheelchair_accessible`, `storage_available`, `requires_id`, `harm_reduction`, `bypass_pathway`, `intake_preparation`, `occupancy_ratio`, `sector`

---

## 11. Environment Canada Weather Feed — Live API

| Field | Value |
|-------|-------|
| **Type** | Live RSS feed (no local file) |
| **URL** | `https://weather.gc.ca/rss/warning/on-94_e.xml` |
| **Update** | Polled on startup + every 60 s with 500 ms fail-safe |
| **License** | Crown Copyright, Government of Canada — non-commercial use permitted |

### Purpose

Detects active weather alerts for the Toronto region (station `on-94`). Used to trigger:
- `EXTREME_COLD` → activates warming centre routing priority, boosts `respite` pillar weight
- `EXTREME_HEAT` → activates cooling centre routing priority

### Alert Detection Logic (`data_ingestion.fetch_weather_alert()`)

| Keyword in feed | Mapped alert |
|---|---|
| `extreme cold`, `wind chill warning`, `frostbite` | `EXTREME_COLD` |
| `extreme heat`, `heat warning`, `humidex` | `EXTREME_HEAT` |

### Alternative Endpoints

| Scope | URL |
|---|---|
| Toronto region (current) | `https://weather.gc.ca/rss/warning/on-94_e.xml` |
| All Ontario | `https://weather.gc.ca/rss/warning/on_e.xml` |
| GeoMet API (JSON, modern) | `https://api.weather.gc.ca/collections/alerts/items?province=ON` |

The GeoMet JSON API is more reliable for automated parsing — consider migrating if the RSS feed changes format.

---

## 12. Runtime Telemetry — `daily_telemetry.csv`

| Field | Value |
|-------|-------|
| **File** | `data/daily_telemetry.csv` |
| **Rows** | Grows at runtime |
| **Format** | CSV (append-only) |
| **Update** | Written by `backend/main.py` after every routing call |
| **License** | Internal — not an external data source |

This is **not an external data source** — it is generated by the system itself. Each row records one routing event for EDA and performance monitoring.

### Columns

| Column | Description |
|--------|-------------|
| `timestamp` | ISO-8601 UTC timestamp |
| `gateway` | `caseworker` or `kiosk` |
| `needs_list` | Pipe-separated list of detected needs |
| `compile_method` | `nim` (LLM) or `regex` (fallback) |
| `gpu_solve_ms` | cuML KNN solve time in milliseconds |
| `pillars_returned` | Pipe-separated list of pillars with results |
| `origin_lat` / `origin_lon` | Client's geocoordinates |
| `weather_alert` | Active weather alert at time of request |

---

## Summary Table

| Dataset | File | Rows | License | Live? |
|---------|------|------|---------|-------|
| Shelter System Flow | `shelters.csv` | 290 | OGL – Toronto | Yes (CKAN) |
| Food Banks & Meals | `food_banks.csv` | 20 | Public org info | No |
| Rehab & Crisis | `rehab_services.csv` | 25 | Public health info | No |
| Hygiene Stations | `hygiene_stations.csv` | 817 | OGL – Toronto (bulk) | No |
| Grassroots Services | `grassroots_services.csv` | 20 | Public org info | No |
| OSM Amenities | `osm_amenities.json` | 55 | ODbL | Re-export |
| TTC GTFS Stops | `stops.txt` | 9,368 | OGL – Toronto | Re-export |
| Youth Spaces | `youth_spaces.csv` | 20 | Public org info | No |
| Toronto Libraries | `libraries.csv` | 20 | OGL – Toronto | No |
| Respite / Warming / Cooling | `respite_sites.csv` | 1,599 | OGL – Toronto (bulk) | No |
| Environment Canada Weather | _(live feed)_ | — | Crown Copyright | Yes |
| Runtime Telemetry | `daily_telemetry.csv` | grows | Internal | Yes |

**OGL** = Open Government License · **ODbL** = Open Database License · **Crown** = Government of Canada

---

## Refresh Runbook

```bash
# 1. Shelters — auto-refreshes on startup; force manual refresh:
curl "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search\
?resource_id=42714176-4f05-44e6-b157-2b57f29b856a&limit=500" > /tmp/shelters_raw.json

# 2. TTC stops — download latest GTFS bundle from Toronto Open Data
#    Unzip and copy stops.txt to data/

# 3. OSM amenities — re-query Overpass API
curl -s "https://overpass-api.de/api/interpreter" \
  --data '[out:json][timeout:60];
(node["amenity"~"toilets|drinking_water|shelter|social_facility"]
  (43.5800,-79.6400,43.8600,-79.1200););
out center;' > data/osm_amenities.json

# 4. Warming / cooling centres — seasonal; download from Toronto Open Data
#    https://open.toronto.ca/dataset/warming-centres/
#    https://open.toronto.ca/dataset/cooling-centres/

# 5. All others — manual review; check org websites for hours/address changes
```

---

## Key Open Data Portals

| Portal | URL | Datasets used |
|--------|-----|---------------|
| Toronto Open Data | https://open.toronto.ca | Shelters, TTC GTFS, Hygiene, Libraries, Warming/Cooling Centres |
| OpenStreetMap / Overpass | https://overpass-turbo.eu | OSM Amenities |
| 211 Ontario | https://211ontario.ca | Food, Grassroots, Youth discovery |
| ConnexOntario | https://www.connexontario.ca | Rehab & Crisis discovery |
| Environment Canada | https://weather.gc.ca | Weather alerts |
| Statistics Canada | https://www150.statcan.gc.ca | Places of worship (respite expansion) |
